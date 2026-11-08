package sessions

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// claudeProjects is the folder of Claude Code's sessions: one folder per
// project, named after its path, holding a <session id>.jsonl each.
func claudeProjects() string {
	return filepath.Join(envDir("CLAUDE_CONFIG_DIR", ".claude"), "projects")
}

// claudeDirName is the name Claude Code gives the folder of a project's
// sessions: its path with every character but letters and digits as "-".
func claudeDirName(folder string) string {
	b := []byte(folder)
	for i, c := range b {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
			b[i] = '-'
		}
	}
	return string(b)
}

// claudeFiles lists the session files: those right in each project's
// folder. Sub-agents keep theirs deeper, in <session>/subagents/, and are
// not sessions of their own. With folder set, only the project folders
// whose names may be its own or a folder's inside it.
func claudeFiles(folder string) []string {
	root := claudeProjects()
	dirs, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	want := ""
	if folder != "" {
		want = strings.ToLower(claudeDirName(strings.TrimRight(folder, `\/`)))
	}
	var files []string
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		if name := strings.ToLower(d.Name()); want != "" && name != want && !strings.HasPrefix(name, want+"-") {
			continue
		}
		entries, err := os.ReadDir(filepath.Join(root, d.Name()))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".jsonl") {
				files = append(files, filepath.Join(root, d.Name(), e.Name()))
			}
		}
	}
	return files
}

// claude reads the sessions of Claude Code; with folder set, it skips the
// files of projects that cannot be in it.
func (r *Reader) claude(folder string) []Session {
	return parallel(claudeFiles(folder), func(path string) (Session, bool) {
		info, err := os.Stat(path)
		if err != nil {
			return Session{}, false
		}
		s, ok := cached(r, path, info, func() claudeParsed { return parseClaude(path, info.Size()) }).session()
		if ok {
			s.UpdatedAt = info.ModTime().UnixMilli()
		}
		return s, ok
	})
}

// claudeParsed is what a session file says.
type claudeParsed struct {
	id, title, cwd string
	ok             bool
}

func (p claudeParsed) session() (Session, bool) {
	if !p.ok {
		return Session{}, false
	}
	return Session{Agent: "claude", ID: p.id, Title: p.title, Cwd: p.cwd, Link: Link(Claude, p.id)}, true
}

// claudeRecord is the part of a line of a session file it is read for.
type claudeRecord struct {
	Type        string `json:"type"`
	Cwd         string `json:"cwd"`
	IsMeta      bool   `json:"isMeta"`
	IsSidechain bool   `json:"isSidechain"`
	CustomTitle string `json:"customTitle"`
	AITitle     string `json:"aiTitle"`
	Message     *struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

// parseClaude reads a session file's start, for its folder and first
// message, and its end, for the latest name, without reading the rest.
// The ID is the file's name, which claude --resume looks for.
func parseClaude(path string, size int64) claudeParsed {
	id := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	if !uuidRe.MatchString(id) {
		return claudeParsed{}
	}
	f, err := os.Open(path)
	if err != nil {
		return claudeParsed{}
	}
	defer f.Close()

	var custom, ai, first, cwd string
	read := func(line []byte) bool {
		var rec claudeRecord
		if json.Unmarshal(line, &rec) != nil {
			return true
		}
		switch rec.Type {
		case "custom-title":
			if t := cleanTitle(rec.CustomTitle); t != "" {
				custom = t
			}
		case "ai-title":
			if t := cleanTitle(rec.AITitle); t != "" {
				ai = t
			}
		case "user":
			if cwd == "" {
				cwd = rec.Cwd
			}
			if first == "" && !rec.IsMeta && !rec.IsSidechain && rec.Message != nil {
				first = claudeUserText(rec.Message.Content)
			}
		default:
			if cwd == "" {
				cwd = rec.Cwd
			}
		}
		return true
	}

	head := readAt(f, 0, headBytes)
	lines(head, int64(len(head)) >= size, read)
	if size > headBytes {
		// The tail starts in the middle of a line, which is left out.
		tail := readAt(f, max(size-tailBytes, headBytes), tailBytes)
		if i := bytes.IndexByte(tail, '\n'); i >= 0 {
			lines(tail[i+1:], true, read)
		}
	}

	title := custom
	if title == "" {
		title = ai
	}
	if title == "" {
		title = first
	}
	if title == "" {
		return claudeParsed{}
	}
	return claudeParsed{id: id, title: title, cwd: cwd, ok: true}
}

// claudeUserText is what the user wrote in a message: its text, or its
// first block of text, without what Claude Code adds around it; "" for
// the results of tools, interruptions and commands.
func claudeUserText(content json.RawMessage) string {
	var text string
	if json.Unmarshal(content, &text) != nil {
		var blocks []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(content, &blocks) != nil {
			return ""
		}
		for _, b := range blocks {
			if b.Type == "tool_result" {
				return ""
			}
			if b.Type == "text" && strings.TrimSpace(b.Text) != "" {
				text = b.Text
				break
			}
		}
	}
	text = stripTags(text)
	if strings.HasPrefix(text, "[Request interrupted by user") {
		return ""
	}
	return cleanTitle(withoutLinkTargets(text))
}

// ClaudeCwd returns the folder the Claude Code session id works in, which
// claude --resume needs to find it, and whether the session was found.
func ClaudeCwd(id string) (string, bool) {
	if !uuidRe.MatchString(id) {
		return "", false
	}
	matches, _ := filepath.Glob(filepath.Join(claudeProjects(), "*", id+".jsonl"))
	for _, path := range matches {
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if p := parseClaude(path, info.Size()); p.ok {
			return p.cwd, true
		}
	}
	return "", false
}
