package store

import (
	"errors"
	"slices"
	"testing"
)

// TestProjectActivity: only the organization's projects, in order; only
// items done since the time asked for; the last change of a project or its
// items.
func TestProjectActivity(t *testing.T) {
	s, _ := newStore(t)
	a := must(s.CreateProject("规则恐怖"))
	b := must(s.CreateProject("官网"))
	work := must(s.CreateOrg(OrgDraft{Name: "IndieArk"}))
	other := must(s.AddProject(ProjectDraft{Name: "后台", OrgID: work.ID}, ""))
	must(s.CreateItem(NewItem{ProjectID: other.ID, Title: "别的组织"}))
	must(s.SetItemStatus(must(s.CreateItem(NewItem{ProjectID: other.ID, Title: "别的组织完成"})).ID, StatusDone))

	early := must(s.CreateItem(NewItem{ProjectID: a.ID, Title: "早"}))
	early = must(s.SetItemStatus(early.ID, StatusDone))
	since := early.DoneAt + 1
	one := must(s.SetItemStatus(must(s.CreateItem(NewItem{ProjectID: a.ID, Title: "一"})).ID, StatusDone))
	two := must(s.SetItemStatus(must(s.CreateItem(NewItem{ProjectID: a.ID, Title: "二"})).ID, StatusDone))
	doing := must(s.SetItemStatus(must(s.CreateItem(NewItem{ProjectID: a.ID, Title: "进行中"})).ID, StatusDoing))
	// Done, then reopened: it no longer counts.
	back := must(s.SetItemStatus(must(s.CreateItem(NewItem{ProjectID: a.ID, Title: "又打开"})).ID, StatusDone))
	back = must(s.SetItemStatus(back.ID, StatusTodo))

	got := must(s.ProjectActivity(PersonalOrg, since))
	if len(got) != 2 || got[0].ProjectID != a.ID || got[1].ProjectID != b.ID {
		t.Fatalf("activity = %+v", got)
	}
	if !slices.Equal(got[0].Done, []int64{one.DoneAt, two.DoneAt}) {
		t.Fatalf("done = %v, want %v", got[0].Done, []int64{one.DoneAt, two.DoneAt})
	}
	if got[0].LastActive != back.UpdatedAt || got[0].LastActive <= doing.UpdatedAt {
		t.Fatalf("last active = %d, want %d", got[0].LastActive, back.UpdatedAt)
	}
	// No items: the project's own last change, and an empty list, not null.
	if got[1].LastActive != b.UpdatedAt || got[1].Done == nil || len(got[1].Done) != 0 {
		t.Fatalf("empty project = %+v", got[1])
	}
	// The project's own change counts too.
	renamed := must(s.RenameProject(b.ID, "官网 2"))
	if got := must(s.ProjectActivity(PersonalOrg, since)); got[1].LastActive != renamed.UpdatedAt {
		t.Fatalf("after rename = %+v", got[1])
	}

	theirs := must(s.ProjectActivity(work.ID, 0))
	if len(theirs) != 1 || theirs[0].ProjectID != other.ID || len(theirs[0].Done) != 1 {
		t.Fatalf("other organization = %+v", theirs)
	}
	if _, err := s.ProjectActivity(9999, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing organization: %v", err)
	}
}
