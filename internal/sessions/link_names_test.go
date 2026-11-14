package sessions

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFindLinksAcrossSources(t *testing.T) {
	projects := setupClaude(t)
	writeLines(t, filepath.Join(projects, "C--p", idA+".jsonl"), userMsg(`C:\p`, "Claude 标题"))
	codex := t.TempDir()
	t.Setenv("CODEX_HOME", codex)
	writeLines(t, filepath.Join(codex, "sessions", "rollout-2026-11-08T01-00-00-"+idB+".jsonl"), codexMetaLine(idB, `C:\p`, nil))
	writeLines(t, filepath.Join(codex, "session_index.jsonl"), m{"id": idB, "thread_name": "Codex 标题"})
	codeg := t.TempDir()
	t.Setenv("CODEG_DATA_DIR", codeg)
	codegFixture(t, codeg)

	var r Reader
	links := []string{Link(Claude, idA), "CODEX://threads/" + idB + "/", Link(Codeg, "10"), Link(Codex, idC), "https://example.com"}
	found := r.FindLinks(links)
	if len(found) != 3 || found[links[0]].Title != "Claude 标题" || found[links[1]].Title != "Codex 标题" || found[links[2]].Title != "修登录" {
		t.Fatalf("mixed links = %+v", found)
	}
	// The picker still lists only the selected source, and querying other
	// sources does not evict its short-lived list cache.
	before := r.lists[Codeg].at
	r.FindLinks(links)
	list, err := r.List(Codeg)
	if err != nil || len(list) != 3 || !r.lists[Codeg].at.Equal(before) {
		t.Fatalf("picker/cache = %+v, %v", list, err)
	}
	// Renames are picked up once that source's list expires.
	writeLines(t, filepath.Join(codex, "session_index.jsonl"), m{"id": idB, "thread_name": "改名后的 Codex"})
	entry := r.lists[Codex]
	entry.at = time.Time{}
	r.lists[Codex] = entry
	if got := r.FindLinks(links)[links[1]].Title; got != "改名后的 Codex" {
		t.Fatalf("renamed = %q", got)
	}
}

func TestFindLinksOnlyRequestedSourcesAndFailureIsolation(t *testing.T) {
	projects := setupClaude(t)
	writeLines(t, filepath.Join(projects, "C--p", idA+".jsonl"), userMsg(`C:\p`, "可读取的标题"))
	codeg := t.TempDir()
	t.Setenv("CODEG_DATA_DIR", codeg)
	if err := os.WriteFile(filepath.Join(codeg, "codeg.db"), []byte("broken database"), 0o600); err != nil {
		t.Fatal(err)
	}
	var r Reader
	if got := r.FindLinks([]string{"https://example.com", "codex://threads/"}); len(got) != 0 || len(r.lists) != 0 {
		t.Fatal("non-session links read a source")
	}
	link := Link(Claude, idA)
	if got := r.FindLinks([]string{link}); got[link].Title != "可读取的标题" || len(r.lists) != 1 {
		t.Fatalf("unrelated sources were read: %+v", r.lists)
	}
	if got := r.FindLinks([]string{link, Link(Codeg, "10")}); len(got) != 1 || got[link].Title != "可读取的标题" {
		t.Fatalf("broken codeg hid Claude name: %+v", got)
	}
}
