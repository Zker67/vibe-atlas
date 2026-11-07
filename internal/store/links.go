package store

import (
	"net/url"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unicode"
)

const maxLink = 4096

var (
	schemeRe  = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9+.\-]*):`)
	drivePath = regexp.MustCompile(`^[A-Za-z]:[\\/]`)
)

// NormalizeDeeplink checks a link the user bound to an item and returns it
// as it is kept. A blank link is "". A link needs a scheme of two letters
// or more, so that a drive letter does not pass for one: https:, vscode:,
// file:, and the schemes of other apps. A local path, as copied from a file
// manager, becomes a file: link. Scripts and inline data are refused.
func NormalizeDeeplink(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if len(s) > maxLink {
		return "", userErr("链接太长了")
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", userErr("链接里不能有换行或控制字符")
		}
	}
	if isLocalPath(s) {
		return FileLink(s), nil
	}
	m := schemeRe.FindStringSubmatch(s)
	if m == nil || len(m[1]) < 2 {
		return "", userErr("需要完整的链接，比如 https://…、vscode://… 或 file:///…")
	}
	switch strings.ToLower(m[1]) {
	case "javascript", "vbscript", "data":
		return "", userErr("不支持 %s: 链接", strings.ToLower(m[1]))
	}
	if strings.TrimSpace(s[len(m[0]):]) == "" {
		return "", userErr("链接不完整")
	}
	return s, nil
}

// isLocalPath tells an absolute local path: a drive path or a network
// share on Windows, a path from the root elsewhere.
func isLocalPath(s string) bool {
	if runtime.GOOS == "windows" {
		return drivePath.MatchString(s) || strings.HasPrefix(s, `\\`)
	}
	return strings.HasPrefix(s, "/")
}

// FileLink returns the file: link of a local path, keeping it readable:
// C:\Users\ada\notes.md becomes file:///C:/Users/ada/notes.md and a share
// \\server\docs becomes file://server/docs.
func FileLink(path string) string {
	p := strings.ReplaceAll(path, `\`, "/")
	switch {
	case strings.HasPrefix(p, "//"):
		return "file:" + p
	case strings.HasPrefix(p, "/"):
		return "file://" + p
	default:
		return "file:///" + p
	}
}

// LocalPath returns the local path a file: link names, and whether link is
// one. Escapes such as %20 are decoded.
func LocalPath(link string) (string, bool) {
	if len(link) < 5 || !strings.EqualFold(link[:5], "file:") {
		return "", false
	}
	rest := link[5:]
	host := ""
	if strings.HasPrefix(rest, "//") {
		rest = rest[2:]
		slash := strings.Index(rest, "/")
		if slash < 0 {
			host, rest = rest, ""
		} else {
			host, rest = rest[:slash], rest[slash:]
		}
	}
	if decoded, err := url.PathUnescape(rest); err == nil {
		rest = decoded
	}
	if host != "" && !strings.EqualFold(host, "localhost") {
		// A network share.
		if runtime.GOOS == "windows" {
			return `\\` + host + filepath.FromSlash(rest), true
		}
		return "//" + host + rest, true
	}
	if runtime.GOOS == "windows" {
		rest = strings.TrimPrefix(rest, "/")
		return filepath.FromSlash(rest), rest != ""
	}
	return rest, rest != ""
}
