package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/egoist/mygo"
)

// smokeUpdateVersion is the version the smoke test offers as an update.
const smokeUpdateVersion = "99.0.0"

// smokeUpdates checks updating in the webview. The page knows the version
// running. In a build with updates, a newer version shows in the toast at
// the bottom right with 去更新; its archive, signed with no key of the
// app's, is refused, the toast tells, the app's folder stays as it was,
// and 稍后 dismisses it. Builds without updates refuse to check.
func (a *app) smokeUpdates(main *mygo.Window) (map[string]any, error) {
	state := a.updateState()
	result := map[string]any{"version": state.Version, "enabled": state.Enabled}
	if state.Version == "" {
		return result, errors.New("updates: the version running is unknown")
	}
	// The schedule of checks: at launch out of the box, kept as chosen.
	prefs, err := a.atlas.Settings()
	if err != nil {
		return result, err
	}
	chosen, err := a.atlas.SetUpdateCheck(UpdateCheckInterval, 6)
	_, refused := a.atlas.SetUpdateCheck(UpdateCheckInterval, 2)
	result["schedule"] = map[string]any{"default": prefs.UpdateCheck, "chosen": chosen.UpdateCheck, "hours": chosen.UpdateInterval, "refused": refused != nil}
	if err != nil || prefs.UpdateCheck != UpdateCheckLaunch || chosen.UpdateCheck != UpdateCheckInterval || chosen.UpdateInterval != 6 || refused == nil {
		return result, errors.New("updates: the schedule of checks: " + jsonString(result["schedule"]))
	}
	if _, err := a.atlas.SetUpdateCheck(UpdateCheckLaunch, defaultUpdateInterval); err != nil {
		return result, err
	}
	if !state.Enabled {
		_, err := a.atlas.CheckForUpdates(context.Background())
		result["refused"] = errors.Is(err, errUpdatesDisabled)
		if result["refused"] != true {
			return result, errors.New("updates: a build without updates checked for them")
		}
		return result, nil
	}

	dir := filepath.Join(a.dataDir, "smoke-update")
	archive := "vibe-atlas-" + smokeUpdateVersion + "-" + runtime.GOOS + "-" + runtime.GOARCH + ".tar.gz"
	body := []byte("not the app")
	manifest, _ := json.Marshal(map[string]any{
		"version":   smokeUpdateVersion,
		"url":       "https://example.invalid/" + archive,
		"size":      len(body),
		"signature": base64.StdEncoding.EncodeToString(make([]byte, 64)),
	})
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return result, err
	}
	if err := os.WriteFile(filepath.Join(dir, archive), body, 0o644); err != nil {
		return result, err
	}
	if err := os.WriteFile(filepath.Join(dir, "update-"+runtime.GOOS+"-"+runtime.GOARCH+".json"), manifest, 0o644); err != nil {
		return result, err
	}
	// The app's folder, and the one it is in, where updates are unpacked.
	exe, _ := os.Executable()
	folders := []string{filepath.Dir(exe), filepath.Dir(filepath.Dir(exe))}
	var before [][]os.DirEntry
	for _, f := range folders {
		es, _ := os.ReadDir(f)
		before = append(before, es)
	}
	mygo.Updater.SetSource(dirSource(dir))
	defer useUpdateDirOrFeed()

	page, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 10000) => {
			for (let t = 0; t < ms; t += 50) {
				if (await check()) return true;
				await sleep(50);
			}
			return false;
		};
		const toast = () => document.querySelector("[data-sonner-toast].update-toast");
		const button = (text) => [...(toast()?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === text);
		const out = {};
		const state = await mygo.call("Atlas.CheckForUpdates");
		out.found = state.phase === "available" && state.available === "`+smokeUpdateVersion+`";
		out.toastShows = await until(() => toast()?.textContent.includes("发现新版本 `+smokeUpdateVersion+`") && button("去更新") && button("稍后"));
		button("去更新")?.click();
		out.failureShows = await until(() => toast()?.textContent.includes("更新失败") && button("重试"));
		out.failed = (await mygo.call("Atlas.UpdateState")).phase === "failed";
		button("稍后")?.click();
		out.dismissed = await until(() => !toast());
		return out;
	`)
	result["page"] = page
	if err != nil {
		return result, err
	}
	for _, k := range []string{"found", "toastShows", "failureShows", "failed", "dismissed"} {
		if page[k] != true {
			return result, errors.New("updates: " + k + " failed: " + jsonString(page))
		}
	}
	result["folderKept"] = true
	for i, f := range folders {
		after, _ := os.ReadDir(f)
		if !sameEntries(before[i], after) {
			result["folderKept"] = false
		}
	}
	if result["folderKept"] != true {
		return result, errors.New("updates: the refused update changed the app's folder")
	}
	a.setUpdate(func(s *UpdateState) bool {
		s.Phase, s.Available, s.Error = UpdateIdle, "", ""
		a.upd.found = nil
		return true
	})
	return result, nil
}

// useUpdateDirOrFeed puts back the source the app started with.
func useUpdateDirOrFeed() {
	mygo.Updater.SetSource(nil)
	useUpdateDir()
}

func sameEntries(a, b []os.DirEntry) bool {
	names := func(es []os.DirEntry) string {
		var s []string
		for _, e := range es {
			s = append(s, e.Name())
		}
		return strings.Join(s, "\n")
	}
	return names(a) == names(b)
}

// smokeInstallUpdate is the smoke test of VIBE_ATLAS_SMOKE_UPDATE=install:
// with VIBE_ATLAS_UPDATE_DIR naming the folder a newer build wrote, it
// finds the newer version there and installs it in place of this copy,
// without starting it. Starting the copy again shows the version.
func (a *app) smokeInstallUpdate() (map[string]any, error) {
	ctx := context.Background()
	result := map[string]any{"from": mygo.App.Version()}
	if err := a.checkUpdates(ctx); err != nil {
		return result, err
	}
	s := a.updateState()
	result["found"] = s.Available
	if s.Phase != UpdateAvailable {
		return result, errors.New("updates: no newer version in VIBE_ATLAS_UPDATE_DIR")
	}
	if err := a.installUpdate(ctx); err != nil {
		return result, err
	}
	result["installed"] = a.updateState().Phase == UpdateRestarting
	return result, nil
}
