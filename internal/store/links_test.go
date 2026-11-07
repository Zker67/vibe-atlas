package store

import (
	"runtime"
	"strings"
	"testing"
)

func TestNormalizeDeeplink(t *testing.T) {
	ok := map[string]string{
		"https://claude.ai/chat/1":               "https://claude.ai/chat/1",
		"  http://localhost:5173/a?b=c#d \t":     "http://localhost:5173/a?b=c#d",
		"vscode://file/C:/game/src/weapon.ts:12": "vscode://file/C:/game/src/weapon.ts:12",
		"cursor://file/C:/game":                  "cursor://file/C:/game",
		"file:///C:/Users/ada/规则 恐怖/设计.md":       "file:///C:/Users/ada/规则 恐怖/设计.md",
		"obsidian://open?vault=notes":            "obsidian://open?vault=notes",
		"mailto:ada@example.com":                 "mailto:ada@example.com",
		"":                                       "",
		"   ":                                    "",
	}
	for in, want := range ok {
		got, err := NormalizeDeeplink(in)
		if err != nil || got != want {
			t.Errorf("NormalizeDeeplink(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	bad := map[string]string{
		"随便写的文字":                  "完整的链接",
		"claude.ai/chat/1":        "完整的链接",
		"c:foo":                   "完整的链接", // a one-letter scheme is a drive
		"https:":                  "不完整",
		"javascript:alert(1)":     "不支持",
		"JavaScript:alert(1)":     "不支持",
		"data:text/html,<b>x</b>": "不支持",
		"https://a\nb":            "换行",
		strings.Repeat("x", 5000): "太长",
	}
	for in, want := range bad {
		_, err := NormalizeDeeplink(in)
		wantUserErr(t, err, want)
	}
}

func TestLocalPathsBecomeFileLinks(t *testing.T) {
	if runtime.GOOS != "windows" {
		got, err := NormalizeDeeplink("/home/ada/notes.md")
		if err != nil || got != "file:///home/ada/notes.md" {
			t.Fatalf("got %q, %v", got, err)
		}
		return
	}
	cases := map[string]string{
		`C:\Users\ada\规则 恐怖\设计.md`: "file:///C:/Users/ada/规则 恐怖/设计.md",
		`D:/game`:                  "file:///D:/game",
		`\\nas\share\docs`:         "file://nas/share/docs",
	}
	for in, want := range cases {
		got, err := NormalizeDeeplink(in)
		if err != nil || got != want {
			t.Errorf("NormalizeDeeplink(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}

func TestLocalPath(t *testing.T) {
	if _, ok := LocalPath("https://example.com"); ok {
		t.Fatal("an https link is not a local path")
	}
	if runtime.GOOS != "windows" {
		if p, ok := LocalPath("file:///home/ada/a%20b.md"); !ok || p != "/home/ada/a b.md" {
			t.Fatalf("got %q, %v", p, ok)
		}
		return
	}
	cases := map[string]string{
		"file:///C:/Users/ada/规则 恐怖/设计.md": `C:\Users\ada\规则 恐怖\设计.md`,
		"file:///C:/Users/ada/a%20b.md":    `C:\Users\ada\a b.md`,
		"FILE:///c:/x":                     `c:\x`,
		"file://localhost/C:/x":            `C:\x`,
		"file://nas/share/docs":            `\\nas\share\docs`,
		"file:C:/x":                        `C:\x`,
	}
	for in, want := range cases {
		got, ok := LocalPath(in)
		if !ok || got != want {
			t.Errorf("LocalPath(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	// A path made into a link comes back as it was.
	path := `C:\Users\ada\规则 恐怖\设计.md`
	if got, _ := LocalPath(FileLink(path)); got != path {
		t.Fatalf("round trip: %q", got)
	}
}
