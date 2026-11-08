package sessions

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The sessions of each test live in a fresh folder that the environment
// variables the agents honor point to, as a user's would be set.

const (
	idA = "11111111-1111-4111-8111-111111111111"
	idB = "22222222-2222-4222-8222-222222222222"
	idC = "33333333-3333-4333-8333-333333333333"
)

func writeLines(t *testing.T, path string, recs ...any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	for _, r := range recs {
		if s, ok := r.(string); ok { // a line as it is, such as a cut one
			b.WriteString(s)
			continue
		}
		line, err := json.Marshal(r)
		if err != nil {
			t.Fatal(err)
		}
		b.Write(line)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

// touch sets when path last changed, minutes ago.
func touch(t *testing.T, path string, minutesAgo int) {
	t.Helper()
	when := time.Now().Add(-time.Duration(minutesAgo) * time.Minute)
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
}

type m = map[string]any

func userMsg(cwd string, content any) m {
	return m{"type": "user", "cwd": cwd, "sessionId": "x", "message": m{"role": "user", "content": content}}
}

func titles(list []Session) []string {
	var out []string
	for _, s := range list {
		out = append(out, s.Title)
	}
	return out
}

func setupClaude(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", root)
	return filepath.Join(root, "projects")
}

func TestClaudeTitles(t *testing.T) {
	projects := setupClaude(t)
	cwd := `C:\Work\网站 项目`
	dir := filepath.Join(projects, claudeDirName(cwd))
	// Renamed: the latest custom title wins over the AI's.
	writeLines(t, filepath.Join(dir, idA+".jsonl"),
		userMsg(cwd, "第一句"),
		m{"type": "ai-title", "aiTitle": "AI 起的名字"},
		m{"type": "custom-title", "customTitle": "旧名字"},
		m{"type": "custom-title", "customTitle": "  [archived] 我改的   名字 "},
		m{"type": "ai-title", "aiTitle": "AI 后来起的"},
	)
	// No name: its first message the user wrote, without what Claude Code
	// adds, the results of tools or an interruption.
	writeLines(t, filepath.Join(dir, idB+".jsonl"),
		m{"type": "user", "cwd": cwd, "isMeta": true, "message": m{"role": "user", "content": "Caveat: meta"}},
		userMsg(cwd, "<command-name>/clear</command-name>\n<command-message>clear</command-message>"),
		userMsg(cwd, []m{{"type": "tool_result", "content": "ok"}}),
		userMsg(cwd, "[Request interrupted by user]"),
		userMsg(cwd, []m{{"type": "text", "text": "<system-reminder>别看</system-reminder>\n修一下 [登录页](https://x.dev/login) 的   按钮"}}),
	)
	// Nothing to name it by: not listed.
	writeLines(t, filepath.Join(dir, idC+".jsonl"), m{"type": "file-history-snapshot"})
	// A sub-agent's, deeper: not a session.
	writeLines(t, filepath.Join(dir, idA, "subagents", "agent-1.jsonl"), m{"type": "ai-title", "aiTitle": "子 agent"})

	var r Reader
	list, err := r.List(Claude)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]Session{}
	for _, s := range list {
		byID[s.ID] = s
	}
	if len(list) != 2 {
		t.Fatalf("listed %v, want the two named sessions", titles(list))
	}
	if got := byID[idA]; got.Title != "我改的 名字" || got.Cwd != cwd || got.Agent != "claude" || got.Link != "claude-session:"+idA {
		t.Errorf("renamed session = %+v", got)
	}
	if got := byID[idB].Title; got != "修一下 登录页 的 按钮" {
		t.Errorf("unnamed session's title = %q", got)
	}
}

func TestClaudeReadsOnlyStartAndEnd(t *testing.T) {
	projects := setupClaude(t)
	path := filepath.Join(projects, "C--p", idA+".jsonl")
	filler := m{"type": "assistant", "message": m{"role": "assistant", "content": strings.Repeat("长", 2000)}}
	recs := []any{userMsg(`C:\p`, "开头的话"), m{"type": "ai-title", "aiTitle": "早先的名字"}}
	for range 400 { // about 2.4 MB, more than the start and end read
		recs = append(recs, filler)
	}
	recs = append(recs, m{"type": "ai-title", "aiTitle": "最新的名字"}, filler)
	writeLines(t, path, recs...)

	var r Reader
	list, _ := r.List(Claude)
	if len(list) != 1 || list[0].Title != "最新的名字" || list[0].Cwd != `C:\p` {
		t.Fatalf("listed %+v", list)
	}
}

func TestClaudeCutLastLine(t *testing.T) {
	projects := setupClaude(t)
	path := filepath.Join(projects, "C--p", idA+".jsonl")
	// Claude Code is writing the last line.
	writeLines(t, path, userMsg(`C:\p`, "开头"), `{"type":"ai-title","aiTitle":"写到一`)
	var r Reader
	list, _ := r.List(Claude)
	if len(list) != 1 || list[0].Title != "开头" {
		t.Fatalf("listed %+v", list)
	}
}

func TestInFolder(t *testing.T) {
	projects := setupClaude(t)
	for i, s := range []struct{ id, cwd string }{
		{idA, `C:\Vibe\atlas`},
		{idB, `c:/vibe/atlas/web`}, // inside, written another way
		{idC, `C:\Vibe\atlas-old`}, // a neighbor whose name starts the same
	} {
		path := filepath.Join(projects, claudeDirName(s.cwd), s.id+".jsonl")
		writeLines(t, path, userMsg(s.cwd, "会话"+s.cwd))
		touch(t, path, i)
	}
	var r Reader
	in, err := r.In(Claude, `C:\Vibe\atlas\`)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, s := range in {
		ids = append(ids, s.ID)
	}
	want := []string{idA} // newest first
	if isCaseless() {
		want = []string{idA, idB}
	}
	if strings.Join(ids, ",") != strings.Join(want, ",") {
		t.Errorf("in the folder: %v, want %v", ids, want)
	}
	all, _ := r.List(Claude)
	if len(all) != 3 || all[0].ID != idA || all[2].ID != idC {
		t.Errorf("all, newest first: %v", titles(all))
	}
}

// isCaseless tells a system whose paths ignore the case of letters, where
// C:\Vibe and c:/vibe are one folder.
func isCaseless() bool { return InFolder(`C:\A`, `c:/a`) }

func TestClaudeCwd(t *testing.T) {
	projects := setupClaude(t)
	writeLines(t, filepath.Join(projects, "C--p", idA+".jsonl"), userMsg(`C:\p`, "你好"))
	if cwd, ok := ClaudeCwd(idA); !ok || cwd != `C:\p` {
		t.Errorf("ClaudeCwd = %q, %v", cwd, ok)
	}
	if _, ok := ClaudeCwd(idB); ok {
		t.Error("found a session that does not exist")
	}
	if _, ok := ClaudeCwd("../../x"); ok {
		t.Error("accepted an ID that is not one")
	}
}

func codexMetaLine(id, cwd string, extra m) m {
	p := m{"id": id, "cwd": cwd, "source": "vscode", "base_instructions": m{"text": strings.Repeat("规则", 5000)}}
	for k, v := range extra {
		p[k] = v
	}
	return m{"type": "session_meta", "payload": p}
}

func TestCodex(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CODEX_HOME", root)
	day := filepath.Join(root, "sessions", "2026", "11", "08")
	userText := func(text string) m {
		return m{"type": "response_item", "payload": m{"type": "message", "role": "user", "content": []m{{"type": "input_text", "text": text}}}}
	}
	// Named in the index, renamed later.
	writeLines(t, filepath.Join(day, "rollout-2026-11-08T01-00-00-"+idA+".jsonl"), codexMetaLine(idA, `C:\p`, nil), userText("原话"))
	// Unnamed: its first message, past what Codex injects.
	writeLines(t, filepath.Join(day, "rollout-2026-11-08T02-00-00-"+idB+".jsonl"),
		codexMetaLine(idB, `C:\q`, nil),
		userText("# AGENTS.md instructions for C:\\q\n<INSTRUCTIONS>…</INSTRUCTIONS>"),
		userText("<environment_context><cwd>C:\\q</cwd></environment_context>"),
		m{"type": "event_msg", "payload": m{"type": "user_message", "message": "把 [首页](codeg://session/1) 改快"}},
	)
	// Rolled back: the later rollout of the thread is the one listed.
	writeLines(t, filepath.Join(day, "rollout-2026-11-08T03-00-00-"+idC+".jsonl"), codexMetaLine(idC, `C:\old`, nil), userText("旧的"))
	writeLines(t, filepath.Join(day, "rollout-2026-11-08T04-00-00-"+idC+"_2.jsonl"), codexMetaLine(idC, `C:\new`, nil), userText("新的"))
	// Sub-agents, both ways Codex marks them: not listed.
	writeLines(t, filepath.Join(day, "rollout-2026-11-08T05-00-00-44444444-4444-4444-8444-444444444444.jsonl"),
		codexMetaLine("44444444-4444-4444-8444-444444444444", `C:\p`, m{"source": m{"subagent": m{"thread_spawn": m{"parent_thread_id": idA}}}}), userText("子任务"))
	writeLines(t, filepath.Join(day, "rollout-2026-11-08T05-00-01-55555555-5555-4555-8555-555555555555.jsonl"),
		codexMetaLine("55555555-5555-4555-8555-555555555555", `C:\p`, m{"parent_thread_id": idA}), userText("子任务"))
	// Not a rollout, and an empty one.
	writeLines(t, filepath.Join(day, "notes.jsonl"), codexMetaLine("x", `C:\p`, nil))
	writeLines(t, filepath.Join(day, "rollout-2026-11-08T06-00-00-66666666-6666-4666-8666-666666666666.jsonl"))
	writeLines(t, filepath.Join(root, "session_index.jsonl"),
		m{"id": idA, "thread_name": "第一次的名字"},
		m{"id": idA, "thread_name": "改过的名字"},
		m{"id": idB, "thread_name": ""},
	)

	var r Reader
	list, err := r.List(Codex)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Session{}
	for _, s := range list {
		got[s.ID] = s
	}
	if len(list) != 3 {
		t.Fatalf("listed %v", titles(list))
	}
	if s := got[idA]; s.Title != "改过的名字" || s.Agent != "codex" || s.Link != "codex://threads/"+idA {
		t.Errorf("named = %+v", s)
	}
	if s := got[idB]; s.Title != "把 首页 改快" || s.Cwd != `C:\q` {
		t.Errorf("unnamed = %+v", s)
	}
	if s := got[idC]; s.Title != "新的" || s.Cwd != `C:\new` {
		t.Errorf("rolled back = %+v", s)
	}

	// Renamed in Codex: the list follows, with the rollout unchanged.
	f, err := os.OpenFile(filepath.Join(root, "session_index.jsonl"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(`{"id":"` + idB + `","thread_name":"后来起的名字"}` + "\n")
	f.Close()
	r.listAt = time.Time{}
	list, _ = r.List(Codex)
	for _, s := range list {
		if s.ID == idB && s.Title != "后来起的名字" {
			t.Errorf("after renaming: %q", s.Title)
		}
	}
}

// codegFixture makes a database laid out as codeg's, and leaves its
// connection open, as codeg does while it runs.
func codegFixture(t *testing.T, dir string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dir, "codeg.db")+"?_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	for _, q := range []string{
		`CREATE TABLE folder (id integer PRIMARY KEY, name varchar NOT NULL, path varchar NOT NULL UNIQUE, deleted_at text NULL, kind text NOT NULL DEFAULT 'regular')`,
		`CREATE TABLE conversation (id integer PRIMARY KEY, folder_id integer NOT NULL, title varchar NULL, agent_type varchar NOT NULL,
			external_id varchar NULL, parent_id integer NULL, created_at text NOT NULL, updated_at text NOT NULL, deleted_at text NULL,
			kind text NOT NULL DEFAULT 'regular')`,
		`INSERT INTO folder VALUES (1, 'atlas', 'C:\Vibe\atlas', NULL, 'regular'), (2, 'gone', 'C:\gone', '2026-11-01T00:00:00+00:00', 'regular')`,
		`INSERT INTO conversation (id, folder_id, title, agent_type, external_id, parent_id, created_at, updated_at, deleted_at, kind) VALUES
			(10, 1, '修登录', 'claude_code', '` + idA + `', NULL, 't', '2026-11-08T05:56:41.199265900+00:00', NULL, 'regular'),
			(11, 1, NULL, 'codex', NULL, NULL, 't', '2026-11-08T04:00:00+00:00', NULL, 'regular'),
			(12, 1, '用 Grok', 'grok', NULL, NULL, 't', '2026-11-07T00:00:00+00:00', NULL, 'regular'),
			(13, 1, '删掉的', 'codex', NULL, NULL, 't', '2026-11-08T06:00:00+00:00', '2026-11-08T06:00:00+00:00', 'regular'),
			(14, 1, '委派的', 'codex', NULL, 10, 't', '2026-11-08T06:00:00+00:00', NULL, 'delegate'),
			(15, 1, '聊天', 'codex', NULL, NULL, 't', '2026-11-08T06:00:00+00:00', NULL, 'chat'),
			(16, 1, '循环', 'codex', NULL, NULL, 't', '2026-11-08T06:00:00+00:00', NULL, 'loop'),
			(17, 2, '删掉的文件夹里', 'codex', NULL, NULL, 't', '2026-11-08T06:00:00+00:00', NULL, 'regular')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	return db
}

func TestCodeg(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "app 数据") // spaces and Chinese, as user folders have
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEG_DATA_DIR", dir)
	db := codegFixture(t, dir)
	if _, err := os.Stat(filepath.Join(dir, "codeg.db-wal")); err != nil {
		t.Fatalf("the writes are not waiting in the WAL: %v", err)
	}

	var r Reader
	list, err := r.List(Codeg)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"10 claude 修登录", "11 codex 未命名会话", "12 grok 用 Grok"}
	var got []string
	for _, s := range list {
		got = append(got, s.ID+" "+s.Agent+" "+s.Title)
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("listed %v, want %v", got, want)
	}
	if s := list[0]; s.Link != "codeg://session/10" || s.Cwd != `C:\Vibe\atlas` || s.UpdatedAt != time.Date(2026, 11, 8, 5, 56, 41, 199265900, time.UTC).UnixMilli() {
		t.Errorf("first = %+v", s)
	}

	// Read only: codeg goes on writing while it is read.
	if _, err := db.Exec(`UPDATE conversation SET title = '改了名' WHERE id = 10`); err != nil {
		t.Fatalf("codeg cannot write while it is read: %v", err)
	}
	r.listAt = time.Time{}
	found, err := r.Find(Codeg, []string{"codeg://session/10", "codeg://session/13", "codex://threads/" + idA, "https://x.dev"})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found["codeg://session/10"].Title != "改了名" {
		t.Errorf("Find = %+v", found)
	}
}

func TestMissingSources(t *testing.T) {
	empty := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(empty, "no"))
	t.Setenv("CODEX_HOME", filepath.Join(empty, "no"))
	t.Setenv("CODEG_DATA_DIR", filepath.Join(empty, "no"))
	var r Reader
	for _, src := range []Source{None, Claude, Codex, Codeg} {
		list, err := r.List(src)
		if err != nil || list == nil || len(list) != 0 {
			t.Errorf("%q: %v, %v; want an empty list", src, list, err)
		}
		in, err := r.In(src, `C:\p`)
		if err != nil || in == nil || len(in) != 0 {
			t.Errorf("%q in a folder: %v, %v", src, in, err)
		}
	}
}

func TestOnlyTheSourceSet(t *testing.T) {
	projects := setupClaude(t)
	writeLines(t, filepath.Join(projects, "C--p", idA+".jsonl"), userMsg(`C:\p`, "Claude 的"))
	codex := t.TempDir()
	t.Setenv("CODEX_HOME", codex)
	writeLines(t, filepath.Join(codex, "sessions", "rollout-2026-11-08T01-00-00-"+idB+".jsonl"),
		codexMetaLine(idB, `C:\p`, nil), m{"type": "event_msg", "payload": m{"type": "user_message", "message": "Codex 的"}})

	var r Reader
	list, _ := r.List(Codex)
	if len(list) != 1 || list[0].Title != "Codex 的" {
		t.Errorf("Codex lists %v", titles(list))
	}
	found, _ := r.Find(Codex, []string{"claude-session:" + idA, "codex://threads/" + idB})
	if _, ok := found["claude-session:"+idA]; ok || len(found) != 1 {
		t.Errorf("Find with Codex set = %v", found)
	}
}

func TestLinks(t *testing.T) {
	for _, c := range []struct {
		src Source
		id  string
	}{{Codeg, "2306"}, {Codex, idA}, {Claude, idB}} {
		link := Link(c.src, c.id)
		src, id, ok := Parse(link)
		if !ok || src != c.src || id != c.id {
			t.Errorf("Parse(%q) = %q, %q, %v", link, src, id, ok)
		}
	}
	for _, link := range []string{
		"CODEG://Session/12/", "codex://threads/" + idA, " claude-session:" + idA + " ",
	} {
		if _, _, ok := Parse(link); !ok {
			t.Errorf("Parse(%q) refused", link)
		}
	}
	for _, link := range []string{
		"codeg://session/", "codeg://session/1/2", "codex://threads/a b", "claude-session:not-a-uuid",
		"claude-session:" + idA + " --dangerously-skip-permissions", "https://claude.ai/chat/" + idA, "",
	} {
		if src, id, ok := Parse(link); ok {
			t.Errorf("Parse(%q) = %q, %q", link, src, id)
		}
	}
	if !IsClaudeLink("Claude-Session:x") || IsClaudeLink("claude://x") {
		t.Error("IsClaudeLink")
	}
}
