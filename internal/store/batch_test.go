package store

import (
	"errors"
	"testing"
)

func TestSetItemsTypeAndModule(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("另一个"))
	m := must(s.CreateModule(p.ID, "武器"))
	other := must(s.CreateModule(q.ID, "别处"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "一"}))
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "二"}))
	c := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "三"}))

	got := must(s.SetItemsType([]int64{a.ID, b.ID}, TypeBug))
	if len(got) != 2 || got[0].ID != a.ID || got[1].ID != b.ID || got[0].Type != TypeBug || got[1].Type != TypeBug {
		t.Fatalf("SetItemsType = %+v", got)
	}
	if it := must(s.Item(c.ID)); it.Type != TypeImprove {
		t.Fatalf("an item not asked changed: %+v", it)
	}
	_, err := s.SetItemsType([]int64{a.ID}, "nope")
	wantUserErr(t, err, "未知的类型")

	got = must(s.SetItemsModule([]int64{a.ID, c.ID}, m.ID))
	if got[0].ModuleID != m.ID || got[1].ModuleID != m.ID {
		t.Fatalf("SetItemsModule = %+v", got)
	}
	if it := must(s.Item(b.ID)); it.ModuleID != 0 {
		t.Fatalf("an item not asked changed module: %+v", it)
	}

	// One that fails leaves all of them as they were.
	if _, err := s.SetItemsModule([]int64{a.ID, 9999}, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
	_, err = s.SetItemsModule([]int64{b.ID, a.ID}, other.ID)
	wantUserErr(t, err, "不属于当前项目")
	if it := must(s.Item(a.ID)); it.ModuleID != m.ID {
		t.Fatalf("a failed batch changed the module: %+v", it)
	}
	if _, err := s.SetItemsType([]int64{b.ID, 9999}, TypeFeature); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
	if it := must(s.Item(b.ID)); it.Type != TypeBug {
		t.Fatalf("a failed batch changed the kind: %+v", it)
	}
}

func TestMoveItemsToProject(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("另一个"))
	m := must(s.CreateModule(p.ID, "武器"))
	existing := must(s.CreateItem(NewItem{ProjectID: q.ID, Title: "原有"}))
	x := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "父"}))
	x1 := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: x.ID, Title: "子"}))
	g := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: x1.ID, Title: "孙"}))
	y := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "另一条"}))
	stay := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "留下"}))

	// x1 sits under x: it goes along with x and stays under it.
	moved := must(s.MoveItemsToProject([]int64{x.ID, x1.ID, y.ID}, q.ID))
	if len(moved) != 3 {
		t.Fatalf("moved = %+v", moved)
	}
	if got := titles(must(s.Items(q.ID))); got != "原有,父,子,孙,另一条" {
		t.Fatalf("items of q = %s", got)
	}
	if it := must(s.Item(x1.ID)); it.ParentID != x.ID || it.ProjectID != q.ID {
		t.Fatalf("the child left its parent: %+v", it)
	}
	if it := must(s.Item(g.ID)); it.ParentID != x1.ID || it.ProjectID != q.ID || it.ModuleID != 0 {
		t.Fatalf("grandchild = %+v", it)
	}
	if it := must(s.Item(x.ID)); it.ParentID != 0 || it.ModuleID != 0 || it.SortOrder <= existing.SortOrder {
		t.Fatalf("x = %+v", it)
	}
	if it := must(s.Item(y.ID)); it.SortOrder <= must(s.Item(x.ID)).SortOrder {
		t.Fatalf("the order of ids is kept: y %d after x", it.SortOrder)
	}
	if got := titles(must(s.Items(p.ID))); got != "留下" {
		t.Fatalf("left in p = %s", got)
	}

	// One that fails moves none.
	if _, err := s.MoveItemsToProject([]int64{stay.ID, 9999}, q.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
	if _, err := s.MoveItemsToProject([]int64{stay.ID}, 9999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing project: %v", err)
	}
	if it := must(s.Item(stay.ID)); it.ProjectID != p.ID {
		t.Fatalf("a failed batch moved it: %+v", it)
	}
}

func TestDeleteItems(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	first := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "前"}))
	parent := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "父"}))
	c1 := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "子一"}))
	must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: c1.ID, Title: "孙"}))
	must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "子二"}))
	last := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "后"}))

	// What stays moves up into the place of the nearest item above it that stays.
	if err := s.DeleteItems([]int64{parent.ID, c1.ID}); err != nil {
		t.Fatal(err)
	}
	items := must(s.Items(p.ID))
	if got := titles(items); got != "前,孙,子二,后" {
		t.Fatalf("items = %s", got)
	}
	for _, it := range items {
		if it.ParentID != 0 {
			t.Fatalf("still under a deleted item: %+v", it)
		}
	}

	// One that fails deletes none.
	if err := s.DeleteItems([]int64{first.ID, 9999}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
	if _, err := s.Item(first.ID); err != nil {
		t.Fatalf("a failed batch deleted it: %v", err)
	}
	if err := s.DeleteItems([]int64{first.ID, last.ID}); err != nil {
		t.Fatal(err)
	}
	if got := titles(must(s.Items(p.ID))); got != "孙,子二" {
		t.Fatalf("items = %s", got)
	}
}
