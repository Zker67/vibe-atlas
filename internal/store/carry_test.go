package store

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// TestDoneCarriesItemsUnder: a parent done takes the items under it not
// done yet to done, marked as carried; reopened, it takes exactly those
// back, each to the status it had, with when it started. Items done on
// their own stay done, with their time.
func TestDoneCarriesItemsUnder(t *testing.T) {
	s, path := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	parent := add("父改进点", 0)
	todo := add("待办的", parent.ID)
	under := add("待办的下面", todo.ID)
	doing := must(s.SetItemStatus(add("进行中的", parent.ID).ID, StatusDoing))
	before := must(s.SetItemStatus(add("先完成的", parent.ID).ID, StatusDone))

	done := must(s.SetItemStatus(parent.ID, StatusDone))
	if done.DoneWith != 0 {
		t.Fatalf("the parent itself was marked carried: %+v", done)
	}
	for _, id := range []int64{todo.ID, under.ID, doing.ID} {
		if it := must(s.Item(id)); it.Status != StatusDone || it.DoneWith != parent.ID || it.DoneAt == 0 {
			t.Fatalf("not carried: %+v", it)
		}
	}
	if it := must(s.Item(before.ID)); it.DoneWith != 0 || it.DoneAt != before.DoneAt {
		t.Fatalf("an item done before was touched: %+v, was %+v", it, before)
	}

	// The marks are in the file.
	s.Close()
	s = must(Open(path))
	defer s.Close()

	if it := must(s.ReopenItem(parent.ID)); it.Status != StatusTodo || it.DoneWith != 0 {
		t.Fatalf("parent reopened = %+v", it)
	}
	for _, c := range []struct {
		id     int64
		status ItemStatus
	}{{todo.ID, StatusTodo}, {under.ID, StatusTodo}, {doing.ID, StatusDoing}} {
		if it := must(s.Item(c.id)); it.Status != c.status || it.DoneAt != 0 || it.DoneWith != 0 {
			t.Fatalf("carried item back as %+v, want %s", it, c.status)
		}
	}
	if it := must(s.Item(doing.ID)); it.StartedAt != doing.StartedAt {
		t.Fatalf("started at %d, was %d", it.StartedAt, doing.StartedAt)
	}
	if it := must(s.Item(before.ID)); it.Status != StatusDone || it.DoneAt != before.DoneAt {
		t.Fatalf("an item done before was reopened: %+v", it)
	}
}

// TestSetStatusTakesCarriedBack: taking a done parent to do or doing by
// hand also takes back what its completion carried.
func TestSetStatusTakesCarriedBack(t *testing.T) {
	for _, status := range []ItemStatus{StatusTodo, StatusDoing} {
		s, _ := newStore(t)
		p := must(s.CreateProject("规则恐怖"))
		parent := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "父改进点"}))
		child := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "子改进点"}))
		must(s.SetItemStatus(parent.ID, StatusDone))
		if got := must(s.SetItemStatus(parent.ID, status)); got.Status != status {
			t.Fatalf("parent = %+v, want %s", got, status)
		}
		if it := must(s.Item(child.ID)); it.Status != StatusTodo || it.DoneWith != 0 {
			t.Fatalf("to %s: child = %+v", status, it)
		}
		s.Close()
	}
}

// TestDoneAgainCarriesWhatReopened: done again, a done parent carries the
// items under it reopened since, and reopening it takes them back.
func TestDoneAgainCarriesWhatReopened(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	parent := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "父改进点"}))
	child := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "子改进点"}))
	must(s.SetItemStatus(parent.ID, StatusDone))
	must(s.ReopenItem(child.ID))
	must(s.SetItemStatus(parent.ID, StatusDone))
	if it := must(s.Item(child.ID)); it.Status != StatusDone || it.DoneWith != parent.ID {
		t.Fatalf("child = %+v, want carried again", it)
	}
	must(s.ReopenItem(parent.ID))
	if it := must(s.Item(child.ID)); it.Status != StatusTodo {
		t.Fatalf("child = %+v, want back to do", it)
	}
}

// TestCarriedChangedByHand: an item carried, then changed by hand, is the
// user's: reopening the parent leaves it.
func TestCarriedChangedByHand(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	parent := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "父改进点"}))
	child := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "子改进点"}))
	other := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "另一条"}))
	must(s.SetItemStatus(parent.ID, StatusDone))
	must(s.ReopenItem(child.ID))
	if it := must(s.SetItemStatus(child.ID, StatusDone)); it.DoneWith != 0 {
		t.Fatalf("done by hand, still marked carried: %+v", it)
	}
	must(s.ReopenItem(parent.ID))
	if it := must(s.Item(child.ID)); it.Status != StatusDone {
		t.Fatalf("the user's done item was reopened: %+v", it)
	}
	if it := must(s.Item(other.ID)); it.Status != StatusTodo {
		t.Fatalf("other = %+v, want back to do", it)
	}
}

// TestCarriedThatLeft: an item carried and then moved out from under the
// parent stays done when the parent reopens, done on its own from then.
func TestCarriedThatLeft(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	parent := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "父改进点"}))
	child := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "子改进点"}))
	must(s.SetItemStatus(parent.ID, StatusDone))
	if err := s.MoveItem(child.ID, parent.ID, PlaceAfter); err != nil {
		t.Fatal(err)
	}
	must(s.ReopenItem(parent.ID))
	if it := must(s.Item(child.ID)); it.Status != StatusDone || it.DoneWith != 0 {
		t.Fatalf("moved out, then parent reopened: %+v", it)
	}
}

// TestCarryNested: what an inner parent carried stays its own; an outer
// parent done later carries only what is not done, and takes back only
// that.
func TestCarryNested(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	add := func(title string, parent int64) Item {
		return must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent, Title: title}))
	}
	outer := add("外层", 0)
	inner := add("内层", outer.ID)
	deep := add("最里面", inner.ID)
	other := add("另一条", outer.ID)
	must(s.SetItemStatus(inner.ID, StatusDone))
	must(s.SetItemStatus(outer.ID, StatusDone))
	if it := must(s.Item(deep.ID)); it.DoneWith != inner.ID {
		t.Fatalf("deep = %+v, want carried by the inner parent", it)
	}
	if it := must(s.Item(other.ID)); it.DoneWith != outer.ID {
		t.Fatalf("other = %+v, want carried by the outer parent", it)
	}

	must(s.ReopenItem(outer.ID))
	if it := must(s.Item(inner.ID)); it.Status != StatusDone {
		t.Fatalf("the inner parent, done before, was reopened: %+v", it)
	}
	if it := must(s.Item(deep.ID)); it.Status != StatusDone || it.DoneWith != inner.ID {
		t.Fatalf("deep = %+v, want still done with the inner parent", it)
	}
	if it := must(s.Item(other.ID)); it.Status != StatusTodo {
		t.Fatalf("other = %+v, want back to do", it)
	}
	must(s.ReopenItem(inner.ID))
	if it := must(s.Item(deep.ID)); it.Status != StatusTodo {
		t.Fatalf("deep = %+v, want back to do with the inner parent", it)
	}
}

// TestCarrierDeleted: deleting the parent that carried an item leaves it
// done on its own.
func TestCarrierDeleted(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	parent := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "父改进点"}))
	child := must(s.CreateItem(NewItem{ProjectID: p.ID, ParentID: parent.ID, Title: "子改进点"}))
	must(s.SetItemStatus(parent.ID, StatusDone))
	if err := s.DeleteItem(parent.ID); err != nil {
		t.Fatal(err)
	}
	if it := must(s.Item(child.ID)); it.Status != StatusDone || it.DoneWith != 0 || it.ParentID != 0 {
		t.Fatalf("child = %+v", it)
	}
}

// TestOpenUpgradesVersion2 opens a database of version 2: its items stay,
// none marked carried, so reopening a parent done then leaves its children.
func TestOpenUpgradesVersion2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		migrations[0],
		migrations[1],
		`PRAGMA user_version = 2`,
		`INSERT INTO projects (id, name, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 1, 1, 1)`,
		`INSERT INTO items (id, project_id, type, status, title, sort_order, created_at, done_at, updated_at)
			VALUES (1, 1, 'bug', 'done', '父改进点', 1, 1, 2, 2)`,
		`INSERT INTO items (id, project_id, parent_id, type, status, title, sort_order, created_at, done_at, updated_at)
			VALUES (2, 1, 1, 'bug', 'done', '子改进点', 1, 1, 2, 2)`,
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
	if it := must(s.Item(2)); it.Status != StatusDone || it.DoneWith != 0 {
		t.Fatalf("old child = %+v", it)
	}
	must(s.ReopenItem(1))
	if it := must(s.Item(2)); it.Status != StatusDone {
		t.Fatalf("old child = %+v, want still done", it)
	}
	must(s.SetItemStatus(1, StatusDone))
	if it := must(s.Item(2)); it.DoneWith != 0 {
		t.Fatalf("a child done already was marked carried: %+v", it)
	}
}
