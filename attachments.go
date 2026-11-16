package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// Files pasted or dropped in a note are attachments: kept in the app, in
// files/<the first 16 hex digits of the SHA-256 of their content>/<their
// name>, which the note refers to as attachment:<folder>/<name>; or left
// where they are, which the note refers to with a file: link. Where a kept
// one came from is written beside its folder, in <folder>.origin, so that
// it can go back to being referred to there.

// AttachMode is how files pasted or dropped in a note are taken.
type AttachMode string

// The ways to take files.
const (
	AttachCopy AttachMode = "copy" // 另存到软件
	AttachLink AttachMode = "link" // 原地引用
)

const keyAttachMode = "attachMode"

// attachCopyLimit is the largest file kept in the app as it is pasted:
// larger ones are referred to where they are.
const attachCopyLimit = 20 << 20

// maxAttachBytes is the largest file the app keeps when asked to.
const maxAttachBytes = 1 << 30

// maxAttachName is how long, in characters, the name of a kept file is.
const maxAttachName = 120

// attachmentLink is a link to a kept file: its folder in group 1, its name
// in group 2.
var attachmentLink = regexp.MustCompile(`^attachment:([0-9a-f]{16})/(.+)$`)

// pictureExts are the extensions of the files that are taken as pictures.
var pictureExts = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true, ".bmp": true}

// AttachedItem is a file taken into a note.
type AttachedItem struct {
	// Image is the name of the picture, when the file was one and was
	// saved as the pictures of the notes are; the other fields are empty.
	Image string `json:"image"`
	// Name is the file's name, for the text of the link.
	Name string `json:"name"`
	// Link is attachment:<folder>/<name> for a file kept in the app, or the
	// file: link of one where it is.
	Link   string `json:"link"`
	Stored bool   `json:"stored"`
}

// Attached is what taking files into a note did.
type Attached struct {
	Items []AttachedItem `json:"items"`
	// Problems are the files that could not be taken, with why, for the
	// user.
	Problems []string `json:"problems"`
}

// FileInfo is what a note's card of a file shows.
type FileInfo struct {
	Link string `json:"link"`
	// Name is the file's name.
	Name string `json:"name"`
	// Path is where the file is on this machine.
	Path string `json:"path"`
	// Folder is the folder the file is in, for one referred to where it is.
	Folder string `json:"folder"`
	Exists bool   `json:"exists"`
	Dir    bool   `json:"dir"`
	Size   int64  `json:"size"`
	// Stored is set for a file kept in the app.
	Stored bool `json:"stored"`
	// CanUnstore is set for a file kept in the app whose origin is still
	// there.
	CanUnstore bool `json:"canUnstore"`
	// CanStore is set for a file, not a folder, referred to where it is and
	// small enough to keep.
	CanStore bool `json:"canStore"`
}

func attachMode(db *store.Store) AttachMode {
	if v, _, _ := db.Setting(keyAttachMode); AttachMode(v) == AttachLink {
		return AttachLink
	}
	return AttachCopy
}

// cleanFileName is name as a kept file is called: no control characters,
// angle brackets or separators, at most maxAttachName characters with its
// extension kept.
func cleanFileName(name string) string {
	name = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsControl(r), strings.ContainsRune(`<>/\:"|?*`, r):
			return '_'
		}
		return r
	}, name)
	name = strings.Trim(name, " .")
	if name == "" {
		return "文件"
	}
	if utf8.RuneCountInString(name) > maxAttachName {
		ext := filepath.Ext(name)
		if utf8.RuneCountInString(ext) > 16 {
			ext = ""
		}
		runes := []rune(strings.TrimSuffix(name, ext))
		name = strings.TrimRight(string(runes[:maxAttachName-utf8.RuneCountInString(ext)]), " .") + ext
	}
	return name
}

// fileLink is the file: link of the local path, with the characters a
// Markdown link in angle brackets cannot hold escaped.
func fileLink(path string) string {
	escaped := strings.NewReplacer("%", "%25", "<", "%3C", ">", "%3E").Replace(path)
	return store.FileLink(escaped)
}

// attachmentPath is the file a link to a kept file names, and whether link
// is one.
func attachmentPath(dataDir, link string) (string, bool) {
	m := attachmentLink.FindStringSubmatch(link)
	if m == nil || m[2] != cleanFileName(m[2]) {
		return "", false
	}
	return filepath.Join(filesDir(dataDir), m[1], m[2]), true
}

// originPath is where the kept files of folder came from, written beside it.
func originPath(dataDir, folder string) string {
	return filepath.Join(filesDir(dataDir), folder+".origin")
}

// storeFile keeps a copy of the file at src in the app. The same content is
// kept once for each name.
func storeFile(dataDir, src string) (AttachedItem, error) {
	info, err := os.Stat(src)
	if err != nil {
		return AttachedItem{}, fmt.Errorf("找不到 %s", src)
	}
	if info.IsDir() {
		return AttachedItem{}, errors.New("文件夹只能原地引用")
	}
	if info.Size() > maxAttachBytes {
		return AttachedItem{}, fmt.Errorf("%s 超过 %d GB，只能原地引用", filepath.Base(src), maxAttachBytes>>30)
	}
	in, err := os.Open(src)
	if err != nil {
		return AttachedItem{}, fmt.Errorf("读不了 %s", src)
	}
	defer in.Close()
	dir := filesDir(dataDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return AttachedItem{}, fmt.Errorf("保存不了文件：%w", err)
	}
	tmp, err := os.CreateTemp(dir, savingPrefix+"*")
	if err != nil {
		return AttachedItem{}, fmt.Errorf("保存不了文件：%w", err)
	}
	sum := sha256.New()
	_, err = io.Copy(io.MultiWriter(tmp, sum), io.LimitReader(in, maxAttachBytes+1))
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	fail := func(err error) (AttachedItem, error) {
		os.Remove(tmp.Name())
		return AttachedItem{}, fmt.Errorf("保存不了文件：%w", err)
	}
	if err != nil {
		return fail(err)
	}
	folder := hex.EncodeToString(sum.Sum(nil)[:8])
	name := cleanFileName(filepath.Base(src))
	if err := os.MkdirAll(filepath.Join(dir, folder), 0o755); err != nil {
		return fail(err)
	}
	dst := filepath.Join(dir, folder, name)
	if _, err := os.Stat(dst); err == nil {
		os.Remove(tmp.Name())
	} else if err := os.Rename(tmp.Name(), dst); err != nil {
		return fail(err)
	}
	if abs, err := filepath.Abs(src); err == nil {
		src = abs
	}
	if err := os.WriteFile(originPath(dataDir, folder), []byte(src), 0o644); err != nil {
		return AttachedItem{}, fmt.Errorf("保存不了文件：%w", err)
	}
	// Referred to anew: kept as long as a new one.
	now := time.Now()
	os.Chtimes(filepath.Join(dir, folder), now, now)
	return AttachedItem{Name: filepath.Base(src), Link: "attachment:" + folder + "/" + name, Stored: true}, nil
}

// linkItem refers to the file or folder at path where it is.
func linkItem(path string) AttachedItem {
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	}
	return AttachedItem{Name: filepath.Base(path), Link: fileLink(path)}
}

// attachPaths takes the files at paths into a note, as mode says: pictures
// as pictures, folders and large files where they are.
func attachPaths(dataDir string, mode AttachMode, paths []string) Attached {
	out := Attached{Items: []AttachedItem{}, Problems: []string{}}
	for _, path := range paths {
		path = filepath.Clean(path)
		info, err := os.Stat(path)
		if err != nil {
			out.Problems = append(out.Problems, "找不到 "+path)
			continue
		}
		if info.IsDir() {
			out.Items = append(out.Items, linkItem(path))
			continue
		}
		if pictureExts[strings.ToLower(filepath.Ext(path))] && info.Size() <= maxImageBytes {
			if data, err := readImageFile(path); err == nil && imageExts[http.DetectContentType(data)] != "" {
				name, err := saveImage(dataDir, data)
				if err == nil {
					out.Items = append(out.Items, AttachedItem{Image: name})
					continue
				}
			}
		}
		if mode == AttachLink || info.Size() > attachCopyLimit {
			out.Items = append(out.Items, linkItem(path))
			continue
		}
		it, err := storeFile(dataDir, path)
		if err != nil {
			out.Problems = append(out.Problems, filepath.Base(path)+"："+err.Error())
			continue
		}
		out.Items = append(out.Items, it)
	}
	return out
}

// fileInfo is what the card of the file link refers to shows.
func fileInfo(dataDir, link string) FileInfo {
	fi := FileInfo{Link: link}
	if path, ok := attachmentPath(dataDir, link); ok {
		fi.Path, fi.Stored = path, true
		fi.Name = filepath.Base(path)
		folder := attachmentLink.FindStringSubmatch(link)[1]
		if origin, err := os.ReadFile(originPath(dataDir, folder)); err == nil {
			if info, err := os.Stat(string(origin)); err == nil && !info.IsDir() {
				fi.CanUnstore = true
			}
		}
	} else if path, ok := store.LocalPath(link); ok {
		fi.Path = path
		fi.Name = filepath.Base(path)
		fi.Folder = filepath.Dir(path)
	} else {
		fi.Name = link
		return fi
	}
	info, err := os.Stat(fi.Path)
	if err != nil {
		fi.CanUnstore = false
		return fi
	}
	fi.Exists, fi.Dir = true, info.IsDir()
	if !fi.Dir {
		fi.Size = info.Size()
		fi.CanStore = !fi.Stored && fi.Size <= maxAttachBytes
	}
	return fi
}

// linkedPath is the file a card's link names, kept in the app or where it
// is, which must be there.
func linkedPath(dataDir, link string) (string, error) {
	path, ok := attachmentPath(dataDir, link)
	if !ok {
		path, ok = store.LocalPath(link)
	}
	if !ok {
		return "", errors.New("这不是文件的链接")
	}
	if _, err := os.Stat(path); err != nil {
		return "", errors.New("找不到这个文件，它可能已经被移走或删除")
	}
	return path, nil
}

// attachmentInText finds the links to kept files in Markdown, after their
// opening parenthesis: in angle brackets (group 1 the folder, 2 the name)
// or not (3, 4).
var attachmentInText = regexp.MustCompile(`\(<attachment:([0-9a-f]{16})/([^<>\n]+)>|\(attachment:([0-9a-f]{16})/([^()\s]+)`)

// withAttachmentPaths puts the paths of the kept files on this machine in
// place of their links, for an AI to read them, as withImagePaths does.
func withAttachmentPaths(text, dataDir string) string {
	return attachmentInText.ReplaceAllStringFunc(text, func(m string) string {
		g := attachmentInText.FindStringSubmatch(m)
		folder, name := g[1], g[2]
		if folder == "" {
			folder, name = g[3], g[4]
		}
		return "(<" + filepath.Join(filesDir(dataDir), folder, name) + ">"
	})
}

// ---- Bound methods ----

// AttachFiles takes the files at paths, dropped on a note, into it: pictures
// as pictures, other files kept in the app or referred to where they are, as
// the setting says.
func (a *Atlas) AttachFiles(paths []string) (Attached, error) {
	db, err := a.store()
	if err != nil {
		return Attached{}, err
	}
	return attachPaths(a.app.dataDir, attachMode(db), paths), nil
}

// AttachClipboardFiles takes the files copied to the clipboard into a note,
// as AttachFiles does; none when there are none.
func (a *Atlas) AttachClipboardFiles() (Attached, error) {
	db, err := a.store()
	if err != nil {
		return Attached{}, err
	}
	var paths []string
	if data, err := mygo.Clipboard.Read(transfer.FileList); err == nil {
		paths, _ = data.Files()
	}
	return attachPaths(a.app.dataDir, attachMode(db), paths), nil
}

// FileInfo tells what the cards of the file links show.
func (a *Atlas) FileInfo(links []string) []FileInfo {
	out := make([]FileInfo, len(links))
	for i, l := range links {
		out[i] = fileInfo(a.app.dataDir, l)
	}
	return out
}

// StoreAttachment keeps in the app a copy of the file a file: link refers
// to, and returns the link to the copy.
func (a *Atlas) StoreAttachment(link string) (AttachedItem, error) {
	path, ok := store.LocalPath(link)
	if !ok {
		return AttachedItem{}, errors.New("这不是本机文件的链接")
	}
	return storeFile(a.app.dataDir, path)
}

// UnstoreAttachment refers to a file kept in the app where it came from,
// which must still be there, and returns the link to it there.
func (a *Atlas) UnstoreAttachment(link string) (AttachedItem, error) {
	m := attachmentLink.FindStringSubmatch(link)
	if m == nil {
		return AttachedItem{}, errors.New("这个文件不是另存在软件里的")
	}
	origin, err := os.ReadFile(originPath(a.app.dataDir, m[1]))
	if err != nil {
		return AttachedItem{}, errors.New("不知道这个文件原来在哪里")
	}
	if info, err := os.Stat(string(origin)); err != nil || info.IsDir() {
		return AttachedItem{}, fmt.Errorf("原来的文件已经不在了：%s", origin)
	}
	return linkItem(string(origin)), nil
}

// OpenAttachment opens the file of a card in the app the system has for it.
func (a *Atlas) OpenAttachment(link string) error {
	path, err := linkedPath(a.app.dataDir, link)
	if err != nil {
		return err
	}
	if err := mygo.Shell.OpenPath(path); err != nil {
		return fmt.Errorf("打不开 %s：%w", filepath.Base(path), err)
	}
	return nil
}

// ShowAttachmentInFolder shows the file of a card in the file manager.
func (a *Atlas) ShowAttachmentInFolder(link string) error {
	path, err := linkedPath(a.app.dataDir, link)
	if err != nil {
		return err
	}
	mygo.Shell.ShowItemInFolder(path)
	return nil
}

// CopyAttachment puts the file of a card on the clipboard, which file
// managers and other apps paste as the file.
func (a *Atlas) CopyAttachment(link string) error {
	path, err := linkedPath(a.app.dataDir, link)
	if err != nil {
		return err
	}
	data, err := transfer.FileData(path)
	if err != nil {
		return fmt.Errorf("复制不了文件：%w", err)
	}
	if err := mygo.Clipboard.Write(data); err != nil {
		return fmt.Errorf("复制不了文件：%w", err)
	}
	return nil
}

// SetAttachMode sets how files pasted or dropped in a note are taken.
func (a *Atlas) SetAttachMode(mode AttachMode) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if mode != AttachCopy && mode != AttachLink {
		return Settings{}, errors.New("只能选另存到软件或原地引用")
	}
	if err := db.SetSetting(keyAttachMode, string(mode)); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}
