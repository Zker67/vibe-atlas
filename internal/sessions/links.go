package sessions

import (
	"net/url"
	"regexp"
	"strings"
)

// The links that open sessions:
//
//   - codeg://session/<conversation id>, which codeg opens;
//   - codex://threads/<thread id>, which Codex opens;
//   - claude-session:<session id>, which no app is registered for: Vibe
//     Atlas itself opens it, by running claude --desktop --resume <id>.
const (
	codegPrefix  = "codeg://session/"
	codexPrefix  = "codex://threads/"
	claudePrefix = "claude-session:"
)

// uuidRe matches the session IDs of Claude Code.
var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// idRe matches the IDs a link may carry: no slashes, spaces or quotes.
var idRe = regexp.MustCompile(`^[0-9A-Za-z._-]{1,128}$`)

// Link returns the link that opens the session id of src, or "".
func Link(src Source, id string) string {
	switch src {
	case Codeg:
		return codegPrefix + url.PathEscape(id)
	case Codex:
		return codexPrefix + url.PathEscape(id)
	case Claude:
		return claudePrefix + id
	}
	return ""
}

// Parse tells the source and session ID of a link that opens a session.
func Parse(link string) (Source, string, bool) {
	link = strings.TrimSpace(link)
	for _, p := range []struct {
		src    Source
		prefix string
	}{{Codeg, codegPrefix}, {Codex, codexPrefix}, {Claude, claudePrefix}} {
		if len(link) <= len(p.prefix) || !strings.EqualFold(link[:len(p.prefix)], p.prefix) {
			continue
		}
		id := strings.TrimRight(link[len(p.prefix):], "/")
		if dec, err := url.PathUnescape(id); err == nil {
			id = dec
		}
		if !idRe.MatchString(id) || p.src == Claude && !uuidRe.MatchString(id) {
			return None, "", false
		}
		return p.src, id, true
	}
	return None, "", false
}

// ClaudeSessionID returns the session ID of a claude-session: link, and
// whether link is one.
func ClaudeSessionID(link string) (string, bool) {
	src, id, ok := Parse(link)
	return id, ok && src == Claude
}

// IsClaudeLink tells a link of the claude-session: form, valid or not.
func IsClaudeLink(link string) bool {
	link = strings.TrimSpace(link)
	return len(link) >= len(claudePrefix) && strings.EqualFold(link[:len(claudePrefix)], claudePrefix)
}

// NewSessionLink returns the link that opens a new session of src working
// in folder, waiting for the user's first prompt, or "" when src has none:
//
//   - Claude Code: claude://code/new?folder=<folder>, in Claude Desktop,
//     which asks the user to confirm the folder;
//   - Codex: codex://threads/new?path=<folder>, as codex app <folder> does;
//   - codeg has no link to start a session in a folder.
func NewSessionLink(src Source, folder string) string {
	// Spaces as %20, which every reader takes; "+" may stay a plus.
	q := strings.ReplaceAll(url.QueryEscape(folder), "+", "%20")
	switch src {
	case Claude:
		return "claude://code/new?folder=" + q
	case Codex:
		return "codex://threads/new?path=" + q
	}
	return ""
}
