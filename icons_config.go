package main

import (
	"os"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"text/scanner"
	"time"
)

func configuredIcon(folder string) ([]byte, string) {
	for _, name := range []string{"mygo.config.ts", "mygo.config.js", "mygo.config.mjs"} {
		if rel := mygoIconPath(string(readIconInput(folder, name, maxIconSourceBytes))); rel != "" {
			if data := readIconFile(folder, rel); data != nil {
				return data, rel
			}
		}
	}
	if rel := godotIconPath(string(readIconInput(folder, "project.godot", maxIconSourceBytes))); rel != "" {
		if data := readIconFile(folder, rel); data != nil {
			return data, rel
		}
	}
	return unityIcon(folder)
}

// Tokenize without executing imports, functions or expressions. Only a
// literal top-level icon in export default defineConfig({...}) is trusted.
// Spreads could override that value, so that form deliberately falls back.
func mygoIconPath(source string) string {
	var s scanner.Scanner
	s.Init(strings.NewReader(source))
	s.Mode = scanner.ScanIdents | scanner.ScanStrings | scanner.ScanChars | scanner.ScanRawStrings | scanner.ScanComments | scanner.SkipComments
	s.Error = func(*scanner.Scanner, string) {} // JS single-quoted strings are not Go chars.
	var tokens []string
	for t := s.Scan(); t != scanner.EOF; t = s.Scan() {
		tokens = append(tokens, s.TokenText())
	}
	start := -1
	for i := 0; i+5 < len(tokens); i++ {
		if slices.Equal(tokens[i:i+5], []string{"export", "default", "defineConfig", "(", "{"}) {
			start = i + 5
			break
		}
	}
	if start < 0 {
		return ""
	}
	depth, result := 1, ""
	for i := start; i < len(tokens); i++ {
		t := tokens[i]
		if depth == 1 && t == "." && i+2 < len(tokens) && tokens[i+1] == "." && tokens[i+2] == "." {
			return ""
		}
		key, _ := literalString(t)
		if depth == 1 && (t == "icon" || key == "icon") && (i == start || tokens[i-1] == ",") {
			result = ""
			if i+3 < len(tokens) && tokens[i+1] == ":" && (tokens[i+3] == "," || tokens[i+3] == "}") {
				if value, ok := literalString(tokens[i+2]); ok {
					result = iconRelativePath(value)
				}
			}
		}
		switch t {
		case "{", "[", "(":
			depth++
		case "}", "]", ")":
			depth--
			if depth == 0 {
				return result
			}
		}
	}
	return ""
}

func literalString(s string) (string, bool) {
	if len(s) < 2 || s[0] != s[len(s)-1] {
		return "", false
	}
	if s[0] == '`' {
		return s[1 : len(s)-1], !strings.Contains(s, "${")
	}
	if s[0] != '\'' && s[0] != '"' {
		return "", false
	}
	var b strings.Builder
	for rest := s[1 : len(s)-1]; rest != ""; {
		r, _, tail, err := strconv.UnquoteChar(rest, s[0])
		if err != nil {
			return "", false
		}
		b.WriteRune(r)
		rest = tail
	}
	return b.String(), true
}

func godotIconPath(source string) string {
	section := ""
	for _, line := range strings.Split(source, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") {
			section = line
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || section != "[application]" || strings.TrimSpace(key) != "config/icon" {
			continue
		}
		// Godot strings are double quoted. Permit an inline comment only
		// after the closing quote, not arbitrary executable expressions.
		value = strings.TrimSpace(value)
		quoted, err := strconv.QuotedPrefix(value)
		if err != nil || (strings.TrimSpace(value[len(quoted):]) != "" && !strings.HasPrefix(strings.TrimSpace(value[len(quoted):]), ";")) {
			return ""
		}
		value, err = strconv.Unquote(quoted)
		if err == nil && strings.HasPrefix(value, "res://") {
			return iconRelativePath(strings.TrimPrefix(value, "res://"))
		}
	}
	return ""
}

var unityGUID = regexp.MustCompile(`\bguid:\s*([a-fA-F0-9]{32})\b`)
var unityMetaGUID = regexp.MustCompile(`(?m)^guid:\s*([a-fA-F0-9]{32})\s*$`)

type unityIconRef struct {
	guid string
	rank int
}

// Unity's YAML uses indentless lists; stay inside the two icon tables so
// splash screens, cursors and unrelated texture GUIDs never become icons.
func unityIconGUIDs(source string) []unityIconRef {
	var refs []unityIconRef
	active, rank := false, 3
	for _, line := range strings.Split(source, "\n") {
		trim := strings.TrimSpace(line)
		indent := len(line) - len(strings.TrimLeft(line, " "))
		if indent == 2 && !strings.HasPrefix(trim, "-") && trim != "" {
			active = trim == "m_BuildTargetIcons:" || trim == "m_BuildTargetPlatformIcons:"
		}
		if !active {
			continue
		}
		if target, ok := strings.CutPrefix(trim, "- m_BuildTarget:"); ok {
			target = strings.Trim(strings.TrimSpace(target), `"'`)
			rank = 3
			switch target {
			case "":
				rank = 0
			case "Standalone":
				rank = 1
			case "Android":
				rank = 2
			}
		}
		for _, m := range unityGUID.FindAllStringSubmatch(trim, -1) {
			if m[1] != strings.Repeat("0", 32) {
				refs = append(refs, unityIconRef{strings.ToLower(m[1]), rank})
			}
		}
	}
	slices.SortStableFunc(refs, func(a, b unityIconRef) int { return a.rank - b.rank })
	seen := map[string]bool{}
	return slices.DeleteFunc(refs, func(r unityIconRef) bool {
		duplicate := seen[r.guid]
		seen[r.guid] = true
		return duplicate
	})
}

// Cache only GUID -> path, never file content or a negative lookup.
// Recheck the .meta on every hit so a moved/reassigned asset is rediscovered.
var unityIconPaths = struct {
	sync.Mutex
	paths map[string]string
}{paths: map[string]string{}}

func unityIcon(folder string) ([]byte, string) {
	refs := unityIconGUIDs(string(readIconInput(folder, "ProjectSettings/ProjectSettings.asset", maxIconSourceBytes)))
	if len(refs) == 0 {
		return nil, ""
	}
	paths := map[string]string{}
	wanted := map[string]bool{}
	for i, ref := range refs {
		key := folder + "\x00" + ref.guid
		unityIconPaths.Lock()
		rel := unityIconPaths.paths[key]
		unityIconPaths.Unlock()
		m := unityMetaGUID.FindSubmatch(readIconInput(folder, rel+".meta", maxIconSourceBytes))
		if rel != "" && len(m) == 2 && strings.EqualFold(string(m[1]), ref.guid) {
			if data := readIconFile(folder, rel); data != nil {
				if i == 0 {
					return data, rel
				}
				paths[ref.guid] = rel
				continue
			}
		}
		wanted[ref.guid] = true
	}
	remaining := 20000
	deadline := time.Now().Add(2 * time.Second)
	var walk func(string, int)
	walk = func(dir string, depth int) {
		if depth > 32 || remaining <= 0 || len(wanted) == 0 || time.Now().After(deadline) {
			return
		}
		entries := iconEntries(folder, dir, &remaining)
		slices.SortFunc(entries, func(a, b os.DirEntry) int { return strings.Compare(a.Name(), b.Name()) })
		for _, e := range entries {
			if len(wanted) == 0 || time.Now().After(deadline) {
				return
			}
			rel := path.Join(dir, e.Name())
			if e.IsDir() && !skipIconDir(e.Name()) {
				walk(rel, depth+1)
			} else if strings.HasSuffix(e.Name(), ".meta") {
				m := unityMetaGUID.FindSubmatch(readIconInput(folder, rel, maxIconSourceBytes))
				if len(m) == 2 {
					guid := strings.ToLower(string(m[1]))
					if wanted[guid] {
						paths[guid] = strings.TrimSuffix(rel, ".meta")
						delete(wanted, guid)
					}
				}
			}
		}
	}
	walk("Assets", 0)
	for _, ref := range refs {
		if rel := paths[ref.guid]; rel != "" {
			if data := readIconFile(folder, rel); data != nil {
				unityIconPaths.Lock()
				if len(unityIconPaths.paths) >= 128 {
					clear(unityIconPaths.paths)
				}
				unityIconPaths.paths[folder+"\x00"+ref.guid] = rel
				unityIconPaths.Unlock()
				return data, rel
			}
		}
	}
	return nil, ""
}
