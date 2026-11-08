package sessions

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// codexHome is Codex's folder.
func codexHome() string { return envDir("CODEX_HOME", ".codex") }

// codexMeta is what the first line of a rollout says: the session it
// records, and the thread that spawned it when a sub-agent's.
type codexMeta struct {
	id, cwd, stamp string
	sub, ok        bool
}

type codexHeader struct {
	Type    string `json:"type"`
	Payload struct {
		ID             string          `json:"id"`
		Cwd            string          `json:"cwd"`
		ParentThreadID string          `json:"parent_thread_id"`
		Source         json.RawMessage `json:"source"`
	} `json:"payload"`
}

// codexStamp is the time in a rollout's name,
// rollout-<YYYY-MM-DDTHH-MM-SS>-<thread>[_<rollout>].jsonl, which orders
// the rollouts of a thread.
func codexStamp(path string) string {
	name := strings.TrimPrefix(filepath.Base(path), "rollout-")
	if len(name) < 19 {
		return ""
	}
	return name[:19]
}

func parseCodexMeta(path string) codexMeta {
	line := firstLine(path, 4<<20)
	var h codexHeader
	if json.Unmarshal(line, &h) != nil || h.Type != "session_meta" || h.Payload.ID == "" {
		return codexMeta{}
	}
	sub := h.Payload.ParentThreadID != ""
	if len(h.Payload.Source) > 0 && h.Payload.Source[0] == '{' {
		var src struct {
			Subagent json.RawMessage `json:"subagent"`
		}
		if json.Unmarshal(h.Payload.Source, &src) == nil && len(src.Subagent) > 0 && string(src.Subagent) != "null" {
			sub = true
		}
	}
	return codexMeta{id: h.Payload.ID, cwd: h.Payload.Cwd, stamp: codexStamp(path), sub: sub, ok: true}
}

// codexRecord is the part of a later line of a rollout read for a name.
type codexRecord struct {
	Type    string `json:"type"`
	Payload struct {
		Type       string `json:"type"`
		Message    string `json:"message"`
		ThreadName string `json:"thread_name"`
		Role       string `json:"role"`
		Content    []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"payload"`
}

// codexTitle names a session without a name in the index: the latest
// name set in its start, else its first message, as far as its start
// tells.
type codexTitle struct{ title string }

func parseCodexTitle(path string) codexTitle {
	f, err := os.Open(path)
	if err != nil {
		return codexTitle{}
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return codexTitle{}
	}
	head := readAt(f, 0, headBytes)
	var named, first string
	lines(head, int64(len(head)) >= info.Size(), func(line []byte) bool {
		var rec codexRecord
		if json.Unmarshal(line, &rec) != nil {
			return true
		}
		p := rec.Payload
		switch {
		case rec.Type == "event_msg" && p.Type == "thread_name_updated":
			if t := cleanTitle(p.ThreadName); t != "" {
				named = t
			}
		case first != "":
		case rec.Type == "event_msg" && p.Type == "user_message":
			first = codexUserText(p.Message)
		case rec.Type == "response_item" && p.Type == "message" && p.Role == "user":
			for _, c := range p.Content {
				if c.Type == "input_text" {
					if first = codexUserText(c.Text); first != "" {
						break
					}
				}
			}
		}
		return true
	})
	if named != "" {
		return codexTitle{named}
	}
	return codexTitle{first}
}

// codexUserText is what the user wrote, or "" for what Codex adds to the
// conversation itself: the AGENTS.md instructions, the environment.
func codexUserText(text string) string {
	t := strings.TrimSpace(text)
	if strings.HasPrefix(t, "# AGENTS.md instructions") {
		return ""
	}
	return cleanTitle(withoutLinkTargets(stripTags(t)))
}

// codexNames reads the names the user gave threads in Codex: the last of
// each thread in session_index.jsonl.
func (r *Reader) codexNames() map[string]string {
	path := filepath.Join(codexHome(), "session_index.jsonl")
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	return cached(r, path, info, func() map[string]string {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		names := map[string]string{}
		lines(b, true, func(line []byte) bool {
			var e struct {
				ID         string `json:"id"`
				ThreadName string `json:"thread_name"`
			}
			if json.Unmarshal(line, &e) == nil && e.ID != "" {
				if t := cleanTitle(e.ThreadName); t != "" {
					names[e.ID] = t
				}
			}
			return true
		})
		return names
	})
}

// codex reads the sessions of Codex: the rollouts in sessions/, at any
// depth; the latest rollout of each thread; no sub-agents.
func (r *Reader) codex() []Session {
	root := filepath.Join(codexHome(), "sessions")
	var paths []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasPrefix(d.Name(), "rollout-") && strings.HasSuffix(d.Name(), ".jsonl") {
			paths = append(paths, path)
		}
		return nil
	})
	type found struct {
		path string
		info os.FileInfo
		meta codexMeta
	}
	all := parallel(paths, func(path string) (found, bool) {
		info, err := os.Stat(path)
		if err != nil {
			return found{}, false
		}
		m := cached(r, path, info, func() codexMeta { return parseCodexMeta(path) })
		return found{path, info, m}, m.ok && !m.sub
	})
	latest := map[string]found{}
	for _, f := range all {
		if had, ok := latest[f.meta.id]; ok && (had.meta.stamp > f.meta.stamp || had.meta.stamp == f.meta.stamp && had.path > f.path) {
			continue
		}
		latest[f.meta.id] = f
	}

	names := r.codexNames()
	var unnamed []string
	for id, f := range latest {
		if names[id] == "" {
			unnamed = append(unnamed, f.path)
		}
	}
	titles := map[string]string{}
	for _, t := range parallel(unnamed, func(path string) ([2]string, bool) {
		info, err := os.Stat(path)
		if err != nil {
			return [2]string{}, false
		}
		t := cached(r, path+"#title", info, func() codexTitle { return parseCodexTitle(path) })
		return [2]string{path, t.title}, t.title != ""
	}) {
		titles[t[0]] = t[1]
	}

	out := make([]Session, 0, len(latest))
	for id, f := range latest {
		title := names[id]
		if title == "" {
			title = titles[f.path]
		}
		if title == "" {
			continue
		}
		out = append(out, Session{
			Agent:     "codex",
			ID:        id,
			Title:     title,
			Cwd:       f.meta.cwd,
			UpdatedAt: f.info.ModTime().UnixMilli(),
			Link:      Link(Codex, id),
		})
	}
	return out
}
