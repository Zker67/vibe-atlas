package store

import (
	"bufio"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// clock is a fake time that moves one second per reading, so every change
// gets its own time.
type clock struct{ t time.Time }

func (c *clock) now() time.Time {
	c.t = c.t.Add(time.Second)
	return c.t
}

// newStore opens a store in a fresh database file, with a fake clock.
func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "atlas.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	c := &clock{t: time.Date(2026, 11, 7, 9, 0, 0, 0, time.Local)}
	s.SetClock(c.now)
	t.Cleanup(func() { s.Close() })
	return s, path
}

// must returns v and panics on err, which fails the test with the error
// and where it happened.
func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

// wantUserErr fails unless err is an *Error whose message contains part.
func wantUserErr(t *testing.T, err error, part string) {
	t.Helper()
	var ue *Error
	if !errors.As(err, &ue) {
		t.Fatalf("got error %v, want a user error containing %q", err, part)
	}
	if !strings.Contains(ue.Error(), part) {
		t.Fatalf("got %q, want it to contain %q", ue.Error(), part)
	}
}

func TestOpenCreatesCurrentVersion(t *testing.T) {
	s, _ := newStore(t)
	if v := must(s.Version()); v != schemaVersion {
		t.Fatalf("version = %d, want %d", v, schemaVersion)
	}
}

func TestOpenInFolderWithSpacesAndChinese(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "我的 数据")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "atlas.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	must(s.CreateProject("规则恐怖"))
	s.Close()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("database file not at %s: %v", path, err)
	}
	s2 := must(Open(path))
	defer s2.Close()
	if ps := must(s2.Projects()); len(ps) != 1 || ps[0].Name != "规则恐怖" {
		t.Fatalf("after reopening, projects = %+v", ps)
	}
}

func TestReopenKeepsEverything(t *testing.T) {
	s, path := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	m := must(s.CreateModule(p.ID, "武器系统"))
	it := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: m.ID, Type: TypeBug, Title: "切枪卡一帧"}))
	must(s.SetItemNote(it.ID, "## 复现\n- 连续切枪"))
	must(s.SetItemDeeplink(it.ID, "https://claude.ai/chat/1"))
	must(s.SetItemStatus(it.ID, StatusDoing))
	if err := s.SetSetting("theme", "dark"); err != nil {
		t.Fatal(err)
	}
	s.Close()

	s2 := must(Open(path))
	defer s2.Close()
	got := must(s2.Item(it.ID))
	if got.Title != "切枪卡一帧" || got.Note != "## 复现\n- 连续切枪" || got.Deeplink != "https://claude.ai/chat/1" ||
		got.Status != StatusDoing || got.ModuleID != m.ID || got.Type != TypeBug || got.StartedAt == 0 {
		t.Fatalf("after reopening, item = %+v", got)
	}
	if v, ok, _ := s2.Setting("theme"); !ok || v != "dark" {
		t.Fatalf("after reopening, theme = %q, %v", v, ok)
	}
}

func TestOpenRefusesNewerVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 99`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	_, err = Open(path)
	wantUserErr(t, err, "更新版本")
}

func TestSettings(t *testing.T) {
	s, _ := newStore(t)
	if _, ok, err := s.Setting("shortcut"); err != nil || ok {
		t.Fatalf("missing setting: ok=%v err=%v", ok, err)
	}
	if err := s.SetSetting("shortcut", "Ctrl+Alt+Space"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSetting("shortcut", "Alt+Shift+Space"); err != nil {
		t.Fatal(err)
	}
	if v, ok, _ := s.Setting("shortcut"); !ok || v != "Alt+Shift+Space" {
		t.Fatalf("shortcut = %q, %v", v, ok)
	}
}

// TestKilledProcessKeepsData writes items in another process, kills it
// without closing the database, and finds every item that process reported
// as saved.
func TestKilledProcessKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	cmd := exec.Command(os.Args[0], "-test.run=^TestHelperWriter$")
	cmd.Env = append(os.Environ(), "ATLAS_HELPER_DB="+path)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	lines := bufio.NewScanner(out)
	saved := 0
	for lines.Scan() {
		if lines.Text() == "saved" {
			saved++
		}
		if saved == 20 {
			break
		}
	}
	if saved != 20 {
		t.Fatalf("helper reported %d saves", saved)
	}
	// The helper keeps writing; kill it in the middle.
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	cmd.Wait()

	s := must(Open(path))
	defer s.Close()
	ps := must(s.Projects())
	if len(ps) != 1 {
		t.Fatalf("projects = %+v", ps)
	}
	items := must(s.Items(ps[0].ID))
	if len(items) < 20 {
		t.Fatalf("after the kill, %d items are left, want at least the 20 reported", len(items))
	}
}

// TestHelperWriter is the process TestKilledProcessKeepsData kills.
func TestHelperWriter(t *testing.T) {
	path := os.Getenv("ATLAS_HELPER_DB")
	if path == "" {
		t.Skip("run by TestKilledProcessKeepsData")
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProject("压力测试")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; ; i++ {
		if _, err := s.CreateItem(NewItem{ProjectID: p.ID, Title: fmt.Sprintf("第 %d 条", i)}); err != nil {
			t.Fatal(err)
		}
		fmt.Println("saved")
	}
}
