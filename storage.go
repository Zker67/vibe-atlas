package main

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// The files the app keeps in the data folder for the texts, the pictures
// in images/ and the attachments in files/, go once no text refers to them
// (sweeper). Settings shows what the folder holds (StorageUsage).

// orphanGrace is how long a file no text refers to is kept: an undo may
// bring it back.
const orphanGrace = time.Hour

// cleanEvery is how often the app cleans while it runs, which may be days
// in the tray.
const cleanEvery = time.Hour

// draftWait is how long a sweep waits for the draft of quick capture.
const draftWait = 2 * time.Second

// dbName is the database file in the data folder; the write-ahead log and
// its index sit beside it.
const dbName = "vibe-atlas.db"

func filesDir(dataDir string) string { return filepath.Join(dataDir, "files") }

// attachmentRef finds the attachments a text refers to, the folder of each
// in group 1: attachment:<folder>/<name>.
var attachmentRef = regexp.MustCompile(`attachment:([0-9a-f]{16})/`)

// attachmentFolder matches the folders of the attachments in files/, and
// attachmentOrigin the files beside them that tell where they came from.
var (
	attachmentFolder = regexp.MustCompile(`^[0-9a-f]{16}$`)
	attachmentOrigin = regexp.MustCompile(`^([0-9a-f]{16})\.origin$`)
)

// StorageKind is a part of the data folder.
type StorageKind string

// The parts of the data folder.
const (
	StorageDatabase   StorageKind = "database"   // 数据库
	StorageImages     StorageKind = "images"     // 图片
	StorageFiles      StorageKind = "files"      // 附件
	StorageWallpapers StorageKind = "wallpapers" // 背景图片
	StorageOther      StorageKind = "other"      // 其他
)

// StoragePart is what a part of the data folder takes.
type StoragePart struct {
	Kind  StorageKind `json:"kind"`
	Bytes int64       `json:"bytes"`
	// Count is how many files it has: pictures, attached files.
	Count int `json:"count"`
}

// Reclaim is what the files no text refers to take.
type Reclaim struct {
	Count int   `json:"count"`
	Bytes int64 `json:"bytes"`
	// ReadyCount and ReadyBytes are those the next cleanup deletes; the
	// others went unused within the grace.
	ReadyCount int   `json:"readyCount"`
	ReadyBytes int64 `json:"readyBytes"`
	// NextAt is when the first of the others may go, 0 when there are none.
	NextAt int64 `json:"nextAt"`
}

// CleanResult is what a cleanup did.
type CleanResult struct {
	// At is when it ran, 0 when none ran yet since the app started.
	At      int64 `json:"at"`
	Deleted int   `json:"deleted"`
	Freed   int64 `json:"freed"`
	// Manual is set when the user asked for it.
	Manual bool `json:"manual"`
	// Skipped is set when it deleted nothing because the draft of quick
	// capture could not be read.
	Skipped bool `json:"skipped"`
}

// StorageUsage is what the data folder holds.
type StorageUsage struct {
	Total int64         `json:"total"`
	Parts []StoragePart `json:"parts"`
	// Reclaim is what the cleanup can take back.
	Reclaim Reclaim `json:"reclaim"`
	// DatabaseFree is about how much compacting the database saves.
	DatabaseFree int64 `json:"databaseFree"`
	// GraceMinutes is how long a file no text refers to is kept.
	GraceMinutes int         `json:"graceMinutes"`
	LastClean    CleanResult `json:"lastClean"`
}

// storageUnit is what the cleanup keeps or deletes as one: a picture, or
// the folder of an attachment with the file that tells where it came from.
type storageUnit struct {
	key   string // images/<name>, files/<folder>
	paths []string
	bytes int64
	count int
	mod   time.Time // when it was saved or referred to anew
	temp  bool      // half written: no text can refer to it
	// name is the picture's name, or the folder of the attachment, as the
	// texts refer to them.
	name string
}

// listUnits lists the pictures and the attachments in the data folder.
// Missing folders have none.
func listUnits(dataDir string) (images, files []storageUnit, err error) {
	imgDir := imageDir(dataDir)
	entries, err := os.ReadDir(imgDir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, nil, err
	}
	for _, e := range entries {
		name := e.Name()
		temp := strings.HasPrefix(name, savingPrefix)
		if e.IsDir() || !temp && !imageFile.MatchString(name) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		images = append(images, storageUnit{
			key: "images/" + name, paths: []string{filepath.Join(imgDir, name)},
			bytes: info.Size(), count: 1, mod: info.ModTime(), temp: temp, name: name,
		})
	}

	fDir := filesDir(dataDir)
	entries, err = os.ReadDir(fDir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, nil, err
	}
	byFolder := map[string]*storageUnit{}
	unit := func(folder string) *storageUnit {
		if u := byFolder[folder]; u != nil {
			return u
		}
		u := &storageUnit{key: "files/" + folder, name: folder}
		byFolder[folder] = u
		return u
	}
	var order []string
	for _, e := range entries {
		name := e.Name()
		info, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(fDir, name)
		switch {
		case e.IsDir() && attachmentFolder.MatchString(name):
			u := unit(name)
			u.paths = append(u.paths, path)
			bytes, count, newest := folderSize(path)
			u.bytes += bytes
			u.count += count
			u.mod = later(u.mod, later(info.ModTime(), newest))
			order = append(order, name)
		case !e.IsDir() && attachmentOrigin.MatchString(name):
			folder := attachmentOrigin.FindStringSubmatch(name)[1]
			u := unit(folder)
			u.paths = append(u.paths, path)
			u.bytes += info.Size()
			u.mod = later(u.mod, info.ModTime())
			order = append(order, folder)
		case !e.IsDir() && strings.HasPrefix(name, savingPrefix):
			files = append(files, storageUnit{
				key: "files/" + name, paths: []string{path},
				bytes: info.Size(), count: 1, mod: info.ModTime(), temp: true, name: name,
			})
		}
	}
	seen := map[string]bool{}
	for _, folder := range order {
		if !seen[folder] {
			seen[folder] = true
			files = append(files, *byFolder[folder])
		}
	}
	return images, files, nil
}

// folderSize is what the files in dir take, how many there are and when
// the newest of them changed.
func folderSize(dir string) (bytes int64, count int, newest time.Time) {
	filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			bytes += info.Size()
			count++
			newest = later(newest, info.ModTime())
		}
		return nil
	})
	return bytes, count, newest
}

func later(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}

// referenced is the pictures and the folders of attachments that the texts
// of the database, and extra (drafts not saved yet), refer to.
func referenced(db *store.Store, extra []string) (images, files map[string]bool, err error) {
	images, files = map[string]bool{}, map[string]bool{}
	pics, err := db.TextsWith("image:")
	if err != nil {
		return nil, nil, err
	}
	attached, err := db.TextsWith("attachment:")
	if err != nil {
		return nil, nil, err
	}
	for _, t := range append(pics, extra...) {
		for _, m := range imageName.FindAllStringSubmatch(t, -1) {
			images[m[1]] = true
		}
	}
	for _, t := range append(attached, extra...) {
		for _, m := range attachmentRef.FindAllStringSubmatch(t, -1) {
			files[m[1]] = true
		}
	}
	return images, files, nil
}

// heldTexts returns the texts not saved yet that may refer to files, such
// as the draft of quick capture; an error when they cannot be read.
type heldTexts func() ([]string, error)

// sweeper cleans the files no text refers to. A file goes once it has gone
// unused for the grace, counted from the later of when it was saved (or
// referred to anew) and when this run first found it unused: the first scan
// of a run counts none of the latter, as the undo history of the run before
// is gone.
type sweeper struct {
	mu     sync.Mutex
	grace  time.Duration
	now    func() time.Time
	unused map[string]time.Time // first found unused, zero for the first scan's
	primed bool                 // the first scan of the run is done
	last   CleanResult
}

func newSweeper() *sweeper {
	return &sweeper{grace: orphanGrace, now: time.Now, unused: map[string]time.Time{}}
}

// scanResult is a scan of the data folder.
type scanResult struct {
	images, files []storageUnit
	reclaim       Reclaim
	ready         []storageUnit // unused for the grace
}

// scan looks at the data folder, noting the files found unused; extra are
// texts not saved yet. Locked by the caller.
func (s *sweeper) scan(db *store.Store, dataDir string, extra []string) (scanResult, error) {
	var r scanResult
	images, files, err := listUnits(dataDir)
	if err != nil {
		return r, err
	}
	usedImages, usedFiles, err := referenced(db, extra)
	if err != nil {
		return r, err
	}
	r.images, r.files = images, files
	now := s.now()
	var next time.Time
	look := func(u storageUnit, used bool) {
		if used && !u.temp {
			delete(s.unused, u.key)
			return
		}
		since := u.mod
		if !u.temp {
			first, ok := s.unused[u.key]
			if !ok {
				if s.primed {
					first = now
				}
				s.unused[u.key] = first
			}
			since = later(since, first)
		}
		r.reclaim.Count++
		r.reclaim.Bytes += u.bytes
		free := since.Add(s.grace)
		if !now.Before(free) {
			r.reclaim.ReadyCount++
			r.reclaim.ReadyBytes += u.bytes
			r.ready = append(r.ready, u)
		} else if next.IsZero() || free.Before(next) {
			next = free
		}
	}
	for _, u := range images {
		look(u, usedImages[u.name])
	}
	for _, u := range files {
		look(u, usedFiles[u.name])
	}
	if !next.IsZero() {
		r.reclaim.NextAt = next.UnixMilli()
	}
	s.primed = true
	return r, nil
}

// prime notes the files unused as the app starts, before the user can
// change any text: those are as old as their files.
func (s *sweeper) prime(db *store.Store, dataDir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.primed {
		return
	}
	if _, err := s.scan(db, dataDir, nil); err != nil {
		log.Println("looking at the data folder:", err)
	}
}

// sweep deletes the files unused for the grace. When held cannot tell the
// texts not saved yet, it deletes nothing and says so.
func (s *sweeper) sweep(db *store.Store, dataDir string, held heldTexts, manual bool) (CleanResult, error) {
	var extra []string
	skip := false
	if held != nil {
		texts, err := held()
		if err != nil {
			log.Println("reading the draft of quick capture:", err)
			skip = true
		}
		extra = texts
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.scan(db, dataDir, extra)
	if err != nil {
		return CleanResult{}, err
	}
	res := CleanResult{At: s.now().UnixMilli(), Manual: manual, Skipped: skip}
	if !skip {
		for _, u := range r.ready {
			ok := true
			for _, p := range u.paths {
				if err := os.RemoveAll(p); err != nil {
					ok = false
				}
			}
			if ok {
				res.Deleted++
				res.Freed += u.bytes
				delete(s.unused, u.key)
			}
		}
	}
	s.last = res
	return res, nil
}

// cleanOnce cleans as the first sweep of a run does, by the age of the
// files alone, and returns how many it deleted.
func cleanOnce(db *store.Store, dataDir string, grace time.Duration) (int, error) {
	s := newSweeper()
	s.grace = grace
	res, err := s.sweep(db, dataDir, nil, false)
	return res.Deleted, err
}

// usage is what the data folder holds. Texts held but not readable count
// as none.
func (s *sweeper) usage(db *store.Store, dataDir string, held heldTexts) (StorageUsage, error) {
	var extra []string
	if held != nil {
		extra, _ = held()
	}
	s.mu.Lock()
	r, err := s.scan(db, dataDir, extra)
	last := s.last
	s.mu.Unlock()
	if err != nil {
		return StorageUsage{}, err
	}
	u := StorageUsage{Reclaim: r.reclaim, GraceMinutes: int(s.grace / time.Minute), LastClean: last}
	free, err := db.FreeBytes()
	if err != nil {
		return StorageUsage{}, err
	}
	u.DatabaseFree = free

	part := func(kind StorageKind, units []storageUnit) StoragePart {
		p := StoragePart{Kind: kind}
		for _, x := range units {
			p.Bytes += x.bytes
			if !x.temp {
				p.Count += x.count
			}
		}
		return p
	}
	images := part(StorageImages, r.images)
	files := part(StorageFiles, r.files)
	database := StoragePart{Kind: StorageDatabase, Bytes: databaseSize(dataDir), Count: 1}
	wallpapers := StoragePart{Kind: StorageWallpapers}
	wallpapers.Bytes, wallpapers.Count, _ = folderSize(wallpaperDir(dataDir))
	all, _, _ := folderSize(dataDir)
	other := StoragePart{Kind: StorageOther, Bytes: max(0, all-database.Bytes-images.Bytes-files.Bytes-wallpapers.Bytes)}

	u.Parts = []StoragePart{database, images, files, wallpapers, other}
	for _, p := range u.Parts {
		u.Total += p.Bytes
	}
	return u, nil
}

// databaseSize is what the database takes with its write-ahead log.
func databaseSize(dataDir string) int64 {
	var n int64
	for _, name := range []string{dbName, dbName + "-wal", dbName + "-shm"} {
		if info, err := os.Stat(filepath.Join(dataDir, name)); err == nil {
			n += info.Size()
		}
	}
	return n
}

// ---- The app's cleanup ----

// draftTexts is the draft of quick capture, which may refer to pictures and
// attachments not saved with any item yet.
func (a *app) draftTexts() ([]string, error) {
	_, capture := a.windows()
	if capture == nil {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), draftWait)
	defer cancel()
	v, err := capture.Page().EvalContext(ctx, `return globalThis.atlasDraftNote?.() ?? ""`)
	if err != nil {
		return nil, err
	}
	s, ok := v.(string)
	if !ok {
		return nil, errors.New("the draft is not text")
	}
	return []string{s}, nil
}

// cleanStorageLater notes the files unused as the app starts, then cleans
// once the app has settled, off the way of its windows, and every
// cleanEvery after.
func (a *app) cleanStorageLater(db *store.Store) {
	go a.sweeper.prime(db, a.dataDir)
	clean := func() {
		res, err := a.sweeper.sweep(db, a.dataDir, a.draftTexts, false)
		if err != nil {
			log.Println("cleaning the data folder:", err)
		} else if res.Deleted > 0 {
			log.Printf("cleaned %d files no text refers to, %d bytes", res.Deleted, res.Freed)
		}
	}
	time.AfterFunc(10*time.Second, func() {
		clean()
		for range time.Tick(cleanEvery) {
			clean()
		}
	})
}

// ---- Bound methods ----

// StorageUsage tells what the data folder holds: its parts, what the
// cleanup can take back and how much compacting the database saves.
func (a *Atlas) StorageUsage() (StorageUsage, error) {
	db, err := a.store()
	if err != nil {
		return StorageUsage{}, err
	}
	return a.app.sweeper.usage(db, a.app.dataDir, a.app.draftTexts)
}

// CleanStorage deletes now the pictures and attachments no text has
// referred to for the grace, as the app does every hour.
func (a *Atlas) CleanStorage() (CleanResult, error) {
	db, err := a.store()
	if err != nil {
		return CleanResult{}, err
	}
	res, err := a.app.sweeper.sweep(db, a.app.dataDir, a.app.draftTexts, true)
	if err != nil {
		return CleanResult{}, errors.New("清理失败：" + err.Error())
	}
	return res, nil
}

// CompactDatabase rebuilds the database without the room deleted data left
// and returns how many bytes its files shrank by.
func (a *Atlas) CompactDatabase() (int64, error) {
	db, err := a.store()
	if err != nil {
		return 0, err
	}
	before := databaseSize(a.app.dataDir)
	if err := db.Compact(); err != nil {
		return 0, err
	}
	return max(0, before-databaseSize(a.app.dataDir)), nil
}
