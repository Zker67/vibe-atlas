package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// UpdateChanged is broadcast to every window as a check for a newer version
// and its installation go on.
var UpdateChanged = mygo.NewEvent[UpdateState]("updateChanged")

// UpdatePhase is where updating the app is.
type UpdatePhase string

// The phases.
const (
	UpdateIdle        UpdatePhase = "idle"        // up to date, or not checked yet
	UpdateChecking    UpdatePhase = "checking"    // asking GitHub for a newer version
	UpdateAvailable   UpdatePhase = "available"   // a newer version is out
	UpdateDownloading UpdatePhase = "downloading" // downloading and installing it
	UpdateRestarting  UpdatePhase = "restarting"  // installed; the app starts again
	UpdateFailed      UpdatePhase = "failed"      // installing it failed
)

// UpdateState is what the pages show of updating the app.
type UpdateState struct {
	// Version is the version running.
	Version string `json:"version"`
	// Enabled reports whether this copy can update itself: a build with
	// updates, where it can write its own folder. Development builds
	// cannot.
	Enabled bool        `json:"enabled"`
	Phase   UpdatePhase `json:"phase"`
	// Available is the newer version found, or "".
	Available string `json:"available"`
	// Progress is how much of it downloaded, 0 to 1.
	Progress float64 `json:"progress"`
	// Error says why installing it failed, in the phase failed.
	Error string `json:"error"`
}

// updates is the app's side of updating itself.
type updates struct {
	mu     sync.Mutex // guards the fields below; never held across calls to MyGo
	state  UpdateState
	found  *mygo.Update
	checkM sync.Mutex // one check at a time
}

// updateCheckDelay is how long after launch the first check waits, clear
// of the start of the app; then it checks once a day.
const (
	updateCheckDelay    = 3 * time.Second
	updateCheckInterval = 24 * time.Hour
	updateCheckTimeout  = 30 * time.Second
)

var errUpdatesDisabled = errors.New("这个版本不能自动更新：开发版本，或者程序所在的文件夹不能写入。可以到 GitHub 下载安装包")

// useUpdateDir makes the updater read the updates from a local folder
// when VIBE_ATLAS_UPDATE_DIR names one, for testing builds: the folder
// that `mygo build` writes, with its manifest and archives. The archives
// are checked against the app's public key as ever.
func useUpdateDir() {
	if dir := os.Getenv("VIBE_ATLAS_UPDATE_DIR"); dir != "" {
		mygo.Updater.SetSource(dirSource(dir))
	}
}

// dirSource serves the updates in a folder: the manifest of the running
// platform, and the files the manifest names, by the last part of their
// URL.
type dirSource string

func (d dirSource) Manifest(ctx context.Context, prereleases bool) (io.ReadCloser, error) {
	return os.Open(filepath.Join(string(d), "update-"+runtime.GOOS+"-"+runtime.GOARCH+".json"))
}

func (d dirSource) Open(ctx context.Context, url string) (io.ReadCloser, error) {
	name := path.Base(url)
	if name == "." || name == "/" || name == ".." {
		return nil, fmt.Errorf("not a file of the update: %s", url)
	}
	return os.Open(filepath.Join(string(d), name))
}

// initUpdates fills in the state of updating as the app starts.
func (a *app) initUpdates() {
	useUpdateDir()
	s := UpdateState{Version: mygo.App.Version(), Enabled: mygo.Updater.Enabled(), Phase: UpdateIdle}
	a.upd.mu.Lock()
	a.upd.state = s
	a.upd.mu.Unlock()
}

func (a *app) updateState() UpdateState {
	a.upd.mu.Lock()
	defer a.upd.mu.Unlock()
	return a.upd.state
}

// setUpdate changes the state of updating and tells the pages; change
// reports whether it changed anything.
func (a *app) setUpdate(change func(*UpdateState) bool) bool {
	a.upd.mu.Lock()
	changed := change(&a.upd.state)
	s := a.upd.state
	a.upd.mu.Unlock()
	if changed {
		_ = UpdateChanged.Broadcast(s)
	}
	return changed
}

// busy reports whether the phase is one that a check leaves be.
func (p UpdatePhase) busy() bool {
	return p == UpdateDownloading || p == UpdateRestarting
}

// errInstalling is returned while an update is being installed already.
var errInstalling = errors.New("正在更新")

// watchUpdates checks for a newer version shortly after launch, then once
// a day while the app runs.
func (a *app) watchUpdates() {
	if !a.updateState().Enabled {
		return
	}
	time.Sleep(updateCheckDelay)
	for {
		if err := a.checkUpdates(context.Background()); err != nil {
			log.Println("checking for updates:", err)
		}
		time.Sleep(updateCheckInterval)
	}
}

// checkUpdates asks for a newer version. While one is downloading, it
// leaves it be.
func (a *app) checkUpdates(ctx context.Context) error {
	if !a.updateState().Enabled {
		return errUpdatesDisabled
	}
	a.upd.checkM.Lock()
	defer a.upd.checkM.Unlock()

	var prev UpdatePhase
	if !a.setUpdate(func(s *UpdateState) bool {
		if s.Phase.busy() {
			return false
		}
		prev, s.Phase = s.Phase, UpdateChecking
		return true
	}) {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, updateCheckTimeout)
	defer cancel()
	up, err := mygo.Updater.Check(ctx)
	a.setUpdate(func(s *UpdateState) bool {
		if s.Phase != UpdateChecking {
			return false
		}
		switch {
		case err != nil:
			s.Phase = prev
		case up == nil:
			s.Phase, s.Available, s.Error = UpdateIdle, "", ""
			a.upd.found = nil
		default:
			s.Phase, s.Available, s.Progress, s.Error = UpdateAvailable, up.Version, 0, ""
			a.upd.found = up
		}
		return true
	})
	return err
}

// installUpdate downloads the version found and puts it in place of this
// one, telling the pages how far it got. The running app goes on as it
// is; the new version runs once it starts again.
func (a *app) installUpdate(ctx context.Context) error {
	var up *mygo.Update
	busy := false
	a.setUpdate(func(s *UpdateState) bool {
		up, busy = a.upd.found, s.Phase.busy() || s.Phase == UpdateChecking
		if up == nil || busy {
			return false
		}
		s.Phase, s.Progress, s.Error = UpdateDownloading, 0, ""
		return true
	})
	if up == nil {
		return errNoUpdate
	}
	if busy {
		return errInstalling
	}
	var last time.Time
	err := up.Install(ctx, func(downloaded, total int64) {
		if total <= 0 || (time.Since(last) < 100*time.Millisecond && downloaded < total) {
			return
		}
		last = time.Now()
		p := float64(downloaded) / float64(total)
		a.setUpdate(func(s *UpdateState) bool { s.Progress = p; return true })
	})
	if err != nil {
		log.Println("installing the update:", err)
		a.setUpdate(func(s *UpdateState) bool {
			s.Phase, s.Error = UpdateFailed, "下载或安装没有完成，原来的版本没有改动。可以重试，或者到 GitHub 下载安装包。"
			return true
		})
		return err
	}
	a.setUpdate(func(s *UpdateState) bool { s.Phase, s.Progress = UpdateRestarting, 1; return true })
	return nil
}

var errNoUpdate = errors.New("还没有找到新版本，先检查更新")

// UpdateState returns what there is to show of updating the app.
func (a *Atlas) UpdateState() UpdateState {
	return a.app.updateState()
}

// CheckForUpdates checks for a newer version now, as the user asked.
func (a *Atlas) CheckForUpdates(ctx context.Context) (UpdateState, error) {
	if err := a.app.checkUpdates(ctx); err != nil {
		if errors.Is(err, errUpdatesDisabled) {
			return a.app.updateState(), err
		}
		return a.app.updateState(), errors.New("检查更新失败，请确认能访问 GitHub 后再试")
	}
	return a.app.updateState(), nil
}

// InstallUpdate downloads the newer version found and starts the app again
// in it. It returns at once; updateChanged tells how it goes.
func (a *Atlas) InstallUpdate() error {
	a.app.upd.mu.Lock()
	found := a.app.upd.found != nil
	a.app.upd.mu.Unlock()
	if !found {
		return errNoUpdate
	}
	go func() {
		if a.app.installUpdate(context.Background()) != nil {
			return
		}
		// The page shows that the app starts again before it goes.
		time.Sleep(400 * time.Millisecond)
		mygo.App.Relaunch()
	}()
	return nil
}
