package main

import (
	_ "embed"
	"fmt"
	"log"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/store"
)

//go:embed resources/tray.png
var trayIcon []byte

// defaultShortcut summons quick capture out of the box. Alt+Space belongs
// to the window menu and launchers, Ctrl+Space to input methods.
const defaultShortcut = "Ctrl+Alt+Space"

// The windows' colors until their pages paint: the pages' backgrounds
// (--background in src/index.css).
const (
	mainBackground    = "light-dark(#f4f3f1, #020202)"
	captureBackground = "light-dark(#f4f3f1, #020202)"
)

// The quick capture panel's width, and the most height it grows to.
const (
	captureWidth     = 640
	captureMaxHeight = 600
)

// titleBarHeight is the height of the main window's title bar, which the
// page draws (src/components/app/title-bar.tsx) under the window buttons.
const titleBarHeight = 40

// app is the running Vibe Atlas: its windows, its tray icon and its global
// shortcut.
type app struct {
	atlas   *Atlas
	dataDir string
	// smokeReport, when set, is the file a smoke test of the build writes
	// its result to, without showing any window (see smoke.go).
	smokeReport string

	mu        sync.Mutex // guards the fields below; never held across calls to MyGo
	main      *mygo.Window
	capture   *mygo.Window
	quitting  bool
	shownAt   time.Time // when the capture panel last showed
	shortcut  string
	scError   string
	scActive  bool // the shortcut is registered
	scPaused  bool // released while the user records another
	shortcutM sync.Mutex
}

func (a *app) setQuitting() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
}

func (a *app) isQuitting() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.quitting
}

func (a *app) windows() (main, capture *mygo.Window) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.main, a.capture
}

// start opens the database and shows the app, once MyGo is ready.
func (a *app) start() {
	db, err := store.Open(filepath.Join(a.dataDir, "vibe-atlas.db"))
	if err != nil {
		go func() {
			mygo.Dialog.Error("Vibe Atlas 打不开数据文件", err.Error())
			mygo.App.Quit()
		}()
		return
	}
	a.atlas.setStore(db)
	mygo.App.OnQuit(func() { db.Close() })
	applyTheme(a.atlas.theme(db))

	// Before the windows: the main page loads the wallpaper from it.
	if err := mygo.Protocol.HandleFunc(wallpaperScheme, a.serveWallpaper); err != nil {
		log.Println("wallpaper scheme:", err)
	}

	throttling := mygo.ThrottlingOn
	if a.smokeReport != "" {
		throttling = mygo.ThrottlingOff // the smoke test drives hidden pages
	}
	main := mygo.NewWindow(mygo.WindowOptions{
		Title:           "Vibe Atlas",
		URL:             "/",
		Width:           1240,
		Height:          780,
		MinWidth:        960,
		MinHeight:       600,
		StateKey:        "main",
		Hidden:          true,
		TitleBarStyle:   mygo.TitleBarHidden,
		TitleBarHeight:  titleBarHeight,
		BackgroundColor: mainBackground,
		Opacity:         float64(windowOpacity(db)) / 100,
		Page:            mygo.PageOptions{BackgroundThrottling: throttling},
	})
	capture := mygo.NewWindow(mygo.WindowOptions{
		Title:     "快速记录",
		URL:       "/capture",
		Panel:     true,
		Hidden:    true,
		Frameless: true,
		Width:     captureWidth,
		Height:    120,
		// The panel is as tall as what it shows: one line to type in,
		// growing as the details or a list open, and shrinking back.
		FitContent:      true,
		MinWidth:        captureWidth,
		MaxWidth:        captureWidth,
		MinHeight:       48,
		MaxHeight:       captureMaxHeight,
		DisableResize:   true,
		CornerRadius:    12,
		BackgroundColor: captureBackground,
		// The panel waits hidden: keep its page awake, so it takes the
		// first keys as soon as it shows.
		Page: mygo.PageOptions{BackgroundThrottling: mygo.ThrottlingOff},
	})
	a.mu.Lock()
	a.main, a.capture = main, capture
	a.mu.Unlock()

	main.OnClose(func(e *mygo.CloseEvent) {
		if !a.isQuitting() {
			e.PreventDefault() // closing keeps the app in the tray
			main.Hide()
		}
	})
	capture.OnClose(func(e *mygo.CloseEvent) { // Alt+F4; the page hides itself on Escape
		if !a.isQuitting() {
			e.PreventDefault()
			capture.Hide()
		}
	})
	capture.OnBlur(func() {
		a.mu.Lock()
		justShown := time.Since(a.shownAt) < 400*time.Millisecond
		a.mu.Unlock()
		if !justShown { // a tray menu closing can take the focus back at once
			capture.Hide()
		}
	})
	guardPage(main)
	guardPage(capture)

	shortcut, ok, _ := db.Setting(keyShortcut)
	if !ok || shortcut == "" {
		shortcut = defaultShortcut
	}
	a.registerShortcut(shortcut)

	if a.smokeReport != "" {
		go a.smokeTest(main, capture)
		return
	}
	main.OnReadyToShow(main.Show)
	a.makeTray()
}

// guardPage keeps a window on the app's own pages: links open in the apps
// the system has for them, and the web view's menu loses its page items.
func guardPage(w *mygo.Window) {
	p := w.Page()
	p.OnWillNavigate(func(e *mygo.NavigateEvent) {
		if sameOrigin(e.URL, p.URL()) {
			return
		}
		e.PreventDefault()
		if e.UserInitiated {
			go openLink(e.URL)
		}
	})
	p.SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
		if req.UserInitiated {
			go openLink(req.URL)
		}
		return nil
	})
	p.OnContextMenu(func(e *mygo.ContextMenuEvent) {
		if !e.Editable && e.SelectionText == "" && !mygo.IsDev() {
			e.PreventDefault() // the page shows menus of its own where it has any
			return
		}
		e.Menu.Remove(mygo.ContextMenuBack, mygo.ContextMenuForward, mygo.ContextMenuReload,
			mygo.ContextMenuStop, mygo.ContextMenuPrint, mygo.ContextMenuOpenLinkInNewWindow,
			mygo.ContextMenuDownloadLink, mygo.ContextMenuOpenImageInNewWindow, mygo.ContextMenuDownloadImage,
			mygo.ContextMenuOpenFrameInNewWindow, mygo.ContextMenuShare)
	})
}

func sameOrigin(a, b string) bool {
	ua, err1 := url.Parse(a)
	ub, err2 := url.Parse(b)
	return err1 == nil && err2 == nil && ua.Scheme == ub.Scheme && strings.EqualFold(ua.Host, ub.Host)
}

func (a *app) makeTray() {
	tray, err := mygo.NewTray(mygo.TrayOptions{ID: "vibe-atlas", Icon: trayIcon, ToolTip: "Vibe Atlas"})
	if err != nil {
		log.Println("tray:", err)
		return
	}
	menu := mygo.NewMenu([]*mygo.MenuItem{
		{Label: "打开 Vibe Atlas", Click: func(*mygo.MenuItem, *mygo.Window) { a.showMain() }},
		{Label: "快速记录", Click: func(*mygo.MenuItem, *mygo.Window) { a.showCapture() }},
		mygo.Separator(),
		{Label: "退出", Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
	})
	// A click opens the main window; the menu is for right-clicks only.
	tray.OnClick(a.showMain)
	tray.OnRightClick(func() {
		tray.SetMenu(menu)
		tray.PopUpMenu()
		tray.SetMenu(nil)
	})
}

func (a *app) showMain() {
	main, _ := a.windows()
	if main == nil {
		return
	}
	main.Show()
	if main.IsMinimized() {
		main.Restore()
	}
	main.Focus()
}

// toggleCapture is what the global shortcut does.
func (a *app) toggleCapture() {
	_, capture := a.windows()
	if capture == nil {
		return
	}
	if capture.IsVisible() {
		capture.Hide()
		return
	}
	a.showCapture()
}

// showCapture shows the quick capture panel over every app, on the display
// with the pointer, a quarter of the way down.
func (a *app) showCapture() {
	_, capture := a.windows()
	if capture == nil {
		return
	}
	// The top edge stays where it is whatever the height, a fifth of the
	// way down, as long as the panel at its tallest still fits below it.
	d := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	width, _ := capture.Size()
	top := d.WorkArea.Height / 5
	if top+captureMaxHeight > d.WorkArea.Height {
		top = max(d.WorkArea.Height-captureMaxHeight, 0)
	}
	capture.SetPosition(d.WorkArea.X+(d.WorkArea.Width-width)/2, d.WorkArea.Y+top)
	_ = CaptureShown.Emit(capture, a.atlas.captureState())
	a.mu.Lock()
	a.shownAt = time.Now()
	a.mu.Unlock()
	capture.Show()
	capture.Focus()
}

func (a *app) hideCapture() {
	if _, capture := a.windows(); capture != nil {
		capture.Hide()
	}
}

// applyTheme makes every window light, dark or follow the system.
func applyTheme(t Theme) {
	switch t {
	case ThemeLight:
		mygo.Theme.SetSource(mygo.ThemeLight)
	case ThemeDark:
		mygo.Theme.SetSource(mygo.ThemeDark)
	default:
		mygo.Theme.SetSource(mygo.ThemeSystem)
	}
}

// ---- The global shortcut ----

func (a *app) shortcutState() (shortcut, problem string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.shortcut, a.scError
}

func (a *app) setShortcutState(shortcut string, active bool, problem string) {
	a.mu.Lock()
	a.shortcut, a.scActive, a.scError, a.scPaused = shortcut, active, problem, false
	a.mu.Unlock()
}

// registerShortcut takes the saved shortcut as the app starts.
func (a *app) registerShortcut(shortcut string) {
	a.shortcutM.Lock()
	defer a.shortcutM.Unlock()
	if err := mygo.GlobalShortcut.Register(shortcut, a.toggleCapture); err != nil {
		log.Printf("shortcut %s: %v", shortcut, err)
		a.setShortcutState(shortcut, false, fmt.Sprintf("「%s」已被其他软件占用，请在设置里换一个", shortcut))
		return
	}
	a.setShortcutState(shortcut, true, "")
}

// changeShortcut swaps the shortcut for another, keeping the old one when
// the new one cannot be registered.
func (a *app) changeShortcut(shortcut string) (string, error) {
	shortcut, err := cleanShortcut(shortcut)
	if err != nil {
		return "", err
	}
	a.shortcutM.Lock()
	defer a.shortcutM.Unlock()
	a.mu.Lock()
	old, active := a.shortcut, a.scActive
	a.mu.Unlock()
	if active && strings.EqualFold(old, shortcut) {
		return shortcut, nil
	}
	if active {
		mygo.GlobalShortcut.Unregister(old)
	}
	if err := mygo.GlobalShortcut.Register(shortcut, a.toggleCapture); err != nil {
		log.Printf("shortcut %s: %v", shortcut, err)
		restored := old != "" && mygo.GlobalShortcut.Register(old, a.toggleCapture) == nil
		problem := ""
		if !restored {
			problem = fmt.Sprintf("「%s」已被其他软件占用，请在设置里换一个", old)
		}
		a.setShortcutState(old, restored, problem)
		return "", fmt.Errorf("「%s」用不了，可能已被其他软件占用，换一个试试", shortcut)
	}
	a.setShortcutState(shortcut, true, "")
	return shortcut, nil
}

// pauseShortcut releases the shortcut while the user records a new one,
// and takes it back.
func (a *app) pauseShortcut(paused bool) {
	a.shortcutM.Lock()
	defer a.shortcutM.Unlock()
	a.mu.Lock()
	shortcut, active, wasPaused := a.shortcut, a.scActive, a.scPaused
	a.mu.Unlock()
	switch {
	case paused && active:
		mygo.GlobalShortcut.Unregister(shortcut)
		a.mu.Lock()
		a.scActive, a.scPaused = false, true
		a.mu.Unlock()
	case !paused && wasPaused:
		if err := mygo.GlobalShortcut.Register(shortcut, a.toggleCapture); err != nil {
			a.setShortcutState(shortcut, false, fmt.Sprintf("「%s」已被其他软件占用，请在设置里换一个", shortcut))
			return
		}
		a.setShortcutState(shortcut, true, "")
	}
}

// cleanShortcut checks a shortcut the user recorded. It needs Ctrl, Alt or
// Win, so that it does not take a key away from typing.
func cleanShortcut(s string) (string, error) {
	parts := strings.Split(s, "+")
	var keys []string
	strong := false
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			return "", fmt.Errorf("快捷键格式不对：%s", s)
		}
		switch strings.ToLower(p) {
		case "ctrl", "control", "alt", "option", "win", "super", "meta", "cmd", "command", "cmdorctrl", "commandorcontrol":
			strong = true
		}
		keys = append(keys, p)
	}
	if len(keys) < 2 {
		return "", fmt.Errorf("快捷键需要组合键，比如 Ctrl+Alt+Space")
	}
	if !strong {
		return "", fmt.Errorf("快捷键至少要包含 Ctrl、Alt 或 Win 中的一个")
	}
	switch strings.ToLower(keys[len(keys)-1]) {
	case "ctrl", "control", "alt", "option", "win", "super", "meta", "cmd", "command", "cmdorctrl", "commandorcontrol", "shift":
		return "", fmt.Errorf("快捷键最后要有一个普通按键，比如 Space 或字母")
	}
	return strings.Join(keys, "+"), nil
}
