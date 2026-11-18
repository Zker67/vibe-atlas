package store

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestCreateProject(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("  规则   恐怖 \n"))
	if p.Name != "规则 恐怖" {
		t.Fatalf("name = %q, want white space folded", p.Name)
	}
	if p.ID == 0 || p.CreatedAt == 0 || p.Counts != (Counts{}) {
		t.Fatalf("project = %+v", p)
	}
}

func TestCreateProjectRejects(t *testing.T) {
	s, _ := newStore(t)
	must(s.CreateProject("Rule Horror"))
	cases := map[string]string{
		"":                      "不能为空",
		"   ":                   "不能为空",
		"rule horror":           "已经有",
		"RULE  HORROR":          "已经有",
		strings.Repeat("长", 61): "不能超过",
		strings.Repeat("a", 61): "不能超过",
	}
	for name, want := range cases {
		_, err := s.CreateProject(name)
		wantUserErr(t, err, want)
	}
	// 60 characters is the limit, not past it.
	must(s.CreateProject(strings.Repeat("长", 60)))
}

func TestRenameProject(t *testing.T) {
	s, _ := newStore(t)
	a := must(s.CreateProject("A 项目"))
	b := must(s.CreateProject("B 项目"))
	// Renaming to its own name, in another case, is fine.
	if got := must(s.RenameProject(a.ID, "a 项目")); got.Name != "a 项目" {
		t.Fatalf("name = %q", got.Name)
	}
	_, err := s.RenameProject(b.ID, "A 项目")
	wantUserErr(t, err, "已经有")
	_, err = s.RenameProject(9999, "C")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("renaming a missing project: %v", err)
	}
}

func TestProjectDescriptionAndFolder(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	p = must(s.SetProjectDescription(p.ID, "# 规则恐怖\n\n一款**恐怖**游戏"))
	if p.Description != "# 规则恐怖\n\n一款**恐怖**游戏" {
		t.Fatalf("description = %q", p.Description)
	}

	dir := filepath.Join(t.TempDir(), "规则 恐怖")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	p = must(s.SetProjectFolder(p.ID, dir))
	if p.FolderPath != dir || !p.FolderExists {
		t.Fatalf("folder = %q, exists = %v", p.FolderPath, p.FolderExists)
	}
	// A folder that disappears is kept, and reported missing.
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	p = must(s.Project(p.ID))
	if p.FolderPath != dir || p.FolderExists {
		t.Fatalf("after removing the folder: %q, exists = %v", p.FolderPath, p.FolderExists)
	}
	_, err := s.SetProjectFolder(p.ID, "relative/path")
	wantUserErr(t, err, "完整路径")
	p = must(s.SetProjectFolder(p.ID, ""))
	if p.FolderPath != "" || p.FolderExists {
		t.Fatalf("after unbinding: %+v", p)
	}
}

func TestDeleteProjectDeletesItsModulesAndItems(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	other := must(s.CreateProject("另一个"))
	m := must(s.CreateModule(p.ID, "武器系统"))
	must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Title: "一"}))
	must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "二"}))
	kept := must(s.CreateItem(NewItem{ProjectID: other.ID, Title: "别的项目的"}))

	if err := s.DeleteProject(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Project(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted project: %v", err)
	}
	var modules, items int
	s.db.QueryRow(`SELECT COUNT(*) FROM modules WHERE project_id = ?`, p.ID).Scan(&modules)
	s.db.QueryRow(`SELECT COUNT(*) FROM items WHERE project_id = ?`, p.ID).Scan(&items)
	if modules != 0 || items != 0 {
		t.Fatalf("left %d modules and %d items", modules, items)
	}
	must(s.Item(kept.ID))
	if err := s.DeleteProject(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting twice: %v", err)
	}
}

func TestProjectCounts(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "一"}))
	b := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "二"}))
	must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "三"}))
	must(s.SetItemStatus(a.ID, StatusDoing))
	must(s.SetItemStatus(b.ID, StatusDone))
	ps := must(s.Projects())
	if ps[0].Counts != (Counts{Todo: 1, Doing: 1, Done: 1}) {
		t.Fatalf("counts = %+v", ps[0].Counts)
	}
}

func TestReorderProjects(t *testing.T) {
	s, _ := newStore(t)
	a := must(s.CreateProject("A"))
	b := must(s.CreateProject("B"))
	c := must(s.CreateProject("C"))
	d := must(s.CreateProject("D"))
	// A partial order with an unknown id and a repeat: the listed ones go
	// first, the others keep their order after them.
	if err := s.ReorderProjects([]int64{c.ID, 4242, a.ID, c.ID}); err != nil {
		t.Fatal(err)
	}
	names := func() string {
		var out []string
		for _, p := range must(s.Projects()) {
			out = append(out, p.Name)
		}
		return strings.Join(out, "")
	}
	if got := names(); got != "CABD" {
		t.Fatalf("order = %s, want CABD", got)
	}
	if err := s.ReorderProjects([]int64{d.ID, b.ID, a.ID, c.ID}); err != nil {
		t.Fatal(err)
	}
	if got := names(); got != "DBAC" {
		t.Fatalf("order = %s, want DBAC", got)
	}
	// A new project goes last.
	must(s.CreateProject("E"))
	if got := names(); got != "DBACE" {
		t.Fatalf("order = %s, want DBACE", got)
	}
}

// TestProjectStage: a new project is 立项中 unless the draft says, the
// stage moves by hand with its time, staying put leaves the time, and
// editing without a stage leaves it.
func TestProjectStage(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	if p.Stage != StagePlanning || p.StageAt != p.CreatedAt {
		t.Fatalf("new project = %+v", p)
	}
	live := must(s.AddProject(ProjectDraft{Name: "官网", Stage: StageLive}, ""))
	if live.Stage != StageLive || live.StageAt == 0 {
		t.Fatalf("drafted = %+v", live)
	}

	// Any direction, any step.
	moved := must(s.SetProjectStage(p.ID, StageTesting))
	if moved.Stage != StageTesting || moved.StageAt <= p.StageAt || moved.UpdatedAt != moved.StageAt {
		t.Fatalf("moved = %+v", moved)
	}
	if again := must(s.SetProjectStage(p.ID, StageTesting)); again.StageAt != moved.StageAt || again.UpdatedAt != moved.UpdatedAt {
		t.Fatalf("set to the same stage = %+v, was %+v", again, moved)
	}
	back := must(s.SetProjectStage(p.ID, StagePlanning))
	if back.Stage != StagePlanning || back.StageAt <= moved.StageAt {
		t.Fatalf("moved back = %+v", back)
	}

	// Editing: no stage leaves it, another moves it, the same keeps the time.
	kept := must(s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖 2"}, ""))
	if kept.Stage != StagePlanning || kept.StageAt != back.StageAt {
		t.Fatalf("edited without a stage = %+v", kept)
	}
	done := must(s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖 2", Stage: StageFinished}, ""))
	if done.Stage != StageFinished || done.StageAt <= kept.StageAt {
		t.Fatalf("edited to finished = %+v", done)
	}
	if same := must(s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖", Stage: StageFinished}, "")); same.StageAt != done.StageAt {
		t.Fatalf("edited to the same stage = %+v", same)
	}

	_, err := s.SetProjectStage(p.ID, "archived")
	wantUserErr(t, err, "未知的阶段")
	_, err = s.SetProjectStage(p.ID, "")
	wantUserErr(t, err, "未知的阶段")
	_, err = s.AddProject(ProjectDraft{Name: "C", Stage: "archived"}, "")
	wantUserErr(t, err, "未知的阶段")
	_, err = s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖", Stage: "archived"}, "")
	wantUserErr(t, err, "未知的阶段")
	if _, err := s.SetProjectStage(9999, StageLive); !errors.Is(err, ErrNotFound) {
		t.Fatalf("staging a missing project: %v", err)
	}
	if _, err := s.SetProjectStage(9999, StagePlanning); !errors.Is(err, ErrNotFound) {
		t.Fatalf("staging a missing project: %v", err)
	}
}

// TestOpenUpgradesVersion7 opens a database of version 7: its projects are
// 开发中, since they were made, and keep what they hold.
func TestOpenUpgradesVersion7(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range append(migrations[:7:7],
		`PRAGMA user_version = 7`,
		`INSERT INTO projects (id, name, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 1, 1000, 5000), (2, '官网', 2, 2000, 2000)`,
		`INSERT INTO items (id, project_id, type, status, title, sort_order, created_at, updated_at) VALUES (1, 2, 'bug', 'doing', 'A', 1, 1, 1)`,
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
	projects := must(s.Projects())
	if len(projects) != 2 {
		t.Fatalf("projects = %+v", projects)
	}
	for _, p := range projects {
		if p.Stage != StageDeveloping || p.StageAt != p.CreatedAt || p.UpdatedAt < p.CreatedAt {
			t.Fatalf("upgraded project = %+v", p)
		}
	}
	if projects[0].UpdatedAt != 5000 || projects[1].Counts.Doing != 1 {
		t.Fatalf("projects = %+v", projects)
	}
	// The column takes only the five stages.
	if _, err := s.db.Exec(`UPDATE projects SET stage = 'archived' WHERE id = 1`); err == nil {
		t.Fatal("stored an unknown stage")
	}
}

// TestStageHistory: a new project starts its history; each move to another
// stage adds a step, from the bar or the dialog; staying adds none; the
// overview carries it; deleting the project deletes it.
func TestStageHistory(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	steps := func() []StageStep { return must(s.StageHistory(p.ID)) }
	if got := steps(); len(got) != 1 || got[0] != (StageStep{StagePlanning, p.StageAt}) {
		t.Fatalf("new project history = %+v", got)
	}
	dev := must(s.SetProjectStage(p.ID, StageDeveloping))
	must(s.SetProjectStage(p.ID, StageDeveloping))
	must(s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖"}, ""))
	test := must(s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖", Stage: StageTesting}, ""))
	must(s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖", Stage: StageTesting}, ""))
	back := must(s.SetProjectStage(p.ID, StageDeveloping))
	want := []StageStep{{StagePlanning, p.StageAt}, {StageDeveloping, dev.StageAt}, {StageTesting, test.StageAt}, {StageDeveloping, back.StageAt}}
	if got := steps(); !slices.Equal(got, want) {
		t.Fatalf("history = %+v, want %+v", got, want)
	}
	if o := must(s.Overview(p.ID)); !slices.Equal(o.Stages, want) {
		t.Fatalf("overview stages = %+v", o.Stages)
	}
	// A project of its own: its history only.
	other := must(s.AddProject(ProjectDraft{Name: "官网", Stage: StageLive}, ""))
	if got := must(s.StageHistory(other.ID)); len(got) != 1 || got[0].Stage != StageLive {
		t.Fatalf("other history = %+v", got)
	}

	must(struct{}{}, s.DeleteProject(p.ID))
	var left int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM project_stages WHERE project_id = ?`, p.ID).Scan(&left); err != nil || left != 0 {
		t.Fatalf("history left after delete: %d, %v", left, err)
	}
}

// TestOpenUpgradesVersion8 opens a database of version 8: each project's
// history starts from the stage it is at.
func TestOpenUpgradesVersion8(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range append(migrations[:8:8],
		`PRAGMA user_version = 8`,
		`INSERT INTO projects (id, name, stage, stage_at, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 'testing', 3000, 1, 1000, 3000), (2, '官网', 'developing', 2000, 2, 2000, 2000)`,
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
	if got := must(s.StageHistory(1)); !slices.Equal(got, []StageStep{{StageTesting, 3000}}) {
		t.Fatalf("history of 1 = %+v", got)
	}
	if got := must(s.StageHistory(2)); !slices.Equal(got, []StageStep{{StageDeveloping, 2000}}) {
		t.Fatalf("history of 2 = %+v", got)
	}
}
