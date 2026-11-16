package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// writeFile writes content to name in dir and returns its path.
func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAttachPathsCopy(t *testing.T) {
	dataDir, src := t.TempDir(), t.TempDir()
	report := writeFile(t, src, "季度 报告 (终版).pdf", "%PDF-1.7 report")
	big := filepath.Join(src, "大文件.bin")
	if err := os.WriteFile(big, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(big, attachCopyLimit+1); err != nil {
		t.Fatal(err)
	}
	folder := filepath.Join(src, "素材 文件夹")
	if err := os.Mkdir(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	pic := filepath.Join(src, "shot.png")
	if err := os.WriteFile(pic, pngBytes(t, 9), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := writeFile(t, src, "not-really.png", "just text")
	missing := filepath.Join(src, "没有.txt")

	got := attachPaths(dataDir, AttachCopy, []string{report, big, folder, pic, fake, missing})
	if len(got.Items) != 5 || len(got.Problems) != 1 || !strings.Contains(got.Problems[0], "没有.txt") {
		t.Fatalf("attached %+v", got)
	}
	stored := got.Items[0]
	if !stored.Stored || stored.Name != "季度 报告 (终版).pdf" || !strings.HasPrefix(stored.Link, "attachment:") {
		t.Fatalf("report: %+v", stored)
	}
	path, ok := attachmentPath(dataDir, stored.Link)
	if !ok {
		t.Fatalf("not a link to a kept file: %s", stored.Link)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "%PDF-1.7 report" {
		t.Fatalf("the copy: %q, %v", b, err)
	}
	folderName := attachmentLink.FindStringSubmatch(stored.Link)[1]
	if origin, err := os.ReadFile(originPath(dataDir, folderName)); err != nil || string(origin) != report {
		t.Errorf("origin %q, %v; want %s", origin, err, report)
	}
	for i, want := range []string{big, folder} {
		it := got.Items[i+1]
		if it.Stored || it.Image != "" {
			t.Errorf("%s: %+v, want it referred to where it is", want, it)
		}
		if p, ok := store.LocalPath(it.Link); !ok || p != want {
			t.Errorf("%s: link %s names %s", want, it.Link, p)
		}
	}
	if it := got.Items[3]; it.Image == "" || !imageFile.MatchString(it.Image) {
		t.Errorf("picture: %+v, want it saved as a picture", it)
	}
	if it := got.Items[4]; !it.Stored || it.Name != "not-really.png" {
		t.Errorf("a .png that is not a picture: %+v, want it kept as a file", it)
	}
	if _, err := os.Stat(filepath.Join(imageDir(dataDir), got.Items[3].Image)); err != nil {
		t.Error(err)
	}
}

func TestAttachPathsLinkMode(t *testing.T) {
	dataDir, src := t.TempDir(), t.TempDir()
	doc := writeFile(t, src, "说明.docx", "doc")
	got := attachPaths(dataDir, AttachLink, []string{doc})
	if len(got.Items) != 1 || got.Items[0].Stored {
		t.Fatalf("attached %+v", got)
	}
	if _, err := os.Stat(filesDir(dataDir)); !os.IsNotExist(err) {
		t.Error("referring to a file where it is copied something")
	}
}

func TestStoreFileKeepsContentOnce(t *testing.T) {
	dataDir, src := t.TempDir(), t.TempDir()
	a := writeFile(t, src, "a.txt", "same")
	b := writeFile(t, filepath.Join(src, "sub"), "a.txt", "same")
	c := writeFile(t, src, "c.txt", "same")
	first, err := storeFile(dataDir, a)
	if err != nil {
		t.Fatal(err)
	}
	second, err := storeFile(dataDir, b)
	if err != nil {
		t.Fatal(err)
	}
	if first.Link != second.Link {
		t.Errorf("the same file twice: %s and %s", first.Link, second.Link)
	}
	if origin, _ := os.ReadFile(originPath(dataDir, attachmentLink.FindStringSubmatch(second.Link)[1])); string(origin) != b {
		t.Errorf("origin %q, want the later %s", origin, b)
	}
	third, err := storeFile(dataDir, c)
	if err != nil {
		t.Fatal(err)
	}
	m1, m3 := attachmentLink.FindStringSubmatch(first.Link), attachmentLink.FindStringSubmatch(third.Link)
	if m1[1] != m3[1] || m3[2] != "c.txt" {
		t.Errorf("same content, another name: %s, %s", first.Link, third.Link)
	}
	entries, _ := os.ReadDir(filepath.Join(filesDir(dataDir), m1[1]))
	if len(entries) != 2 {
		t.Errorf("%d files in the folder, want a.txt and c.txt", len(entries))
	}
	if _, err := storeFile(dataDir, src); err == nil || !strings.Contains(err.Error(), "文件夹") {
		t.Errorf("storing a folder: %v", err)
	}
	// No half written file stays.
	all, _ := os.ReadDir(filesDir(dataDir))
	for _, e := range all {
		if strings.HasPrefix(e.Name(), savingPrefix) {
			t.Errorf("left %s", e.Name())
		}
	}
}

func TestCleanFileName(t *testing.T) {
	long := strings.Repeat("长", 200) + ".pdf"
	for in, want := range map[string]string{
		"报告.pdf":         "报告.pdf",
		"a<b>c.txt":      "a_b_c.txt",
		"tab\tname.md":   "tab_name.md",
		"":               "文件",
		"..":             "文件",
		"  spaced .txt ": "spaced .txt",
		"../x":           "_x",
	} {
		if got := cleanFileName(in); got != want {
			t.Errorf("cleanFileName(%q) = %q, want %q", in, got, want)
		}
	}
	got := cleanFileName(long)
	if !strings.HasSuffix(got, ".pdf") || len([]rune(got)) != maxAttachName {
		t.Errorf("a long name: %d characters, %q", len([]rune(got)), got[len(got)-8:])
	}
}

func TestAttachmentPathRefusesOthers(t *testing.T) {
	dataDir := t.TempDir()
	for _, link := range []string{
		"attachment:0123456789abcdef/../../secret.txt",
		"attachment:0123456789abcdef/a/b.txt",
		"attachment:0123456789abcde/a.txt",
		"attachment:0123456789ABCDEF/a.txt",
		"file:///C:/a.txt",
	} {
		if p, ok := attachmentPath(dataDir, link); ok {
			t.Errorf("%s names %s", link, p)
		}
	}
	if p, ok := attachmentPath(dataDir, "attachment:0123456789abcdef/报告 (1).pdf"); !ok || p != filepath.Join(filesDir(dataDir), "0123456789abcdef", "报告 (1).pdf") {
		t.Errorf("a good link: %s, %v", p, ok)
	}
}

func TestFileLinkRoundTrip(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"有 空格.txt", "100%.txt", "括号(1).txt", "a#b.txt"} {
		path := filepath.Join(dir, name)
		link := fileLink(path)
		if strings.ContainsAny(link, "<>\n") {
			t.Errorf("%s: %s cannot sit in angle brackets", name, link)
		}
		if got, ok := store.LocalPath(link); !ok || got != path {
			t.Errorf("%s: %s names %s", name, link, got)
		}
	}
}

func TestFileInfoAndSwitching(t *testing.T) {
	dataDir, src := t.TempDir(), t.TempDir()
	orig := writeFile(t, src, "图纸.dwg", "drawing")
	a := &Atlas{app: &app{dataDir: dataDir}}

	linked := linkItem(orig)
	info := fileInfo(dataDir, linked.Link)
	if !info.Exists || info.Stored || info.Size != 7 || info.Folder != src || !info.CanStore || info.Name != "图纸.dwg" {
		t.Fatalf("linked %+v", info)
	}
	kept, err := a.StoreAttachment(linked.Link)
	if err != nil {
		t.Fatal(err)
	}
	info = fileInfo(dataDir, kept.Link)
	if !info.Exists || !info.Stored || !info.CanUnstore || info.CanStore || info.Folder != "" {
		t.Fatalf("kept %+v", info)
	}
	back, err := a.UnstoreAttachment(kept.Link)
	if err != nil || back.Link != linked.Link || back.Stored {
		t.Fatalf("back: %+v, %v", back, err)
	}
	if err := os.Remove(orig); err != nil {
		t.Fatal(err)
	}
	if info := fileInfo(dataDir, kept.Link); !info.Exists || info.CanUnstore {
		t.Errorf("the origin gone: %+v", info)
	}
	if _, err := a.UnstoreAttachment(kept.Link); err == nil || !strings.Contains(err.Error(), "不在了") {
		t.Errorf("unstoring without the origin: %v", err)
	}
	if info := fileInfo(dataDir, linked.Link); info.Exists || info.CanStore {
		t.Errorf("a link to a file gone: %+v", info)
	}
	if info := fileInfo(dataDir, linkItem(src).Link); !info.Exists || !info.Dir || info.CanStore {
		t.Errorf("a folder: %+v", info)
	}
	if _, err := linkedPath(dataDir, linked.Link); err == nil {
		t.Error("a file gone has a path")
	}
	if _, err := a.StoreAttachment("https://example.com/a.pdf"); err == nil {
		t.Error("stored a web address")
	}
}

func TestWithAttachmentPaths(t *testing.T) {
	dataDir := t.TempDir()
	text := "见 [报告 v2.pdf](<attachment:00000000000000aa/报告 v2.pdf>) 和 [b](attachment:00000000000000bb/b.txt)。\n[原地](<file:///C:/x.txt>)"
	got := withLocalPaths(text, dataDir)
	for _, want := range []string{
		"[报告 v2.pdf](<" + filepath.Join(filesDir(dataDir), "00000000000000aa", "报告 v2.pdf") + ">)",
		"[b](<" + filepath.Join(filesDir(dataDir), "00000000000000bb", "b.txt") + ">)",
		"[原地](<file:///C:/x.txt>)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("lacks %q:\n%s", want, got)
		}
	}
}

// A kept file a note refers to stays; once nothing does, it goes with its
// origin.
func TestCleanKeepsReferredAttachments(t *testing.T) {
	db, dataDir := storageSetup(t)
	src := t.TempDir()
	used, err := storeFile(dataDir, writeFile(t, src, "used.txt", "used"))
	if err != nil {
		t.Fatal(err)
	}
	unused, err := storeFile(dataDir, writeFile(t, src, "unused.txt", "unused"))
	if err != nil {
		t.Fatal(err)
	}
	p, _ := db.CreateProject("附件")
	if _, err := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "有附件", Note: "[used.txt](<" + used.Link + ">)"}); err != nil {
		t.Fatal(err)
	}
	ageAll(t, filesDir(dataDir), 2*time.Hour)
	if n, err := cleanOnce(db, dataDir, orphanGrace); err != nil || n != 1 {
		t.Fatalf("cleanOnce = %d, %v; want the unused one", n, err)
	}
	if _, err := linkedPath(dataDir, used.Link); err != nil {
		t.Error("deleted the one a note refers to")
	}
	unusedFolder := attachmentLink.FindStringSubmatch(unused.Link)[1]
	if exists(filepath.Join(filesDir(dataDir), unusedFolder)) || exists(originPath(dataDir, unusedFolder)) {
		t.Error("kept the unused one or its origin")
	}
}
