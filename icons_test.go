package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// pngOf returns a PNG of w×h pixels of one colour.
func pngOf(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// svgData is an SVG picture, as a project's icon may be.
var svgData = []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512"><title>标志</title><circle cx="12" cy="12" r="10" fill="#F54EA2"/></svg>`)

// webpData is the start of a WebP file, enough for its type to be told.
var webpData = []byte("RIFF\x24\x00\x00\x00WEBPVP8 \x18\x00\x00\x00\x30\x01\x00\x9d\x01\x2a\x01\x00\x01\x00")

// project makes a folder with files at their slash paths.
func project(t *testing.T, files map[string][]byte) string {
	t.Helper()
	dir := t.TempDir()
	for rel, data := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestFindProjectIconConventionalPaths(t *testing.T) {
	red := pngOf(t, 4, 4, color.NRGBA{255, 0, 0, 255})
	blue := pngOf(t, 4, 4, color.NRGBA{0, 0, 255, 255})
	cases := []struct {
		name  string
		files map[string][]byte
		want  string
	}{
		{"none", map[string][]byte{"README.md": []byte("# x")}, ""},
		{"favicon before logo", map[string][]byte{"logo.png": red, "public/favicon.png": blue}, "public/favicon.png"},
		{"png before webp of a stem", map[string][]byte{"icon.webp": webpData, "icon.png": red}, "icon.png"},
		{"webp", map[string][]byte{"assets/icon.webp": webpData}, "assets/icon.webp"},
		{"tauri", map[string][]byte{"src-tauri/icons/icon.png": red}, "src-tauri/icons/icon.png"},
		{"mygo like vibe-atlas", map[string][]byte{"resources/icon.png": red, "resources/tray.png": blue}, "resources/icon.png"},
		{"wails", map[string][]byte{"build/appicon.png": red}, "build/appicon.png"},
		// A .png that is not one, and pictures of other types, are not taken.
		{"not a png", map[string][]byte{"favicon.png": []byte("<svg/>"), "logo.png": red}, "logo.png"},
		{"ico left out", map[string][]byte{"favicon.ico": {0, 0, 1, 0}}, ""},
		{"svg", map[string][]byte{"public/favicon.svg": svgData}, "public/favicon.svg"},
		{"png before svg of a stem", map[string][]byte{"favicon.svg": svgData, "favicon.png": red}, "favicon.png"},
		{"svg with a mark, a declaration and comments", map[string][]byte{
			"logo.svg": []byte("\xef\xbb\xbf<?xml version=\"1.0\"?>\n<!-- 标志 -->\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
		}, "logo.svg"},
		{"an svg that is not one", map[string][]byte{"favicon.svg": []byte("<html><svg/></html>"), "logo.png": red}, "logo.png"},
		// Below the conventional paths and what entry pages declare.
		{"apple touch icon last", map[string][]byte{"public/apple-touch-icon.png": blue}, "public/apple-touch-icon.png"},
		{"apple touch icon after the others", map[string][]byte{"public/apple-touch-icon.png": blue, "icon.png": red}, "icon.png"},
		{"a folder named like an icon", map[string][]byte{"icon.png/x.txt": []byte("x"), "logo.png": red}, "logo.png"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			data, rel := findProjectIcon(project(t, c.files))
			if rel != c.want {
				t.Fatalf("found %q, want %q", rel, c.want)
			}
			if c.want != "" && !bytes.Equal(data, c.files[c.want]) {
				t.Fatal("found the wrong content")
			}
		})
	}
}

// TestFindProjectIconInAppFolder looks in the folders of apps right in the
// project's, as 20005-aigc keeps its web page in mj_webui.
func TestFindProjectIconInAppFolder(t *testing.T) {
	red := pngOf(t, 4, 4, color.NRGBA{255, 0, 0, 255})
	page := []byte(`<link rel="icon" type="image/svg+xml" href="/app-icon.svg" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />`)
	cases := []struct {
		name  string
		files map[string][]byte
		want  string
	}{
		{"like 20005-aigc", map[string][]byte{
			"README.md":                            []byte("# x"),
			"archive/logo.png":                     red,
			"mj_webui/package.json":                []byte("{}"),
			"mj_webui/index.html":                  page,
			"mj_webui/public/app-icon.svg":         svgData,
			"mj_webui/public/apple-touch-icon.png": red,
		}, "mj_webui/public/app-icon.svg"},
		{"the root first", map[string][]byte{
			"public/favicon.png":     red,
			"web/package.json":       []byte("{}"),
			"web/public/favicon.svg": svgData,
		}, "public/favicon.png"},
		{"an index.html marks an app", map[string][]byte{
			"site/index.html": []byte(`<link rel="icon" href="/mark.png">`),
			"site/mark.png":   red,
		}, "site/mark.png"},
		{"folders of apps in the order of their names", map[string][]byte{
			"b/package.json": []byte("{}"),
			"b/icon.png":     red,
			"a/package.json": []byte("{}"),
			"a/logo.png":     red,
		}, "a/logo.png"},
		{"a folder without an app left out", map[string][]byte{"docs/icon.png": red}, ""},
		{"downloads and builds left out", map[string][]byte{
			"node_modules/x/package.json": []byte("{}"),
			"node_modules/package.json":   []byte("{}"),
			"node_modules/icon.png":       red,
			"dist/index.html":             []byte(`<link rel="icon" href="/favicon.png">`),
			"dist/favicon.png":            red,
			".cache/package.json":         []byte("{}"),
			".cache/icon.png":             red,
		}, ""},
		{"only one level down", map[string][]byte{
			"apps/web/package.json": []byte("{}"),
			"apps/web/icon.png":     red,
		}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			data, rel := findProjectIcon(project(t, c.files))
			if rel != c.want {
				t.Fatalf("found %q, want %q", rel, c.want)
			}
			if c.want != "" && !bytes.Equal(data, c.files[c.want]) {
				t.Fatal("found the wrong content")
			}
		})
	}
}

func TestFindProjectIconTooLarge(t *testing.T) {
	big := append(pngOf(t, 2, 2, color.Black), make([]byte, maxIconFileBytes)...)
	small := pngOf(t, 2, 2, color.White)
	if _, rel := findProjectIcon(project(t, map[string][]byte{"favicon.png": big, "icon.png": small})); rel != "icon.png" {
		t.Fatalf("found %q, want icon.png past the one too large", rel)
	}
}

func TestFindProjectIconDeclared(t *testing.T) {
	red := pngOf(t, 4, 4, color.NRGBA{255, 0, 0, 255})
	cases := []struct {
		name  string
		files map[string][]byte
		want  string
	}{
		{"rooted href in public", map[string][]byte{
			"index.html":            []byte(`<head><link rel="stylesheet" href="/a.css"><link href="/brand/mark.png" rel="icon" type="image/png"></head>`),
			"public/brand/mark.png": red,
		}, "public/brand/mark.png"},
		{"relative to the page", map[string][]byte{
			"src/index.html":  []byte(`<link rel='shortcut icon' href='./img/app.png?v=2'>`),
			"src/img/app.png": red,
		}, "src/img/app.png"},
		{"jsx head", map[string][]byte{
			"app/root.tsx": []byte(`export const links = () => [{ rel: "stylesheet", href: "/s.css" }, { rel: "icon", href: "/mark.png" }];`),
			"mark.png":     red,
		}, "mark.png"},
		{"climbing out refused", map[string][]byte{
			"index.html": []byte(`<link rel="icon" href="../../secret.png">`),
		}, ""},
		{"web address refused", map[string][]byte{
			"index.html":           []byte(`<link rel="icon" href="https://example.com/mark.png">`),
			"mark.png":             red,
			"example.com/mark.png": red,
		}, ""},
		{"template svg left out", map[string][]byte{
			"index.html":      []byte(`<link rel="icon" type="image/svg+xml" href="/vite.svg">`),
			"public/vite.svg": svgData,
		}, ""},
		{"declared svg", map[string][]byte{
			"index.html":                  []byte(`<link rel="icon" type="image/svg+xml" href="/app-icon.svg" />`),
			"public/app-icon.svg":         svgData,
			"public/apple-touch-icon.png": red,
		}, "public/app-icon.svg"},
		{"declared apple touch icon when the icon is not taken", map[string][]byte{
			"index.html":             []byte(`<link rel="icon" href="/vite.svg"><link rel="apple-touch-icon" href="/brand/touch.png">`),
			"public/vite.svg":        svgData,
			"public/brand/touch.png": red,
		}, "public/brand/touch.png"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, rel := findProjectIcon(project(t, c.files)); rel != c.want {
				t.Fatalf("found %q, want %q", rel, c.want)
			}
		})
	}
}

func TestIconHrefPaths(t *testing.T) {
	cases := []struct {
		href, source string
		want         []string
	}{
		{"/favicon.png", "index.html", []string{"public/favicon.png", "favicon.png"}},
		{"img/a.png", "src/index.html", []string{"src/img/a.png", "public/img/a.png", "img/a.png"}},
		{`img\a.png`, "index.html", []string{"public/img/a.png", "img/a.png"}},
		{"../a.png", "src/index.html", nil},
		{"//cdn.example.com/a.png", "index.html", nil},
		{"data:image/png;base64,AAAA", "index.html", nil},
		{"C:/a.png", "index.html", nil},
		{"", "index.html", nil},
	}
	for _, c := range cases {
		if got := iconHrefPaths(c.href, c.source); !slices.Equal(got, c.want) {
			t.Errorf("iconHrefPaths(%q, %q) = %q, want %q", c.href, c.source, got, c.want)
		}
	}
}

func TestSaveIconShrinks(t *testing.T) {
	dataDir := t.TempDir()
	icon, err := saveIcon(dataDir, pngOf(t, 1024, 512, color.NRGBA{10, 200, 30, 255}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(icon, "image:") {
		t.Fatalf("icon = %q", icon)
	}
	f, err := os.Open(filepath.Join(imageDir(dataDir), strings.TrimPrefix(icon, "image:")))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 128 || b.Dy() != 64 {
		t.Fatalf("size = %v, want 128×64", b.Size())
	}
	if r, g, b, _ := img.At(10, 10).RGBA(); r>>8 != 10 || g>>8 != 200 || b>>8 != 30 {
		t.Fatalf("colour = %d %d %d, want it kept", r>>8, g>>8, b>>8)
	}

	// A small one keeps its size; WebP is kept as it is.
	small, err := saveIcon(dataDir, pngOf(t, 16, 16, color.White))
	if err != nil || small == icon {
		t.Fatalf("small = %q, %v", small, err)
	}
	if _, err := saveIcon(dataDir, webpData); err != nil {
		t.Fatalf("webp: %v", err)
	}

	// SVG is kept as it is, under .svg; notes still take no SVG.
	svg, err := saveIcon(dataDir, svgData)
	if err != nil || !strings.HasSuffix(svg, ".svg") {
		t.Fatalf("svg = %q, %v", svg, err)
	}
	if kept, err := os.ReadFile(filepath.Join(imageDir(dataDir), strings.TrimPrefix(svg, "image:"))); err != nil || !bytes.Equal(kept, svgData) {
		t.Fatalf("svg kept as %q, %v", kept, err)
	}
	if _, err := saveImage(dataDir, svgData); err == nil {
		t.Fatal("a note took an SVG")
	}
	huge := append([]byte(`<svg xmlns="http://www.w3.org/2000/svg">`), bytes.Repeat([]byte(" "), maxIconSVGBytes)...)
	if _, err := saveIcon(dataDir, append(huge, "</svg>"...)); err == nil {
		t.Fatal("took an SVG too large")
	}
	if _, err := saveIcon(dataDir, []byte("not a picture")); err == nil {
		t.Fatal("took what is not a picture")
	}
}

func TestDetectProjectIconThisRepository(t *testing.T) {
	// Vibe Atlas itself: its icon is resources/icon.png.
	data, rel := findProjectIcon(".")
	if rel != "resources/icon.png" || data == nil {
		t.Fatalf("found %q in this repository, want resources/icon.png", rel)
	}
	if icon := detectProjectIcon(t.TempDir(), "."); icon == "" {
		t.Fatal("kept no icon")
	}
}

func TestCleanImagesKeepsIcons(t *testing.T) {
	db := openStore(t)
	dataDir := t.TempDir()
	folder := project(t, map[string][]byte{"icon.png": pngOf(t, 8, 8, color.White)})
	detected := detectProjectIcon(dataDir, folder)
	chosen, err := saveIcon(dataDir, pngOf(t, 8, 8, color.Black))
	if err != nil {
		t.Fatal(err)
	}
	ofModule, err := saveIcon(dataDir, svgData)
	if err != nil {
		t.Fatal(err)
	}
	unused, err := saveIcon(dataDir, pngOf(t, 10, 10, color.Black))
	if err != nil {
		t.Fatal(err)
	}
	unusedSVG, err := saveIcon(dataDir, []byte(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`))
	if err != nil {
		t.Fatal(err)
	}
	p, err := db.AddProject(store.ProjectDraft{FolderPath: folder, Icon: chosen}, detected)
	if err != nil {
		t.Fatal(err)
	}
	m, err := db.CreateModule(p.ID, "界面")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetModuleIcon(m.ID, ofModule); err != nil {
		t.Fatal(err)
	}

	old := time.Now().Add(-48 * time.Hour)
	for _, icon := range []string{detected, chosen, ofModule, unused, unusedSVG} {
		os.Chtimes(filepath.Join(imageDir(dataDir), strings.TrimPrefix(icon, "image:")), old, old)
	}
	n, err := cleanImages(db, dataDir, imageGrace)
	if err != nil || n != 2 {
		t.Fatalf("cleanImages = %d, %v; want only the two unused", n, err)
	}
	for _, icon := range []string{detected, chosen, ofModule} {
		if _, err := os.Stat(filepath.Join(imageDir(dataDir), strings.TrimPrefix(icon, "image:"))); err != nil {
			t.Errorf("%s was cleaned: %v", icon, err)
		}
	}
}
