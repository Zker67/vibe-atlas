package store

import (
	"errors"
	"os"
	"path/filepath"
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
