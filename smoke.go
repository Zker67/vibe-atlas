package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/egoist/mygo"
)

// smokeTest checks a build end to end without showing a window: both pages
// load, call Go, and follow its events. It runs when VIBE_ATLAS_SMOKE_REPORT
// names the file to write its result to, as JSON; set VIBE_ATLAS_DATA_DIR
// too, so that it works on a database of its own. The app exits with 0
// when every check passed.
func (a *app) smokeTest(main, capture *mygo.Window) {
	report := map[string]any{"ok": false}
	finish := func(err error, step string) {
		if err != nil {
			report["failedStep"] = step
			report["error"] = err.Error()
		} else {
			report["ok"] = true
		}
		report["version"] = mygo.App.Version()
		shortcut, problem := a.keyState(&a.capKey)
		report["shortcut"] = shortcut
		report["shortcutRegistered"] = problem == ""
		data, _ := json.MarshalIndent(report, "", "  ")
		_ = os.WriteFile(a.smokeReport, data, 0o644)
		mygo.GlobalShortcut.UnregisterAll()
		if err != nil {
			mygo.App.Exit(1)
		}
		mygo.App.Exit(0)
	}

	start := time.Now()
	if err := waitFor(main, "[data-atlas-ready]"); err != nil {
		finish(err, "main page loads")
		return
	}
	report["mainReadyMs"] = time.Since(start).Milliseconds()
	if os.Getenv("VIBE_ATLAS_SMOKE_UPDATE") == "install" {
		installed, err := a.smokeInstallUpdate()
		report["installUpdate"] = installed
		finish(err, "install update")
		return
	}
	if os.Getenv("VIBE_ATLAS_SMOKE_LOGIN") == "1" {
		login, err := a.smokeOpenAtLogin(main)
		report["openAtLogin"] = login
		finish(err, "open at login")
		return
	}
	if err := waitFor(capture, "[data-capture-ready]"); err != nil {
		finish(err, "capture page loads")
		return
	}
	report["captureReadyMs"] = time.Since(start).Milliseconds()

	// The page calls Go, and shows what the Changed events tell it.
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const name = "冒烟测试项目";
		const project = await mygo.call("Atlas.CreateProject", name);
		const module = await mygo.call("Atlas.CreateModule", project.id, "冒烟模块");
		const item = await mygo.call("Atlas.CreateItem", { projectId: project.id, moduleId: module.id, type: "bug", title: "冒烟测试条目" });
		await mygo.call("Atlas.SetItemStatus", item.id, "doing");
		await mygo.call("Atlas.SetItemNote", item.id, "## 备注\n- [ ] 任务");
		const overview = await mygo.call("Atlas.Overview", project.id);
		const seen = async (text) => {
			for (let i = 0; i < 100; i++) {
				if (document.body.innerText.includes(text)) return true;
				await new Promise((r) => setTimeout(r, 100));
			}
			return false;
		};
		let rejected = "";
		try { await mygo.call("Atlas.CreateProject", name); } catch (e) { rejected = e.message; }
		return {
			projectShown: await seen(name),
			itemShown: await seen("冒烟测试条目"),
			doing: overview.totals.doing,
			duplicateRejected: rejected,
		};
	`)
	if err != nil {
		finish(err, "main page calls Go")
		return
	}
	report["main"] = result
	if result["projectShown"] != true || result["itemShown"] != true {
		finish(errors.New("the main page did not show what it created"), "main page follows events")
		return
	}
	if result["doing"] != float64(1) || result["duplicateRejected"] == "" {
		finish(errors.New("unexpected results: "+strconv.Quote(jsonString(result))), "main page calls Go")
		return
	}

	// Quick capture saves to the project it starts with.
	captured, err := mygo.EvalAs[map[string]any](capture.Page(), `
		const item = await mygo.call("Atlas.CaptureItem", { projectId: (await mygo.call("Atlas.Projects"))[0].id, moduleId: 0, type: "feature", title: "从小窗记下的" });
		return { id: item.id, status: item.status };
	`)
	if err != nil {
		finish(err, "capture page calls Go")
		return
	}
	report["capture"] = captured
	panel, err := a.smokeCapturePanel(capture)
	report["capturePanel"] = panel
	if err != nil {
		finish(err, "capture panel")
		return
	}

	// The effects are off out of the box; turned on, the main window loads
	// the background picked, and quick capture never does.
	effects, err := mygo.EvalAs[map[string]any](main.Page(), `
		const until = async (check) => {
			for (let i = 0; i < 100; i++) {
				if (check()) return true;
				await new Promise((r) => setTimeout(r, 100));
			}
			return false;
		};
		const layer = (id) => document.querySelector('[data-effects-layer="' + id + '"] canvas');
		const before = await mygo.call("Atlas.Settings");
		const result = {
			titleBar: !!document.querySelector("[data-titlebar]"),
			offByDefault: before.effects === false,
			noLayerWhenOff: !document.querySelector("[data-effects-layer]") && !document.documentElement.hasAttribute("data-effects"),
		};
		await mygo.call("Atlas.SetEffects", true);
		result.gridShown = await until(() => layer("grid") && document.documentElement.hasAttribute("data-effects"));
		await mygo.call("Atlas.SetBackground", "waves");
		result.wavesShown = await until(() => layer("waves"));
		return result;
	`)
	if err != nil {
		finish(err, "effects turn on")
		return
	}
	report["effects"] = effects
	for _, k := range []string{"titleBar", "offByDefault", "noLayerWhenOff", "gridShown", "wavesShown"} {
		if effects[k] != true {
			finish(errors.New("effects: "+k+" failed: "+jsonString(effects)), "effects turn on")
			return
		}
	}
	captureEffects, err := mygo.EvalAs[map[string]any](capture.Page(), `
		return {
			layer: !!document.querySelector("[data-effects-layer]"),
			attr: document.documentElement.hasAttribute("data-effects"),
			reactBits: performance.getEntriesByType("resource").some((e) => /DotGrid|PatternWaves|effects-layer/.test(e.name)),
		};
	`)
	if err != nil {
		finish(err, "capture stays without effects")
		return
	}
	report["captureEffects"] = captureEffects
	if captureEffects["layer"] != false || captureEffects["attr"] != false || captureEffects["reactBits"] != false {
		finish(errors.New("quick capture loaded effects: "+jsonString(captureEffects)), "capture stays without effects")
		return
	}
	off, err := mygo.EvalAs[bool](main.Page(), `
		await mygo.call("Atlas.SetEffects", false);
		for (let i = 0; i < 100; i++) {
			if (!document.querySelector("[data-effects-layer]") && !document.documentElement.hasAttribute("data-effects")) return true;
			await new Promise((r) => setTimeout(r, 100));
		}
		return false;
	`)
	if err != nil || !off {
		finish(errors.Join(err, errors.New("the effects stay after turning them off")), "effects turn off")
		return
	}

	look, err := a.smokeLook(main, capture)
	report["look"] = look
	if err != nil {
		finish(err, "look")
		return
	}

	boss, err := a.smokeBossKey(main)
	report["bossKey"] = boss
	if err != nil {
		finish(err, "boss key")
		return
	}

	pictures, err := a.smokeImages(main)
	report["images"] = pictures
	if err != nil {
		finish(err, "images")
		return
	}

	icons, err := a.smokeIcons(main)
	report["icons"] = icons
	if err != nil {
		finish(err, "icons")
		return
	}

	pasted, err := a.smokePaste(main)
	report["paste"] = pasted
	if err != nil {
		finish(err, "paste into a note")
		return
	}

	immersive, err := a.smokeImmersive(main)
	report["immersive"] = immersive
	if err != nil {
		finish(err, "immersive editing")
		return
	}

	linked, err := a.smokeSessions(main)
	report["sessions"] = linked
	if err != nil {
		finish(err, "pick a session")
		return
	}

	menus, err := a.smokeMenu(main)
	report["menu"] = menus
	if err != nil {
		finish(err, "right-click menus")
		return
	}

	folded, err := a.smokeSidebar(main)
	report["sidebar"] = folded
	if err != nil {
		finish(err, "fold the sidebar")
		return
	}

	selected, err := a.smokeSelect(main)
	report["select"] = selected
	if err != nil {
		finish(err, "select several")
		return
	}

	moved, err := a.smokeMotion(main)
	report["motion"] = moved
	if err != nil {
		finish(err, "motion")
		return
	}

	trashed, err := a.smokeTrash(main)
	report["trash"] = trashed
	if err != nil {
		finish(err, "trash")
		return
	}

	flowed, err := a.smokeFlow(main)
	report["flow"] = flowed
	if err != nil {
		finish(err, "prerequisites and the flow chart")
		return
	}

	updated, err := a.smokeUpdates(main)
	report["updates"] = updated
	if err != nil {
		finish(err, "updates")
		return
	}
	finish(nil, "")
}

// smokeBossKey checks the boss key: not set out of the box, the shortcut of
// quick capture and keys without Ctrl, Alt or Win are refused, a set one is
// registered, recording a shortcut releases it and takes it back, and
// clearing it lets it go.
func (a *app) smokeBossKey(main *mygo.Window) (map[string]any, error) {
	const accel = "Ctrl+Alt+Shift+F12"
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const refused = async (shortcut) => {
			try { await mygo.call("Atlas.SetBossKey", shortcut); return ""; } catch (e) { return e.message; }
		};
		const s = await mygo.call("Atlas.Settings");
		const result = { unsetByDefault: s.bossKey === "" };
		result.sameRefused = await refused(s.shortcut);
		result.plainRefused = await refused("Shift+B");
		const set = await mygo.call("Atlas.SetBossKey", `+strconv.Quote(accel)+`);
		result.set = set.bossKey;
		result.setError = set.bossKeyError;
		result.captureRefused = await (async () => {
			try { await mygo.call("Atlas.SetShortcut", `+strconv.Quote(accel)+`); return ""; } catch (e) { return e.message; }
		})();
		return result;
	`)
	if err != nil {
		return result, err
	}
	if result["unsetByDefault"] != true || result["sameRefused"] == "" || result["plainRefused"] == "" ||
		result["captureRefused"] == "" || result["set"] != accel || result["setError"] != "" {
		return result, errors.New("boss key: unexpected results: " + jsonString(result))
	}
	result["registered"] = mygo.GlobalShortcut.IsRegistered(accel)
	if err := a.atlas.PauseShortcut(true); err != nil {
		return result, err
	}
	result["releasedWhileRecording"] = !mygo.GlobalShortcut.IsRegistered(accel)
	if err := a.atlas.PauseShortcut(false); err != nil {
		return result, err
	}
	result["takenBack"] = mygo.GlobalShortcut.IsRegistered(accel)
	s, err := a.atlas.SetBossKey("")
	if err != nil {
		return result, err
	}
	result["cleared"] = s.BossKey == "" && !mygo.GlobalShortcut.IsRegistered(accel)
	for _, k := range []string{"registered", "releasedWhileRecording", "takenBack", "cleared"} {
		if result[k] != true {
			return result, errors.New("boss key: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}

// smokeLook checks the look of the main window: a picture loads from the
// wallpaper scheme and frosts the frame and panel by itself, the glass
// follows its settings, and the window takes its opacity. Quick capture
// shows none of it.
func (a *app) smokeLook(main, capture *mygo.Window) (map[string]any, error) {
	db, err := a.atlas.store()
	if err != nil {
		return nil, err
	}
	src := filepath.Join(a.dataDir, "smoke-wallpaper.png")
	img := image.NewRGBA(image.Rect(0, 0, 64, 40))
	for i := range img.Pix {
		img.Pix[i] = 0x80
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	if err := os.WriteFile(src, buf.Bytes(), 0o644); err != nil {
		return nil, err
	}
	defer os.Remove(src)
	if err := saveWallpaper(db, a.dataDir, src); err != nil {
		return nil, err
	}
	a.atlas.settingsChanged()

	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const until = async (check) => {
			for (let i = 0; i < 100; i++) {
				if (check()) return true;
				await new Promise((r) => setTimeout(r, 100));
			}
			return false;
		};
		const html = document.documentElement;
		const layer = () => document.querySelector("[data-wallpaper-layer]");
		const s = await mygo.call("Atlas.Settings");
		const result = { url: s.wallpaper.url };
		// The app's own scroll bars: the system's hidden, the box still scrolling natively.
		const viewport = document.querySelector('[data-slot="scroller"] .scroller-viewport');
		result.scroller = !!viewport && getComputedStyle(viewport).scrollbarWidth === "none" && getComputedStyle(viewport).overflowY === "auto";
		// 使用说明 is longer than its dialog: its bar is in sight, with a thumb.
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true }));
		const helpBar = () => document.querySelector('[data-slot="dialog-content"] .scroller-bar[data-always]');
		result.helpBarShown = await until(() => {
			const bar = helpBar();
			if (!bar || bar.hasAttribute("data-hidden") || getComputedStyle(bar).visibility !== "visible") return false;
			return bar.querySelector(".scroller-thumb").getBoundingClientRect().height >= 24;
		});
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		result.helpClosed = await until(() => !helpBar());
		result.layerShown = await until(() => layer() && html.hasAttribute("data-effects"));
		try {
			const res = await fetch(s.wallpaper.url);
			result.fetched = { status: res.status, type: res.headers.get("content-type"), bytes: (await res.arrayBuffer()).byteLength };
		} catch (e) {
			result.fetched = String(e);
		}
		const img = new Image();
		img.src = s.wallpaper.url;
		try {
			await img.decode();
			result.loaded = img.naturalWidth === 64 && img.naturalHeight === 40;
		} catch (e) {
			result.loaded = false;
			result.loadError = String(e);
		}
		await mygo.call("Atlas.SetGlass", { blur: 12, panel: 40, frame: 30 });
		result.glassApplied = await until(() =>
			html.style.getPropertyValue("--glass-panel") === "40%" && html.style.getPropertyValue("--glass-blur") === "12px");
		result.panelFilter = getComputedStyle(document.querySelector(".app-panel")).backdropFilter;
		const clamped = await mygo.call("Atlas.SetGlass", { blur: 500, panel: -1, frame: 30 });
		result.glassClamped = clamped.glass.blur === 60 && clamped.glass.panel === 0;
		await mygo.call("Atlas.SetGlass", s.lookDefaults.glass);
		await mygo.call("Atlas.SetWallpaperLook", { ...s.wallpaper.look, enabled: false });
		result.hiddenWhenOff = await until(() => !layer() && !html.hasAttribute("data-effects"));
		await mygo.call("Atlas.SetWallpaperLook", { ...s.wallpaper.look, enabled: true });
		result.windowOpacity = (await mygo.call("Atlas.SetWindowOpacity", 70)).windowOpacity;
		return result;
	`)
	if err != nil {
		return result, err
	}
	result["nativeOpacity"] = main.Opacity()
	for _, k := range []string{"scroller", "helpBarShown", "helpClosed", "layerShown", "loaded", "glassApplied", "glassClamped", "hiddenWhenOff"} {
		if result[k] != true {
			return result, errors.New("look: " + k + " failed: " + jsonString(result))
		}
	}
	if result["windowOpacity"] != float64(70) || main.Opacity() < 0.69 || main.Opacity() > 0.71 {
		return result, errors.New("look: the window did not take its opacity: " + jsonString(result))
	}

	inCapture, err := mygo.EvalAs[map[string]any](capture.Page(), `
		return {
			layer: !!document.querySelector("[data-wallpaper-layer]"),
			attr: document.documentElement.hasAttribute("data-effects"),
			glass: document.documentElement.style.getPropertyValue("--glass-panel"),
		};
	`)
	if err != nil {
		return result, err
	}
	result["capture"] = inCapture
	if inCapture["layer"] != false || inCapture["attr"] != false || inCapture["glass"] != "" {
		return result, errors.New("look: quick capture took the main window's look: " + jsonString(inCapture))
	}
	if _, err := a.atlas.SetWindowOpacity(100); err != nil {
		return result, err
	}
	if _, err := a.atlas.ClearWallpaper(); err != nil {
		return result, err
	}
	if w := wallpaper(db, a.dataDir); w.URL != "" {
		return result, errors.New("look: the wallpaper stays after clearing it")
	}
	return result, nil
}

func jsonString(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

// waitFor waits until the page of w has an element matching selector.
func waitFor(w *mygo.Window, selector string) error {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		ok, err := mygo.EvalAs[bool](w.Page(), "return !!document.querySelector("+strconv.Quote(selector)+")")
		if err == nil && ok {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("timed out waiting for " + selector)
}
