package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func TestTrashAndRestoreItem(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	a := add("A", 0)
	x := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Type: TypeBug, Title: "X", Note: "备注", Deeplink: "https://example.com/x"}))
	add("B", x.ID)
	add("C", x.ID)
	add("E", 0)
	must(s.SetItemStatus(x.ID, StatusDoing))
	x = must(s.Item(x.ID))

	batch := must(s.TrashItems([]int64{x.ID}))
	wantTree(t, s, p.ID, "A,B,C,E")
	if _, err := s.Item(x.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a trashed item is still in the project: %v", err)
	}
	trash := must(s.Trash())
	if len(trash) != 1 || trash[0].Batch != batch || trash[0].Lifted != 2 {
		t.Fatalf("trash = %+v", trash)
	}
	got := trash[0].Item
	if got.ID != x.ID || got.Title != "X" || got.Note != "备注" || got.ModuleID != m.ID || got.Status != StatusDoing || got.StartedAt != x.StartedAt {
		t.Fatalf("trash keeps %+v, want %+v", got, x)
	}
	if n := must(s.TrashCount()); n != 1 {
		t.Fatalf("TrashCount = %d", n)
	}

	// A new item does not take the id of the one in the trash.
	y := add("Y", 0)
	if y.ID <= x.ID {
		t.Fatalf("a new item took id %d, the trash has %d", y.ID, x.ID)
	}

	back := must(s.RestoreTrash([]int64{trash[0].ID}))
	if len(back) != 1 || back[0].ID != x.ID {
		t.Fatalf("restored = %+v", back)
	}
	r := back[0]
	if r.Title != "X" || r.Type != TypeBug || r.Note != "备注" || r.Deeplink != "https://example.com/x" ||
		r.ModuleID != m.ID || r.Status != StatusDoing || r.StartedAt != x.StartedAt || r.CreatedAt != x.CreatedAt {
		t.Fatalf("restored %+v, want %+v", r, x)
	}
	wantTree(t, s, p.ID, "A,X[B,C],E,Y")
	if n := must(s.TrashCount()); n != 0 {
		t.Fatalf("TrashCount after restore = %d", n)
	}
	if _, err := s.RestoreTrash([]int64{trash[0].ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restoring twice: %v", err)
	}
	_ = a
}

func TestRestoreLeavesChildrenMovedSince(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	add("A", 0)
	x := add("X", 0)
	add("B", x.ID)
	c := add("C", x.ID)
	e := add("E", 0)

	must(s.TrashItems([]int64{x.ID}))
	// C goes under E meanwhile: it is no longer where X left it.
	if err := s.MoveItem(c.ID, e.ID, PlaceInside); err != nil {
		t.Fatal(err)
	}
	must(s.RestoreTrash([]int64{must(s.Trash())[0].ID}))
	wantTree(t, s, p.ID, "A,X[B],E[C]")
}

func TestTrashSeveralAndUndoBatch(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	add("A", 0)
	g := add("G", 0)
	x := add("X", g.ID)
	c := add("C", x.ID)
	add("D", x.ID)
	z := add("Z", 0)

	// X and C, its child, together; then Z on its own.
	b1 := must(s.TrashItems([]int64{x.ID, c.ID}))
	wantTree(t, s, p.ID, "A,G[D],Z")
	b2 := must(s.TrashItems([]int64{z.ID}))
	if b2 == b1 {
		t.Fatalf("two deletions share batch %d", b1)
	}
	wantTree(t, s, p.ID, "A,G[D]")

	back := must(s.RestoreBatch(b1))
	if len(back) != 2 || back[0].ID != x.ID || back[1].ID != c.ID {
		t.Fatalf("restored = %+v", back)
	}
	wantTree(t, s, p.ID, "A,G[X[C,D]]")
	if n := must(s.TrashCount()); n != 1 {
		t.Fatalf("TrashCount = %d, want Z left", n)
	}
	_, err := s.RestoreBatch(b1)
	wantUserErr(t, err, "已经没有")

	// One that fails leaves the others in the trash.
	if _, err := s.TrashItems([]int64{g.ID, 9999}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
	wantTree(t, s, p.ID, "A,G[X[C,D]]")
	_, err = s.TrashItems(nil)
	wantUserErr(t, err, "没有要删除")
}

func TestRestoreWithoutItsParentOrModule(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, ModuleID: m.ID, Title: title}))
	}
	add("A", 0)
	x := add("X", 0)
	c := add("C", x.ID)
	add("B", 0)

	must(s.TrashItems([]int64{c.ID}))
	// Its parent and its module are deleted for good meanwhile.
	if err := s.DeleteItem(x.ID); err != nil {
		t.Fatal(err)
	}
	must(s.DeleteModule(m.ID))
	back := must(s.RestoreTrash([]int64{must(s.Trash())[0].ID}))
	if back[0].ParentID != 0 || back[0].ModuleID != 0 {
		t.Fatalf("restored = %+v, want top level, 未分类", back[0])
	}
	wantTree(t, s, p.ID, "A,B,C")
}

func TestRestoreUnderParentInTrashGoesTopLevel(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	x := add("X", 0)
	c := add("C", x.ID)
	add("D", x.ID)

	must(s.TrashItems([]int64{c.ID}))
	must(s.TrashItems([]int64{x.ID}))
	trash := must(s.Trash()) // X, then C
	must(s.RestoreTrash([]int64{trash[1].ID}))
	wantTree(t, s, p.ID, "D,C")
	// X back now: D comes back under it, C stays where it went.
	must(s.RestoreTrash([]int64{trash[0].ID}))
	wantTree(t, s, p.ID, "X[D],C")
}

func TestRestoreCarriesAgain(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	x := add("X", 0)
	c := add("C", x.ID)
	must(s.SetItemStatus(c.ID, StatusDoing))
	must(s.SetItemStatus(x.ID, StatusDone))

	must(s.TrashItems([]int64{x.ID}))
	if it := must(s.Item(c.ID)); it.DoneWith != 0 {
		t.Fatalf("carried by an item in the trash: %+v", it)
	}
	must(s.RestoreTrash([]int64{must(s.Trash())[0].ID}))
	if it := must(s.Item(c.ID)); it.DoneWith != x.ID || it.ParentID != x.ID {
		t.Fatalf("child after restore = %+v", it)
	}
	// Reopening X takes C back to doing, as before the deletion.
	must(s.ReopenItem(x.ID))
	if it := must(s.Item(c.ID)); it.Status != StatusDoing {
		t.Fatalf("child after reopen = %+v", it)
	}
}

func TestRestoreKeepsAutoTitles(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "第一条改进点"}))
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "第二条"}))
	c := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "第三条"}))
	parent := must(s.MergeItems(b.ID, a.ID))
	if err := s.MoveItem(c.ID, parent.ID, PlaceInside); err != nil {
		t.Fatal(err)
	}
	must(s.TrashItems([]int64{c.ID}))
	if it := must(s.Item(parent.ID)); it.Title != "第一条改进点等 2 个改进点" {
		t.Fatalf("title = %q", it.Title)
	}
	must(s.RestoreTrash([]int64{must(s.Trash())[0].ID}))
	if it := must(s.Item(parent.ID)); it.Title != "第一条改进点等 3 个改进点" {
		t.Fatalf("title after restore = %q", it.Title)
	}
}

func TestPurgeAndEmptyTrash(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("另一个"))
	var ids []int64
	for _, title := range []string{"一", "二", "三"} {
		ids = append(ids, must(s.CreateItem(NewItem{ProjectID: p.ID, Title: title, Note: "![](image:" + title + ".png)"})).ID)
	}
	other := must(s.CreateItem(NewItem{ProjectID: q.ID, Title: "别处"}))
	must(s.TrashItems(ids[:1]))
	cutoff := s.millis()
	must(s.TrashItems(ids[1:]))

	// The notes in the trash still hold their pictures.
	if texts := must(s.TextsWith("image:")); len(texts) != 3 {
		t.Fatalf("TextsWith = %q", texts)
	}
	if n := must(s.PurgeTrashBefore(cutoff)); n != 1 {
		t.Fatalf("PurgeTrashBefore = %d, want 1", n)
	}
	trash := must(s.Trash())
	if len(trash) != 2 || trash[0].Item.Title != "三" || trash[1].Item.Title != "二" {
		t.Fatalf("trash = %+v", trash)
	}
	if err := s.PurgeTrash([]int64{trash[0].ID}); err != nil {
		t.Fatal(err)
	}
	if texts := must(s.TextsWith("image:")); len(texts) != 1 {
		t.Fatalf("TextsWith after purge = %q", texts)
	}

	// Deleting a project takes its entries of the trash along.
	must(s.TrashItems([]int64{other.ID}))
	if err := s.DeleteProject(q.ID); err != nil {
		t.Fatal(err)
	}
	if n := must(s.TrashCount()); n != 1 {
		t.Fatalf("TrashCount = %d, want 1", n)
	}
	if n := must(s.EmptyTrash()); n != 1 {
		t.Fatalf("EmptyTrash = %d", n)
	}
	if n := must(s.TrashCount()); n != 0 {
		t.Fatalf("TrashCount = %d", n)
	}
}

// TestOpenUpgradesVersion3 opens a database of version 3: its items stay,
// and the trash comes empty.
func TestOpenUpgradesVersion3(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		migrations[0],
		migrations[1],
		migrations[2],
		`PRAGMA user_version = 3`,
		`INSERT INTO projects (id, name, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 1, 1, 1)`,
		`INSERT INTO items (id, project_id, type, status, title, sort_order, created_at, updated_at)
			VALUES (7, 1, 'bug', 'todo', '旧改进点', 1, 1, 1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()

	s := must(Open(path))
	defer s.Close()
	if v := must(s.Version()); v != schemaVersion {
		t.Fatalf("version = %d, want %d", v, schemaVersion)
	}
	if n := must(s.TrashCount()); n != 0 {
		t.Fatalf("TrashCount = %d", n)
	}
	must(s.TrashItems([]int64{7}))
	back := must(s.RestoreTrash([]int64{must(s.Trash())[0].ID}))
	if back[0].ID != 7 || back[0].Title != "旧改进点" {
		t.Fatalf("restored = %+v", back)
	}
}
