package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/sessions"
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

	sessions sessions.Reader
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
	// BossKey is the global shortcut that hides every window at once and
	// brings the main window back, or "" while not set (out of the box).
	BossKey string `json:"bossKey"`
	// BossKeyError says why BossKey does not work, or "".
	BossKeyError string `json:"bossKeyError"`
	Theme        Theme  `json:"theme"`
	// Effects turns on the effects that cost the GPU in the main window: the
	// moving background, blurred panels and glowing rows. Off by default;
	// quick capture never shows them.
	Effects bool `json:"effects"`
	// Background is the moving background the effects show.
	Background Background `json:"background"`
	// Wallpaper is the picture behind the main window, under the moving
	// background; with one, the frame and panel are frosted glass even
	// while the effects are off.
	Wallpaper Wallpaper `json:"wallpaper"`
	// Glass is the frosted glass of the frame and panel.
	Glass Glass `json:"glass"`
	// WindowOpacity is the opacity of the whole main window, 40 to 100 %.
	WindowOpacity int `json:"windowOpacity"`
	// ShareLinks lets a sub-item without a link of its own open the link of
	// the nearest item above it that has one. On by default.
	ShareLinks bool `json:"shareLinks"`
	// SessionSource is where the sessions to link items to are read from:
	// Claude Code, Codex or codeg, one of them; "" (out of the box) for
	// none.
	SessionSource sessions.Source `json:"sessionSource"`
	// TrashDays is how many days items stay in the trash before they are
	// deleted for good, or 0 to keep them until the user empties it. 30 out
	// of the box.
	TrashDays int `json:"trashDays"`
	// LookDefaults are the looks the app has out of the box.
	LookDefaults LookDefaults `json:"lookDefaults"`
	// DataDir is the folder of the database.
	DataDir string `json:"dataDir"`
	// CurrentProjectID is the project open in the main window, or 0.
	CurrentProjectID int64 `json:"currentProjectId"`
}

// Keys of the settings table.
const (
	keyShortcut       = "shortcut"
	keyBossKey        = "bossKey"
	keyTheme          = "theme"
	keyEffects        = "effects"
	keyBackground     = "background"
	keyShareLinks     = "shareLinks"
	keyTrashDays      = "trashDays"
	keySessionSource  = "sessionSource"
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

// ReopenItem takes a done item back to the status it had before: doing,
// with the time it started, when it was done while doing; else to do.
func (a *Atlas) ReopenItem(id int64) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.ReopenItem(id) })
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

// MoveItem moves an item, with the items under it, right before or after
// anchorID among the anchor's siblings, or inside the anchor as its last
// child.
func (a *Atlas) MoveItem(id, anchorID int64, place store.Place) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	if err := db.MoveItem(id, anchorID, place); err != nil {
		return err
	}
	if it, err := db.Item(id); err == nil {
		a.changed(it.ProjectID)
	}
	return nil
}

// MergeItems puts the item id and the item targetID under a new parent in
// the target's place, and returns the parent. Its title is the first 6
// characters of the target's and how many children it has.
func (a *Atlas) MergeItems(id, targetID int64) (store.Item, error) {
	return a.editItem(func(db *store.Store) (store.Item, error) { return db.MergeItems(id, targetID) })
}

// MoveItemToProject moves an item, with the items under it, to another
// project, at the top level and without a module.
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

// DeleteItem deletes an item for good, past the trash. Its children move
// up a level, into its place.
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

// SetItemsType changes the kind of the items ids, all at once: when one
// fails, none changes.
func (a *Atlas) SetItemsType(ids []int64, itemType store.ItemType) ([]store.Item, error) {
	return a.editItems(func(db *store.Store) ([]store.Item, error) { return db.SetItemsType(ids, itemType) })
}

// SetItemsModule puts the items ids in a module of their project, or in
// none when moduleID is 0, all at once: when one fails, none changes.
func (a *Atlas) SetItemsModule(ids []int64, moduleID int64) ([]store.Item, error) {
	return a.editItems(func(db *store.Store) ([]store.Item, error) { return db.SetItemsModule(ids, moduleID) })
}

func (a *Atlas) editItems(fn func(*store.Store) ([]store.Item, error)) ([]store.Item, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	items, err := fn(db)
	if err == nil {
		projects := make([]int64, 0, len(items))
		for _, it := range items {
			projects = append(projects, it.ProjectID)
		}
		a.changedAll(projects)
	}
	return items, err
}

// MoveItemsToProject moves the items ids, with the items under them, to
// another project, in their order, at the top level and without a module,
// all at once: when one fails, none moves. Those under another of ids go
// along with it, under it.
func (a *Atlas) MoveItemsToProject(ids []int64, projectID int64) ([]store.Item, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	from, err := projectsOf(db, ids)
	if err != nil {
		return nil, err
	}
	items, err := db.MoveItemsToProject(ids, projectID)
	if err == nil {
		a.changedAll(append(from, projectID))
	}
	return items, err
}

// DeleteItems deletes the items ids for good, past the trash, all at
// once: when one fails, none is deleted. Children not deleted move up into
// the place of the nearest item above them that stays.
func (a *Atlas) DeleteItems(ids []int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	from, err := projectsOf(db, ids)
	if err != nil {
		return err
	}
	if err := db.DeleteItems(ids); err != nil {
		return err
	}
	a.changedAll(from)
	return nil
}

// ---- Trash ----

// TrashItems moves the items ids to the trash, in their order, all at
// once: when one fails, none moves. Each one's children not trashed move
// up a level, into its place, as with DeleteItems. It returns the batch,
// which RestoreBatch takes to undo it.
func (a *Atlas) TrashItems(ids []int64) (int64, error) {
	db, err := a.store()
	if err != nil {
		return 0, err
	}
	from, err := projectsOf(db, ids)
	if err != nil {
		return 0, err
	}
	batch, err := db.TrashItems(ids)
	if err != nil {
		return 0, err
	}
	a.changedAll(from)
	return batch, nil
}

// Trash returns the items in the trash of every project, the last deleted
// first.
func (a *Atlas) Trash() ([]store.TrashEntry, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	return db.Trash()
}

// TrashCount returns how many items the trash holds.
func (a *Atlas) TrashCount() (int, error) {
	db, err := a.store()
	if err != nil {
		return 0, err
	}
	return db.TrashCount()
}

// RestoreTrash puts the items of the trash entries ids back where they
// were, with the children that moved up when they went, all at once: when
// one fails, none comes back. Without its parent, an item goes to the end
// of its project's top level; without its module, it is 未分类.
func (a *Atlas) RestoreTrash(ids []int64) ([]store.Item, error) {
	return a.restore(func(db *store.Store) ([]store.Item, error) { return db.RestoreTrash(ids) })
}

// RestoreBatch puts back the items TrashItems moved to the trash together,
// as RestoreTrash does: what undoing a deletion does.
func (a *Atlas) RestoreBatch(batch int64) ([]store.Item, error) {
	return a.restore(func(db *store.Store) ([]store.Item, error) { return db.RestoreBatch(batch) })
}

func (a *Atlas) restore(fn func(*store.Store) ([]store.Item, error)) ([]store.Item, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	items, err := fn(db)
	if err != nil {
		return nil, err
	}
	projects := make([]int64, 0, len(items))
	for _, it := range items {
		projects = append(projects, it.ProjectID)
	}
	a.changedAll(projects)
	return items, nil
}

// PurgeTrash deletes the trash entries ids for good.
func (a *Atlas) PurgeTrash(ids []int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	if err := db.PurgeTrash(ids); err != nil {
		return err
	}
	a.changed(0)
	return nil
}

// EmptyTrash deletes everything in the trash for good and returns how many
// items there were.
func (a *Atlas) EmptyTrash() (int, error) {
	db, err := a.store()
	if err != nil {
		return 0, err
	}
	n, err := db.EmptyTrash()
	if err == nil {
		a.changed(0)
	}
	return n, err
}

// projectsOf returns the project of each of the items ids.
func projectsOf(db *store.Store, ids []int64) ([]int64, error) {
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		it, err := db.Item(id)
		if err != nil {
			return nil, err
		}
		out = append(out, it.ProjectID)
	}
	return out, nil
}

// changedAll tells every window about each of the projects once.
func (a *Atlas) changedAll(projectIDs []int64) {
	seen := map[int64]bool{}
	for _, id := range projectIDs {
		if !seen[id] {
			seen[id] = true
			a.changed(id)
		}
	}
}

// ItemText is what copying an item puts on the clipboard: its title, its
// notes, then the items under it as a task list, done ones ticked, the
// notes of each indented under it. descendants are as Store.Descendants
// returns them.
func ItemText(it store.Item, descendants []store.Item) string {
	text := it.Title
	if note := strings.TrimSpace(it.Note); note != "" {
		text += "\n\n" + note
	}
	if len(descendants) == 0 {
		return text
	}
	depth := map[int64]int{it.ID: -1}
	var b strings.Builder
	// Notes stand apart from the items around them by a blank line.
	gap := false
	for _, d := range descendants {
		depth[d.ID] = depth[d.ParentID] + 1
		indent := strings.Repeat("  ", depth[d.ID])
		mark := " "
		if d.Status == store.StatusDone {
			mark = "x"
		}
		if gap {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "\n%s- [%s] %s", indent, mark, d.Title)
		gap = false
		if note := strings.TrimSpace(d.Note); note != "" {
			b.WriteString("\n")
			for _, line := range strings.Split(note, "\n") {
				if line = strings.TrimRight(line, "\r"); line != "" {
					b.WriteString("\n" + indent + "  " + line)
				} else {
					b.WriteString("\n")
				}
			}
			gap = true
		}
	}
	return text + "\n" + b.String()
}

// CopyItem copies an item's title and notes, with the items under it, as
// Markdown, to paste to an AI.
func (a *Atlas) CopyItem(id int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	it, err := db.Item(id)
	if err != nil {
		return err
	}
	descendants, err := db.Descendants(id)
	if err != nil {
		return err
	}
	mygo.Clipboard.WriteText(withImagePaths(ItemText(it, descendants), a.app.dataDir))
	return nil
}

// ItemsText is what copying the items ids puts on the clipboard: each one
// as ItemText has it, in their order, apart by a rule. One under another
// of ids shows only in that one's list.
func ItemsText(db *store.Store, ids []int64) (string, error) {
	type entry struct {
		it          store.Item
		descendants []store.Item
	}
	entries := make([]entry, 0, len(ids))
	under := map[int64]bool{}
	seen := map[int64]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		it, err := db.Item(id)
		if err != nil {
			return "", err
		}
		descendants, err := db.Descendants(id)
		if err != nil {
			return "", err
		}
		for _, d := range descendants {
			under[d.ID] = true
		}
		entries = append(entries, entry{it, descendants})
	}
	parts := make([]string, 0, len(entries))
	for _, e := range entries {
		if !under[e.it.ID] {
			parts = append(parts, ItemText(e.it, e.descendants))
		}
	}
	return strings.Join(parts, "\n\n---\n\n"), nil
}

// CopyItems copies the items ids, as ItemsText has them, to paste to an
// AI.
func (a *Atlas) CopyItems(ids []int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	text, err := ItemsText(db, ids)
	if err != nil {
		return err
	}
	mygo.Clipboard.WriteText(withImagePaths(text, a.app.dataDir))
	return nil
}

// OpenDeeplink opens the link an item is bound to; without one, while
// sub-items share links, the link of the nearest item above it that has one.
func (a *Atlas) OpenDeeplink(id int64) error {
	db, err := a.store()
	if err != nil {
		return err
	}
	it, err := db.Item(id)
	if err != nil {
		return err
	}
	link, err := itemLink(db, it, shareLinks(db))
	if err != nil {
		return err
	}
	if link == "" {
		return errors.New("这条改进点没有绑定链接")
	}
	return openLink(link)
}

// itemLink is the link an item opens: its own; without one, when shared,
// that of the nearest item above it that has one; else "".
func itemLink(db *store.Store, it store.Item, shared bool) (string, error) {
	seen := map[int64]bool{}
	for it.Deeplink == "" && shared && it.ParentID != 0 && !seen[it.ID] {
		seen[it.ID] = true
		parent, err := db.Item(it.ParentID)
		if err != nil {
			return "", err
		}
		it = parent
	}
	return it.Deeplink, nil
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
	if sessions.IsClaudeLink(link) {
		return openClaudeSession(link)
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

// ---- Sessions ----

// ListSessions lists the sessions of the source the user set, the newest
// first: those that work in folder or a folder inside it, or all of them
// when all is set or folder is "". None while no source is set.
func (a *Atlas) ListSessions(folder string, all bool) ([]sessions.Session, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	if all {
		folder = ""
	}
	return a.sessions.In(sessionSource(db), strings.TrimSpace(folder))
}

// SessionsOf finds the sessions links open, by link, to show their names:
// only those of the source the user set.
func (a *Atlas) SessionsOf(links []string) (map[string]sessions.Session, error) {
	db, err := a.store()
	if err != nil {
		return nil, err
	}
	return a.sessions.Find(sessionSource(db), links)
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
	shortcut, shortcutErr := a.app.keyState(&a.app.capKey)
	bossKey, bossKeyErr := a.app.keyState(&a.app.bossKey)
	s := Settings{
		Shortcut:        shortcut,
		DefaultShortcut: defaultShortcut,
		ShortcutError:   shortcutErr,
		BossKey:         bossKey,
		BossKeyError:    bossKeyErr,
		Theme:           a.theme(db),
		Effects:         effectsOn(db),
		Background:      background(db),
		Wallpaper:       wallpaper(db, a.app.dataDir),
		Glass:           glass(db),
		WindowOpacity:   windowOpacity(db),
		ShareLinks:      shareLinks(db),
		SessionSource:   sessionSource(db),
		TrashDays:       trashDays(db),
		LookDefaults:    lookDefaults,
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

func shareLinks(db *store.Store) bool {
	v, _, _ := db.Setting(keyShareLinks)
	return v != "off"
}

func sessionSource(db *store.Store) sessions.Source {
	v, _, _ := db.Setting(keySessionSource)
	if src := sessions.Source(v); sessions.Valid(src) {
		return src
	}
	return sessions.None
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

// SetShortcut changes the global shortcut of quick capture. It must differ
// from the boss key. When the new one cannot be registered, the old one
// stays.
func (a *Atlas) SetShortcut(shortcut string) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	shortcut, err = a.app.changeShortcut(&a.app.capKey, &a.app.bossKey, shortcut)
	if err != nil {
		return Settings{}, err
	}
	if err := db.SetSetting(keyShortcut, shortcut); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

// SetBossKey changes the boss key, the global shortcut that hides every
// window at once and brings the main window back; "" clears it. It must
// differ from the shortcut of quick capture. When the new one cannot be
// registered, the old one stays.
func (a *Atlas) SetBossKey(shortcut string) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if strings.TrimSpace(shortcut) == "" {
		a.app.clearShortcut(&a.app.bossKey, &a.app.capKey)
		shortcut = ""
	} else if shortcut, err = a.app.changeShortcut(&a.app.bossKey, &a.app.capKey, shortcut); err != nil {
		return Settings{}, err
	}
	if err := db.SetSetting(keyBossKey, shortcut); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

// PauseShortcut releases the global shortcuts, quick capture's and the boss
// key, while the user records a new one, so that pressing either reaches
// the page, and takes them back when paused is false.
func (a *Atlas) PauseShortcut(paused bool) error {
	a.app.pauseShortcuts(paused)
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

// SetShareLinks turns on or off sub-items opening the link of the item
// above them when they have none of their own.
func (a *Atlas) SetShareLinks(on bool) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := setShareLinks(db, on); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

func setShareLinks(db *store.Store, on bool) error {
	v := "off"
	if on {
		v = "on"
	}
	return db.SetSetting(keyShareLinks, v)
}

// SetSessionSource picks where the sessions to link items to are read
// from: "claude", "codex" or "codeg"; "" for none.
func (a *Atlas) SetSessionSource(src sessions.Source) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if err := setSessionSource(db, src); err != nil {
		return Settings{}, err
	}
	a.settingsChanged()
	return a.Settings()
}

func setSessionSource(db *store.Store, src sessions.Source) error {
	if !sessions.Valid(src) {
		return fmt.Errorf("未知的会话来源：%s", src)
	}
	return db.SetSetting(keySessionSource, string(src))
}

// defaultTrashDays is how long items stay in the trash out of the box.
const defaultTrashDays = 30

// trashDayChoices are the days the trash may keep items for; 0 keeps them
// until the user empties it.
var trashDayChoices = []int{0, 7, 30, 90}

func trashDays(db *store.Store) int {
	v, ok, _ := db.Setting(keyTrashDays)
	if !ok {
		return defaultTrashDays
	}
	n, err := strconv.Atoi(v)
	if err != nil || !slices.Contains(trashDayChoices, n) {
		return defaultTrashDays
	}
	return n
}

// SetTrashDays changes how many days items stay in the trash before they
// are deleted for good: 7, 30 or 90, or 0 to keep them until the user
// empties it. Those in the trash longer go at once.
func (a *Atlas) SetTrashDays(days int) (Settings, error) {
	db, err := a.store()
	if err != nil {
		return Settings{}, err
	}
	if !slices.Contains(trashDayChoices, days) {
		return Settings{}, errors.New("回收站只能保留 7、30、90 天，或者一直保留")
	}
	if err := db.SetSetting(keyTrashDays, strconv.Itoa(days)); err != nil {
		return Settings{}, err
	}
	a.purgeOldTrash(db)
	a.settingsChanged()
	return a.Settings()
}

// purgeOldTrash deletes for good the items in the trash longer than the
// user keeps them.
func (a *Atlas) purgeOldTrash(db *store.Store) {
	days := trashDays(db)
	if days == 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	n, err := db.PurgeTrashBefore(cutoff)
	if err != nil {
		log.Println("emptying the old trash:", err)
		return
	}
	if n > 0 {
		log.Printf("deleted %d items in the trash longer than %d days", n, days)
		a.changed(0)
	}
}

// purgeTrashLater runs purgeOldTrash once the app has settled, off the way
// of its windows, then every few hours: the app stays in the tray for days.
func (a *Atlas) purgeTrashLater(db *store.Store) {
	time.AfterFunc(5*time.Second, func() {
		a.purgeOldTrash(db)
		for range time.Tick(6 * time.Hour) {
			a.purgeOldTrash(db)
		}
	})
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
