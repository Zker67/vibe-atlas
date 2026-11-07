package store

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

// tree draws a project's items as their structure: siblings in their
// order, children in brackets, as "A,P[B,C[D]],E".
func tree(t *testing.T, s *Store, projectID int64) string {
	t.Helper()
	items := must(s.Items(projectID))
	children := map[int64][]Item{}
	for _, it := range items {
		children[it.ParentID] = append(children[it.ParentID], it)
	}
	for _, list := range children {
		for i := 1; i < len(list); i++ {
			for j := i; j > 0 && (list[j].SortOrder < list[j-1].SortOrder ||
				list[j].SortOrder == list[j-1].SortOrder && list[j].ID < list[j-1].ID); j-- {
				list[j], list[j-1] = list[j-1], list[j]
			}
		}
	}
	var draw func(parent int64) string
	draw = func(parent int64) string {
		var parts []string
		for _, it := range children[parent] {
			part := it.Title
			if len(children[it.ID]) > 0 {
				part += "[" + draw(it.ID) + "]"
			}
			parts = append(parts, part)
		}
		return strings.Join(parts, ",")
	}
	return draw(0)
}

func wantTree(t *testing.T, s *Store, projectID int64, want string) {
	t.Helper()
	if got := tree(t, s, projectID); got != want {
		t.Fatalf("tree = %s\nwant   %s", got, want)
	}
}

func TestMergeItemsMakesAParent(t *testing.T) {
	s, path := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器"))
	add := func(title string) Item { return must(s.CreateItem(NewItem{ProjectID: p.ID, Title: title})) }
	a := add("A")
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Type: TypeBug, Title: "修复切枪时卡一帧"}))
	c := add("C")
	d := add("D")

	// D dropped on B: a parent takes B's place, B first, then D.
	parent := must(s.MergeItems(d.ID, b.ID))
	if parent.Title != "修复切枪时卡等 2 个改进点" {
		t.Fatalf("parent title = %q", parent.Title)
	}
	if parent.Type != TypeBug || parent.ModuleID != m.ID || parent.Status != StatusTodo || parent.ParentID != 0 {
		t.Fatalf("parent = %+v", parent)
	}
	wantTree(t, s, p.ID, fmt.Sprintf("A,%s[修复切枪时卡一帧,D],C", parent.Title))

	// The title counts the children it has.
	must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "E"}))
	if got := must(s.Item(parent.ID)).Title; got != "修复切枪时卡等 3 个改进点" {
		t.Fatalf("after adding a child, title = %q", got)
	}
	if err := s.MoveItem(c.ID, parent.ID, PlaceInside); err != nil {
		t.Fatal(err)
	}
	if got := must(s.Item(parent.ID)).Title; got != "修复切枪时卡等 4 个改进点" {
		t.Fatalf("after moving a child in, title = %q", got)
	}
	// A short first title is taken whole; the first child decides.
	if err := s.MoveItem(a.ID, b.ID, PlaceBefore); err != nil {
		t.Fatal(err)
	}
	if got := must(s.Item(parent.ID)).Title; got != "A等 5 个改进点" {
		t.Fatalf("with a new first child, title = %q", got)
	}
	// Once the user renames the parent, the title is theirs.
	must(s.SetItemTitle(parent.ID, "武器手感"))
	if err := s.MoveItem(c.ID, parent.ID, PlaceAfter); err != nil {
		t.Fatal(err)
	}
	if got := must(s.Item(parent.ID)).Title; got != "武器手感" {
		t.Fatalf("after renaming, title = %q", got)
	}
	wantTree(t, s, p.ID, "武器手感[A,修复切枪时卡一帧,D,E],C")

	// The structure outlives the app.
	s.Close()
	s2 := must(Open(path))
	defer s2.Close()
	wantTree(t, s2, p.ID, "武器手感[A,修复切枪时卡一帧,D,E],C")
}

func TestMergeDoneItemsMakesADoneParent(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "A"}))
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "B"}))
	c := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "C"}))
	must(s.SetItemStatus(a.ID, StatusDone))
	must(s.SetItemStatus(b.ID, StatusDone))
	if got := must(s.MergeItems(b.ID, a.ID)); got.Status != StatusDone || got.DoneAt == 0 {
		t.Fatalf("parent of done items = %+v", got)
	}
	if got := must(s.MergeItems(c.ID, b.ID)); got.Status != StatusTodo || got.DoneAt != 0 {
		t.Fatalf("parent of done and to do = %+v", got)
	}
}

func TestNestingHasNoLimit(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	parent := int64(0)
	var ids []int64
	for i := range 30 {
		it := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: fmt.Sprintf("L%d", i)}))
		ids = append(ids, it.ID)
		parent = it.ID
	}
	desc := must(s.Descendants(ids[0]))
	if len(desc) != 29 || desc[28].ID != ids[29] {
		t.Fatalf("descendants of the root: %d", len(desc))
	}
	// Nothing goes inside itself or what is under it.
	wantUserErr(t, s.MoveItem(ids[0], ids[29], PlaceInside), "不能移到自己")
	wantUserErr(t, s.MoveItem(ids[3], ids[10], PlaceBefore), "不能移到自己")
	_, err := s.MergeItems(ids[0], ids[15])
	wantUserErr(t, err, "不能和自己的子改进点合并")
	_, err = s.MergeItems(ids[2], ids[2])
	wantUserErr(t, err, "不能和自己合并")
	// Out to the top level, by its place next to a top-level item.
	if err := s.MoveItem(ids[20], ids[0], PlaceAfter); err != nil {
		t.Fatal(err)
	}
	if got := must(s.Item(ids[20])); got.ParentID != 0 {
		t.Fatalf("parent after moving out = %d", got.ParentID)
	}
	if got := must(s.Item(ids[21])); got.ParentID != ids[20] {
		t.Fatalf("a moved item keeps its children: parent of L21 = %d", got.ParentID)
	}
}

func TestMoveItemAmongChildren(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	x := add("X", 0)
	a, b, c := add("A", x.ID), add("B", x.ID), add("C", x.ID)
	y := add("Y", 0)
	steps := []struct {
		id, anchor int64
		place      Place
		want       string
	}{
		{c.ID, a.ID, PlaceBefore, "X[C,A,B],Y"},
		{c.ID, b.ID, PlaceAfter, "X[A,B,C],Y"},
		{y.ID, b.ID, PlaceBefore, "X[A,Y,B,C]"},
		{a.ID, y.ID, PlaceInside, "X[Y[A],B,C]"},
		{x.ID, x.ID, PlaceAfter, "X[Y[A],B,C]"},
		{b.ID, x.ID, PlaceBefore, "B,X[Y[A],C]"},
	}
	for _, step := range steps {
		if err := s.MoveItem(step.id, step.anchor, step.place); err != nil {
			t.Fatal(err)
		}
		wantTree(t, s, p.ID, step.want)
	}
}

func TestDeleteParentKeepsChildren(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	add("A", 0)
	x := add("X", 0)
	b := add("B", x.ID)
	add("D", b.ID)
	add("C", x.ID)
	add("E", 0)
	if err := s.DeleteItem(x.ID); err != nil {
		t.Fatal(err)
	}
	wantTree(t, s, p.ID, "A,B[D],C,E")
	if err := s.DeleteItem(b.ID); err != nil {
		t.Fatal(err)
	}
	wantTree(t, s, p.ID, "A,D,C,E")
}

func TestMoveItemToProjectTakesItsChildren(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("另一个"))
	m := must(s.CreateModule(p.ID, "武器"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, ModuleID: m.ID, Title: title}))
	}
	x := add("X", 0)
	b := add("B", x.ID)
	add("C", b.ID)
	add("D", x.ID)
	must(s.CreateItem(NewItem{ProjectID: q.ID, Title: "原有"}))

	moved := must(s.MoveItemToProject(b.ID, q.ID))
	if moved.ParentID != 0 || moved.ProjectID != q.ID || moved.ModuleID != 0 {
		t.Fatalf("moved = %+v", moved)
	}
	wantTree(t, s, p.ID, "X[D]")
	wantTree(t, s, q.ID, "原有,B[C]")
	for _, it := range must(s.Items(q.ID)) {
		if it.ModuleID != 0 {
			t.Fatalf("%s keeps module %d", it.Title, it.ModuleID)
		}
	}
}

func TestCreateItemChecksParent(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("另一个"))
	x := must(s.CreateItem(NewItem{ProjectID: q.ID, Title: "X"}))
	_, err := s.CreateItem(NewItem{ProjectID: p.ID, ParentID: x.ID, Title: "A"})
	wantUserErr(t, err, "上级改进点不属于这个项目")
}

func TestAutoTitle(t *testing.T) {
	cases := []struct {
		first string
		n     int
		want  string
	}{
		{"修复登录按钮颜色不对", 2, "修复登录按钮等 2 个改进点"},
		{"切枪", 3, "切枪等 3 个改进点"},
		{"Fix the jump", 2, "Fix th等 2 个改进点"},
		{"Ab cd ef", 2, "Ab cd等 2 个改进点"},
	}
	for _, c := range cases {
		if got := autoTitle(c.first, c.n); got != c.want {
			t.Errorf("autoTitle(%q, %d) = %q, want %q", c.first, c.n, got, c.want)
		}
	}
}

// TestOpenUpgradesVersion1 opens a database the first prototype wrote:
// its items stay, all at the top level.
func TestOpenUpgradesVersion1(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		migrations[0],
		`PRAGMA user_version = 1`,
		`INSERT INTO projects (id, name, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 1, 1, 1)`,
		`INSERT INTO items (project_id, type, status, title, sort_order, created_at, updated_at) VALUES (1, 'bug', 'todo', '旧的一条', 1, 1, 1)`,
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
	items := must(s.Items(1))
	if len(items) != 1 || items[0].Title != "旧的一条" || items[0].ParentID != 0 {
		t.Fatalf("items = %+v", items)
	}
	child := must(s.CreateItem(NewItem{ProjectID: 1, ParentID: items[0].ID, Title: "新的子项"}))
	if child.ParentID != items[0].ID {
		t.Fatalf("child = %+v", child)
	}
}
