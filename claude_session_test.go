package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Zker67/vibe-atlas/internal/sessions"
	"github.com/Zker67/vibe-atlas/internal/store"
)

const claudeID = "8f3e6384-fa39-4ed9-a03a-b11f7df5f5df"

// fakeClaude puts a claude first on the PATH that writes down the
// arguments and the folder it ran with, and returns its folder.
func fakeClaude(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	name, script := "claude", "#!/bin/sh\necho \"$@\" > \"$(dirname \"$0\")/args.txt\"\npwd > \"$(dirname \"$0\")/cwd.txt\"\n"
	if runtime.GOOS == "windows" {
		name, script = "claude.cmd", "@echo off\r\nchcp 65001 >nul\r\necho %*> \"%~dp0args.txt\"\r\ncd> \"%~dp0cwd.txt\"\r\n"
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return dir
}

// claudeSession makes a Claude Code session that works in a folder of its
// own, and returns the folder.
func claudeSession(t *testing.T, id string) string {
	t.Helper()
	root := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", root)
	cwd := filepath.Join(t.TempDir(), "我的 项目")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"user","cwd":` + quote(cwd) + `,"message":{"role":"user","content":"你好"}}` + "\n"
	path := filepath.Join(root, "projects", "p", id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}
	return cwd
}

func quote(s string) string {
	return `"` + strings.ReplaceAll(s, `\`, `\\`) + `"`
}

func TestStartClaudeResumesInTheSessionFolder(t *testing.T) {
	bin := fakeClaude(t)
	cwd := claudeSession(t, claudeID)
	cmd, err := startClaude(sessions.Link(sessions.Claude, claudeID))
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("claude ended with %v", err)
	}
	args, _ := os.ReadFile(filepath.Join(bin, "args.txt"))
	if got := strings.TrimSpace(string(args)); got != "--desktop --resume "+claudeID {
		t.Errorf("claude ran with %q", got)
	}
	ran, _ := os.ReadFile(filepath.Join(bin, "cwd.txt"))
	if got := strings.TrimSpace(string(ran)); !sessions.InFolder(got, cwd) {
		t.Errorf("claude ran in %q, want %q", got, cwd)
	}
}

func TestStartClaudeRefuses(t *testing.T) {
	bin := fakeClaude(t)
	cwd := claudeSession(t, claudeID)
	for _, c := range []struct{ link, want string }{
		{"claude-session:not-an-id", "不是有效"},
		{"claude-session:" + claudeID + " --dangerously-skip-permissions", "不是有效"},
		{"claude-session:11111111-1111-4111-8111-111111111111", "找不到"},
	} {
		if _, err := startClaude(c.link); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("startClaude(%q) = %v, want an error saying %q", c.link, err, c.want)
		}
	}
	if err := os.RemoveAll(cwd); err != nil {
		t.Fatal(err)
	}
	if _, err := startClaude("claude-session:" + claudeID); err == nil || !strings.Contains(err.Error(), "不在了") {
		t.Errorf("with the folder gone: %v", err)
	}
	if _, err := os.Stat(filepath.Join(bin, "args.txt")); err == nil {
		t.Error("claude ran for a link it should have refused")
	}
}

// A claude-session: link is a link items keep like any other.
func TestClaudeLinkIsKept(t *testing.T) {
	link := sessions.Link(sessions.Claude, claudeID)
	if got, err := store.NormalizeDeeplink(link); err != nil || got != link {
		t.Errorf("NormalizeDeeplink(%q) = %q, %v", link, got, err)
	}
}

func TestSessionSourceSetting(t *testing.T) {
	db := openStore(t)
	if got := sessionSource(db); got != sessions.None {
		t.Errorf("a new database reads sessions from %q", got)
	}
	if err := setSessionSource(db, sessions.Codeg); err != nil {
		t.Fatal(err)
	}
	if got := sessionSource(db); got != sessions.Codeg {
		t.Errorf("source = %q after setting codeg", got)
	}
	if err := setSessionSource(db, "cursor"); err == nil {
		t.Error("an unknown source was accepted")
	}
	if err := db.SetSetting(keySessionSource, "cursor"); err != nil { // written by a later version
		t.Fatal(err)
	}
	if got := sessionSource(db); got != sessions.None {
		t.Errorf("source = %q for an unknown stored value", got)
	}
}
