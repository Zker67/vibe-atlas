// Package sessions reads, without writing, the AI sessions kept on this
// machine by one of Claude Code, Codex or codeg, so that an item can be
// linked to one picked from a list, and a link to one shows the session's
// name. It never runs, watches or talks to an agent.
package sessions

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Source is where sessions are read from: one at a time, as the user set.
type Source string

// The sources.
const (
	None   Source = ""       // 不使用
	Claude Source = "claude" // Claude Code
	Codex  Source = "codex"  // Codex
	Codeg  Source = "codeg"  // codeg
)

// Valid tells a source the user can set.
func Valid(s Source) bool {
	switch s {
	case None, Claude, Codex, Codeg:
		return true
	}
	return false
}

// Session is one conversation with an agent.
type Session struct {
	// Agent is the agent it talks to, which picks its icon: "claude",
	// "codex", "gemini", or the name codeg gives another agent.
	Agent string `json:"agent"`
	// ID is the session's ID in its source: the conversation number in
	// codeg, the session or thread ID in Claude Code and Codex.
	ID string `json:"id"`
	// Title is the session's name, or its first message when unnamed.
	Title string `json:"title"`
	// Cwd is the folder the session works in, or "" when unknown.
	Cwd string `json:"cwd"`
	// UpdatedAt is when it last changed, in milliseconds.
	UpdatedAt int64 `json:"updatedAt"`
	// Link is the link that opens it (see Link).
	Link string `json:"link"`
}

// Reader reads sessions, keeping what it parsed of each file until the
// file changes, so that reading them again costs little.
type Reader struct {
	mu    sync.Mutex
	files map[string]parsed
	// list is the last list read, briefly, for the bursts of calls a page
	// makes as it shows several links.
	list     []Session
	listFrom Source
	listAt   time.Time
}

// listFresh is how long a list read stays current.
const listFresh = 2 * time.Second

type parsed struct {
	mod  time.Time
	size int64
	v    any
}

// cached returns what parse made of the file path, parsing it again only
// after it changed.
func cached[T any](r *Reader, path string, info os.FileInfo, parse func() T) T {
	r.mu.Lock()
	p, ok := r.files[path]
	r.mu.Unlock()
	if ok && p.mod.Equal(info.ModTime()) && p.size == info.Size() {
		if v, ok := p.v.(T); ok {
			return v
		}
	}
	v := parse()
	r.mu.Lock()
	if r.files == nil {
		r.files = map[string]parsed{}
	}
	r.files[path] = parsed{mod: info.ModTime(), size: info.Size(), v: v}
	r.mu.Unlock()
	return v
}

// List returns the sessions of src, the newest first. A source that is
// not on this machine has none.
func (r *Reader) List(src Source) ([]Session, error) {
	r.mu.Lock()
	if r.list != nil && r.listFrom == src && time.Since(r.listAt) < listFresh {
		list := r.list
		r.mu.Unlock()
		return list, nil
	}
	r.mu.Unlock()

	var (
		list []Session
		err  error
	)
	switch src {
	case Claude:
		list = r.claude("")
	case Codex:
		list = r.codex()
	case Codeg:
		list, err = readCodeg()
	}
	if err != nil {
		return nil, err
	}
	list = newestFirst(list)
	r.mu.Lock()
	r.list, r.listFrom, r.listAt = list, src, time.Now()
	r.mu.Unlock()
	return list, nil
}

// In returns the sessions of src that work in folder or a folder inside
// it, the newest first; all of them when folder is "".
func (r *Reader) In(src Source, folder string) ([]Session, error) {
	if folder == "" {
		return r.List(src)
	}
	var (
		list []Session
		err  error
	)
	if src == Claude {
		// Only the project folders that may be folder's are read.
		list = r.claude(folder)
	} else if list, err = r.List(src); err != nil {
		return nil, err
	}
	out := []Session{}
	for _, s := range list {
		if InFolder(s.Cwd, folder) {
			out = append(out, s)
		}
	}
	return newestFirst(out), nil
}

// newestFirst orders sessions by when they last changed, the newest
// first; never nil, which the pages would read as null.
func newestFirst(list []Session) []Session {
	if list == nil {
		return []Session{}
	}
	slices.SortStableFunc(list, func(a, b Session) int {
		switch {
		case a.UpdatedAt > b.UpdatedAt:
			return -1
		case a.UpdatedAt < b.UpdatedAt:
			return 1
		}
		return strings.Compare(a.ID, b.ID)
	})
	return list
}

// Find returns the sessions of src the links open, by link; links of
// other sources and sessions not found are left out.
func (r *Reader) Find(src Source, links []string) (map[string]Session, error) {
	out := map[string]Session{}
	want := false
	for _, l := range links {
		if from, _, ok := Parse(l); ok && from == src {
			want = true
		}
	}
	if !want {
		return out, nil
	}
	list, err := r.List(src)
	if err != nil {
		return nil, err
	}
	byLink := make(map[string]Session, len(list))
	for _, s := range list {
		byLink[s.Link] = s
	}
	for _, l := range links {
		from, id, ok := Parse(l)
		if !ok || from != src {
			continue
		}
		if s, ok := byLink[Link(src, id)]; ok {
			out[l] = s
		}
	}
	return out, nil
}

// InFolder tells whether cwd is folder or inside it. On Windows the case
// of letters and the kind of slash do not matter.
func InFolder(cwd, folder string) bool {
	if cwd == "" || folder == "" {
		return false
	}
	norm := func(p string) string {
		p = strings.ReplaceAll(p, `\`, "/")
		p = strings.TrimRight(p, "/")
		if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
			p = strings.ToLower(p)
		}
		return p
	}
	c, f := norm(cwd), norm(folder)
	return c == f || strings.HasPrefix(c, f+"/")
}

// home is the user's home folder.
func home() string {
	h, _ := os.UserHomeDir()
	return h
}

// envDir is the folder the environment variable name sets, else the
// folder def under the home folder.
func envDir(name, def string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return filepath.Join(home(), def)
}

// The most of a file read from its start and from its end.
const (
	headBytes = 256 << 10
	tailBytes = 256 << 10
)

// lines calls fn with each whole line of b; a cut line at its end, as a
// file being written has, is left out unless whole says b ends a line.
func lines(b []byte, whole bool, fn func(line []byte) bool) {
	for len(b) > 0 {
		i := slices.Index(b, '\n')
		if i < 0 {
			if whole && !fn(b) {
				return
			}
			return
		}
		if !fn(b[:i]) {
			return
		}
		b = b[i+1:]
	}
}

// readAt reads at most n bytes of f from off.
func readAt(f *os.File, off, n int64) []byte {
	b := make([]byte, n)
	got, err := f.ReadAt(b, off)
	if err != nil && err != io.EOF {
		return nil
	}
	return b[:got]
}

// firstLine reads the first line of path, up to max bytes.
func firstLine(path string, max int) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 64<<10)
	var out []byte
	for {
		chunk, err := r.ReadSlice('\n')
		out = append(out, chunk...)
		if len(out) > max {
			return nil
		}
		if err != bufio.ErrBufferFull {
			return out
		}
	}
}

// maxTitle is the most characters a title keeps.
const maxTitle = 100

// cleanTitle makes text a title: on one line, without codeg's 「[archived]」
// mark, cut to maxTitle characters.
func cleanTitle(text string) string {
	t := strings.Join(strings.Fields(text), " ")
	for strings.HasPrefix(t, "[archived] ") {
		t = strings.TrimSpace(strings.TrimPrefix(t, "[archived] "))
	}
	if utf8.RuneCountInString(t) > maxTitle {
		r := []rune(t)
		t = strings.TrimSpace(string(r[:maxTitle])) + "…"
	}
	return t
}

// mdLink is a link in Markdown, [text](target).
var mdLink = regexp.MustCompile(`\[([^\]\n]*)\]\([^)\s]*\)`)

// withoutLinkTargets keeps the text of the Markdown links in text, without
// where they go.
func withoutLinkTargets(text string) string {
	return mdLink.ReplaceAllString(text, "$1")
}

// stripTags removes the blocks <tag …>…</tag> agents put around what they
// add to a message, such as <system-reminder> or <command-name>, and what
// is left of tags without an end.
func stripTags(text string) string {
	var b strings.Builder
	s := text
	for {
		i := strings.IndexByte(s, '<')
		if i < 0 {
			b.WriteString(s)
			break
		}
		name := tagName(s[i+1:])
		if name == "" {
			b.WriteString(s[:i+1])
			s = s[i+1:]
			continue
		}
		b.WriteString(s[:i])
		rest := s[i:]
		if end := strings.Index(rest, "</"+name+">"); end >= 0 {
			s = rest[end+len(name)+3:]
		} else if gt := strings.IndexByte(rest, '>'); gt >= 0 {
			s = rest[gt+1:]
		} else {
			s = ""
		}
	}
	return strings.TrimSpace(b.String())
}

// tagName is the name of the tag s starts with, after its <, or "".
func tagName(s string) string {
	n := 0
	for n < len(s) {
		c := s[n]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || n > 0 && (c >= '0' && c <= '9' || c == '-' || c == '_') {
			n++
			continue
		}
		break
	}
	if n == 0 || n == len(s) || s[n] != '>' && s[n] != ' ' {
		return ""
	}
	return s[:n]
}

// parallel runs fn on each of paths, a few at a time.
func parallel[T any](paths []string, fn func(string) (T, bool)) []T {
	out := make([]T, len(paths))
	keep := make([]bool, len(paths))
	next := make(chan int)
	var wg sync.WaitGroup
	for range max(1, min(runtime.NumCPU(), 8)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				out[i], keep[i] = fn(paths[i])
			}
		}()
	}
	for i := range paths {
		next <- i
	}
	close(next)
	wg.Wait()
	kept := out[:0]
	for i, v := range out {
		if keep[i] {
			kept = append(kept, v)
		}
	}
	return kept
}
