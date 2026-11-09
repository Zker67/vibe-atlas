package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/store"
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
	// wake tells watchUpdates that the schedule of checks changed.
	wake chan struct{}
}

// UpdateCheck is when the app checks for a newer version by itself.
type UpdateCheck string

// The schedules.
const (
	UpdateCheckOff      UpdateCheck = "off"      // 不自动检查
	UpdateCheckLaunch   UpdateCheck = "launch"   // 启动时检查
	UpdateCheckInterval UpdateCheck = "interval" // 定时检查：启动时，之后每隔 UpdateInterval 小时
)

// The hours between checks the user can choose, and the one out of the box.
var updateIntervals = []int{1, 6, 24}

const defaultUpdateInterval = 24

// updateCheckDelay is how long after launch the first check waits, clear
// of the start of the app.
const (
	updateCheckDelay   = 3 * time.Second
	updateCheckTimeout = 30 * time.Second
)

// A check or a download is tried this many times, a while apart, before it
// fails: a proxy on the way to GitHub answers 504 now and then.
var updateRetryWaits = []time.Duration{time.Second, 3 * time.Second}

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
	a.upd.wake = make(chan struct{}, 1)
	a.upd.mu.Unlock()
}

// rescheduleUpdates makes watchUpdates follow a new schedule at once.
func (a *app) rescheduleUpdates() {
	a.upd.mu.Lock()
	wake := a.upd.wake
	a.upd.mu.Unlock()
	if wake == nil {
		return
	}
	select {
	case wake <- struct{}{}:
	default:
	}
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

// watchUpdates checks for a newer version as the user chose: shortly
// after launch, then every few hours with 定时检查, or never. A change of
// the schedule takes effect at once; switching to 定时检查 checks when the
// last check is as old as the interval.
func (a *app) watchUpdates() {
	if !a.updateState().Enabled {
		return
	}
	time.Sleep(updateCheckDelay)
	a.upd.mu.Lock()
	wake := a.upd.wake
	a.upd.mu.Unlock()
	var last time.Time
	launched := false
	for {
		mode, every := a.atlas.updateSchedule()
		due := false
		switch mode {
		case UpdateCheckLaunch:
			due = !launched
		case UpdateCheckInterval:
			due = !launched || time.Since(last) >= every
		}
		launched = true
		if due {
			last = time.Now()
			if err := a.checkUpdates(context.Background()); err != nil {
				log.Println("checking for updates:", err)
			}
		}
		var next <-chan time.Time
		if mode == UpdateCheckInterval {
			next = time.After(time.Until(last.Add(every)))
		}
		select {
		case <-next:
		case <-wake:
		}
	}
}

// retry runs try until it succeeds, fails for a reason that trying again
// does not mend, or has been tried len(updateRetryWaits)+1 times.
func retry(ctx context.Context, try func() error) error {
	err := try()
	for _, wait := range updateRetryWaits {
		if err == nil || !transient(err) {
			return err
		}
		log.Println("trying again:", err)
		select {
		case <-ctx.Done():
			return err
		case <-time.After(wait):
		}
		err = try()
	}
	return err
}

// httpStatus finds the status of a failed request in the errors of MyGo's
// updater, "GET <url>: 504 Gateway Time-out".
var httpStatus = regexp.MustCompile(`GET \S+: (\d{3}) `)

func statusOf(err error) int {
	if m := httpStatus.FindStringSubmatch(err.Error()); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return 0
}

// transient reports whether err may go away when tried again: the
// network, or a server or proxy that is busy.
func transient(err error) bool {
	var ne net.Error
	if errors.As(err, &ne) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	n := statusOf(err)
	return n == 429 || n >= 500
}

// updateProblem says in words why reaching the updates failed.
func updateProblem(err error) string {
	var ne net.Error
	switch n := statusOf(err); {
	case n == 404:
		return "GitHub 上找不到更新文件，稍后再试"
	case n == 429 || n >= 500:
		return fmt.Sprintf("GitHub 暂时没有响应（%d），稍后再试；开着代理时，确认代理能访问 GitHub", n)
	case n != 0:
		return fmt.Sprintf("GitHub 拒绝了请求（%d），稍后再试", n)
	case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()):
		return "连接 GitHub 超时，检查网络后再试；开着代理时，确认代理能访问 GitHub"
	case errors.As(err, &ne):
		return "连不上 GitHub，检查网络后再试；开着代理时，确认代理能访问 GitHub"
	}
	return "更新文件不对（内容或签名没有通过校验），或者写不进程序所在的文件夹"
}

// updateSchedule returns when the app checks by itself, and how often with
// 定时检查.
func (a *Atlas) updateSchedule() (UpdateCheck, time.Duration) {
	db, err := a.store()
	if err != nil {
		return UpdateCheckLaunch, defaultUpdateInterval * time.Hour
	}
	return updateCheck(db), time.Duration(updateInterval(db)) * time.Hour
}

func updateCheck(db *store.Store) UpdateCheck {
	v, _, _ := db.Setting(keyUpdateCheck)
	switch UpdateCheck(v) {
	case UpdateCheckOff, UpdateCheckInterval:
		return UpdateCheck(v)
	}
	return UpdateCheckLaunch
}

func updateInterval(db *store.Store) int {
	v, _, _ := db.Setting(keyUpdateInterval)
	n, _ := strconv.Atoi(v)
	if slices.Contains(updateIntervals, n) {
		return n
	}
	return defaultUpdateInterval
}

// SetUpdateCheck changes when the app checks for a newer version by
// itself: never, at launch, or at launch and then every hours hours (1, 6
// or 24) with UpdateCheckInterval. hours is kept whatever the schedule.
func (a *Atlas) SetUpdateCheck(check UpdateCheck, hours int) (Settings, error) {
	switch check {
	case UpdateCheckOff, UpdateCheckLaunch, UpdateCheckInterval:
	default:
		return Settings{}, fmt.Errorf("不认识的检查方式：%s", check)
	}
	if !slices.Contains(updateIntervals, hours) {
		return Settings{}, fmt.Errorf("检查间隔只能是 1、6 或 24 小时")
	}
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := db.SetSetting(keyUpdateCheck, string(check)); err != nil {
		return Settings{}, err
	}
	if err := db.SetSetting(keyUpdateInterval, strconv.Itoa(hours)); err != nil {
		return Settings{}, err
	}
	a.app.rescheduleUpdates()
	a.settingsChanged()
	return a.Settings()
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
	var up *mygo.Update
	err := retry(ctx, func() error {
		ctx, cancel := context.WithTimeout(ctx, updateCheckTimeout)
		defer cancel()
		var err error
		up, err = mygo.Updater.Check(ctx)
		return err
	})
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
	err := retry(ctx, func() error {
		return up.Install(ctx, func(downloaded, total int64) {
			if total <= 0 || (time.Since(last) < 100*time.Millisecond && downloaded < total) {
				return
			}
			last = time.Now()
			p := float64(downloaded) / float64(total)
			a.setUpdate(func(s *UpdateState) bool { s.Progress = p; return true })
		})
	})
	if err != nil {
		log.Println("installing the update:", err)
		a.setUpdate(func(s *UpdateState) bool {
			s.Phase, s.Error = UpdateFailed, "没有更新成功，原来的版本没有改动："+updateProblem(err)+"。"
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
		return a.app.updateState(), errors.New("检查更新失败：" + updateProblem(err))
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
