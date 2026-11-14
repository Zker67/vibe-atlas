package store

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// depsText lists the prerequisites of a project as "A>B" pairs by title,
// sorted, so tests read them at a glance.
func depsText(t *testing.T, s *Store, projectID int64) string {
	t.Helper()
	items := must(s.Items(projectID))
	title := map[int64]string{}
	for _, it := range items {
		title[it.ID] = it.Title
	}
	var out []string
	for _, d := range must(s.Deps(projectID)) {
		out = append(out, fmt.Sprintf("%s>%s", title[d.FromID], title[d.ToID]))
	}
	slices.Sort(out)
	return strings.Join(out, ",")
}

func wantDeps(t *testing.T, s *Store, projectID int64, want string) {
	t.Helper()
	if got := depsText(t, s, projectID); got != want {
		t.Fatalf("deps = %q, want %q", got, want)
	}
}

func TestAddAndRemoveDeps(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("别的项目"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	a, b, c := add("A", 0), add("B", 0), add("C", 0)
	x := add("X", 0)
	x1 := add("X1", x.ID)
	other := must(s.CreateItem(NewItem{ProjectID: q.ID, Title: "O"}))

	d := must(s.AddDep(a.ID, b.ID))
	if d.FromID != a.ID || d.ToID != b.ID || d.CreatedAt == 0 {
		t.Fatalf("AddDep = %+v", d)
	}
	// Once more: the one there, as it is.
	if again := must(s.AddDep(a.ID, b.ID)); again != d {
		t.Fatalf("adding it again = %+v, want %+v", again, d)
	}
	must(s.AddDep(b.ID, c.ID))
	wantDeps(t, s, p.ID, "A>B,B>C")

	_, err := s.AddDep(a.ID, a.ID)
	wantUserErr(t, err, "同一条")
	_, err = s.AddDep(c.ID, a.ID)
	wantUserErr(t, err, "循环")
	_, err = s.AddDep(b.ID, a.ID)
	wantUserErr(t, err, "「B」已经在等「A」")
	_, err = s.AddDep(a.ID, other.ID)
	wantUserErr(t, err, "同一个项目")
	_, err = s.AddDep(x.ID, x1.ID)
	wantUserErr(t, err, "上级或子改进点")
	_, err = s.AddDep(x1.ID, x.ID)
	wantUserErr(t, err, "上级或子改进点")
	_, err = s.AddDep(a.ID, 9999)
	if err != ErrNotFound {
		t.Fatalf("a missing item: %v", err)
	}
	// The child of X may wait for an item outside X.
	must(s.AddDep(a.ID, x1.ID))
	wantDeps(t, s, p.ID, "A>B,A>X1,B>C")
	// Other projects show none of them.
	wantDeps(t, s, q.ID, "")

	must(struct{}{}, s.RemoveDep(a.ID, x1.ID))
	must(struct{}{}, s.RemoveDep(a.ID, x1.ID)) // twice: nothing
	wantDeps(t, s, p.ID, "A>B,B>C")

	// Moving X1 under C afterwards keeps what was there.
	must(s.AddDep(c.ID, x1.ID))
	must(struct{}{}, s.MoveItem(x1.ID, c.ID, PlaceInside))
	wantDeps(t, s, p.ID, "A>B,B>C,C>X1")

	// Deleting an item for good takes its prerequisites along.
	must(struct{}{}, s.DeleteItem(b.ID))
	wantDeps(t, s, p.ID, "C>X1")
	// Deleting the project takes the rest.
	must(struct{}{}, s.DeleteProject(p.ID))
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM item_deps`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("deps left after the project went: %d, %v", n, err)
	}
}

func TestDepsThroughTheTrash(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string) Item { return must(s.CreateItem(NewItem{ProjectID: p.ID, Title: title})) }
	a, b, c := add("A"), add("B"), add("C")
	must(s.AddDep(a.ID, b.ID))
	must(s.AddDep(b.ID, c.ID))
	must(struct{}{}, s.SetCanvas(p.ID, []CanvasSpot{{ItemID: b.ID, X: 120, Y: -40.5}}))

	batch := must(s.TrashItems([]int64{b.ID}))
	wantDeps(t, s, p.ID, "")
	if spots := must(s.Canvas(p.ID)); len(spots) != 0 {
		t.Fatalf("a trashed item keeps its place: %+v", spots)
	}
	must(s.RestoreBatch(batch))
	wantDeps(t, s, p.ID, "A>B,B>C")
	if spots := must(s.Canvas(p.ID)); len(spots) != 1 || spots[0] != (CanvasSpot{ItemID: b.ID, X: 120, Y: -40.5}) {
		t.Fatalf("restored place = %+v", spots)
	}

	// Both ends trashed together, then undone: the prerequisite comes back.
	batch = must(s.TrashItems([]int64{a.ID, b.ID}))
	wantDeps(t, s, p.ID, "")
	must(s.RestoreBatch(batch))
	wantDeps(t, s, p.ID, "A>B,B>C")

	// Trashed apart, the later one restored first: the prerequisite waits in
	// the entry of the one still in the trash, and comes back with it.
	must(s.TrashItems([]int64{b.ID}))
	must(s.TrashItems([]int64{a.ID}))
	entries := must(s.Trash())
	idOf := func(item int64) int64 {
		for _, e := range entries {
			if e.Item.ID == item {
				return e.ID
			}
		}
		t.Fatalf("item %d is not in the trash", item)
		return 0
	}
	must(s.RestoreTrash([]int64{idOf(b.ID)}))
	wantDeps(t, s, p.ID, "B>C")
	must(s.RestoreTrash([]int64{idOf(a.ID)}))
	wantDeps(t, s, p.ID, "A>B,B>C")

	// One that would close a loop now is left out: with A > B > C > D,
	// the trash says A also waited for D.
	d := add("D")
	must(s.AddDep(c.ID, d.ID))
	must(s.TrashItems([]int64{a.ID}))
	var entry int64
	var depsJSON string
	if err := s.db.QueryRow(`SELECT id, deps FROM trash WHERE item_id = ?`, a.ID).Scan(&entry, &depsJSON); err != nil {
		t.Fatal(err)
	}
	loop := strings.TrimSuffix(depsJSON, "]") + fmt.Sprintf(`,{"id":%d,"created":%d,"next":false}]`, d.ID, d.CreatedAt)
	if _, err := s.db.Exec(`UPDATE trash SET deps = ? WHERE id = ?`, loop, entry); err != nil {
		t.Fatal(err)
	}
	must(s.RestoreTrash([]int64{entry}))
	// D > A would make A > B > C > D > A: only A > B came back.
	wantDeps(t, s, p.ID, "A>B,B>C,C>D")

	// Purged for good: nothing comes back, nothing breaks.
	must(s.TrashItems([]int64{b.ID}))
	entries = must(s.Trash())
	must(struct{}{}, s.PurgeTrash([]int64{entries[0].ID}))
	wantDeps(t, s, p.ID, "C>D")
}

func TestMoveToProjectBreaksDeps(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("别的项目"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	a := add("A", 0)
	x := add("X", 0)
	x1 := add("X1", x.ID)
	x2 := add("X2", x.ID)
	must(s.AddDep(a.ID, x1.ID))
	must(s.AddDep(x1.ID, x2.ID))
	must(struct{}{}, s.SetCanvas(p.ID, []CanvasSpot{{ItemID: a.ID, X: 1, Y: 2}, {ItemID: x1.ID, X: 3, Y: 4}}))

	must(s.MoveItemToProject(x.ID, q.ID))
	wantDeps(t, s, p.ID, "")
	wantDeps(t, s, q.ID, "X1>X2")
	if spots := must(s.Canvas(q.ID)); len(spots) != 0 {
		t.Fatalf("moved items keep their places: %+v", spots)
	}
	if spots := must(s.Canvas(p.ID)); len(spots) != 1 || spots[0].ItemID != a.ID {
		t.Fatalf("places left = %+v", spots)
	}
}

func TestOverviewReady(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string) Item { return must(s.CreateItem(NewItem{ProjectID: p.ID, Title: title})) }
	a, b, c, d, e := add("A"), add("B"), add("C"), add("D"), add("E")
	must(s.AddDep(a.ID, b.ID)) // B waits for A
	must(s.AddDep(a.ID, c.ID)) // C waits for A and D
	must(s.AddDep(d.ID, c.ID))
	must(s.AddDep(a.ID, e.ID)) // E waits for A, but is doing
	must(s.SetItemStatus(e.ID, StatusDoing))

	ready := func() string {
		var out []string
		for _, it := range must(s.Overview(p.ID)).Ready {
			out = append(out, it.Title)
		}
		return strings.Join(out, ",")
	}
	if got := ready(); got != "" {
		t.Fatalf("ready = %q with A not done", got)
	}
	must(s.SetItemStatus(a.ID, StatusDone))
	if got := ready(); got != "B" {
		t.Fatalf("ready = %q, want B", got)
	}
	must(s.SetItemStatus(d.ID, StatusDone))
	if got := ready(); got != "B,C" {
		t.Fatalf("ready = %q, want B,C", got)
	}
}

func TestCanvas(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("别的项目"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "A"}))
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "B"}))
	o := must(s.CreateItem(NewItem{ProjectID: q.ID, Title: "O"}))

	// Items of another project, or gone, are left out.
	must(struct{}{}, s.SetCanvas(p.ID, []CanvasSpot{{ItemID: a.ID, X: 10, Y: 20}, {ItemID: o.ID, X: 1, Y: 1}, {ItemID: 9999, X: 1, Y: 1}}))
	must(struct{}{}, s.SetCanvas(p.ID, []CanvasSpot{{ItemID: a.ID, X: 30, Y: 40}, {ItemID: b.ID, X: -5, Y: 0}}))
	got := must(s.Canvas(p.ID))
	if len(got) != 2 || got[0] != (CanvasSpot{ItemID: a.ID, X: 30, Y: 40}) || got[1] != (CanvasSpot{ItemID: b.ID, X: -5, Y: 0}) {
		t.Fatalf("canvas = %+v", got)
	}
	if got := must(s.Canvas(q.ID)); len(got) != 0 {
		t.Fatalf("canvas of the other project = %+v", got)
	}
	wantUserErr(t, s.SetCanvas(p.ID, []CanvasSpot{{ItemID: a.ID, X: 1e9, Y: 0}}), "超出范围")
	if err := s.SetCanvas(9999, nil); err != ErrNotFound {
		t.Fatalf("a missing project: %v", err)
	}

	must(struct{}{}, s.ClearCanvas(p.ID, []int64{a.ID, o.ID}))
	if got := must(s.Canvas(p.ID)); len(got) != 1 || got[0].ItemID != b.ID {
		t.Fatalf("canvas after clearing = %+v", got)
	}
	must(struct{}{}, s.DeleteItem(b.ID))
	if got := must(s.Canvas(p.ID)); len(got) != 0 {
		t.Fatalf("canvas keeps a deleted item: %+v", got)
	}
}

// TestOpenUpgradesVersion5 opens a database of version 5, with an item in
// the trash: it comes back without prerequisites or a place.
func TestOpenUpgradesVersion5(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		migrations[0], migrations[1], migrations[2], migrations[3], migrations[4],
		`PRAGMA user_version = 5`,
		`INSERT INTO projects (id, name, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 1, 1, 1)`,
		`INSERT INTO items (id, project_id, type, status, title, sort_order, created_at, updated_at) VALUES (1, 1, 'bug', 'todo', 'A', 1, 1, 1)`,
		`INSERT INTO trash (batch, deleted_at, item_id, project_id, place, type, status, title, note, deeplink, auto_title, created_at, updated_at)
			VALUES (1, 5, 2, 1, 1, 'improve', 'todo', 'B', '', '', 0, 2, 2)`,
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
	wantDeps(t, s, 1, "")
	back := must(s.RestoreBatch(1))
	if len(back) != 1 || back[0].Title != "B" {
		t.Fatalf("restored = %+v", back)
	}
	must(s.AddDep(1, 2))
	wantDeps(t, s, 1, "A>B")
	if got := must(s.Canvas(1)); len(got) != 0 {
		t.Fatalf("canvas = %+v", got)
	}
}
