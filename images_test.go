package main

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// pngBytes encodes a small real PNG, its pixel shade setting it apart.
func pngBytes(t *testing.T, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 6, 4))
	img.Set(2, 2, color.RGBA{R: shade, G: 10, B: 10, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func imageFiles(t *testing.T, dataDir string) []string {
	t.Helper()
	entries, err := os.ReadDir(imageDir(dataDir))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	slices.Sort(names)
	return names
}

// age sets when the picture name was last saved.
func age(t *testing.T, dataDir, name string, d time.Duration) {
	t.Helper()
	when := time.Now().Add(-d)
	if err := os.Chtimes(filepath.Join(imageDir(dataDir), name), when, when); err != nil {
		t.Fatal(err)
	}
}

func TestSaveImageNamesByContent(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "数据 目录") // spaces and Chinese, as user folders have
	data := pngBytes(t, 200)
	name, err := saveImage(dir, data)
	if err != nil {
		t.Fatal(err)
	}
	if !imageFile.MatchString(name) || !strings.HasSuffix(name, ".png") {
		t.Fatalf("name = %q", name)
	}
	got, err := os.ReadFile(filepath.Join(imageDir(dir), name))
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("saved file differs: %v", err)
	}

	// The same picture again: one file, its time renewed.
	age(t, dir, name, 48*time.Hour)
	again, err := saveImage(dir, data)
	if err != nil || again != name {
		t.Fatalf("saving again = %q, %v; want %q", again, err, name)
	}
	info, err := os.Stat(filepath.Join(imageDir(dir), name))
	if err != nil || time.Since(info.ModTime()) > time.Hour {
		t.Errorf("saving again did not renew the picture's time: %v %v", info.ModTime(), err)
	}

	other, err := saveImage(dir, pngBytes(t, 50))
	if err != nil || other == name {
		t.Fatalf("another picture = %q, %v", other, err)
	}

	// The extension comes from the content.
	var buf bytes.Buffer
	if err := gif.Encode(&buf, image.NewPaletted(image.Rect(0, 0, 2, 2), []color.Color{color.Black, color.White}), nil); err != nil {
		t.Fatal(err)
	}
	g, err := saveImage(dir, buf.Bytes())
	if err != nil || !strings.HasSuffix(g, ".gif") {
		t.Fatalf("gif = %q, %v", g, err)
	}
	if files := imageFiles(t, dir); len(files) != 3 {
		t.Errorf("files = %q, want 3 pictures and nothing half written", files)
	}
}

func TestSaveImageRefuses(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name string
		data []byte
		want string
	}{
		{"empty", nil, "空的"},
		{"text", []byte("not a picture at all"), "不支持"},
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), "不支持"},
		{"too big", append(pngBytes(t, 1), make([]byte, maxImageBytes)...), "不能超过 20 MB"},
	} {
		if _, err := saveImage(dir, tc.data); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want one with %q", tc.name, err, tc.want)
		}
	}
	if files := imageFiles(t, dir); len(files) != 0 {
		t.Errorf("refused pictures left files: %q", files)
	}
}

func TestServeImage(t *testing.T) {
	a := &app{dataDir: t.TempDir()}
	name, err := saveImage(a.dataDir, pngBytes(t, 120))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(a.dataDir, "vibe-atlas.db"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	get := func(method, path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		a.serveImage(rec, httptest.NewRequest(method, "image://localhost"+path, nil))
		return rec
	}
	rec := get(http.MethodGet, "/"+name)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("GET the picture: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Header().Get("Cache-Control"))
	}
	for _, path := range []string{"/../vibe-atlas.db", "/vibe-atlas.db", "/", "/0123456789abcdef.png", "/" + strings.ToUpper(name)} {
		if rec := get(http.MethodGet, path); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: %d, want 404", path, rec.Code)
		}
	}
	if rec := get(http.MethodPost, "/"+name); rec.Code != http.StatusNotFound {
		t.Errorf("POST: %d, want 404", rec.Code)
	}
}

func TestCopyPutsImagePaths(t *testing.T) {
	db := openStore(t)
	dataDir := filepath.Join(t.TempDir(), "My Data")
	p, err := db.CreateProject("规则恐怖")
	if err != nil {
		t.Fatal(err)
	}
	top, err := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "界面", Note: "看这张：\n\n![](image:aaaaaaaaaaaaaaaa.png)"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateItem(store.NewItem{ProjectID: p.ID, ParentID: top.ID, Title: "按钮", Note: "![](image:bbbbbbbbbbbbbbbb.jpg) ![图](image:cccccccccccccccc.webp)\n写成 `image:dddddddddddddddd.png` 的字不是图片"}); err != nil {
		t.Fatal(err)
	}
	it, err := db.Item(top.ID)
	if err != nil {
		t.Fatal(err)
	}
	descendants, err := db.Descendants(top.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := withImagePaths(ItemText(it, descendants), dataDir)
	dir := imageDir(dataDir)
	for _, want := range []string{
		"![](<" + filepath.Join(dir, "aaaaaaaaaaaaaaaa.png") + ">)",
		"\n  ![](<" + filepath.Join(dir, "bbbbbbbbbbbbbbbb.jpg") + ">) ![图](<" + filepath.Join(dir, "cccccccccccccccc.webp") + ">)",
		"`image:dddddddddddddddd.png`",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("copied text lacks %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "(image:") {
		t.Errorf("copied text still has image names:\n%s", got)
	}
	if text := "没有图片的备注"; withImagePaths(text, dataDir) != text {
		t.Error("a text without pictures changed")
	}
}

func TestCleanImages(t *testing.T) {
	db := openStore(t)
	dataDir := t.TempDir()
	if n, err := cleanImages(db, dataDir, imageGrace); err != nil || n != 0 {
		t.Fatalf("without a folder: %d, %v", n, err)
	}
	save := func(shade uint8) string {
		name, err := saveImage(dataDir, pngBytes(t, shade))
		if err != nil {
			t.Fatal(err)
		}
		return name
	}
	inNote, inChild, inProject, orphan, fresh, deletedItem := save(1), save(2), save(3), save(4), save(5), save(6)

	p, err := db.CreateProject("规则恐怖")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetProjectDescription(p.ID, "![](image:"+inProject+")"); err != nil {
		t.Fatal(err)
	}
	top, err := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "父", Note: "前面 ![](image:" + inNote + ") 后面"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateItem(store.NewItem{ProjectID: p.ID, ParentID: top.ID, Title: "子", Note: "![](image:" + inChild + ")"}); err != nil {
		t.Fatal(err)
	}
	gone, err := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "删掉的", Note: "![](image:" + deletedItem + ")"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.DeleteItem(gone.ID); err != nil {
		t.Fatal(err)
	}
	// Left over from a crash while saving, and something not ours.
	for _, name := range []string{savingPrefix + "123", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(imageDir(dataDir), name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{inNote, inChild, inProject, orphan, deletedItem, savingPrefix + "123", "notes.txt"} {
		age(t, dataDir, name, 2*imageGrace)
	}
	age(t, dataDir, fresh, imageGrace/2)

	n, err := cleanImages(db, dataDir, imageGrace)
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Errorf("deleted %d, want 3 (the orphan, the deleted item's, the half written)", n)
	}
	want := []string{inNote, inChild, inProject, fresh, "notes.txt"}
	slices.Sort(want)
	if got := imageFiles(t, dataDir); !slices.Equal(got, want) {
		t.Errorf("left %q, want %q", got, want)
	}
}
