package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// storageSetup is a data folder with its database in it, as the app has.
func storageSetup(t *testing.T) (*store.Store, string) {
	t.Helper()
	dataDir := t.TempDir()
	db, err := store.Open(filepath.Join(dataDir, dbName))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, dataDir
}

// writeAttachment puts an attachment in files/ as the app keeps one: the
// file in the folder of its content, and where it came from beside it.
func writeAttachment(t *testing.T, dataDir, folder, name, content string) {
	t.Helper()
	dir := filepath.Join(filesDir(dataDir), folder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filesDir(dataDir), folder+".origin"), []byte(`C:\原来\`+name), 0o644); err != nil {
		t.Fatal(err)
	}
}

// ageAll sets when every file under dir was last changed.
func ageAll(t *testing.T, dir string, d time.Duration) {
	t.Helper()
	when := time.Now().Add(-d)
	err := filepath.Walk(dir, func(path string, _ os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return os.Chtimes(path, when, when)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// clockSweeper is a sweeper whose clock the test moves.
func clockSweeper() (*sweeper, *time.Duration) {
	s := newSweeper()
	base := time.Now()
	var offset time.Duration
	s.now = func() time.Time { return base.Add(offset) }
	return s, &offset
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestStorageUsageParts(t *testing.T) {
	db, dataDir := storageSetup(t)
	used, err := saveImage(dataDir, pngBytes(t, 1))
	if err != nil {
		t.Fatal(err)
	}
	unused, err := saveImage(dataDir, pngBytes(t, 2))
	if err != nil {
		t.Fatal(err)
	}
	writeAttachment(t, dataDir, "00000000000000aa", "报告 v2.pdf", strings.Repeat("p", 3000))
	writeAttachment(t, dataDir, "00000000000000bb", "旧.txt", "old")
	if err := os.MkdirAll(wallpaperDir(dataDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wallpaperDir(dataDir), "wall.jpg"), make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "notes.txt"), make([]byte, 700), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := db.CreateProject("存储")
	if err != nil {
		t.Fatal(err)
	}
	note := "![](image:" + used + ")\n\n[报告 v2.pdf](<attachment:00000000000000aa/报告 v2.pdf>)"
	if _, err := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "带附件", Note: note}); err != nil {
		t.Fatal(err)
	}

	u, err := newSweeper().usage(db, dataDir, nil)
	if err != nil {
		t.Fatal(err)
	}
	parts := map[StorageKind]StoragePart{}
	var sum int64
	for _, p := range u.Parts {
		parts[p.Kind] = p
		sum += p.Bytes
	}
	if len(u.Parts) != 5 || u.Total != sum {
		t.Fatalf("parts %+v, total %d", u.Parts, u.Total)
	}
	size := func(path string) int64 {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		return info.Size()
	}
	images := size(filepath.Join(imageDir(dataDir), used)) + size(filepath.Join(imageDir(dataDir), unused))
	if got := parts[StorageImages]; got.Bytes != images || got.Count != 2 {
		t.Errorf("images %+v, want %d bytes in 2", got, images)
	}
	origins := size(filepath.Join(filesDir(dataDir), "00000000000000aa.origin")) + size(filepath.Join(filesDir(dataDir), "00000000000000bb.origin"))
	if got := parts[StorageFiles]; got.Bytes != 3003+origins || got.Count != 2 {
		t.Errorf("files %+v, want %d bytes in 2", got, 3003+origins)
	}
	if got := parts[StorageWallpapers]; got.Bytes != 5000 || got.Count != 1 {
		t.Errorf("wallpapers %+v", got)
	}
	if got := parts[StorageDatabase]; got.Bytes <= 0 || got.Bytes != databaseSize(dataDir) {
		t.Errorf("database %+v, want %d", got, databaseSize(dataDir))
	}
	if got := parts[StorageOther]; got.Bytes != 700 {
		t.Errorf("other %+v, want the 700 bytes of notes.txt", got)
	}
	unusedBytes := size(filepath.Join(imageDir(dataDir), unused)) + 3 + size(filepath.Join(filesDir(dataDir), "00000000000000bb.origin"))
	if u.Reclaim.Count != 2 || u.Reclaim.Bytes != unusedBytes {
		t.Errorf("reclaim %+v, want the unused picture and attachment, %d bytes", u.Reclaim, unusedBytes)
	}
	// Just saved: in the grace.
	if u.Reclaim.ReadyCount != 0 || u.Reclaim.NextAt == 0 {
		t.Errorf("reclaim %+v, want none ready yet and a time for the first", u.Reclaim)
	}
	if u.GraceMinutes != 60 || u.LastClean.At != 0 {
		t.Errorf("grace %d, last clean %+v", u.GraceMinutes, u.LastClean)
	}
}

func TestStorageUsageEmptyFolder(t *testing.T) {
	db, dataDir := storageSetup(t)
	u, err := newSweeper().usage(db, dataDir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if u.Reclaim.Count != 0 || u.Total != databaseSize(dataDir) {
		t.Errorf("usage of a new folder %+v", u)
	}
}

// The grace counts from when the run first found a file unused, not from
// when it was saved: a picture saved long ago and taken out of its note
// just now stays an hour, for an undo.
func TestSweepGraceFromUnused(t *testing.T) {
	db, dataDir := storageSetup(t)
	name, err := saveImage(dataDir, pngBytes(t, 3))
	if err != nil {
		t.Fatal(err)
	}
	age(t, dataDir, name, 30*24*time.Hour)
	p, _ := db.CreateProject("回收")
	it, err := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "有图", Note: "![](image:" + name + ")"})
	if err != nil {
		t.Fatal(err)
	}
	s, offset := clockSweeper()
	s.prime(db, dataDir)
	if _, err := db.SetItemNote(it.ID, "图删掉了"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(imageDir(dataDir), name)
	sweep := func() CleanResult {
		t.Helper()
		res, err := s.sweep(db, dataDir, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if res := sweep(); res.Deleted != 0 || !exists(path) {
		t.Fatalf("deleted the picture as it went unused: %+v", res)
	}
	*offset = 59 * time.Minute
	if res := sweep(); res.Deleted != 0 {
		t.Fatalf("deleted within the grace: %+v", res)
	}
	*offset = 61 * time.Minute
	res := sweep()
	if res.Deleted != 1 || exists(path) {
		t.Fatalf("kept after the grace: %+v", res)
	}
	if res.Freed <= 0 || res.At == 0 || res.Manual {
		t.Errorf("result %+v", res)
	}
	u, err := s.usage(db, dataDir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if u.LastClean != res || u.Reclaim.Count != 0 {
		t.Errorf("usage after the sweep: %+v", u)
	}
}

// Referred to again, a file starts over: its old time unused counts no more.
func TestSweepReferredAgainStartsOver(t *testing.T) {
	db, dataDir := storageSetup(t)
	name, _ := saveImage(dataDir, pngBytes(t, 4))
	age(t, dataDir, name, 30*24*time.Hour)
	p, _ := db.CreateProject("回收")
	it, _ := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "有图", Note: "![](image:" + name + ")"})
	s, offset := clockSweeper()
	s.prime(db, dataDir)
	set := func(note string) {
		if _, err := db.SetItemNote(it.ID, note); err != nil {
			t.Fatal(err)
		}
	}
	sweep := func() int {
		res, err := s.sweep(db, dataDir, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		return res.Deleted
	}
	set("没有图")
	sweep() // found unused at 0
	*offset = 40 * time.Minute
	set("![](image:" + name + ")") // undone
	sweep()
	set("又删掉了")
	*offset = 50 * time.Minute
	sweep() // found unused again at 50 min
	*offset = 70 * time.Minute
	if sweep() != 0 {
		t.Fatal("counted the time before it was referred to again")
	}
	*offset = 111 * time.Minute
	if sweep() != 1 {
		t.Fatal("kept an hour after it went unused again")
	}
}

// The first scan of a run goes by how old the files are: the undo history of
// the run before is gone.
func TestSweepFirstScanByAge(t *testing.T) {
	db, dataDir := storageSetup(t)
	old, _ := saveImage(dataDir, pngBytes(t, 5))
	recent, _ := saveImage(dataDir, pngBytes(t, 6))
	age(t, dataDir, old, 2*time.Hour)
	age(t, dataDir, recent, 30*time.Minute)
	writeAttachment(t, dataDir, "0000000000000001", "a.txt", "a")
	ageAll(t, filesDir(dataDir), 3*time.Hour)
	if err := os.WriteFile(filepath.Join(filesDir(dataDir), savingPrefix+"9"), []byte("half"), 0o644); err != nil {
		t.Fatal(err)
	}
	half := filepath.Join(filesDir(dataDir), savingPrefix+"9")
	when := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(half, when, when); err != nil {
		t.Fatal(err)
	}

	s, offset := clockSweeper()
	s.prime(db, dataDir)
	res, err := s.sweep(db, dataDir, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Deleted != 3 {
		t.Errorf("deleted %d, want the old picture, the attachment and the half written file", res.Deleted)
	}
	for _, p := range []string{
		filepath.Join(imageDir(dataDir), old),
		filepath.Join(filesDir(dataDir), "0000000000000001"),
		filepath.Join(filesDir(dataDir), "0000000000000001.origin"),
		half,
	} {
		if exists(p) {
			t.Errorf("%s stays", p)
		}
	}
	recentPath := filepath.Join(imageDir(dataDir), recent)
	if !exists(recentPath) {
		t.Fatal("deleted a picture saved half an hour ago")
	}
	*offset = 31 * time.Minute
	if res, _ := s.sweep(db, dataDir, nil, false); res.Deleted != 1 || exists(recentPath) {
		t.Errorf("kept the recent picture an hour after it was saved: %+v", res)
	}
}

// Pictures and attachments in the draft of quick capture are in use; when
// the draft cannot be read, nothing goes.
func TestSweepHeldTexts(t *testing.T) {
	db, dataDir := storageSetup(t)
	pic, _ := saveImage(dataDir, pngBytes(t, 7))
	age(t, dataDir, pic, 2*time.Hour)
	writeAttachment(t, dataDir, "00000000000000cc", "草稿.pdf", "d")
	ageAll(t, filesDir(dataDir), 2*time.Hour)
	other, _ := saveImage(dataDir, pngBytes(t, 8))
	age(t, dataDir, other, 2*time.Hour)

	s := newSweeper()
	s.prime(db, dataDir)
	broken := func() ([]string, error) { return nil, errors.New("the page did not answer") }
	res, err := s.sweep(db, dataDir, broken, true)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Skipped || res.Deleted != 0 || !res.Manual {
		t.Fatalf("without the draft: %+v, want nothing deleted", res)
	}
	draft := func() ([]string, error) {
		return []string{"![](image:" + pic + ")\n[草稿.pdf](<attachment:00000000000000cc/草稿.pdf>)"}, nil
	}
	res, err = s.sweep(db, dataDir, draft, false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Skipped || res.Deleted != 1 {
		t.Fatalf("with the draft: %+v, want only the other picture deleted", res)
	}
	if !exists(filepath.Join(imageDir(dataDir), pic)) || !exists(filepath.Join(filesDir(dataDir), "00000000000000cc")) {
		t.Error("deleted what the draft refers to")
	}
	if exists(filepath.Join(imageDir(dataDir), other)) {
		t.Error("kept the picture nothing refers to")
	}
}

// Files that are not the app's, in its folders, are left alone.
func TestSweepLeavesOthersAlone(t *testing.T) {
	db, dataDir := storageSetup(t)
	for _, p := range []string{
		filepath.Join(imageDir(dataDir), "mine.png"),
		filepath.Join(filesDir(dataDir), "readme.txt"),
		filepath.Join(filesDir(dataDir), "not-a-hash", "x.txt"),
	} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	ageAll(t, dataDir, 48*time.Hour)
	if n, err := cleanOnce(db, dataDir, 0); err != nil || n != 0 {
		t.Fatalf("cleanOnce = %d, %v; want nothing deleted", n, err)
	}
}
