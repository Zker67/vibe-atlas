package store

import (
	"errors"
	"testing"
)

func TestOverview(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	other := must(s.CreateProject("另一个"))
	weapons := must(s.CreateModule(p.ID, "武器系统"))
	levels := must(s.CreateModule(p.ID, "关卡"))
	must(s.CreateModule(p.ID, "UI")) // empty
	add := func(title string, module int64, typ ItemType) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: module, Type: typ, Title: title}))
	}
	w1 := add("武器手感", weapons.ID, TypeImprove)
	w2 := add("切枪卡顿", weapons.ID, TypeBug)
	add("后坐力", weapons.ID, TypeImprove)
	l1 := add("存档点", levels.ID, TypeFeature)
	u1 := add("字体溢出", 0, TypeBug)
	must(s.CreateItem(NewItem{ProjectID: other.ID, Title: "别的项目"}))

	must(s.SetItemStatus(w1.ID, StatusDoing))
	must(s.SetItemStatus(u1.ID, StatusDoing))
	must(s.SetItemStatus(w2.ID, StatusDone))
	must(s.SetItemStatus(l1.ID, StatusDone))

	o := must(s.Overview(p.ID))
	if o.Totals != (Counts{Todo: 1, Doing: 2, Done: 2}) {
		t.Fatalf("totals = %+v", o.Totals)
	}
	wantModules := []ModuleStats{
		{ModuleID: weapons.ID, Name: "武器系统", Counts: Counts{Todo: 1, Doing: 1, Done: 1}},
		{ModuleID: levels.ID, Name: "关卡", Counts: Counts{Done: 1}},
		{ModuleID: o.Modules[2].ModuleID, Name: "UI"},
		{ModuleID: 0, Name: "未分类", Counts: Counts{Doing: 1}},
	}
	if len(o.Modules) != len(wantModules) {
		t.Fatalf("modules = %+v", o.Modules)
	}
	for i, want := range wantModules {
		if o.Modules[i] != want {
			t.Errorf("module %d = %+v, want %+v", i, o.Modules[i], want)
		}
	}
	wantTypes := []TypeStats{
		{Type: TypeImprove, Counts: Counts{Todo: 1, Doing: 1}},
		{Type: TypeBug, Counts: Counts{Doing: 1, Done: 1}},
		{Type: TypeFeature, Counts: Counts{Done: 1}},
	}
	for i, want := range wantTypes {
		if o.Types[i] != want {
			t.Errorf("type %d = %+v, want %+v", i, o.Types[i], want)
		}
	}
	if got := titles(o.Doing); got != "武器手感,字体溢出" {
		t.Errorf("doing = %s", got)
	}
	if got := titles(o.Done); got != "存档点,切枪卡顿" {
		t.Errorf("done = %s, want the latest first", got)
	}
}

func TestOverviewFollowsChanges(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	other := must(s.CreateProject("另一个"))
	m := must(s.CreateModule(p.ID, "武器系统"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "一"}))
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "二"}))

	// Done today shows in the history; reopened, it leaves it.
	must(s.SetItemStatus(a.ID, StatusDone))
	if o := must(s.Overview(p.ID)); len(o.Done) != 1 || o.Done[0].ID != a.ID || o.Done[0].DoneAt == 0 {
		t.Fatalf("done = %+v", o.Done)
	}
	must(s.SetItemStatus(a.ID, StatusTodo))
	if o := must(s.Overview(p.ID)); len(o.Done) != 0 || o.Totals.Todo != 2 {
		t.Fatalf("after reopening: %+v", o)
	}

	// Moving an item out leaves the counts of both projects right.
	must(s.MoveItemToProject(b.ID, other.ID))
	if o := must(s.Overview(p.ID)); o.Totals != (Counts{Todo: 1}) || o.Modules[0].Counts != (Counts{Todo: 1}) {
		t.Fatalf("after moving out: %+v", o)
	}
	if o := must(s.Overview(other.ID)); o.Totals != (Counts{Todo: 1}) || o.Modules[0].Name != "未分类" {
		t.Fatalf("project moved to: %+v", o)
	}

	// Deleting the module moves its items to 未分类.
	must(s.DeleteModule(m.ID))
	o := must(s.Overview(p.ID))
	if len(o.Modules) != 1 || o.Modules[0].ModuleID != 0 || o.Modules[0].Counts != (Counts{Todo: 1}) {
		t.Fatalf("after deleting the module: %+v", o.Modules)
	}

	if _, err := s.Overview(9999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("overview of a missing project: %v", err)
	}
}

func TestOverviewOfEmptyProject(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("空项目"))
	o := must(s.Overview(p.ID))
	if o.Totals != (Counts{}) || len(o.Modules) != 0 || len(o.Types) != 3 || o.Doing == nil || o.Done == nil {
		t.Fatalf("overview = %+v", o)
	}
}
