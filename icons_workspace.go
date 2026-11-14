package main

import (
	"encoding/json"
	"os"
	"path"
	"slices"
	"strings"
)

const maxIconAppDirs = 64

func workspacePatterns(folder string) []string {
	var pkg struct {
		Workspaces json.RawMessage `json:"workspaces"`
	}
	var patterns []string
	if json.Unmarshal(readIconInput(folder, "package.json", maxIconSourceBytes), &pkg) == nil {
		if json.Unmarshal(pkg.Workspaces, &patterns) != nil {
			patterns = nil
			var object struct {
				Packages []string `json:"packages"`
			}
			if json.Unmarshal(pkg.Workspaces, &object) == nil {
				patterns = object.Packages
			}
		}
	}
	patterns = append(patterns, pnpmWorkspacePatterns(string(readIconInput(folder, "pnpm-workspace.yaml", maxIconSourceBytes)))...)
	if len(patterns) > 128 {
		return nil // Never drop exclusions by truncating a manifest.
	}
	return patterns
}

// Read only pnpm's top-level packages string list. YAML aliases, tags and
// complex expressions are not interpreted. Unsupported forms fail closed.
func pnpmWorkspacePatterns(source string) []string {
	var out []string
	active := false
	for _, line := range strings.Split(source, "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		if !active {
			if line != strings.TrimLeft(line, " \t") || !strings.HasPrefix(trim, "packages:") {
				continue
			}
			rest := strings.TrimSpace(strings.TrimPrefix(trim, "packages:"))
			if strings.HasPrefix(rest, "[") {
				// JSON arrays are also valid YAML; other inline forms are
				// intentionally left to the conventional-path fallback.
				if json.Unmarshal([]byte(rest), &out) != nil {
					return nil
				}
				return out
			}
			if rest != "" && !strings.HasPrefix(rest, "#") {
				return nil
			}
			active = true
			continue
		}
		if !strings.HasPrefix(trim, "- ") {
			break
		}
		value := strings.TrimSpace(strings.TrimPrefix(trim, "- "))
		if strings.HasPrefix(value, "'") {
			// YAML escapes single quotes by doubling them.
			var b strings.Builder
			closed := false
			for i := 1; i < len(value); i++ {
				if value[i] == '\'' {
					if i+1 < len(value) && value[i+1] == '\'' {
						b.WriteByte('\'')
						i++
						continue
					}
					tail := strings.TrimSpace(value[i+1:])
					closed = tail == "" || strings.HasPrefix(tail, "#")
					break
				}
				b.WriteByte(value[i])
			}
			if !closed {
				return nil
			}
			value = b.String()
		} else if strings.HasPrefix(value, `"`) {
			// Decode a JSON-compatible double-quoted scalar and allow a comment.
			dec := json.NewDecoder(strings.NewReader(value))
			var decoded string
			if dec.Decode(&decoded) != nil {
				return nil
			}
			tail := strings.TrimSpace(value[dec.InputOffset():])
			if tail != "" && !strings.HasPrefix(tail, "#") {
				return nil
			}
			value = decoded
		} else {
			value, _, _ = strings.Cut(value, " #")
			value = strings.TrimSpace(value)
			if value == "" || strings.ContainsAny(value[:1], "*&!{[>|@`") {
				return nil
			}
		}
		out = append(out, value)
	}
	return out
}

// Segment-based matching keeps '*' inside a directory; '**' may cross
// directories, but expansion is capped at eight levels and 4096 entries.
func iconGlobMatch(pattern, rel string) bool {
	p, r := strings.Split(pattern, "/"), strings.Split(rel, "/")
	var match func(int, int) bool
	match = func(i, j int) bool {
		if i == len(p) {
			return j == len(r)
		}
		if p[i] == "**" {
			return match(i+1, j) || j < len(r) && match(i, j+1)
		}
		if j >= len(r) {
			return false
		}
		ok, _ := path.Match(p[i], r[j])
		return ok && match(i+1, j+1)
	}
	return match(0, 0)
}

func workspaceAppDirs(folder string) []string {
	var includes, excludes []string
	for _, pattern := range workspacePatterns(folder) {
		exclude := strings.HasPrefix(pattern, "!")
		pattern = iconRelativePath(strings.TrimPrefix(pattern, "!"))
		if pattern == "" || pattern == "." || len(strings.Split(pattern, "/")) > 8 {
			continue
		}
		if exclude {
			excludes = append(excludes, pattern)
		} else {
			includes = append(includes, pattern)
		}
	}
	remaining := 4096
	seen, visited := map[string]bool{}, map[string]bool{}
	var dirs []string
	var expand func(string, []string, int)
	expand = func(dir string, parts []string, depth int) {
		key := dir + "\x00" + strings.Join(parts, "/")
		if visited[key] || depth > 8 || len(dirs) >= maxIconAppDirs {
			return
		}
		visited[key] = true
		if len(parts) == 0 {
			if dir == "." || seen[dir] {
				return
			}
			for _, pattern := range excludes {
				if iconGlobMatch(pattern, dir) {
					return
				}
			}
			if isIconAppDir(folder, dir) {
				seen[dir] = true
				dirs = append(dirs, dir)
			}
			return
		}
		if parts[0] == "**" {
			expand(dir, parts[1:], depth)
		}
		// Literal segments need no directory listing.
		if !strings.ContainsAny(parts[0], "*?[") {
			if !skipIconDir(parts[0]) {
				expand(path.Join(dir, parts[0]), parts[1:], depth+1)
			}
			return
		}
		entries := iconEntries(folder, dir, &remaining)
		slices.SortFunc(entries, func(a, b os.DirEntry) int { return strings.Compare(a.Name(), b.Name()) })
		for _, e := range entries {
			if !e.IsDir() || skipIconDir(e.Name()) {
				continue
			}
			if parts[0] == "**" {
				expand(path.Join(dir, e.Name()), parts, depth+1)
			} else if ok, _ := path.Match(parts[0], e.Name()); ok {
				expand(path.Join(dir, e.Name()), parts[1:], depth+1)
			}
		}
	}
	for _, pattern := range includes {
		expand(".", strings.Split(pattern, "/"), 0)
	}
	slices.Sort(dirs)
	return dirs
}

func isIconAppDir(folder, dir string) bool {
	for _, marker := range []string{"package.json", "index.html", "mygo.config.ts", "mygo.config.js", "mygo.config.mjs", "project.godot", "ProjectSettings/ProjectSettings.asset"} {
		if readIconInput(folder, path.Join(dir, marker), maxIconSourceBytes) != nil {
			return true
		}
	}
	return false
}
