package store

import (
	"errors"
	"strings"
	"testing"
)

func titles(items []Item) string {
	var out []string
	for _, it := range items {
		out = append(out, it.Title)
	}
	return strings.Join(out, ",")
}

func TestCreateItem(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器系统"))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "  全面优化\n武器手感  "}))
	if it.Title != "全面优化 武器手感" || it.Type != TypeImprove || it.Status != StatusTodo || it.ModuleID != 0 {
		t.Fatalf("item = %+v", it)
	}
	if it.StartedAt != 0 || it.DoneAt != 0 || it.CreatedAt == 0 {
		t.Fatalf("times = %+v", it)
	}
	bug := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Type: TypeBug, Title: "切枪卡一帧"}))
	if bug.Type != TypeBug || bug.ModuleID != m.ID {
		t.Fatalf("bug = %+v", bug)
	}
	if bug.SortOrder <= it.SortOrder {
		t.Fatalf("a new item goes last: %d after %d", bug.SortOrder, it.SortOrder)
	}
}

func TestCreateItemRejects(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	other := must(s.CreateProject("另一个"))
	foreign := must(s.CreateModule(other.ID, "UI"))

	_, err := s.CreateItem(NewItem{ProjectID: p.ID, Title: " \n "})
	wantUserErr(t, err, "不能为空")
	_, err = s.CreateItem(NewItem{ProjectID: p.ID, Title: strings.Repeat("字", 301)})
	wantUserErr(t, err, "不能超过")
	_, err = s.CreateItem(NewItem{ProjectID: p.ID, Type: "chore", Title: "x"})
	wantUserErr(t, err, "未知的类型")
	_, err = s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: foreign.ID, Title: "x"})
	wantUserErr(t, err, "不属于")
	_, err = s.CreateItem(NewItem{ProjectID: 9999, Title: "x"})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("item of a missing project: %v", err)
	}
	if items := must(s.Items(p.ID)); len(items) != 0 {
		t.Fatalf("rejected items were saved: %+v", items)
	}
}

func TestEditItem(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器系统"))
	other := must(s.CreateProject("另一个"))
	foreign := must(s.CreateModule(other.ID, "UI"))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "一"}))

	it = must(s.SetItemTitle(it.ID, "武器手感"))
	it = must(s.SetItemType(it.ID, TypeFeature))
	it = must(s.SetItemModule(it.ID, m.ID))
	it = must(s.SetItemNote(it.ID, "- [ ] 后坐力\n- [x] 换弹"))
	if it.Title != "武器手感" || it.Type != TypeFeature || it.ModuleID != m.ID || it.Note != "- [ ] 后坐力\n- [x] 换弹" {
		t.Fatalf("item = %+v", it)
	}
	_, err := s.SetItemTitle(it.ID, "")
	wantUserErr(t, err, "不能为空")
	_, err = s.SetItemType(it.ID, "")
	wantUserErr(t, err, "未知的类型")
	_, err = s.SetItemModule(it.ID, foreign.ID)
	wantUserErr(t, err, "不属于")
	_, err = s.SetItemModule(it.ID, 9999)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing module: %v", err)
	}
	it = must(s.SetItemModule(it.ID, 0))
	if it.ModuleID != 0 {
		t.Fatalf("module not cleared: %+v", it)
	}
	_, err = s.SetItemNote(9999, "x")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
}

func TestStatusChanges(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "一"}))

	doing := must(s.SetItemStatus(it.ID, StatusDoing))
	if doing.Status != StatusDoing || doing.StartedAt == 0 || doing.DoneAt != 0 {
		t.Fatalf("doing = %+v", doing)
	}
	// The same status again changes nothing.
	again := must(s.SetItemStatus(it.ID, StatusDoing))
	if again.StartedAt != doing.StartedAt || again.UpdatedAt != doing.UpdatedAt {
		t.Fatalf("setting doing twice restamped it: %+v then %+v", doing, again)
	}
	done := must(s.SetItemStatus(it.ID, StatusDone))
	if done.Status != StatusDone || done.DoneAt <= done.StartedAt || done.StartedAt != doing.StartedAt {
		t.Fatalf("done = %+v", done)
	}
	reopened := must(s.SetItemStatus(it.ID, StatusTodo))
	if reopened.Status != StatusTodo || reopened.DoneAt != 0 || reopened.StartedAt != 0 {
		t.Fatalf("reopened = %+v", reopened)
	}
	// Done straight from to do, never started.
	direct := must(s.SetItemStatus(it.ID, StatusDone))
	if direct.DoneAt == 0 || direct.StartedAt != 0 {
		t.Fatalf("done from to do = %+v", direct)
	}
	// And from done back to doing.
	back := must(s.SetItemStatus(it.ID, StatusDoing))
	if back.DoneAt != 0 || back.StartedAt == 0 {
		t.Fatalf("doing from done = %+v", back)
	}
	_, err := s.SetItemStatus(it.ID, "archived")
	wantUserErr(t, err, "未知的状态")
}

func TestManyItemsDoingAtOnce(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	for _, title := range []string{"一", "二", "三"} {
		it := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: title}))
		must(s.SetItemStatus(it.ID, StatusDoing))
	}
	doing := 0
	for _, it := range must(s.Items(p.ID)) {
		if it.Status == StatusDoing {
			doing++
		}
	}
	if doing != 3 {
		t.Fatalf("%d items doing, want 3", doing)
	}
}

func TestItemsOrder(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string) Item { return must(s.CreateItem(NewItem{ProjectID: p.ID, Title: title})) }
	t1, t2, t3 := add("待办1"), add("待办2"), add("待办3")
	d1, d2 := add("进行1"), add("进行2")
	f1, f2 := add("完成1"), add("完成2")
	_ = t1
	_ = t3
	must(s.SetItemStatus(d2.ID, StatusDoing))
	must(s.SetItemStatus(d1.ID, StatusDoing))
	must(s.SetItemStatus(f1.ID, StatusDone))
	must(s.SetItemStatus(f2.ID, StatusDone))
	if err := s.MoveItem(t2.ID, t1.ID, PlaceBefore); err != nil {
		t.Fatal(err)
	}
	// Doing in the order started, to do in the user's order, done the
	// latest first.
	want := "进行2,进行1,待办2,待办1,待办3,完成2,完成1"
	if got := titles(must(s.Items(p.ID))); got != want {
		t.Fatalf("order = %s\nwant    %s", got, want)
	}
}

func TestMoveItemReorders(t *testing.T) {
	s, path := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器"))
	add := func(title string, module int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: module, Title: title}))
	}
	a, b, c, d, e := add("A", m.ID), add("B", 0), add("C", m.ID), add("D", 0), add("E", m.ID)
	order := func() string {
		var out []string
		for _, it := range must(s.Items(p.ID)) {
			if it.Status == StatusTodo {
				out = append(out, it.Title)
			}
		}
		return strings.Join(out, "")
	}
	steps := []struct {
		id, anchor int64
		place      Place
		want       string
	}{
		{e.ID, a.ID, PlaceBefore, "EABCD"}, // to the top
		{e.ID, d.ID, PlaceAfter, "ABCDE"},  // to the bottom
		{a.ID, c.ID, PlaceAfter, "BCADE"},  // down
		{d.ID, b.ID, PlaceBefore, "DBCAE"}, // up
		{c.ID, c.ID, PlaceBefore, "DBCAE"}, // onto itself
		// Dragging in the list filtered to module 武器 (C, A, E): E above C
		// puts it right before C in the whole list.
		{e.ID, c.ID, PlaceBefore, "DBECA"},
	}
	for _, step := range steps {
		if err := s.MoveItem(step.id, step.anchor, step.place); err != nil {
			t.Fatal(err)
		}
		if got := order(); got != step.want {
			t.Fatalf("order = %s, want %s", got, step.want)
		}
	}
	// The order outlives the app.
	s.Close()
	s2 := must(Open(path))
	defer s2.Close()
	var got []string
	for _, it := range must(s2.Items(p.ID)) {
		got = append(got, it.Title)
	}
	if strings.Join(got, "") != "DBECA" {
		t.Fatalf("after reopening, order = %v", got)
	}
}

func TestMoveItemRejects(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	other := must(s.CreateProject("另一个"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "A"}))
	x := must(s.CreateItem(NewItem{ProjectID: other.ID, Title: "X"}))
	wantUserErr(t, s.MoveItem(a.ID, x.ID, PlaceBefore), "只能在同一个项目里")
	wantUserErr(t, s.MoveItem(a.ID, a.ID, PlaceInside), "不能移到自己")
	wantUserErr(t, s.MoveItem(a.ID, a.ID, "sideways"), "未知的位置")
	if err := s.MoveItem(a.ID, 9999, PlaceBefore); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing anchor: %v", err)
	}
}

func TestReopenedItemKeepsItsPlace(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string) Item { return must(s.CreateItem(NewItem{ProjectID: p.ID, Title: title})) }
	add("A")
	b := add("B")
	add("C")
	must(s.SetItemStatus(b.ID, StatusDoing))
	must(s.SetItemStatus(b.ID, StatusTodo))
	if got := titles(must(s.Items(p.ID))); got != "A,B,C" {
		t.Fatalf("order = %s, want A,B,C", got)
	}
}

func TestMoveItemToProject(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	q := must(s.CreateProject("另一个"))
	m := must(s.CreateModule(p.ID, "武器"))
	existing := must(s.CreateItem(NewItem{ProjectID: q.ID, Title: "原有"}))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Type: TypeBug, Title: "记错项目了"}))
	must(s.SetItemStatus(it.ID, StatusDoing))

	moved := must(s.MoveItemToProject(it.ID, q.ID))
	if moved.ProjectID != q.ID || moved.ModuleID != 0 || moved.Type != TypeBug || moved.Status != StatusDoing {
		t.Fatalf("moved = %+v", moved)
	}
	if moved.SortOrder <= existing.SortOrder {
		t.Fatalf("a moved item goes last: %d after %d", moved.SortOrder, existing.SortOrder)
	}
	if items := must(s.Items(p.ID)); len(items) != 0 {
		t.Fatalf("left behind: %+v", items)
	}
	if _, err := s.MoveItemToProject(it.ID, 9999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing project: %v", err)
	}
	// Moving to its own project changes nothing.
	same := must(s.MoveItemToProject(it.ID, q.ID))
	if same.SortOrder != moved.SortOrder {
		t.Fatalf("moving to its own project: %+v", same)
	}
}

func TestDeleteItem(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "一"}))
	if err := s.DeleteItem(it.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Item(it.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted item: %v", err)
	}
	if err := s.DeleteItem(it.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting twice: %v", err)
	}
}

func TestDeeplinkOnItem(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "一"}))
	it = must(s.SetItemDeeplink(it.ID, "  https://chatgpt.com/c/abc  "))
	if it.Deeplink != "https://chatgpt.com/c/abc" {
		t.Fatalf("deeplink = %q", it.Deeplink)
	}
	_, err := s.SetItemDeeplink(it.ID, "随便写的文字")
	wantUserErr(t, err, "完整的链接")
	if got := must(s.Item(it.ID)); got.Deeplink != "https://chatgpt.com/c/abc" {
		t.Fatalf("a rejected link replaced the old one: %q", got.Deeplink)
	}
	it = must(s.SetItemDeeplink(it.ID, ""))
	if it.Deeplink != "" {
		t.Fatalf("deeplink not cleared: %q", it.Deeplink)
	}
}

// Quick capture saves the notes and the link with the new item, checked as
// SetItemNote and SetItemDeeplink check them.
func TestCreateItemWithDetails(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "切枪卡一帧", Note: "## 复现\n- 连按 Q", Deeplink: "  https://chatgpt.com/c/abc  "}))
	if it.Note != "## 复现\n- 连按 Q" || it.Deeplink != "https://chatgpt.com/c/abc" {
		t.Fatalf("item = %+v", it)
	}
	if got := must(s.Item(it.ID)); got.Note != it.Note || got.Deeplink != it.Deeplink {
		t.Fatalf("saved = %+v", got)
	}

	_, err := s.CreateItem(NewItem{ProjectID: p.ID, Title: "x", Deeplink: "随便写的文字"})
	wantUserErr(t, err, "完整的链接")
	_, err = s.CreateItem(NewItem{ProjectID: p.ID, Title: "x", Note: strings.Repeat("字", maxText+1)})
	wantUserErr(t, err, "太长")
	if items := must(s.Items(p.ID)); len(items) != 1 {
		t.Fatalf("rejected items were saved: %s", titles(items))
	}
}
