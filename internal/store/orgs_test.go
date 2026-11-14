package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

// orgNames returns the names of the organizations, in their order.
func orgNames(t *testing.T, s *Store) []string {
	t.Helper()
	var names []string
	for _, o := range must(s.Orgs()) {
		names = append(names, o.Name)
	}
	return names
}

func TestNewDatabaseHasPersonal(t *testing.T) {
	s, _ := newStore(t)
	orgs := must(s.Orgs())
	if len(orgs) != 1 || orgs[0].ID != PersonalOrg || orgs[0].Name != "个人" || !orgs[0].Personal || orgs[0].Icon != "" {
		t.Fatalf("orgs = %+v", orgs)
	}
	p := must(s.CreateProject("规则恐怖"))
	if p.OrgID != PersonalOrg {
		t.Fatalf("a new project is in org %d", p.OrgID)
	}
}

func TestCreateAndEditOrgs(t *testing.T) {
	s, _ := newStore(t)
	work := must(s.CreateOrg(OrgDraft{Name: "  IndieArk  ", Icon: "lucide:Briefcase"}))
	if work.Name != "IndieArk" || work.Icon != "lucide:Briefcase" || work.Personal {
		t.Fatalf("created = %+v", work)
	}
	_, err := s.CreateOrg(OrgDraft{Name: "indieark"})
	wantUserErr(t, err, "已经有叫「indieark」的组织了")
	_, err = s.CreateOrg(OrgDraft{Name: "   "})
	wantUserErr(t, err, "组织名称不能为空")
	_, err = s.CreateOrg(OrgDraft{Name: "四十一个字四十一个字四十一个字四十一个字四十一个字四十一个字四十一个字四十一个字一"})
	wantUserErr(t, err, "不能超过 40 个字")
	_, err = s.CreateOrg(OrgDraft{Name: "客户", Icon: "nope"})
	wantUserErr(t, err, "图标不对")
	must(s.CreateOrg(OrgDraft{Name: "客户"}))
	if got := orgNames(t, s); len(got) != 3 || got[0] != "个人" || got[1] != "IndieArk" || got[2] != "客户" {
		t.Fatalf("orgs = %v", got)
	}

	// 个人 can be renamed and get an icon, like any other.
	me := must(s.EditOrg(PersonalOrg, OrgDraft{Name: "我自己", Icon: "emoji:🐧"}))
	if me.Name != "我自己" || me.Icon != "emoji:🐧" || !me.Personal {
		t.Fatalf("edited = %+v", me)
	}
	_, err = s.EditOrg(PersonalOrg, OrgDraft{Name: "客户"})
	wantUserErr(t, err, "已经有叫「客户」的组织了")
	// The same name in another case is its own name.
	if o := must(s.EditOrg(work.ID, OrgDraft{Name: "INDIEARK"})); o.Name != "INDIEARK" || o.Icon != "" {
		t.Fatalf("edited = %+v", o)
	}
	if _, err := s.EditOrg(99, OrgDraft{Name: "不存在"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("edit a missing org: %v", err)
	}
}

func TestProjectsInOrgs(t *testing.T) {
	s, _ := newStore(t)
	work := must(s.CreateOrg(OrgDraft{Name: "IndieArk"}))
	mine := must(s.AddProject(ProjectDraft{Name: "规则恐怖"}, ""))
	site := must(s.AddProject(ProjectDraft{Name: "官网", OrgID: work.ID}, ""))
	if mine.OrgID != PersonalOrg || site.OrgID != work.ID {
		t.Fatalf("orgs: %d, %d", mine.OrgID, site.OrgID)
	}
	if _, err := s.AddProject(ProjectDraft{Name: "孤儿", OrgID: 99}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("add to a missing org: %v", err)
	}

	// Names are unique among all organizations; the error says where the other one is.
	_, err := s.AddProject(ProjectDraft{Name: "官网"}, "")
	wantUserErr(t, err, "组织「IndieArk」里已经有叫「官网」的项目了")
	_, err = s.AddProject(ProjectDraft{Name: "官网", OrgID: work.ID}, "")
	wantUserErr(t, err, "已经有叫「官网」的项目了")
	_, err = s.RenameProject(mine.ID, "官网")
	wantUserErr(t, err, "组织「IndieArk」里")
	_, err = s.EditProject(site.ID, ProjectDraft{Name: "规则恐怖"}, "")
	wantUserErr(t, err, "组织「个人」里已经有叫「规则恐怖」的项目了")

	// Editing a project leaves its organization alone.
	if p := must(s.EditProject(site.ID, ProjectDraft{Name: "公司官网", OrgID: PersonalOrg}, "")); p.OrgID != work.ID {
		t.Fatalf("edit moved the project to %d", p.OrgID)
	}

	// Moved, a project goes to the end of the list, with what it holds.
	m := must(s.CreateModule(mine.ID, "关卡"))
	it := must(s.CreateItem(NewItem{ProjectID: mine.ID, ModuleID: m.ID, Type: TypeBug, Title: "跳不过去"}))
	moved := must(s.SetProjectOrg(mine.ID, work.ID))
	if moved.OrgID != work.ID || moved.SortOrder <= site.SortOrder {
		t.Fatalf("moved = %+v, site at %d", moved, site.SortOrder)
	}
	if got := must(s.Item(it.ID)); got.ProjectID != mine.ID || got.ModuleID != m.ID {
		t.Fatalf("item after the move = %+v", got)
	}
	if again := must(s.SetProjectOrg(mine.ID, work.ID)); again.SortOrder != moved.SortOrder {
		t.Fatalf("a move to its own org changed its place: %d → %d", moved.SortOrder, again.SortOrder)
	}
	if _, err := s.SetProjectOrg(mine.ID, 99); !errors.Is(err, ErrNotFound) {
		t.Fatalf("move to a missing org: %v", err)
	}
	if _, err := s.SetProjectOrg(99, work.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("move a missing project: %v", err)
	}
}

func TestDeleteOrgMovesItsProjects(t *testing.T) {
	s, _ := newStore(t)
	work := must(s.CreateOrg(OrgDraft{Name: "IndieArk"}))
	empty := must(s.CreateOrg(OrgDraft{Name: "空的"}))
	a := must(s.AddProject(ProjectDraft{Name: "官网", OrgID: work.ID}, ""))
	b := must(s.AddProject(ProjectDraft{Name: "后台", OrgID: work.ID}, ""))
	it := must(s.CreateItem(NewItem{ProjectID: a.ID, Type: TypeImprove, Title: "首页改版"}))

	_, err := s.DeleteOrg(PersonalOrg)
	wantUserErr(t, err, "「个人」是默认的组织，不能删除")
	if n := must(s.DeleteOrg(empty.ID)); n != 0 {
		t.Fatalf("deleting an empty org moved %d", n)
	}
	if n := must(s.DeleteOrg(work.ID)); n != 2 {
		t.Fatalf("moved %d projects, want 2", n)
	}
	if got := orgNames(t, s); len(got) != 1 || got[0] != "个人" {
		t.Fatalf("orgs = %v", got)
	}
	for _, id := range []int64{a.ID, b.ID} {
		if p := must(s.Project(id)); p.OrgID != PersonalOrg {
			t.Fatalf("project %d is in org %d", id, p.OrgID)
		}
	}
	if got := must(s.Item(it.ID)); got.Title != "首页改版" {
		t.Fatalf("item = %+v", got)
	}
	if _, err := s.DeleteOrg(work.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete again: %v", err)
	}
	// Its name is free again.
	must(s.CreateOrg(OrgDraft{Name: "IndieArk"}))
}

func TestOrgIconIsAReference(t *testing.T) {
	s, _ := newStore(t)
	const pic = "image:0123456789abcdef.png"
	must(s.CreateOrg(OrgDraft{Name: "IndieArk", Icon: pic}))
	if got := must(s.TextsWith("0123456789abcdef.png")); len(got) != 1 || got[0] != pic {
		t.Fatalf("texts = %q", got)
	}
}

// TestOpenUpgradesVersion6 opens a database of version 6 with projects:
// they all go to 个人, which is there, and keep what they hold.
func TestOpenUpgradesVersion6(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range append(migrations[:6:6],
		`PRAGMA user_version = 6`,
		`INSERT INTO projects (id, name, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 1, 1, 1), (2, '官网', 2, 1, 1)`,
		`INSERT INTO items (id, project_id, type, status, title, sort_order, created_at, updated_at) VALUES (1, 2, 'bug', 'todo', 'A', 1, 1, 1)`,
	) {
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
	orgs := must(s.Orgs())
	if len(orgs) != 1 || orgs[0].ID != PersonalOrg || orgs[0].Name != "个人" || orgs[0].CreatedAt == 0 {
		t.Fatalf("orgs = %+v", orgs)
	}
	projects := must(s.Projects())
	if len(projects) != 2 {
		t.Fatalf("projects = %+v", projects)
	}
	for _, p := range projects {
		if p.OrgID != PersonalOrg {
			t.Fatalf("project %q is in org %d", p.Name, p.OrgID)
		}
	}
	if projects[1].Counts.Todo != 1 {
		t.Fatalf("counts = %+v", projects[1].Counts)
	}
	work := must(s.CreateOrg(OrgDraft{Name: "IndieArk"}))
	if p := must(s.SetProjectOrg(2, work.ID)); p.OrgID != work.ID {
		t.Fatalf("moved = %+v", p)
	}
}
