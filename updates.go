package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/netproxy"

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

// A check or a download is tried this many times, longer and longer
// apart, before it fails: a proxy on the way to GitHub answers 504 now and
// then, and goes out through addresses whose API quota others used up.
var updateRetryWaits = []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second}

var errUpdatesDisabled = errors.New("这个版本不能自动更新：开发版本，或者程序所在的文件夹不能写入。可以到 GitHub 下载安装包")

// useUpdateSource sets where the updater reads the updates: the latest
// GitHub release (githubFeed); or, when VIBE_ATLAS_UPDATE_DIR names one, a
// local folder, for testing builds: the folder that `mygo build` writes,
// with its manifest and archives. The archives are checked against the
// app's public key either way.
func useUpdateSource() {
	if dir := os.Getenv("VIBE_ATLAS_UPDATE_DIR"); dir != "" {
		mygo.Updater.SetSource(dirSource(dir))
		return
	}
	mygo.Updater.SetSource(githubFeed{
		site: "https://github.com/" + updateRepo,
		api:  "https://api.github.com/repos/" + updateRepo,
	})
}

// updateRepo is the repository whose releases hold the updates, which
// updates.github in mygo.config.ts names too.
const updateRepo = "Zker67/vibe-atlas"

// githubFeed reads the updates of a repository's releases as MyGo does,
// with two changes. The manifest of the latest release is asked for with a
// query no cache has seen: GitHub answers with a redirect to the release,
// which a cache on the way kept for a while, so that the release before
// showed for a minute or two after a new one came out. And a file that
// github.com does not give, as a proxy that times out on its downloads
// (504) makes it, comes through GitHub's API instead, which leads to the
// same store of files another way. The files of a release never change.
type githubFeed struct {
	site string // https://github.com/<repo>
	api  string // https://api.github.com/repos/<repo>
}

func (f githubFeed) Manifest(ctx context.Context, prereleases bool) (io.ReadCloser, error) {
	name := "update-" + runtime.GOOS + "-" + runtime.GOARCH + ".json"
	rc, err := updateGet(ctx, connections(siteWait), f.site+"/releases/latest/download/"+name+"?t="+fresh(), "")
	if err == nil {
		return rc, nil
	}
	rc, apiErr := f.fromAPI(ctx, "latest", name)
	if apiErr == nil {
		log.Println("the manifest came through GitHub's API:", err)
		return rc, nil
	}
	return nil, errors.Join(err, apiErr)
}

func (f githubFeed) Open(ctx context.Context, url string) (io.ReadCloser, error) {
	rc, err := updateGet(ctx, connections(siteWait), url, "")
	if err == nil {
		return rc, nil
	}
	// https://github.com/<repo>/releases/download/<tag>/<name>
	tag, name, ok := strings.Cut(strings.TrimPrefix(url, f.site+"/releases/download/"), "/")
	if !ok || !strings.HasPrefix(url, f.site+"/releases/download/") || strings.Contains(name, "/") {
		return nil, err
	}
	rc, apiErr := f.fromAPI(ctx, "tags/"+tag, name)
	if apiErr == nil {
		log.Println("the update came through GitHub's API:", err)
		return rc, nil
	}
	return nil, errors.Join(err, apiErr)
}

// fromAPI downloads the file name of a release, "latest" or "tags/<tag>",
// through GitHub's API, on connections of its own: a proxy may send each
// connection out through another address, and one whose quota is used up
// stays so for the connection.
func (f githubFeed) fromAPI(ctx context.Context, release, name string) (io.ReadCloser, error) {
	rt := connections(0)
	rc, err := updateGet(ctx, rt, f.api+"/releases/"+release+"?t="+fresh(), "application/vnd.github+json")
	if err != nil {
		return nil, err
	}
	var r struct {
		Assets []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		} `json:"assets"`
	}
	err = json.NewDecoder(io.LimitReader(rc, 4<<20)).Decode(&r)
	rc.Close()
	if err != nil {
		return nil, fmt.Errorf("the release %s: %w", release, err)
	}
	for _, a := range r.Assets {
		if a.Name == name {
			return updateGet(ctx, rt, a.URL, "application/octet-stream")
		}
	}
	return nil, fmt.Errorf("the release %s has no %s", release, name)
}

// siteWait is how long github.com may take to start answering before the
// API is asked instead: a proxy that times out on its downloads answers
// 504 after 12 s or so.
var siteWait = 6 * time.Second // tests shorten it

// fresh returns a query value no cache has seen.
func fresh() string {
	return strconv.FormatInt(time.Now().UnixNano(), 36)
}

// updateTransport carries the requests of the updates: through the proxy
// of the system's settings, or of HTTPS_PROXY, as MyGo's own. Tests
// replace it.
var updateTransport = func() http.RoundTripper { return netproxy.Transport() }

// connections returns a transport of updateTransport's with connections of
// its own, which gives up when an answer does not start within wait, when
// not 0; the body may take longer.
func connections(wait time.Duration) http.RoundTripper {
	rt := updateTransport()
	if t, ok := rt.(*http.Transport); ok {
		t = t.Clone()
		t.ResponseHeaderTimeout = wait
		rt = t
	}
	return rt
}

// updateGet fetches a file of the updates over HTTPS through rt, asking
// for accept when not "". Its errors read as MyGo's, "GET <url>: 504
// Gateway Time-out", which statusOf reads.
func updateGet(ctx context.Context, rt http.RoundTripper, rawURL, accept string) (io.ReadCloser, error) {
	if !strings.HasPrefix(rawURL, "https://") {
		return nil, fmt.Errorf("refusing to download %s: updates need HTTPS", rawURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	// ASCII: GitHub's store of release files refuses other user agents.
	req.Header.Set("User-Agent", "mygo-updater")
	req.Header.Set("Cache-Control", "no-cache")
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := (&http.Client{Transport: rt}).Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", rawURL, resp.Status)
	}
	return resp.Body, nil
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
	useUpdateSource()
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
	case n == 403 || n == 429:
		return fmt.Sprintf("GitHub 限制了访问频率（%d），过一会儿再试", n)
	case n >= 500:
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
