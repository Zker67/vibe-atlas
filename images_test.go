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

	"github.com/egoist/mygo/transfer"

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

	// An SVG icon, which runs nothing even opened on its own.
	svg, err := writeImage(a.dataDir, []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), ".svg")
	if err != nil {
		t.Fatal(err)
	}
	rec = get(http.MethodGet, "/"+svg)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/svg+xml" ||
		!strings.Contains(rec.Header().Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatalf("GET the SVG: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Header().Get("Content-Security-Policy"))
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

func TestFetchImage(t *testing.T) {
	pic := pngBytes(t, 90)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/pic.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pic)
		case "/big":
			_, _ = w.Write(make([]byte, maxImageBytes+10))
		case "/slow":
			time.Sleep(300 * time.Millisecond)
			_, _ = w.Write(pic)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	got, err := fetchImage(srv.URL+"/pic.png", time.Second)
	if err != nil || !bytes.Equal(got, pic) {
		t.Fatalf("web picture: %v, %d bytes", err, len(got))
	}
	dataDir := t.TempDir()
	name, err := saveImage(dataDir, got)
	if err != nil || !imageFile.MatchString(name) {
		t.Fatalf("saving the downloaded picture: %q, %v", name, err)
	}

	if _, err := fetchImage(srv.URL+"/missing.png", time.Second); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("a missing picture: %v", err)
	}
	if _, err := fetchImage(srv.URL+"/slow", 50*time.Millisecond); err == nil {
		t.Error("a download past its time was taken")
	}
	big, err := fetchImage(srv.URL+"/big", 5*time.Second)
	if err != nil || len(big) != maxImageBytes+1 {
		t.Fatalf("a large download read %d bytes, %v; want the limit and one more", len(big), err)
	}
	if _, err := saveImage(dataDir, big); err == nil {
		t.Error("a picture past the limit was saved")
	}

	// A file on this machine, by a file: link with a space in its path.
	dir := filepath.Join(t.TempDir(), "带 空格")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "clip_image001.png")
	if err := os.WriteFile(path, pic, 0o644); err != nil {
		t.Fatal(err)
	}
	link := "file:///" + strings.ReplaceAll(filepath.ToSlash(path), " ", "%20")
	if got, err := fetchImage(link, time.Second); err != nil || !bytes.Equal(got, pic) {
		t.Fatalf("local picture %s: %v", link, err)
	}
	if _, err := fetchImage("file:///"+filepath.ToSlash(filepath.Join(dir, "none.png")), time.Second); err == nil {
		t.Error("a missing local file was read")
	}

	for _, src := range []string{"blob:https://x/1", "javascript:alert(1)", "data:image/png;base64,AAAA", ""} {
		if _, err := fetchImage(src, time.Second); err == nil {
			t.Errorf("%q was taken", src)
		}
	}
}

func TestSaveImageFiles(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.png")
	b := filepath.Join(dir, "b.png")
	notPic := filepath.Join(dir, "readme.png")
	for path, data := range map[string][]byte{a: pngBytes(t, 1), b: pngBytes(t, 2), notPic: []byte("not a picture")} {
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	dataDir := t.TempDir()
	names, err := saveImageFiles(dataDir, []string{a, notPic, b})
	if err != nil || len(names) != 2 || names[0] == names[1] {
		t.Fatalf("names %v, %v; want the two pictures, in order", names, err)
	}
	if got := imageFiles(t, dataDir); len(got) != 2 {
		t.Errorf("saved %v", got)
	}
	if names, err := saveImageFiles(dataDir, nil); err != nil || len(names) != 0 {
		t.Errorf("nothing chosen: %v, %v", names, err)
	}
	if _, err := saveImageFiles(dataDir, []string{notPic, filepath.Join(dir, "none.png")}); err == nil || !strings.Contains(err.Error(), "readme.png") {
		t.Errorf("none could be kept: %v", err)
	}
}

func TestImagePath(t *testing.T) {
	dataDir := t.TempDir()
	name, err := saveImage(dataDir, pngBytes(t, 3))
	if err != nil {
		t.Fatal(err)
	}
	if path, err := imagePath(dataDir, name); err != nil || path != filepath.Join(imageDir(dataDir), name) {
		t.Errorf("saved picture: %q, %v", path, err)
	}
	for _, bad := range []string{"0123456789abcdef.png", "../images/" + name, "x.png", ""} {
		if _, err := imagePath(dataDir, bad); err == nil {
			t.Errorf("%q: want an error", bad)
		}
	}
}

func TestImageClipboard(t *testing.T) {
	dataDir := t.TempDir()
	var gifBuf bytes.Buffer
	pal := image.NewPaletted(image.Rect(0, 0, 5, 3), color.Palette{color.Black, color.White})
	if err := gif.Encode(&gifBuf, pal, nil); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		data []byte
		ext  string
	}{{pngBytes(t, 4), ".png"}, {gifBuf.Bytes(), ".gif"}} {
		name, err := saveImage(dataDir, c.data)
		if err != nil || !strings.HasSuffix(name, c.ext) {
			t.Fatalf("save %s: %q, %v", c.ext, name, err)
		}
		path := filepath.Join(imageDir(dataDir), name)
		d, err := imageClipboard(path)
		if err != nil {
			t.Fatalf("%s: %v", c.ext, err)
		}
		if len(d.Items()) != 1 {
			t.Errorf("%s: %d items, want one picture", c.ext, len(d.Items()))
		}
		pic, err := d.Read(transfer.PNG)
		if err != nil {
			t.Fatalf("%s: no PNG: %v", c.ext, err)
		}
		img, err := png.Decode(bytes.NewReader(pic))
		if err != nil || img.Bounds().Dx() != map[string]int{".png": 6, ".gif": 5}[c.ext] {
			t.Errorf("%s: PNG on the clipboard: %v", c.ext, err)
		}
		files, err := d.Files()
		if err != nil || len(files) != 1 || !strings.EqualFold(filepath.Clean(files[0]), filepath.Clean(path)) {
			t.Errorf("%s: files %v, %v; want %s", c.ext, files, err, path)
		}
	}

	// A picture image.Decode cannot read goes as its file alone.
	bmp := filepath.Join(imageDir(dataDir), "00000000000000aa.bmp")
	if err := os.WriteFile(bmp, append([]byte("BM"), make([]byte, 64)...), 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := imageClipboard(bmp)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Read(transfer.PNG); err == nil {
		t.Error("BMP: want no PNG")
	}
	if files, err := d.Files(); err != nil || len(files) != 1 {
		t.Errorf("BMP: files %v, %v", files, err)
	}
}
