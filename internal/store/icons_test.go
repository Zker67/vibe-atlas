package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

const someImage = "image:0123456789abcdef.png"

func TestCheckIcon(t *testing.T) {
	for _, ok := range []string{"", "lucide:Gamepad2", "emoji:🎮", "emoji:👨‍👩‍👧", "emoji:🇨🇳", someImage} {
		if err := checkIcon(ok); err != nil {
			t.Errorf("checkIcon(%q) = %v", ok, err)
		}
	}
	for _, bad := range []string{"Gamepad2", "lucide:", "lucide:gamepad", "lucide:A-b", "emoji:", "emoji: 🎮",
		"emoji:" + strings.Repeat("🎮", 13), "image:../x.png", "image:0123456789abcdef.svg", "https://x/y.png"} {
		wantUserErr(t, checkIcon(bad), "图标不对")
	}
	wantUserErr(t, checkDetected("lucide:Gamepad2"), "图标不对")
}

func TestAddProjectFromFolder(t *testing.T) {
	s, _ := newStore(t)
	dir := filepath.Join(t.TempDir(), "rule-horror")

	// Without a name, the folder's is taken.
	p := must(s.AddProject(ProjectDraft{FolderPath: dir + string(filepath.Separator)}, someImage))
	if p.Name != "rule-horror" || p.FolderPath != dir || p.DetectedIcon != someImage || p.Icon != "" {
		t.Fatalf("project = %+v", p)
	}
	// A name given is kept.
	q := must(s.AddProject(ProjectDraft{Name: " 规则  恐怖 ", FolderPath: dir, Icon: "emoji:👻"}, ""))
	if q.Name != "规则 恐怖" || q.Icon != "emoji:👻" {
		t.Fatalf("project = %+v", q)
	}
	// The folder's name may be taken already.
	_, err := s.AddProject(ProjectDraft{FolderPath: dir}, "")
	wantUserErr(t, err, "已经有叫「rule-horror」的项目了")
	// Neither a name nor a folder.
	_, err = s.AddProject(ProjectDraft{}, "")
	wantUserErr(t, err, "项目名称不能为空")
	_, err = s.AddProject(ProjectDraft{Name: "x", FolderPath: "relative"}, "")
	wantUserErr(t, err, "完整路径")
	_, err = s.AddProject(ProjectDraft{Name: "y", Icon: "nope"}, "")
	wantUserErr(t, err, "图标不对")
	_, err = s.AddProject(ProjectDraft{Name: "z"}, "emoji:👻")
	wantUserErr(t, err, "图标不对")
}

func TestFolderName(t *testing.T) {
	long := strings.Repeat("长", 70)
	for path, want := range map[string]string{
		filepath.Join(t.TempDir(), "vibe-atlas"): "vibe-atlas",
		filepath.Join(t.TempDir(), long):         strings.Repeat("长", maxProjectName),
		string(filepath.Separator):               "",
	} {
		if got := FolderName(path); got != want {
			t.Errorf("FolderName(%q) = %q, want %q", path, got, want)
		}
	}
	if filepath.VolumeName(`C:\`) != "" && FolderName(`C:\`) != "" {
		t.Errorf("FolderName of a drive = %q", FolderName(`C:\`))
	}
}

func TestEditProject(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	must(s.CreateProject("另一个"))
	dir := t.TempDir()

	p = must(s.EditProject(p.ID, ProjectDraft{Name: "规则恐怖 2", FolderPath: dir, Icon: "lucide:Ghost"}, someImage))
	if p.Name != "规则恐怖 2" || p.FolderPath != dir || !p.FolderExists || p.Icon != "lucide:Ghost" || p.DetectedIcon != someImage {
		t.Fatalf("project = %+v", p)
	}
	// Emptying the name takes the folder's.
	p = must(s.EditProject(p.ID, ProjectDraft{FolderPath: dir}, someImage))
	if p.Name != filepath.Base(dir) || p.Icon != "" {
		t.Fatalf("project = %+v", p)
	}
	_, err := s.EditProject(p.ID, ProjectDraft{Name: "另一个"}, "")
	wantUserErr(t, err, "已经有叫「另一个」的项目了")
	_, err = s.EditProject(999, ProjectDraft{Name: "x"}, "")
	if err != ErrNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestProjectAndModuleIcons(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	before := p.UpdatedAt
	p = must(s.SetProjectIcon(p.ID, "emoji:👻"))
	if p.Icon != "emoji:👻" || p.UpdatedAt == before {
		t.Fatalf("project = %+v", p)
	}
	_, err := s.SetProjectIcon(p.ID, "lucide:bad")
	wantUserErr(t, err, "图标不对")

	// Detecting is not a change of the user.
	before = p.UpdatedAt
	p = must(s.SetProjectDetectedIcon(p.ID, someImage))
	if p.DetectedIcon != someImage || p.UpdatedAt != before {
		t.Fatalf("project = %+v", p)
	}

	// Binding another folder forgets the icon found in the old one; binding
	// the same keeps it.
	dir := t.TempDir()
	p = must(s.SetProjectFolder(p.ID, dir))
	p = must(s.SetProjectDetectedIcon(p.ID, someImage))
	p = must(s.SetProjectFolder(p.ID, dir))
	if p.DetectedIcon != someImage {
		t.Fatalf("same folder: detected = %q", p.DetectedIcon)
	}
	p = must(s.SetProjectFolder(p.ID, t.TempDir()))
	if p.DetectedIcon != "" || p.Icon != "emoji:👻" {
		t.Fatalf("other folder: %+v", p)
	}
	p = must(s.SetProjectFolder(p.ID, ""))
	if p.DetectedIcon != "" {
		t.Fatalf("no folder: detected = %q", p.DetectedIcon)
	}

	m := must(s.CreateModule(p.ID, "界面"))
	if m.Icon != "" {
		t.Fatalf("new module icon = %q", m.Icon)
	}
	m = must(s.SetModuleIcon(m.ID, "lucide:Palette"))
	if got := must(s.Modules(p.ID))[0]; got.Icon != "lucide:Palette" {
		t.Fatalf("module = %+v", got)
	}
	_, err = s.SetModuleIcon(m.ID, "emoji:")
	wantUserErr(t, err, "图标不对")
	if _, err := s.SetModuleIcon(999, ""); err != ErrNotFound {
		t.Fatalf("err = %v", err)
	}

	// The pictures they use count as referred to.
	must(s.SetModuleIcon(m.ID, "image:fedcba9876543210.webp"))
	must(s.SetProjectIcon(p.ID, someImage))
	texts := strings.Join(must(s.TextsWith("image:")), "\n")
	if !strings.Contains(texts, "fedcba9876543210.webp") || !strings.Contains(texts, "0123456789abcdef.png") {
		t.Fatalf("TextsWith = %q", texts)
	}
}

// TestOpenUpgradesVersion4 opens a database of version 4: its projects and
// modules stay, with the default icons.
func TestOpenUpgradesVersion4(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		migrations[0],
		migrations[1],
		migrations[2],
		migrations[3],
		`PRAGMA user_version = 4`,
		`INSERT INTO projects (id, name, folder_path, sort_order, created_at, updated_at) VALUES (1, '规则恐怖', 'C:\x', 1, 1, 1)`,
		`INSERT INTO modules (id, project_id, name, sort_order, created_at) VALUES (3, 1, '界面', 1, 1)`,
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
	p := must(s.Project(1))
	if p.Name != "规则恐怖" || p.Icon != "" || p.DetectedIcon != "" {
		t.Fatalf("project = %+v", p)
	}
	if m := must(s.Modules(1))[0]; m.Name != "界面" || m.Icon != "" {
		t.Fatalf("module = %+v", m)
	}
}
