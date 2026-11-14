package main

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif" // decoders of the pictures image.Decode reads
	_ "image/jpeg"
	"image/png"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// Project icons come from local app declarations, then conventional paths.
// Workspace manifests locate nested apps; Unity GUID lookup is confined to
// Assets. Detection never executes a project's code or fetches remote images.

// iconStems are where projects keep their icon, in the order looked at.
var iconStems = []string{
	"favicon",
	"public/favicon",
	"app/favicon",
	"app/icon",
	"src/favicon",
	"src/app/icon",
	"assets/favicon",
	"assets/icon",
	"static/favicon",
	"logo",
	"public/logo",
	"public/icon",
	"src-tauri/icons/icon", // Tauri
	"resources/icon",       // MyGo, electron-vite
	"build/appicon",        // Wails
	"build/icon",           // electron-builder
	"app-icon",
	"app_icon",
	"assets/app-icon",
	"assets/app_icon",
	"public/app-icon",
	"public/app_icon",
	"resources/app-icon",
	"resources/app_icon",
	"icon",
}

// iconExts are the extensions tried after each stem, the bitmaps first as
// before SVG was taken. ICO is left out: Next and Vue CLI put the same one
// in every project.
var iconExts = []string{".png", ".webp", ".svg"}

// appleIconStems are where the icon for the home screen of iPhones is kept:
// the project's icon too, looked at last.
var appleIconStems = []string{
	"apple-touch-icon",
	"public/apple-touch-icon",
	"static/apple-touch-icon",
}

// templateIcons are the pictures the templates of frameworks put in every
// project, by name: an entry page that declares one says nothing of the
// project.
var templateIcons = map[string]bool{
	"vite.svg":       true,
	"react.svg":      true,
	"vue.svg":        true,
	"svelte.svg":     true,
	"next.svg":       true,
	"vercel.svg":     true,
	"nuxt.svg":       true,
	"tauri.svg":      true,
	"electron.svg":   true,
	"typescript.svg": true,
	"javascript.svg": true,
}

// iconSources are the entry pages whose declared icon is looked at next.
var iconSources = []string{
	"index.html",
	"public/index.html",
	"src/index.html",
	"app/routes/__root.tsx",
	"src/routes/__root.tsx",
	"app/root.tsx",
	"src/root.tsx",
}

// skippedIconDirs are the folders, right in a project's, never looked into
// for its icon: what tools download or build.
var skippedIconDirs = map[string]bool{
	"node_modules": true,
	"dist":         true,
	"build":        true,
	"out":          true,
	"target":       true,
	"vendor":       true,
	"coverage":     true,
	"library":      true,
	"temp":         true,
	"obj":          true,
	"logs":         true,
	"builds":       true,
}

// maxIconSourceBytes is the largest entry page read for its icon.
const maxIconSourceBytes = 256 << 10

// maxIconFileBytes is the largest picture taken as an icon.
const maxIconFileBytes = 4 << 20

// maxIconSVGBytes is the largest SVG taken as an icon: drawn in every row
// of the sidebar, a large one would slow it down.
const maxIconSVGBytes = 1 << 20

// iconSize is the most pixels an icon keeps on each side: the pages show
// it at 20 at most, on screens of up to four times the density.
const iconSize = 128

var (
	linkTag  = regexp.MustCompile(`(?is)<link\b[^>]*>`)
	iconRel  = regexp.MustCompile(`(?i)\brel\s*=\s*["'](?:shortcut\s+)?icon["']`)
	appleRel = regexp.MustCompile(`(?i)\brel\s*=\s*["']apple-touch-icon(?:-precomposed)?["']`)
	hrefAttr = regexp.MustCompile(`(?i)\bhref\s*=\s*["']([^"'?#]+)`)
	// A link of a route's head in JSX: { rel: "icon", href: "/x.png" }.
	braces    = regexp.MustCompile(`\{[^{}]*\}`)
	iconProp  = regexp.MustCompile(`(?i)\brel\s*:\s*["'](?:shortcut\s+)?icon["']`)
	appleProp = regexp.MustCompile(`(?i)\brel\s*:\s*["']apple-touch-icon(?:-precomposed)?["']`)
	hrefProp  = regexp.MustCompile(`(?i)\bhref\s*:\s*["']([^"'?#]+)`)
	scheme    = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)
)

// iconHref returns the address of the icon an entry page declares, or "".
func iconHref(source string) string {
	return declaredHref(source, iconRel, iconProp)
}

// appleIconHref returns the address of the icon for the home screen of
// iPhones an entry page declares, or "".
func appleIconHref(source string) string {
	return declaredHref(source, appleRel, appleProp)
}

// declaredHref returns the address of the first link of an entry page
// whose rel matches: an HTML link (rel), or an object of JSX (prop).
func declaredHref(source string, rel, prop *regexp.Regexp) string {
	for _, tag := range linkTag.FindAllString(source, -1) {
		if rel.MatchString(tag) {
			if m := hrefAttr.FindStringSubmatch(tag); m != nil {
				return m[1]
			}
		}
	}
	for _, obj := range braces.FindAllString(source, -1) {
		if prop.MatchString(obj) {
			if m := hrefProp.FindStringSubmatch(obj); m != nil {
				return m[1]
			}
		}
	}
	return ""
}

// iconHrefPaths returns the files, relative to the project's folder and
// with forward slashes, that href in the entry page at source may mean.
// Addresses of the web and those that climb out of the folder give none.
func iconHrefPaths(href, source string) []string {
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(href, "//") || scheme.MatchString(href) {
		return nil
	}
	rooted := strings.HasPrefix(href, "/")
	var parts []string
	for _, p := range strings.Split(strings.ReplaceAll(href, `\`, "/"), "/") {
		switch p {
		case "", ".":
		case "..":
			return nil
		default:
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return nil
	}
	clean := strings.Join(parts, "/")
	var out []string
	add := func(p string) {
		for _, q := range out {
			if q == p {
				return
			}
		}
		out = append(out, p)
	}
	if dir := path.Dir(source); !rooted && dir != "." {
		add(dir + "/" + clean)
	}
	add("public/" + clean)
	add(clean)
	return out
}

// isSVG tells whether data is an SVG picture: XML whose first element is
// svg.
func isSVG(data []byte) bool {
	d := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	d.Strict = false
	for {
		tok, err := d.Token()
		if err != nil {
			return false
		}
		if el, ok := tok.(xml.StartElement); ok {
			return el.Name.Local == "svg"
		}
	}
}

// readIconFile reads the picture at rel in folder: PNG or WebP by its
// content, or SVG by its content and name, not too large, not one templates put in every project. It
// returns nil for anything else.
func readIconFile(folder, rel string) []byte {
	if templateIcons[strings.ToLower(path.Base(rel))] {
		return nil
	}
	data := readIconInput(folder, rel, maxIconFileBytes)
	if data == nil {
		return nil
	}
	switch http.DetectContentType(data) {
	case "image/png", "image/webp":
		return data
	}
	// SVG only by its name too: a .png that holds markup is no icon.
	if strings.EqualFold(path.Ext(rel), ".svg") && len(data) <= maxIconSVGBytes && isSVG(data) {
		return data
	}
	return nil
}

// findProjectIcon returns the project's own icon in folder and where it
// is, relative to the folder with forward slashes; nil when there is none.
// The root comes first, then declared workspaces, then direct app folders.
func findProjectIcon(folder string) ([]byte, string) {
	if folder == "" {
		return nil, ""
	}
	// Avoid manifest traversal entirely when the root already has an icon.
	if data, rel := findIconIn(folder); data != nil {
		return data, rel
	}
	dirs := append(workspaceAppDirs(folder), appDirs(folder)...)
	seen := map[string]bool{}
	for _, dir := range dirs {
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if data, rel := findIconIn(filepath.Join(folder, dir)); data != nil {
			if dir != "" {
				rel = dir + "/" + rel
			}
			return data, rel
		}
	}
	return nil, ""
}

// appDirs returns direct folders with an app marker, sorted by name.
func appDirs(folder string) []string {
	remaining := 4096
	entries := iconEntries(folder, ".", &remaining)
	slices.SortFunc(entries, func(a, b os.DirEntry) int { return strings.Compare(a.Name(), b.Name()) })
	patterns := workspacePatterns(folder)
	var dirs []string
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() || skipIconDir(name) || len(dirs) >= maxIconAppDirs {
			continue
		}
		excluded := false
		for _, pattern := range patterns {
			if strings.HasPrefix(pattern, "!") && iconGlobMatch(iconRelativePath(pattern[1:]), name) {
				excluded = true
				break
			}
		}
		if !excluded && isIconAppDir(folder, name) {
			dirs = append(dirs, name)
		}
	}
	return dirs
}

// Explicit app and entry-page declarations outrank conventional filenames.
func findIconIn(folder string) ([]byte, string) {
	if data, rel := configuredIcon(folder); data != nil {
		return data, rel
	}
	if data, rel := declaredIcon(folder, iconHref); data != nil {
		return data, rel
	}
	if data, rel := firstIconFile(folder, iconStems, iconExts); data != nil {
		return data, rel
	}
	if data, rel := declaredIcon(folder, appleIconHref); data != nil {
		return data, rel
	}
	return firstIconFile(folder, appleIconStems, []string{".png"})
}

// firstIconFile returns the first icon at a stem with an extension.
func firstIconFile(folder string, stems, exts []string) ([]byte, string) {
	for _, stem := range stems {
		for _, ext := range exts {
			if data := readIconFile(folder, stem+ext); data != nil {
				return data, stem + ext
			}
		}
	}
	return nil, ""
}

// declaredIcon returns the first icon an entry page in folder declares, as
// href reads it.
func declaredIcon(folder string, href func(string) string) ([]byte, string) {
	for _, src := range iconSources {
		text := readIconInput(folder, src, maxIconSourceBytes)
		if text == nil {
			continue
		}
		for _, rel := range iconHrefPaths(href(string(text)), src) {
			if data := readIconFile(folder, rel); data != nil {
				return data, rel
			}
		}
	}
	return nil, ""
}

// detectProjectIcon finds the project's own icon in folder and keeps it
// in the images folder: "image:<name>", or "" when there is none.
func detectProjectIcon(dataDir, folder string) string {
	data, _ := findProjectIcon(folder)
	if data == nil {
		return ""
	}
	name, err := saveIcon(dataDir, data)
	if err != nil {
		log.Println("keeping the icon of", folder, ":", err)
		return ""
	}
	return name
}

// saveIcon keeps the picture data, shrunk to iconSize, in the images folder
// and returns its icon: "image:<name>". WebP, which the standard library
// cannot decode, and SVG, which draws sharp at any size, are kept as they
// are.
func saveIcon(dataDir string, data []byte) (string, error) {
	if len(data) > maxIconFileBytes {
		return "", fmt.Errorf("图标图片不能超过 %d MB", maxIconFileBytes>>20)
	}
	if http.DetectContentType(data) != "image/webp" && isSVG(data) {
		if len(data) > maxIconSVGBytes {
			return "", fmt.Errorf("SVG 图标不能超过 %d MB", maxIconSVGBytes>>20)
		}
		name, err := writeImage(dataDir, data, ".svg")
		if err != nil {
			return "", err
		}
		return "image:" + name, nil
	}
	if http.DetectContentType(data) != "image/webp" {
		small, err := shrinkIcon(data)
		if err != nil {
			return "", err
		}
		data = small
	}
	name, err := saveImage(dataDir, data)
	if err != nil {
		return "", err
	}
	return "image:" + name, nil
}

// shrinkIcon decodes a PNG, JPEG or GIF and encodes it as a PNG of at most
// iconSize pixels a side, each pixel the average of those it covers.
func shrinkIcon(data []byte) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("不支持这种图片，请用 PNG、JPG、WebP、GIF 或 SVG")
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return nil, errors.New("这张图片是空的")
	}
	dw, dh := w, h
	if w > iconSize || h > iconSize {
		if w >= h {
			dw, dh = iconSize, max(1, h*iconSize/w)
		} else {
			dw, dh = max(1, w*iconSize/h), iconSize
		}
	}
	// Premultiplied, so transparent pixels do not darken the edges.
	rgba := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(rgba, rgba.Bounds(), src, b.Min, draw.Src)
	out := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := range dh {
		y0, y1 := y*h/dh, max((y+1)*h/dh, y*h/dh+1)
		for x := range dw {
			x0, x1 := x*w/dw, max((x+1)*w/dw, x*w/dw+1)
			var r, g, bl, a, n uint32
			for sy := y0; sy < y1; sy++ {
				i := rgba.PixOffset(x0, sy)
				for sx := x0; sx < x1; sx++ {
					r += uint32(rgba.Pix[i])
					g += uint32(rgba.Pix[i+1])
					bl += uint32(rgba.Pix[i+2])
					a += uint32(rgba.Pix[i+3])
					i += 4
					n++
				}
			}
			j := out.PixOffset(x, y)
			out.Pix[j], out.Pix[j+1], out.Pix[j+2], out.Pix[j+3] = uint8(r/n), uint8(g/n), uint8(bl/n), uint8(a/n)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// detectIconsLater looks again, once the app has settled, for the icon of
// each project bound to a folder: the project may have got one, or a new
// one, since. The windows hear once, when one changed.
func (a *Atlas) detectIconsLater(db *store.Store) {
	time.AfterFunc(3*time.Second, func() {
		projects, err := db.Projects()
		if err != nil {
			log.Println("detecting the icons of the projects:", err)
			return
		}
		changed := false
		for _, p := range projects {
			if !p.FolderExists {
				continue
			}
			icon := detectProjectIcon(a.app.dataDir, p.FolderPath)
			if icon == p.DetectedIcon {
				continue
			}
			if _, err := db.SetProjectDetectedIcon(p.ID, icon); err != nil {
				log.Println("detecting the icon of", p.Name, ":", err)
				continue
			}
			changed = true
		}
		if changed {
			a.changed(0)
		}
	})
}

// ---- Bound methods ----

// FolderChoice is a folder the user chose for a project.
type FolderChoice struct {
	// Path is the folder, or "" when the user cancelled.
	Path string `json:"path"`
	// Name is the folder's name, which a project without a name takes.
	Name string `json:"name"`
	// Icon is the project's own icon found in the folder, "image:<name>",
	// or "".
	Icon string `json:"icon"`
}

// ChooseFolder asks for a project's folder, opening at current when it
// exists, and looks in it for the project's own icon. Nothing is saved:
// AddProject or EditProject does.
func (a *Atlas) ChooseFolder(ctx context.Context, current string) (FolderChoice, error) {
	opts := mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "选择项目文件夹",
		ButtonLabel: "选择",
		Directory:   true,
	}
	if info, err := os.Stat(current); current != "" && err == nil && info.IsDir() {
		opts.DefaultPath = current
	}
	paths, err := mygo.Dialog.Open(opts)
	if err != nil {
		return FolderChoice{}, fmt.Errorf("打不开选择文件夹的窗口：%w", err)
	}
	if len(paths) == 0 {
		return FolderChoice{}, nil
	}
	folder := filepath.Clean(paths[0])
	return FolderChoice{
		Path: folder,
		Name: store.FolderName(folder),
		Icon: detectProjectIcon(a.app.dataDir, folder),
	}, nil
}

// AddProject adds a project at the end of the list. A project bound to a
// folder without a name takes the folder's; its icon, unless chosen, is
// the one found in the folder.
func (a *Atlas) AddProject(draft store.ProjectDraft) (store.Project, error) {
	detected := ""
	if draft.FolderPath != "" && filepath.IsAbs(draft.FolderPath) {
		detected = detectProjectIcon(a.app.dataDir, filepath.Clean(draft.FolderPath))
	}
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.AddProject(draft, detected) })
}

// EditProject replaces a project's name, folder and icon, as AddProject
// takes them.
func (a *Atlas) EditProject(id int64, draft store.ProjectDraft) (store.Project, error) {
	db, err := a.store()
	if err != nil {
		return store.Project{}, err
	}
	p, err := db.Project(id)
	if err != nil {
		return p, err
	}
	detected := p.DetectedIcon
	if folder := draft.FolderPath; folder == "" {
		detected = ""
	} else if filepath.IsAbs(folder) && filepath.Clean(folder) != p.FolderPath {
		detected = detectProjectIcon(a.app.dataDir, filepath.Clean(folder))
	}
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.EditProject(id, draft, detected) })
}

// SetProjectIcon sets the icon the user chose for a project, "" for 自动.
func (a *Atlas) SetProjectIcon(id int64, icon string) (store.Project, error) {
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.SetProjectIcon(id, icon) })
}

// DetectProjectIcon looks again for the project's own icon in its folder.
func (a *Atlas) DetectProjectIcon(id int64) (store.Project, error) {
	db, err := a.store()
	if err != nil {
		return store.Project{}, err
	}
	p, err := db.Project(id)
	if err != nil {
		return p, err
	}
	icon := ""
	if p.FolderExists {
		icon = detectProjectIcon(a.app.dataDir, p.FolderPath)
	}
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.SetProjectDetectedIcon(id, icon) })
}

// SetModuleIcon sets the icon the user chose for a module, "" for the
// default.
func (a *Atlas) SetModuleIcon(id int64, icon string) (store.Module, error) {
	return do(a, 0, func(db *store.Store) (store.Module, error) { return db.SetModuleIcon(id, icon) })
}

// ChooseIconImage asks for a picture on this machine to be an icon, and
// keeps it shrunk: "image:<name>", or "" when the user cancels. Nothing is
// saved to a project or module: SetProjectIcon, SetModuleIcon or
// EditProject does.
func (a *Atlas) ChooseIconImage(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "选择图标图片",
		ButtonLabel: "选择",
		Filters:     []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "webp", "gif", "svg"}}},
	})
	if err != nil {
		return "", fmt.Errorf("打不开选择图片的窗口：%w", err)
	}
	if len(paths) == 0 {
		return "", nil
	}
	data, err := readImageFile(paths[0])
	if err != nil {
		return "", err
	}
	return saveIcon(a.app.dataDir, data)
}
