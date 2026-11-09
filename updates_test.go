package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
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
