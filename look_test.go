package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// writePNG writes a small real PNG to dir/name and returns its path.
func writePNG(t *testing.T, dir, name string) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.RGBA{R: 200, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func wallpaperFiles(t *testing.T, dataDir string) []string {
	t.Helper()
	entries, err := os.ReadDir(wallpaperDir(dataDir))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestLookDefaults(t *testing.T) {
	db := openStore(t)
	w := wallpaper(db, t.TempDir())
	if w.URL != "" || w.Name != "" {
		t.Errorf("a new database has a wallpaper: %+v", w)
	}
	if w.Look != defaultWallpaperLook {
		t.Errorf("look = %+v, want %+v", w.Look, defaultWallpaperLook)
	}
	if g := glass(db); g != defaultGlass {
		t.Errorf("glass = %+v, want %+v", g, defaultGlass)
	}
	if o := windowOpacity(db); o != 100 {
		t.Errorf("window opacity = %d, want 100", o)
	}
}

func TestLookPersistsAndClamps(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(db, keyGlass, Glass{Blur: 99, Panel: -5, Frame: 40}.clean()); err != nil {
		t.Fatal(err)
	}
	look := WallpaperLook{Enabled: false, Blur: 12, Opacity: 150, Scale: 5, X: 30, Y: 120}
	if err := writeJSON(db, keyWallpaperLook, look.clean()); err != nil {
		t.Fatal(err)
	}
	if err := db.SetSetting(keyWindowOpacity, "75"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	db, err = store.Open(path) // what the next start reads
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if g, want := glass(db), (Glass{Blur: 60, Panel: 0, Frame: 40}); g != want {
		t.Errorf("glass = %+v, want %+v", g, want)
	}
	if l, want := wallpaperLook(db), (WallpaperLook{Enabled: false, Blur: 12, Opacity: 100, Scale: 20, X: 30, Y: 100}); l != want {
		t.Errorf("look = %+v, want %+v", l, want)
	}
	if o := windowOpacity(db); o != 75 {
		t.Errorf("window opacity = %d, want 75", o)
	}
}

func TestLookReadsBadValuesAsDefaults(t *testing.T) {
	db := openStore(t)
	for key, v := range map[string]string{keyGlass: "not json", keyWallpaperLook: "[1,2]", keyWindowOpacity: "half"} {
		if err := db.SetSetting(key, v); err != nil {
			t.Fatal(err)
		}
	}
	if g := glass(db); g != defaultGlass {
		t.Errorf("glass = %+v for a bad value", g)
	}
	if l := wallpaperLook(db); l != defaultWallpaperLook {
		t.Errorf("look = %+v for a bad value", l)
	}
	if o := windowOpacity(db); o != 100 {
		t.Errorf("window opacity = %d for a bad value", o)
	}
	// Too low a value saved by hand still leaves the window readable.
	if err := db.SetSetting(keyWindowOpacity, "5"); err != nil {
		t.Fatal(err)
	}
	if o := windowOpacity(db); o != minWindowOpacity {
		t.Errorf("window opacity = %d, want %d", o, minWindowOpacity)
	}
	// A partial value keeps the defaults of the fields it lacks.
	if err := db.SetSetting(keyGlass, `{"panel":50}`); err != nil {
		t.Fatal(err)
	}
	if g, want := glass(db), (Glass{Blur: defaultGlass.Blur, Panel: 50, Frame: defaultGlass.Frame}); g != want {
		t.Errorf("glass = %+v, want %+v", g, want)
	}
}

func TestWallpaperSaveReplaceClear(t *testing.T) {
	db := openStore(t)
	dataDir, src := t.TempDir(), t.TempDir()

	// Turned off before a picture is picked: picking one shows it.
	if err := writeJSON(db, keyWallpaperLook, WallpaperLook{Enabled: false, Blur: 8, Opacity: 70, X: 10, Y: 90}); err != nil {
		t.Fatal(err)
	}
	if err := saveWallpaper(db, dataDir, writePNG(t, src, "海边.PNG")); err != nil {
		t.Fatal(err)
	}
	w := wallpaper(db, dataDir)
	files := wallpaperFiles(t, dataDir)
	if len(files) != 1 || w.URL != wallpaperBase()+files[0] || w.Name != "海边.PNG" {
		t.Fatalf("after saving: %+v, files %v", w, files)
	}
	if !w.Look.Enabled || w.Look.Blur != 8 || w.Look.Opacity != 70 {
		t.Errorf("saving changed the look: %+v", w.Look)
	}

	// Another picture replaces it, under a new name, and the old file goes.
	if err := saveWallpaper(db, dataDir, writePNG(t, src, "b.png")); err != nil {
		t.Fatal(err)
	}
	w2 := wallpaper(db, dataDir)
	files = wallpaperFiles(t, dataDir)
	if len(files) != 1 || w2.URL == w.URL || w2.Name != "b.png" {
		t.Fatalf("after replacing: %+v, files %v", w2, files)
	}

	if err := clearWallpaper(db, dataDir); err != nil {
		t.Fatal(err)
	}
	if w := wallpaper(db, dataDir); w.URL != "" || w.Name != "" || w.Look.Blur != 8 {
		t.Errorf("after clearing: %+v", w)
	}
	if files := wallpaperFiles(t, dataDir); len(files) != 0 {
		t.Errorf("files left after clearing: %v", files)
	}
}

func TestWallpaperGoneWithItsFile(t *testing.T) {
	db := openStore(t)
	dataDir := t.TempDir()
	if err := saveWallpaper(db, dataDir, writePNG(t, t.TempDir(), "a.png")); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(wallpaperDir(dataDir)); err != nil {
		t.Fatal(err)
	}
	if w := wallpaper(db, dataDir); w.URL != "" {
		t.Errorf("a deleted picture still shows: %+v", w)
	}
}

func TestWallpaperRejects(t *testing.T) {
	db := openStore(t)
	dataDir, src := t.TempDir(), t.TempDir()
	text := filepath.Join(src, "notes.txt")
	fake := filepath.Join(src, "fake.png")
	huge := filepath.Join(src, "huge.png")
	for path, data := range map[string][]byte{text: []byte("hello"), fake: []byte("hello, not a picture")} {
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	f, err := os.Create(huge)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(maxWallpaperBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()

	cases := map[string]string{
		text:                         "不支持",
		fake:                         "不是有效的",
		huge:                         "不能超过",
		filepath.Join(src, "no.png"): "打不开",
	}
	for path, want := range cases {
		err := saveWallpaper(db, dataDir, path)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v, want one with %q", filepath.Base(path), err, want)
		}
	}
	if w := wallpaper(db, dataDir); w.URL != "" {
		t.Errorf("a rejected file became the wallpaper: %+v", w)
	}
	if files := wallpaperFiles(t, dataDir); len(files) != 0 {
		t.Errorf("rejected files were kept: %v", files)
	}
}

func TestServeWallpaper(t *testing.T) {
	db := openStore(t)
	a := &app{dataDir: t.TempDir()}
	if err := saveWallpaper(db, a.dataDir, writePNG(t, t.TempDir(), "a.png")); err != nil {
		t.Fatal(err)
	}
	// Something else in the data folder, which the scheme must not reach.
	if err := os.WriteFile(filepath.Join(a.dataDir, "vibe-atlas.db"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	name := wallpaperFiles(t, a.dataDir)[0]

	get := func(method, path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		a.serveWallpaper(rec, httptest.NewRequest(method, "wallpaper://localhost"+path, nil))
		return rec
	}
	rec := get(http.MethodGet, "/"+name)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("GET the picture: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	for _, path := range []string{"/../vibe-atlas.db", "/vibe-atlas.db", "/", "/0123456789abcdef.png"} {
		if rec := get(http.MethodGet, path); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: %d, want 404", path, rec.Code)
		}
	}
	if rec := get(http.MethodPost, "/"+name); rec.Code != http.StatusNotFound {
		t.Errorf("POST: %d, want 404", rec.Code)
	}
}
