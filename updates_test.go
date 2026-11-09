package main

import (
	"context"
	"errors"
	"fmt"
	"io"
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
	updateRetryWaits = []time.Duration{time.Millisecond, time.Millisecond}
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
	if err := retry(context.Background(), func() error { tries++; return busy }); err != busy || tries != 3 {
		t.Fatalf("retry gave up with %v after %d tries", err, tries)
	}
	tries = 0
	if err := retry(context.Background(), func() error { tries++; return unsigned }); err != unsigned || tries != 1 {
		t.Fatalf("a refused signature was tried %d times", tries)
	}
}
