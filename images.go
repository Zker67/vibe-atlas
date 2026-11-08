package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
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

// imageFile matches the names the app saves pictures under.
var imageFile = regexp.MustCompile(`^[0-9a-f]{16}\.(png|jpg|webp|gif|bmp)$`)

// imageName finds the pictures a text refers to, their names in group 1.
var imageName = regexp.MustCompile(`image:([0-9a-f]{16}\.(?:png|jpg|webp|gif|bmp))`)

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
	http.ServeFile(w, r, filepath.Join(imageDir(a.dataDir), name))
}

// ---- Bound methods ----

// SaveImage keeps a picture pasted or dropped in a note and returns its
// name, which the note refers to it by: ![](image:<name>). The same
// picture saved twice is kept once.
func (a *Atlas) SaveImage(data []byte) (string, error) {
	return saveImage(a.app.dataDir, data)
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
