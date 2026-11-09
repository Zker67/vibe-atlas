package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// The pictures of the notes and project descriptions live in the images
// folder of the data folder, named by their content. Markdown refers to
// them as ![](image:<name>), which no machine path is part of; the pages
// load them from the image scheme.

// imageScheme serves the pictures of the notes to the pages.
const imageScheme = "image"

// maxImageBytes is the largest picture taken.
const maxImageBytes = 20 << 20

// imageGrace is how long a picture no text refers to is kept: an undo, or
// a note not saved yet, may still bring it back.
const imageGrace = 24 * time.Hour

// imageExts are the pictures taken, by the type of their content, and the
// extension they are saved with.
var imageExts = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
	"image/bmp":  ".bmp",
}

// imageFile matches the names the app saves pictures under; SVG only as
// the icon of a project or module (icons.go).
var imageFile = regexp.MustCompile(`^[0-9a-f]{16}\.(png|jpg|webp|gif|bmp|svg)$`)

// imageName finds the pictures a text refers to, their names in group 1.
var imageName = regexp.MustCompile(`image:([0-9a-f]{16}\.(?:png|jpg|webp|gif|bmp|svg))`)

// imageLink finds the addresses of the pictures in Markdown links, after
// their opening parenthesis.
var imageLink = regexp.MustCompile(`\(image:[0-9a-f]{16}\.(?:png|jpg|webp|gif|bmp)`)

// savingPrefix starts the names of pictures being written.
const savingPrefix = ".saving-"

func imageDir(dataDir string) string { return filepath.Join(dataDir, "images") }

// imageBase is where the pages load the pictures from, as wallpaperBase.
func imageBase() string {
	if runtime.GOOS == "windows" {
		return "http://" + imageScheme + ".localhost/"
	}
	return imageScheme + "://localhost/"
}

// saveImage keeps the picture data in the images folder and returns its
// name. The same picture saved twice is kept once.
func saveImage(dataDir string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("这张图片是空的")
	}
	if len(data) > maxImageBytes {
		return "", fmt.Errorf("图片不能超过 %d MB", maxImageBytes>>20)
	}
	ext, ok := imageExts[http.DetectContentType(data)]
	if !ok {
		return "", errors.New("不支持这种图片，请用 PNG、JPG、WebP、GIF 或 BMP")
	}
	return writeImage(dataDir, data, ext)
}

// writeImage keeps data, checked to be a picture of type ext, in the images
// folder, named by its content, and returns its name.
func writeImage(dataDir string, data []byte, ext string) (string, error) {
	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:8]) + ext
	dir := imageDir(dataDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("保存不了图片：%w", err)
	}
	dst := filepath.Join(dir, name)
	if _, err := os.Stat(dst); err == nil {
		// Referred to anew: kept as long as a new one.
		now := time.Now()
		_ = os.Chtimes(dst, now, now)
		return name, nil
	}
	tmp, err := os.CreateTemp(dir, savingPrefix+"*")
	if err != nil {
		return "", fmt.Errorf("保存不了图片：%w", err)
	}
	_, err = tmp.Write(data)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), dst)
	}
	if err != nil {
		os.Remove(tmp.Name())
		return "", fmt.Errorf("保存不了图片：%w", err)
	}
	return name, nil
}

// withImagePaths puts the paths of the pictures on this machine in place
// of their names in the Markdown text, for an AI to read them: copied out
// of the app, image:<name> means nothing. The paths are in angle brackets,
// which keep the spaces in them.
func withImagePaths(text, dataDir string) string {
	dir := imageDir(dataDir)
	return imageLink.ReplaceAllStringFunc(text, func(m string) string {
		return "(<" + filepath.Join(dir, strings.TrimPrefix(m, "(image:")) + ">"
	})
}

// cleanImages deletes the pictures no item note or project description
// refers to any more, but those saved or referred to anew within grace,
// and pictures left half written. It returns how many it deleted.
func cleanImages(db *store.Store, dataDir string, grace time.Duration) (int, error) {
	dir := imageDir(dataDir)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	texts, err := db.TextsWith("image:")
	if err != nil {
		return 0, err
	}
	used := map[string]bool{}
	for _, t := range texts {
		for _, m := range imageName.FindAllStringSubmatch(t, -1) {
			used[m[1]] = true
		}
	}
	cutoff := time.Now().Add(-grace)
	deleted := 0
	for _, e := range entries {
		name := e.Name()
		if used[name] || e.IsDir() || !imageFile.MatchString(name) && !strings.HasPrefix(name, savingPrefix) {
			continue
		}
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if os.Remove(filepath.Join(dir, name)) == nil {
			deleted++
		}
	}
	return deleted, nil
}

// cleanImagesLater runs cleanImages once the app has settled, off the
// way of its windows.
func (a *app) cleanImagesLater(db *store.Store) {
	time.AfterFunc(10*time.Second, func() {
		if n, err := cleanImages(db, a.dataDir, imageGrace); err != nil {
			log.Println("cleaning images:", err)
		} else if n > 0 {
			log.Printf("cleaned %d images no note refers to", n)
		}
	})
}

// serveImage answers image://localhost/<name> (imageBase) with a picture
// of the images folder.
func (a *app) serveImage(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if r.Method != http.MethodGet && r.Method != http.MethodHead || !imageFile.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "max-age=31536000, immutable") // named by its content
	// An SVG opened on its own runs no script and loads nothing.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, filepath.Join(imageDir(a.dataDir), name))
}

// ---- Bound methods ----

// SaveImage keeps a picture pasted or dropped in a note and returns its
// name, which the note refers to it by: ![](image:<name>). The same
// picture saved twice is kept once.
func (a *Atlas) SaveImage(data []byte) (string, error) {
	return saveImage(a.app.dataDir, data)
}

// SaveImageFrom keeps a picture that pasted content refers to, a web
// address (http or https) or a file on this machine (file:), and returns
// its name, as SaveImage.
func (a *Atlas) SaveImageFrom(src string) (string, error) {
	data, err := fetchImage(src, imageFetchTimeout)
	if err != nil {
		return "", err
	}
	return saveImage(a.app.dataDir, data)
}

// imageFetchTimeout is how long downloading a pasted picture may take.
const imageFetchTimeout = 15 * time.Second

// fetchImage reads the picture at src: downloads it from the web, or reads
// it from this machine. It reads at most one byte more than a picture may
// have, which saveImage then refuses.
func fetchImage(src string, timeout time.Duration) ([]byte, error) {
	u, err := url.Parse(strings.TrimSpace(src))
	if err != nil {
		return nil, errors.New("图片地址不对")
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		req, err := http.NewRequest(http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, errors.New("图片地址不对")
		}
		// Some hosts of pictures turn away clients that do not look like a browser.
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VibeAtlas")
		req.Header.Set("Accept", "image/*")
		resp, err := (&http.Client{Timeout: timeout}).Do(req)
		if err != nil {
			return nil, fmt.Errorf("下载不了图片：%w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("下载不了图片（%d）", resp.StatusCode)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
		if err != nil {
			return nil, fmt.Errorf("下载不了图片：%w", err)
		}
		return data, nil
	case "file":
		path, ok := store.LocalPath(u.String())
		if !ok {
			return nil, errors.New("图片地址不对")
		}
		return readImageFile(path)
	}
	return nil, errors.New("只能保存网络上或本机的图片")
}

// readImageFile reads a picture on this machine, at most one byte more
// than a picture may have, which saveImage then refuses.
func readImageFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("读不了图片 %s", path)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读不了图片 %s", path)
	}
	return data, nil
}

// ChooseImages asks for pictures on this machine to put in a note, and
// keeps them as SaveImage does: their names, none when the user cancels.
// Pictures that cannot be kept are left out; when none can, it says why.
func (a *Atlas) ChooseImages(ctx context.Context) ([]string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "插入图片",
		ButtonLabel: "插入",
		Multiple:    true,
		Filters:     []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "webp", "gif", "bmp"}}},
	})
	if err != nil {
		return nil, fmt.Errorf("打不开选择图片的窗口：%w", err)
	}
	return saveImageFiles(a.app.dataDir, paths)
}

// saveImageFiles keeps the pictures at paths, in order.
func saveImageFiles(dataDir string, paths []string) ([]string, error) {
	names := []string{}
	var problems []string
	for _, path := range paths {
		data, err := readImageFile(path)
		name := ""
		if err == nil {
			name, err = saveImage(dataDir, data)
		}
		if err != nil {
			problems = append(problems, filepath.Base(path)+"："+err.Error())
			continue
		}
		names = append(names, name)
	}
	if len(names) == 0 && len(problems) > 0 {
		return nil, errors.New(strings.Join(problems, "；"))
	}
	return names, nil
}

// ImageBase is where the pages load the pictures of the notes from: the
// name of a picture follows it.
func (a *Atlas) ImageBase() string {
	return imageBase()
}

// OpenImage opens a picture of the notes in the system's viewer.
func (a *Atlas) OpenImage(name string) error {
	if !imageFile.MatchString(name) {
		return errors.New("找不到这张图片")
	}
	path := filepath.Join(imageDir(a.app.dataDir), name)
	if _, err := os.Stat(path); err != nil {
		return errors.New("找不到这张图片，它可能已经被清理")
	}
	if err := mygo.Shell.OpenPath(path); err != nil {
		return fmt.Errorf("打不开这张图片：%w", err)
	}
	return nil
}
