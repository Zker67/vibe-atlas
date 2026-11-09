package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// The folder of VIBE_ATLAS_UPDATE_DIR serves the manifest of the running
// platform and the files it names by the last part of their URL, and
// nothing outside the folder.
func TestDirSource(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "updates")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(path, body string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(dir, "update-"+runtime.GOOS+"-"+runtime.GOARCH+".json"), `{"version":"9.9.9"}`)
	write(filepath.Join(dir, "vibe-atlas-9.9.9.tar.gz"), "archive")
	write(filepath.Join(root, "secret.txt"), "outside")

	src := dirSource(dir)
	read := func(rc io.ReadCloser, err error) (string, error) {
		if err != nil {
			return "", err
		}
		defer rc.Close()
		b, err := io.ReadAll(rc)
		return string(b), err
	}
	ctx := context.Background()

	if got, err := read(src.Manifest(ctx, false)); err != nil || got != `{"version":"9.9.9"}` {
		t.Fatalf("manifest = %q, %v", got, err)
	}
	if got, err := read(src.Open(ctx, "https://github.com/Zker67/vibe-atlas/releases/download/v9.9.9/vibe-atlas-9.9.9.tar.gz")); err != nil || got != "archive" {
		t.Fatalf("archive = %q, %v", got, err)
	}
	for _, url := range []string{"../secret.txt", "https://example.com/a/../../secret.txt", "https://example.com/", ".."} {
		if got, err := read(src.Open(ctx, url)); err == nil && got == "outside" {
			t.Fatalf("Open(%q) read a file outside the folder", url)
		}
	}
	if _, err := src.Open(ctx, "https://example.com/missing.tar.gz"); err == nil {
		t.Fatal("Open of a missing file succeeded")
	}
}

// A check finds nothing to do while an update downloads, and a second
// install of the one downloading is refused, so that it is not installed
// twice.
func TestUpdatePhases(t *testing.T) {
	a := &app{}
	a.upd.state = UpdateState{Version: "1.0.0", Enabled: false, Phase: UpdateIdle}
	if err := a.checkUpdates(context.Background()); err != errUpdatesDisabled {
		t.Fatalf("check without updates = %v", err)
	}
	if err := a.installUpdate(context.Background()); err != errNoUpdate {
		t.Fatalf("install with nothing found = %v", err)
	}
	for _, p := range []UpdatePhase{UpdateDownloading, UpdateRestarting} {
		if !p.busy() {
			t.Fatalf("%s is not busy", p)
		}
	}
	for _, p := range []UpdatePhase{UpdateIdle, UpdateAvailable, UpdateFailed, UpdateChecking} {
		if p.busy() {
			t.Fatalf("%s is busy", p)
		}
	}
}

// The schedule of checks is at launch out of the box, and a value the app
// does not know reads as the default.
func TestUpdateScheduleDefaults(t *testing.T) {
	db := openStore(t)
	if got := updateCheck(db); got != UpdateCheckLaunch {
		t.Fatalf("check = %q, want launch", got)
	}
	if got := updateInterval(db); got != defaultUpdateInterval {
		t.Fatalf("interval = %d, want %d", got, defaultUpdateInterval)
	}
	for k, v := range map[string]string{keyUpdateCheck: "hourly", keyUpdateInterval: "5"} {
		if err := db.SetSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}
	if updateCheck(db) != UpdateCheckLaunch || updateInterval(db) != defaultUpdateInterval {
		t.Fatalf("bad values read as %q, %d", updateCheck(db), updateInterval(db))
	}
	for k, v := range map[string]string{keyUpdateCheck: "interval", keyUpdateInterval: "6"} {
		if err := db.SetSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}
	if updateCheck(db) != UpdateCheckInterval || updateInterval(db) != 6 {
		t.Fatalf("saved values read as %q, %d", updateCheck(db), updateInterval(db))
	}
}

func TestSetUpdateCheckRejects(t *testing.T) {
	a := &Atlas{app: &app{}}
	if _, err := a.SetUpdateCheck("weekly", 24); err == nil {
		t.Fatal("an unknown schedule was taken")
	}
	if _, err := a.SetUpdateCheck(UpdateCheckInterval, 2); err == nil {
		t.Fatal("an interval of 2 hours was taken")
	}
}

// A proxy's 504 is tried again and said in words; a refused signature is
// not tried again.
func TestUpdateErrors(t *testing.T) {
	busy := errors.New("mygo: checking for updates: GET https://github.com/Zker67/vibe-atlas/releases/latest/download/update-windows-amd64.json: 504 Gateway Time-out")
	missing := errors.New("mygo: checking for updates: GET https://example.com/update.json: 404 Not Found")
	unsigned := errors.New("mygo: installing the update: the update is not signed with the app's key")
	if !transient(busy) || transient(missing) || transient(unsigned) {
		t.Fatal("transient misjudged an error")
	}
	if got := updateProblem(busy); !strings.Contains(got, "504") || !strings.Contains(got, "代理") {
		t.Fatalf("504 said as %q", got)
	}
	if got := updateProblem(missing); !strings.Contains(got, "找不到") {
		t.Fatalf("404 said as %q", got)
	}
	if got := updateProblem(unsigned); !strings.Contains(got, "签名") {
		t.Fatalf("a refused signature said as %q", got)
	}
	if got := updateProblem(fmt.Errorf("checking: %w", context.DeadlineExceeded)); !strings.Contains(got, "超时") {
		t.Fatalf("a timeout said as %q", got)
	}

	saved := updateRetryWaits
	updateRetryWaits = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond}
	t.Cleanup(func() { updateRetryWaits = saved })
	tries := 0
	if err := retry(context.Background(), func() error {
		tries++
		if tries < 3 {
			return busy
		}
		return nil
	}); err != nil || tries != 3 {
		t.Fatalf("retry after 504: err %v, %d tries", err, tries)
	}
	tries = 0
	if err := retry(context.Background(), func() error { tries++; return busy }); err != busy || tries != 5 {
		t.Fatalf("retry gave up with %v after %d tries", err, tries)
	}
	tries = 0
	if err := retry(context.Background(), func() error { tries++; return unsigned }); err != unsigned || tries != 1 {
		t.Fatalf("a refused signature was tried %d times", tries)
	}
}

// Each check asks for the manifest with a query no cache has seen, as
// mygo-updater. When github.com answers 504, as a proxy on the way does,
// the manifest and the archive come through the API; a 504 of both reads
// as one.
func TestGithubFeed(t *testing.T) {
	manifest := "update-" + runtime.GOOS + "-" + runtime.GOARCH + ".json"
	var queries []string
	siteDown, siteSlow := false, false
	var srv *httptest.Server
	srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "mygo-updater" {
			t.Errorf("User-Agent = %q", r.Header.Get("User-Agent"))
		}
		p := r.URL.Path
		if strings.HasPrefix(p, "/site/") && siteSlow {
			time.Sleep(300 * time.Millisecond)
		}
		switch {
		case strings.HasPrefix(p, "/site/") && siteDown:
			w.WriteHeader(http.StatusGatewayTimeout)
		case p == "/site/releases/latest/download/"+manifest:
			queries = append(queries, r.URL.Query().Get("t"))
			io.WriteString(w, `{"version":"9.9.9"}`)
		case p == "/site/releases/download/v9.9.9/archive.tar.gz":
			io.WriteString(w, "archive")
		case p == "/api/releases/latest" || p == "/api/releases/tags/v9.9.9":
			if r.URL.Query().Get("t") == "" {
				t.Errorf("%s without a fresh query", p)
			}
			fmt.Fprintf(w, `{"assets":[{"name":%q,"url":%q},{"name":"archive.tar.gz","url":%q}]}`,
				manifest, srv.URL+"/api/assets/1", srv.URL+"/api/assets/2")
		case p == "/api/assets/1" && r.Header.Get("Accept") == "application/octet-stream":
			io.WriteString(w, `{"version":"9.9.9","via":"api"}`)
		case p == "/api/assets/2" && r.Header.Get("Accept") == "application/octet-stream":
			io.WriteString(w, "archive via api")
		default:
			w.WriteHeader(http.StatusGatewayTimeout)
		}
	}))
	defer srv.Close()
	saved := updateTransport
	updateTransport = func() http.RoundTripper { return srv.Client().Transport }
	t.Cleanup(func() { updateTransport = saved })

	ctx := context.Background()
	feed := githubFeed{site: srv.URL + "/site", api: srv.URL + "/api"}
	read := func(rc io.ReadCloser, err error) string {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		defer rc.Close()
		b, _ := io.ReadAll(rc)
		return string(b)
	}
	for range 2 {
		if got := read(feed.Manifest(ctx, false)); got != `{"version":"9.9.9"}` {
			t.Fatalf("manifest = %q", got)
		}
	}
	if len(queries) != 2 || queries[0] == "" || queries[0] == queries[1] {
		t.Fatalf("queries = %q, want two different ones", queries)
	}
	archive := srv.URL + "/site/releases/download/v9.9.9/archive.tar.gz"
	if got := read(feed.Open(ctx, archive)); got != "archive" {
		t.Fatalf("archive = %q", got)
	}

	savedWait := siteWait
	siteWait = 50 * time.Millisecond
	t.Cleanup(func() { siteWait = savedWait })
	siteSlow = true
	if got := read(feed.Manifest(ctx, false)); !strings.Contains(got, `"via":"api"`) {
		t.Fatalf("manifest with github.com slow = %q", got)
	}
	siteSlow, siteDown = false, true
	if got := read(feed.Manifest(ctx, false)); !strings.Contains(got, `"via":"api"`) {
		t.Fatalf("manifest with github.com down = %q", got)
	}
	if got := read(feed.Open(ctx, archive)); got != "archive via api" {
		t.Fatalf("archive with github.com down = %q", got)
	}
	_, err := feed.Open(ctx, srv.URL+"/site/releases/download/v9.9.9/missing.tar.gz")
	if err == nil || statusOf(err) != 504 || !transient(err) {
		t.Fatalf("a 504 reads as %v", err)
	}
	if _, err := feed.Open(ctx, "http://example.com/archive.tar.gz"); err == nil {
		t.Fatal("a download without HTTPS was made")
	}
}

// The manifest of the latest release on GitHub, read as the app reads it.
// Set VIBE_ATLAS_LIVE=1 to run it; it needs the network.
func TestGithubFeedLive(t *testing.T) {
	if os.Getenv("VIBE_ATLAS_LIVE") == "" {
		t.Skip("set VIBE_ATLAS_LIVE=1 to read GitHub")
	}
	feed := githubFeed{site: "https://github.com/" + updateRepo, api: "https://api.github.com/repos/" + updateRepo}
	var body []byte
	err := retry(context.Background(), func() error {
		rc, err := feed.Manifest(context.Background(), false)
		if err != nil {
			return err
		}
		defer rc.Close()
		body, err = io.ReadAll(rc)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("latest manifest: %.60s", body)
	if !strings.Contains(string(body), `"version"`) {
		t.Fatalf("not a manifest: %.200s", body)
	}
}
