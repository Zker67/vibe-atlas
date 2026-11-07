package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// Atlas is what the pages of Vibe Atlas call: the projects, modules and
// items kept on this machine, and the parts of the desktop the app uses.
// Errors carry messages written for the user, which the pages show as they
// are.
type Atlas struct {
	app *app

	mu sync.RWMutex
	db *store.Store
}

// Changed is broadcast to every window after projects, modules or items
// change, in any window: pages fetch what they show again.
var Changed = mygo.NewEvent[Change]("changed")

// Change tells what changed.
type Change struct {
	// ProjectID is the project whose modules or items changed, or 0 when
	// the list of projects changed.
	ProjectID int64 `json:"projectId"`
}

// SettingsChanged is broadcast to every window after the settings change.
var SettingsChanged = mygo.NewEvent[Settings]("settingsChanged")

// CaptureShown is sent to the quick capture panel each time it shows.
var CaptureShown = mygo.NewEvent[CaptureState]("captureShown")

// CaptureState is how the quick capture panel starts.
type CaptureState struct {
	// ProjectID is the project new items go to unless the user picks
	// another: the one open in the main window, else the one last captured
	// into, else the first; 0 when there is no project.
	ProjectID int64 `json:"projectId"`
}

// Theme is the appearance the user chose.
type Theme string

// The appearances.
const (
	ThemeSystem Theme = "system" // 跟随系统
	ThemeLight  Theme = "light"  // 亮色
	ThemeDark   Theme = "dark"   // 暗色
)

// Background is the moving background of the main window while the
// effects are on.
type Background string

// The backgrounds.
const (
	BackgroundGrid  Background = "grid"  // 点阵网格
	BackgroundWaves Background = "waves" // 点阵信号
)

// Settings are the user's preferences.
type Settings struct {
	// Shortcut is the global shortcut of quick capture, such as
	// "Ctrl+Alt+Space".
	Shortcut string `json:"shortcut"`
	// DefaultShortcut is the shortcut quick capture has out of the box.
	DefaultShortcut string `json:"defaultShortcut"`
	// ShortcutError says why Shortcut does not work, or "".
	ShortcutError string `json:"shortcutError"`
	Theme         Theme  `json:"theme"`
	// Effects turns on the effects that cost the GPU in the main window: the
	// moving background, blurred panels and glowing rows. Off by default;
	// quick capture never shows them.
	Effects bool `json:"effects"`
	// Background is the moving background the effects show.
	Background Background `json:"background"`
	// DataDir is the folder of the database.
	DataDir string `json:"dataDir"`
	// CurrentProjectID is the project open in the main window, or 0.
	CurrentProjectID int64 `json:"currentProjectId"`
}

// Keys of the settings table.
const (
	keyShortcut       = "shortcut"
	keyTheme          = "theme"
	keyEffects        = "effects"
	keyBackground     = "background"
	keyCurrentProject = "currentProject"
	keyLastCapture    = "lastCaptureProject"
)

var errStarting = errors.New("Vibe Atlas 还在启动，请稍候再试")

func (a *Atlas) store() (*store.Store, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.db == nil {
		return nil, errStarting
	}
	return a.db, nil
}

func (a *Atlas) setStore(db *store.Store) {
	a.mu.Lock()
	a.db = db
	a.mu.Unlock()
}

// changed tells every window that a project's modules or items changed,
// or the list of projects when projectID is 0.
func (a *Atlas) changed(projectID int64) {
	_ = Changed.Broadcast(Change{ProjectID: projectID})
}

// do runs fn with the store, then tells the windows about the change to
// projectID when fn succeeded.
func do[T any](a *Atlas, projectID int64, fn func(*store.Store) (T, error)) (T, error) {
	db, err := a.store()
	if err != nil {
		var zero T
		return zero, err
	}
	v, err := fn(db)
	if err == nil {
		a.changed(projectID)
	}
	return v, err
}

// ---- Projects ----

// Projects returns every project, in the user's order.
func (a *Atlas) Projects() ([]store.Project, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	return db.Projects()
}

// CreateProject adds a project at the end of the list.
func (a *Atlas) CreateProject(name string) (store.Project, error) {
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.CreateProject(name) })
}

// RenameProject renames a project.
func (a *Atlas) RenameProject(id int64, name string) (store.Project, error) {
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.RenameProject(id, name) })
}

// SetProjectDescription replaces a project's notes, in Markdown.
func (a *Atlas) SetProjectDescription(id int64, description string) (store.Project, error) {
	return do(a, id, func(db *store.Store) (store.Project, error) { return db.SetProjectDescription(id, description) })
}

// ChooseProjectFolder asks for a folder and binds the project to it. It
// returns the project unchanged when the user cancels.
func (a *Atlas) ChooseProjectFolder(ctx context.Context, id int64) (store.Project, error) {
	db, err := a.store()
	if err != nil {
		return store.Project{}, err
	}
	p, err := db.Project(id)
	if err != nil {
		return p, err
	}
	opts := mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "选择「" + p.Name + "」的项目文件夹",
		ButtonLabel: "选择",
		Directory:   true,
	}
	if p.FolderExists {
		opts.DefaultPath = p.FolderPath
	}
	paths, err := mygo.Dialog.Open(opts)
	if err != nil {
		return p, fmt.Errorf("打不开选择文件夹的窗口：%w", err)
	}
	if len(paths) == 0 {
		return p, nil
	}
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.SetProjectFolder(id, paths[0]) })
}

// ClearProjectFolder unbinds a project from its folder.
func (a *Atlas) ClearProjectFolder(id int64) (store.Project, error) {
	return do(a, 0, func(db *store.Store) (store.Project, error) { return db.SetProjectFolder(id, "") })
}

// OpenProjectFolder opens the project's folder in the file manager.
func (a *Atlas) OpenProjectFolder(id int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	p, err := db.Project(id)
	if err != nil {
		return err
	}
	if p.FolderPath == "" {
		return errors.New("这个项目还没有绑定文件夹")
	}
	if !p.FolderExists {
		return fmt.Errorf("文件夹不存在：%s", p.FolderPath)
	}
	if err := mygo.Shell.OpenPath(p.FolderPath); err != nil {
		return fmt.Errorf("打不开文件夹：%w", err)
	}
	return nil
}

// DeleteProject deletes a project with its modules and items.
func (a *Atlas) DeleteProject(id int64) error {
	_, err := do(a, 0, func(db *store.Store) (struct{}, error) { return struct{}{}, db.DeleteProject(id) })
	return err
}

// ReorderProjects puts the projects in the order of ids.
func (a *Atlas) ReorderProjects(ids []int64) error {
	_, err := do(a, 0, func(db *store.Store) (struct{}, error) { return struct{}{}, db.ReorderProjects(ids) })
	return err
}

// ---- Modules ----

// Modules returns the modules of a project, in the user's order.
func (a *Atlas) Modules(projectID int64) ([]store.Module, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	return db.Modules(projectID)
}

// CreateModule adds a module at the end of the project's.
func (a *Atlas) CreateModule(projectID int64, name string) (store.Module, error) {
	return do(a, projectID, func(db *store.Store) (store.Module, error) { return db.CreateModule(projectID, name) })
}

// RenameModule renames a module.
func (a *Atlas) RenameModule(id int64, name string) (store.Module, error) {
	return do(a, 0, func(db *store.Store) (store.Module, error) { return db.RenameModule(id, name) })
}

// DeleteModule deletes a module; its items stay in the project, without a
// module. It returns how many there were.
func (a *Atlas) DeleteModule(id int64) (int, error) {
	return do(a, 0, func(db *store.Store) (int, error) { return db.DeleteModule(id) })
}

// ReorderModules puts the modules of a project in the order of ids.
func (a *Atlas) ReorderModules(projectID int64, ids []int64) error {
	_, err := do(a, projectID, func(db *store.Store) (struct{}, error) { return struct{}{}, db.ReorderModules(projectID, ids) })
	return err
}

// ---- Items ----

// Items returns the items of a project: doing, to do in the user's order,
// then done, the most recently done first.
func (a *Atlas) Items(projectID int64) ([]store.Item, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	return db.Items(projectID)
}

// CreateItem adds an item to do at the end of the project's list.
func (a *Atlas) CreateItem(item store.NewItem) (store.Item, error) {
	return do(a, item.ProjectID, func(db *store.Store) (store.Item, error) { return db.CreateItem(item) })
}

// SetItemTitle changes the title of an item.
func (a *Atlas) SetItemTitle(id int64, title string) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.SetItemTitle(id, title) })
}

// SetItemType changes the kind of an item.
func (a *Atlas) SetItemType(id int64, itemType store.ItemType) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.SetItemType(id, itemType) })
}

// SetItemModule puts an item in a module of its project, or in none when
// moduleID is 0.
func (a *Atlas) SetItemModule(id, moduleID int64) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.SetItemModule(id, moduleID) })
}

// SetItemNote replaces the notes of an item, in Markdown.
func (a *Atlas) SetItemNote(id int64, note string) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.SetItemNote(id, note) })
}

// SetItemDeeplink binds an item to a link, or unbinds it when link is
// blank. A local path becomes a file: link.
func (a *Atlas) SetItemDeeplink(id int64, link string) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.SetItemDeeplink(id, link) })
}

// SetItemStatus moves an item to to do, doing or done.
func (a *Atlas) SetItemStatus(id int64, status store.ItemStatus) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.SetItemStatus(id, status) })
}

func (a *Atlas) editItem(fn func(*store.Store) (store.Item, error)) (store.Item, error) {
	db, err := a.store()
	if err != nil {
		return store.Item{}, err
	}
	it, err := fn(db)
	if err == nil {
		a.changed(it.ProjectID)
	}
	return it, err
}

// MoveTodoItem moves an item to do right before the item to do anchorID,
// or right after it when after is true.
func (a *Atlas) MoveTodoItem(id, anchorID int64, after bool) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	if err := db.MoveTodoItem(id, anchorID, after); err != nil {
		return err
	}
	if it, err := db.Item(id); err == nil {
		a.changed(it.ProjectID)
	}
	return nil
}

// MoveItemToProject moves an item to another project, without a module.
func (a *Atlas) MoveItemToProject(id, projectID int64) (store.Item, error) {
	db, err := a.store()
	if err != nil {
		return store.Item{}, err
	}
	before, err := db.Item(id)
	if err != nil {
		return before, err
	}
	it, err := db.MoveItemToProject(id, projectID)
	if err == nil {
		a.changed(before.ProjectID)
		a.changed(projectID)
	}
	return it, err
}

// DeleteItem deletes an item.
func (a *Atlas) DeleteItem(id int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	it, err := db.Item(id)
	if err != nil {
		return err
	}
	if err := db.DeleteItem(id); err != nil {
		return err
	}
	a.changed(it.ProjectID)
	return nil
}

// ItemText is what copying an item puts on the clipboard: its title, then
// its notes.
func ItemText(it store.Item) string {
	text := it.Title
	if note := strings.TrimSpace(it.Note); note != "" {
		text += "\n\n" + note
	}
	return text
}

// CopyItem copies an item's title and notes as Markdown, to paste to an AI.
func (a *Atlas) CopyItem(id int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	it, err := db.Item(id)
	if err != nil {
		return err
	}
	mygo.Clipboard.WriteText(ItemText(it))
	return nil
}

// OpenDeeplink opens the link an item is bound to.
func (a *Atlas) OpenDeeplink(id int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	it, err := db.Item(id)
	if err != nil {
		return err
	}
	if it.Deeplink == "" {
		return errors.New("这条改进点没有绑定链接")
	}
	return openLink(it.Deeplink)
}

// OpenLink opens a link of the notes with the app the system has for it.
func (a *Atlas) OpenLink(link string) error {
	return openLink(link)
}

// openLink opens a link, a file: link as the local file or folder it names.
func openLink(link string) error {
	link, err := store.NormalizeDeeplink(link)
	if err != nil {
		return err
	}
	if link == "" {
		return errors.New("链接是空的")
	}
	if path, ok := store.LocalPath(link); ok {
		if _, err := os.Stat(path); err != nil {
			return fmt.Errorf("找不到这个文件或文件夹：%s", path)
		}
		if err := mygo.Shell.OpenPath(path); err != nil {
			return fmt.Errorf("打不开 %s：%w", path, err)
		}
		return nil
	}
	if err := mygo.Shell.OpenExternal(link); err != nil {
		return fmt.Errorf("打不开这个链接，系统里可能没有能打开它的程序：%w", err)
	}
	return nil
}

// ---- Overview ----

// Overview sums up a project: the progress of its modules, its kinds of
// items, what is doing and what was done.
func (a *Atlas) Overview(projectID int64) (store.Overview, error) {
	db, err := a.store()
	if err != nil {
		return store.Overview{}, err
	}
	return db.Overview(projectID)
}

// ---- Settings ----

// Settings returns the user's preferences.
func (a *Atlas) Settings() (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	shortcut, shortcutErr := a.app.shortcutState()
	s := Settings{
		Shortcut:        shortcut,
		DefaultShortcut: defaultShortcut,
		ShortcutError:   shortcutErr,
		Theme:           a.theme(db),
		Effects:         effectsOn(db),
		Background:      background(db),
		DataDir:         a.app.dataDir,
	}
	s.CurrentProjectID = a.settingID(db, keyCurrentProject)
	return s, nil
}

func (a *Atlas) theme(db *store.Store) Theme {
	v, _, _ := db.Setting(keyTheme)
	switch Theme(v) {
	case ThemeLight, ThemeDark:
		return Theme(v)
	}
	return ThemeSystem
}

func effectsOn(db *store.Store) bool {
	v, _, _ := db.Setting(keyEffects)
	return v == "on"
}

func background(db *store.Store) Background {
	v, _, _ := db.Setting(keyBackground)
	if Background(v) == BackgroundWaves {
		return BackgroundWaves
	}
	return BackgroundGrid
}

func (a *Atlas) settingID(db *store.Store, key string) int64 {
	v, _, _ := db.Setting(key)
	id, _ := strconv.ParseInt(v, 10, 64)
	return id
}

func (a *Atlas) settingsChanged() {
	if s, err := a.Settings(); err == nil {
		_ = SettingsChanged.Broadcast(s)
	}
}

// SetShortcut changes the global shortcut of quick capture. When the new
// one cannot be registered, the old one stays.
func (a *Atlas) SetShortcut(shortcut string) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	shortcut, err = a.app.changeShortcut(shortcut)
	if err != nil {
		return Settings{}, err
	}
	if err := db.SetSetting(keyShortcut, shortcut); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

// PauseShortcut releases the global shortcut while the user records a new
// one, so that pressing it reaches the page, and takes it back when paused
// is false.
func (a *Atlas) PauseShortcut(paused bool) error {
	a.app.pauseShortcut(paused)
	return nil
}

// SetTheme changes the appearance of every window.
func (a *Atlas) SetTheme(theme Theme) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	switch theme {
	case ThemeSystem, ThemeLight, ThemeDark:
	default:
		return Settings{}, fmt.Errorf("未知的主题：%s", theme)
	}
	if err := db.SetSetting(keyTheme, string(theme)); err != nil {
		return Settings{}, err
	}
	applyTheme(theme)
	a.settingsChanged()
	return a.Settings()
}

// SetEffects turns the effects of the main window on or off.
func (a *Atlas) SetEffects(on bool) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := setEffects(db, on); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

func setEffects(db *store.Store, on bool) error {
	v := "off"
	if on {
		v = "on"
	}
	return db.SetSetting(keyEffects, v)
}

// SetBackground picks the moving background the effects show.
func (a *Atlas) SetBackground(bg Background) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := setBackground(db, bg); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

func setBackground(db *store.Store, bg Background) error {
	switch bg {
	case BackgroundGrid, BackgroundWaves:
	default:
		return fmt.Errorf("未知的背景：%s", bg)
	}
	return db.SetSetting(keyBackground, string(bg))
}

// SetCurrentProject records the project open in the main window, which
// quick capture adds items to unless the user picks another.
func (a *Atlas) SetCurrentProject(id int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	return db.SetSetting(keyCurrentProject, strconv.FormatInt(id, 10))
}

// OpenDataFolder opens the folder of the database in the file manager.
func (a *Atlas) OpenDataFolder() error {
	if err := mygo.Shell.OpenPath(a.app.dataDir); err != nil {
		return fmt.Errorf("打不开数据文件夹：%w", err)
	}
	return nil
}

// ---- Quick capture ----

// captureState picks the project quick capture starts with.
func (a *Atlas) captureState() CaptureState {
	db, err := a.store()
	if err != nil {
		return CaptureState{}
	}
	projects, err := db.Projects()
	if err != nil || len(projects) == 0 {
		return CaptureState{}
	}
	exists := func(id int64) bool {
		for _, p := range projects {
			if p.ID == id {
				return true
			}
		}
		return false
	}
	for _, key := range []string{keyCurrentProject, keyLastCapture} {
		if id := a.settingID(db, key); id != 0 && exists(id) {
			return CaptureState{ProjectID: id}
		}
	}
	return CaptureState{ProjectID: projects[0].ID}
}

// CaptureItem adds an item from quick capture, and remembers its project
// for the next capture.
func (a *Atlas) CaptureItem(item store.NewItem) (store.Item, error) {
	it, err := a.CreateItem(item)
	if err != nil {
		return it, err
	}
	if db, err := a.store(); err == nil {
		_ = db.SetSetting(keyLastCapture, strconv.FormatInt(it.ProjectID, 10))
	}
	return it, nil
}

// HideCapture hides the quick capture panel.
func (a *Atlas) HideCapture() {
	a.app.hideCapture()
}

// ShowMain brings the main window to the front, as from quick capture
// when there is no project yet.
func (a *Atlas) ShowMain() {
	a.app.hideCapture()
	a.app.showMain()
}
