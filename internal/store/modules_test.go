package store

import (
	"errors"
	"strings"
	"testing"
)

func TestModules(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	other := must(s.CreateProject("另一个"))
	weapons := must(s.CreateModule(p.ID, " 武器系统 "))
	if weapons.Name != "武器系统" || weapons.ProjectID != p.ID {
		t.Fatalf("module = %+v", weapons)
	}
	must(s.CreateModule(p.ID, "UI"))
	_, err := s.CreateModule(p.ID, "ui")
	wantUserErr(t, err, "已经有")
	_, err = s.CreateModule(p.ID, "")
	wantUserErr(t, err, "不能为空")
	_, err = s.CreateModule(p.ID, strings.Repeat("模", 41))
	wantUserErr(t, err, "不能超过")
	// The same name in another project is fine.
	must(s.CreateModule(other.ID, "UI"))
	_, err = s.CreateModule(9999, "UI")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("module of a missing project: %v", err)
	}

	renamed := must(s.RenameModule(weapons.ID, "武器"))
	if renamed.Name != "武器" {
		t.Fatalf("renamed = %+v", renamed)
	}
	_, err = s.RenameModule(weapons.ID, "UI")
	wantUserErr(t, err, "已经有")
	if ms := must(s.Modules(p.ID)); len(ms) != 2 || ms[0].Name != "武器" || ms[1].Name != "UI" {
		t.Fatalf("modules = %+v", ms)
	}
}

func TestDeleteModuleKeepsItsItemsUnsorted(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器系统"))
	keep := must(s.CreateModule(p.ID, "人物"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "一"}))
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "二"}))
	c := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: keep.ID, Title: "三"}))
	must(s.SetItemStatus(b.ID, StatusDone))

	moved := must(s.DeleteModule(m.ID))
	if moved != 2 {
		t.Fatalf("moved = %d, want 2", moved)
	}
	for _, id := range []int64{a.ID, b.ID} {
		if it := must(s.Item(id)); it.ModuleID != 0 || it.ProjectID != p.ID {
			t.Fatalf("item %d after deleting its module: %+v", id, it)
		}
	}
	if it := must(s.Item(c.ID)); it.ModuleID != keep.ID {
		t.Fatalf("item of another module: %+v", it)
	}
	if it := must(s.Item(b.ID)); it.Status != StatusDone {
		t.Fatalf("status changed: %+v", it)
	}
	if _, err := s.DeleteModule(m.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting twice: %v", err)
	}
}

func TestModuleCounts(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器系统"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "一"}))
	must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "二"}))
	must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "未分类的"}))
	must(s.SetItemStatus(a.ID, StatusDone))
	ms := must(s.Modules(p.ID))
	if ms[0].Counts != (Counts{Todo: 1, Done: 1}) {
		t.Fatalf("counts = %+v", ms[0].Counts)
	}
}

func TestReorderModules(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	other := must(s.CreateProject("另一个"))
	a := must(s.CreateModule(p.ID, "A"))
	b := must(s.CreateModule(p.ID, "B"))
	c := must(s.CreateModule(p.ID, "C"))
	foreign := must(s.CreateModule(other.ID, "X"))
	// A module of another project in the list is ignored.
	if err := s.ReorderModules(p.ID, []int64{c.ID, foreign.ID, a.ID, b.ID}); err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, m := range must(s.Modules(p.ID)) {
		names = append(names, m.Name)
	}
	if strings.Join(names, "") != "CAB" {
		t.Fatalf("order = %v", names)
	}
	if ms := must(s.Modules(other.ID)); len(ms) != 1 || ms[0].Name != "X" {
		t.Fatalf("other project's modules = %+v", ms)
	}
}
