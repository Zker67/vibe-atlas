package main

import (
	"io"
	"os"
	"path"
	"strings"
)

// Only relative paths are accepted, even on platforms that treat a drive
// letter or backslash as an ordinary filename. OpenInRoot also confines
// symlinks/junctions, including when a file is replaced during detection.
func iconRelativePath(rel string) string {
	rel = strings.ReplaceAll(strings.TrimSpace(rel), `\`, "/")
	if rel == "" || strings.HasPrefix(rel, "/") || strings.ContainsAny(rel, ":\x00") {
		return ""
	}
	for _, part := range strings.Split(rel, "/") {
		if part == ".." {
			return ""
		}
	}
	return path.Clean(rel)
}

func readIconInput(folder, rel string, limit int64) []byte {
	rel = iconRelativePath(rel)
	if rel == "" {
		return nil
	}
	f, err := os.OpenInRoot(folder, rel)
	if err != nil {
		return nil
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > limit {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil
	}
	return data
}

// The caller owns the total entry budget; even one huge directory cannot
// allocate an unbounded listing. Directory links are never traversed.
func iconEntries(folder, rel string, remaining *int) []os.DirEntry {
	if *remaining <= 0 {
		return nil
	}
	f, err := os.OpenInRoot(folder, rel)
	if err != nil {
		return nil
	}
	defer f.Close()
	entries, _ := f.ReadDir(*remaining)
	*remaining -= len(entries)
	return entries
}

func skipIconDir(name string) bool {
	return strings.HasPrefix(name, ".") || skippedIconDirs[strings.ToLower(name)]
}
