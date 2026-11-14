package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Zker67/vibe-atlas/internal/sessions"
)

func TestSessionNamesIgnorePickerSource(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CODEX_HOME", root)
	t.Setenv("CODEG_DATA_DIR", t.TempDir())
	if err := os.Mkdir(filepath.Join(root, "sessions"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"sessions/rollout-2026-11-15T01-00-00-test.jsonl": `{"type":"session_meta","payload":{"id":"test","cwd":"/project"}}`,
		"session_index.jsonl":                             `{"id":"test","thread_name":"跨来源会话名"}`,
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	db := openStore(t)
	a := &Atlas{db: db}
	link := "codex://threads/test"
	for _, source := range []sessions.Source{sessions.Codeg, sessions.None} {
		if err := setSessionSource(db, source); err != nil {
			t.Fatal(err)
		}
		found, err := a.SessionsOf([]string{link})
		if err != nil || found[link].Title != "跨来源会话名" {
			t.Fatalf("source %q: %+v, %v", source, found, err)
		}
		list, err := a.ListSessions("", true)
		if err != nil || len(list) != 0 || sessionSource(db) != source {
			t.Fatalf("name lookup changed picker: %+v, %v", list, err)
		}
	}
}
