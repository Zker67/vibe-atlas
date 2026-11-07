package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// The look of the main window beyond its theme: a picture of the user's
// behind it, the frosted glass of its frame and panel, and the opacity of
// the whole window. Quick capture keeps its plain look.

// WallpaperLook is how the picture behind the main window shows.
type WallpaperLook struct {
	// Enabled shows the picture; off, it is kept for later.
	Enabled bool `json:"enabled"`
	// Blur of the picture, 0 to 40 px.
	Blur int `json:"blur"`
	// Opacity of the picture over the ground, 0 to 100 %.
	Opacity int `json:"opacity"`
	// Scale of the picture: 0 covers the window, else 20 to 300 % of it.
	Scale int `json:"scale"`
	// X and Y place the picture, 0 to 100 % across and down.
	X int `json:"x"`
	Y int `json:"y"`
}

// Wallpaper is the picture behind the main window.
type Wallpaper struct {
	// URL is where the page loads the picture from, or "" when there is none.
	URL string `json:"url"`
	// Name is the name of the file the user picked.
	Name string        `json:"name"`
	Look WallpaperLook `json:"look"`
}

// Glass is the frosted glass of the main window's frame (title bar and
// sidebar) and of its content panel, over a background or a picture. It
// does not change the opacity of the whole window (WindowOpacity).
type Glass struct {
	// Blur of the content panel, 0 to 60 px; the frame blurs 60 % of it.
	Blur int `json:"blur"`
	// Panel is the opacity of the content panel, 0 to 100 %.
	Panel int `json:"panel"`
	// Frame is the opacity of the frame, 0 to 100 %.
	Frame int `json:"frame"`
}

// The defaults, which the look had before it could be changed.
var (
	defaultWallpaperLook = WallpaperLook{Enabled: true, Blur: 0, Opacity: 100, Scale: 0, X: 50, Y: 50}
	defaultGlass         = Glass{Blur: 32, Panel: 90, Frame: 64}
)

// LookDefaults are the looks the app has out of the box, which the
// settings reset to.
type LookDefaults struct {
	WallpaperLook WallpaperLook `json:"wallpaperLook"`
	Glass         Glass         `json:"glass"`
	WindowOpacity int           `json:"windowOpacity"`
	// MinWindowOpacity is the lowest opacity the window takes, in %.
	MinWindowOpacity int `json:"minWindowOpacity"`
}

var lookDefaults = LookDefaults{
	WallpaperLook:    defaultWallpaperLook,
	Glass:            defaultGlass,
	WindowOpacity:    defaultWindowOpacity,
	MinWindowOpacity: minWindowOpacity,
}

// The range of the window's opacity, in %: below it, the window is too
// faint to read.
const (
	minWindowOpacity     = 40
	defaultWindowOpacity = 100
)

// maxWallpaperBytes is the largest picture taken.
const maxWallpaperBytes = 20 << 20

// wallpaperScheme serves the pictures in the wallpaper folder to the page.
const wallpaperScheme = "wallpaper"

// Keys of the settings table.
const (
	keyWallpaperFile = "wallpaperFile"
	keyWallpaperName = "wallpaperName"
	keyWallpaperLook = "wallpaperLook"
	keyGlass         = "glass"
	keyWindowOpacity = "windowOpacity"
)

// wallpaperTypes are the pictures taken, by the extension the file is
// saved with and the type its content must have.
var wallpaperTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
}

// wallpaperBase is where the page loads the pictures from. WebView2 cannot
// load a custom scheme itself: MyGo serves wallpaper://localhost/ at
// http://wallpaper.localhost/ there (MyGo's docs/frontend.md), which the
// page has to ask for.
func wallpaperBase() string {
	if runtime.GOOS == "windows" {
		return "http://" + wallpaperScheme + ".localhost/"
	}
	return wallpaperScheme + "://localhost/"
}

// wallpaperFile matches the names the app saves pictures under.
var wallpaperFile = regexp.MustCompile(`^[0-9a-f]{16}\.(png|jpe?g|webp|gif|bmp)$`)

func clamp(v, lo, hi int) int { return min(max(v, lo), hi) }

func (l WallpaperLook) clean() WallpaperLook {
	l.Blur = clamp(l.Blur, 0, 40)
	l.Opacity = clamp(l.Opacity, 0, 100)
	if l.Scale != 0 {
		l.Scale = clamp(l.Scale, 20, 300)
	}
	l.X = clamp(l.X, 0, 100)
	l.Y = clamp(l.Y, 0, 100)
	return l
}

func (g Glass) clean() Glass {
	g.Blur = clamp(g.Blur, 0, 60)
	g.Panel = clamp(g.Panel, 0, 100)
	g.Frame = clamp(g.Frame, 0, 100)
	return g
}

// readJSON reads the setting under key into a copy of def; fields it lacks
// keep their defaults, and a value it cannot read is the default.
func readJSON[T any](db *store.Store, key string, def T) T {
	v, ok, _ := db.Setting(key)
	if !ok {
		return def
	}
	out := def
	if json.Unmarshal([]byte(v), &out) != nil {
		return def
	}
	return out
}

func writeJSON(db *store.Store, key string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return db.SetSetting(key, string(data))
}

func wallpaperLook(db *store.Store) WallpaperLook {
	return readJSON(db, keyWallpaperLook, defaultWallpaperLook).clean()
}

func glass(db *store.Store) Glass {
	return readJSON(db, keyGlass, defaultGlass).clean()
}

func windowOpacity(db *store.Store) int {
	v, ok, _ := db.Setting(keyWindowOpacity)
	n, err := strconv.Atoi(v)
	if !ok || err != nil {
		return defaultWindowOpacity
	}
	return clamp(n, minWindowOpacity, 100)
}

// wallpaperDir is the folder the pictures are saved in.
func wallpaperDir(dataDir string) string { return filepath.Join(dataDir, "wallpapers") }

// wallpaper reads the picture saved, which is gone when its file is.
func wallpaper(db *store.Store, dataDir string) Wallpaper {
	w := Wallpaper{Look: wallpaperLook(db)}
	file, _, _ := db.Setting(keyWallpaperFile)
	if !wallpaperFile.MatchString(file) {
		return w
	}
	if _, err := os.Stat(filepath.Join(wallpaperDir(dataDir), file)); err != nil {
		return w
	}
	w.URL = wallpaperBase() + file
	w.Name, _, _ = db.Setting(keyWallpaperName)
	return w
}

// saveWallpaper copies the picture at src into the wallpaper folder, under
// a name of its own so that the page loads the new one, and makes it the
// wallpaper, shown. The picture it replaces is deleted.
func saveWallpaper(db *store.Store, dataDir, src string) error {
	ext := strings.ToLower(filepath.Ext(src))
	want, ok := wallpaperTypes[ext]
	if !ok {
		return fmt.Errorf("不支持这种图片，请选择 PNG、JPG、WebP、GIF 或 BMP")
	}
	f, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("打不开这张图片：%w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return fmt.Errorf("打不开这张图片：%w", err)
	}
	if info.Size() > maxWallpaperBytes {
		return fmt.Errorf("图片不能超过 %d MB", maxWallpaperBytes>>20)
	}
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	if http.DetectContentType(head[:n]) != want {
		return fmt.Errorf("这个文件不是有效的 %s 图片", strings.ToUpper(strings.TrimPrefix(ext, ".")))
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("打不开这张图片：%w", err)
	}

	dir := wallpaperDir(dataDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("保存不了图片：%w", err)
	}
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		return fmt.Errorf("保存不了图片：%w", err)
	}
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	name := hex.EncodeToString(id) + ext
	dst := filepath.Join(dir, name)
	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("保存不了图片：%w", err)
	}
	_, err = io.Copy(out, io.LimitReader(f, maxWallpaperBytes))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(dst)
		return fmt.Errorf("保存不了图片：%w", err)
	}

	old, _, _ := db.Setting(keyWallpaperFile)
	look := wallpaperLook(db)
	look.Enabled = true
	err = db.SetSetting(keyWallpaperFile, name)
	if err == nil {
		err = db.SetSetting(keyWallpaperName, filepath.Base(src))
	}
	if err == nil {
		err = writeJSON(db, keyWallpaperLook, look)
	}
	if err != nil {
		os.Remove(dst)
		return err
	}
	removeWallpaperFile(dataDir, old)
	return nil
}

// clearWallpaper removes the picture; how it showed stays for the next one.
func clearWallpaper(db *store.Store, dataDir string) error {
	old, _, _ := db.Setting(keyWallpaperFile)
	if err := db.SetSetting(keyWallpaperFile, ""); err != nil {
		return err
	}
	if err := db.SetSetting(keyWallpaperName, ""); err != nil {
		return err
	}
	removeWallpaperFile(dataDir, old)
	return nil
}

func removeWallpaperFile(dataDir, name string) {
	if wallpaperFile.MatchString(name) {
		os.Remove(filepath.Join(wallpaperDir(dataDir), name))
	}
}

// serveWallpaper answers wallpaper://localhost/<file> (wallpaperBase) with a picture of the
// wallpaper folder, and nothing else.
func (a *app) serveWallpaper(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if r.Method != http.MethodGet && r.Method != http.MethodHead || !wallpaperFile.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "max-age=31536000, immutable") // a new picture gets a new name
	http.ServeFile(w, r, filepath.Join(wallpaperDir(a.dataDir), name))
}

// ---- Bound methods ----

// ChooseWallpaper asks for a picture and puts it behind the main window.
// It returns the settings unchanged when the user cancels.
func (a *Atlas) ChooseWallpaper(ctx context.Context) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "选择背景图片",
		ButtonLabel: "选择",
		Filters:     []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "webp", "gif", "bmp"}}},
	})
	if err != nil {
		return Settings{}, fmt.Errorf("打不开选择图片的窗口：%w", err)
	}
	if len(paths) == 0 {
		return a.Settings()
	}
	if err := saveWallpaper(db, a.app.dataDir, paths[0]); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

// ClearWallpaper removes the picture behind the main window.
func (a *Atlas) ClearWallpaper() (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := clearWallpaper(db, a.app.dataDir); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

// SetWallpaperLook changes how the picture behind the main window shows.
// Values out of range are brought into it.
func (a *Atlas) SetWallpaperLook(look WallpaperLook) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := writeJSON(db, keyWallpaperLook, look.clean()); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

// SetGlass changes the frosted glass of the main window's frame and panel.
// Values out of range are brought into it.
func (a *Atlas) SetGlass(g Glass) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := writeJSON(db, keyGlass, g.clean()); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

// SetWindowOpacity changes the opacity of the whole main window, 40 to
// 100 %, which shows the desktop through it.
func (a *Atlas) SetWindowOpacity(percent int) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	percent = clamp(percent, minWindowOpacity, 100)
	if err := db.SetSetting(keyWindowOpacity, strconv.Itoa(percent)); err != nil {
		return Settings{}, err
	}
	a.app.setMainOpacity(percent)
	a.settingsChanged()
	return a.Settings()
}

// PreviewWindowOpacity shows the main window at an opacity, 40 to 100 %,
// without saving it, while the user drags its slider.
func (a *Atlas) PreviewWindowOpacity(percent int) {
	a.app.setMainOpacity(clamp(percent, minWindowOpacity, 100))
}

func (a *app) setMainOpacity(percent int) {
	if main, _ := a.windows(); main != nil {
		main.SetOpacity(float64(percent) / 100)
	}
}
