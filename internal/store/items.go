package store

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// ItemType is the kind of an item.
type ItemType string

// The kinds of items.
const (
	TypeImprove ItemType = "improve" // 改进
	TypeBug     ItemType = "bug"     // bug
	TypeFeature ItemType = "feature" // 新需求
)

func (t ItemType) valid() bool {
	return t == TypeImprove || t == TypeBug || t == TypeFeature
}

// ItemStatus is where an item is. The user moves items between the
// statuses by hand, in any direction; any number of items may be doing.
type ItemStatus string

// The statuses of items.
const (
	StatusTodo  ItemStatus = "todo"  // 待办
	StatusDoing ItemStatus = "doing" // 进行中
	StatusDone  ItemStatus = "done"  // 完成
)

func (s ItemStatus) valid() bool {
	return s == StatusTodo || s == StatusDoing || s == StatusDone
}

// Item is one thing to do in a project: an improvement, a bug or a new
// feature. Items may sit under another item of their project, to any depth.
type Item struct {
	ID        int64 `json:"id"`
	ProjectID int64 `json:"projectId"`
	// ParentID is the item this one sits under, or 0 for a top-level item.
	ParentID int64 `json:"parentId"`
	// ModuleID is the item's module, or 0 for none (「未分类」).
	ModuleID int64      `json:"moduleId"`
	Type     ItemType   `json:"type"`
	Status   ItemStatus `json:"status"`
	Title    string     `json:"title"`
	// Note is the item's notes, in Markdown.
	Note string `json:"note"`
	// Deeplink is a link the item is bound to, such as the conversation
	// with an AI where it is worked on, or "".
	Deeplink string `json:"deeplink"`
	// SortOrder orders an item among its siblings, as the user dragged
	// them.
	SortOrder int64 `json:"sortOrder"`
	CreatedAt int64 `json:"createdAt"`
	// StartedAt is when the item became doing, or 0.
	StartedAt int64 `json:"startedAt"`
	// DoneAt is when the item was done, or 0.
	DoneAt    int64 `json:"doneAt"`
	UpdatedAt int64 `json:"updatedAt"`
}

const itemColumns = `id, project_id, COALESCE(parent_id, 0), COALESCE(module_id, 0), type, status, title, note, deeplink,
	sort_order, created_at, COALESCE(started_at, 0), COALESCE(done_at, 0), updated_at`

func scanItem(row scanner) (Item, error) {
	var it Item
	err := row.Scan(&it.ID, &it.ProjectID, &it.ParentID, &it.ModuleID, &it.Type, &it.Status, &it.Title, &it.Note, &it.Deeplink,
		&it.SortOrder, &it.CreatedAt, &it.StartedAt, &it.DoneAt, &it.UpdatedAt)
	return it, err
}

// itemOrder lists doing items first, in the order they were started, then
// the items to do in the user's order, then done items, the latest first.
const itemOrder = ` ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
	CASE WHEN status = 'doing' THEN started_at END,
	CASE WHEN status = 'todo' THEN sort_order END,
	CASE WHEN status = 'done' THEN done_at END DESC,
	id`

// Items returns the items of a project: doing, then to do in the user's
// order, then done, the most recently done first.
func (s *Store) Items(projectID int64) ([]Item, error) {
	return s.queryItems(`SELECT `+itemColumns+` FROM items WHERE project_id = ?`+itemOrder, projectID)
}

func (s *Store) queryItems(query string, args ...any) ([]Item, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// Item returns the item with id.
func (s *Store) Item(id int64) (Item, error) {
	return itemIn(s.db, id)
}

func itemIn(q queryer, id int64) (Item, error) {
	it, err := scanItem(q.QueryRow(`SELECT `+itemColumns+` FROM items WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return it, ErrNotFound
	}
	return it, err
}

// NewItem is what a new item starts with.
type NewItem struct {
	ProjectID int64 `json:"projectId"`
	// ParentID is the item it goes under, as its last child, or 0 for the
	// end of the project's list.
	ParentID int64 `json:"parentId"`
	// ModuleID is 0 for no module.
	ModuleID int64 `json:"moduleId"`
	// Type is TypeImprove when empty.
	Type  ItemType `json:"type"`
	Title string   `json:"title"`
}

// checkModule fails unless moduleID is 0 or a module of the project.
func checkModule(tx *sql.Tx, projectID, moduleID int64) error {
	if moduleID == 0 {
		return nil
	}
	m, err := moduleIn(tx, moduleID)
	if err != nil {
		return err
	}
	if m.ProjectID != projectID {
		return userErr("这个模块不属于当前项目")
	}
	return nil
}

func nextItemOrder(tx *sql.Tx, projectID int64) (int64, error) {
	var n int64
	err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM items WHERE project_id = ?`, projectID).Scan(&n)
	return n, err
}

// checkParent fails unless parentID is 0 or an item of the project.
func checkParent(tx *sql.Tx, projectID, parentID int64) error {
	if parentID == 0 {
		return nil
	}
	p, err := itemIn(tx, parentID)
	if err != nil {
		return err
	}
	if p.ProjectID != projectID {
		return userErr("上级改进点不属于这个项目")
	}
	return nil
}

// CreateItem adds an item to do, at the end of the project's list or of
// its parent's children.
func (s *Store) CreateItem(in NewItem) (Item, error) {
	title, err := cleanLine(in.Title, "标题", maxTitle)
	if err != nil {
		return Item{}, err
	}
	if in.Type == "" {
		in.Type = TypeImprove
	}
	if !in.Type.valid() {
		return Item{}, userErr("未知的类型：%s", in.Type)
	}
	var it Item
	err = s.inTx(func(tx *sql.Tx) error {
		if _, err := projectIn(tx, in.ProjectID); err != nil {
			return err
		}
		if err := checkModule(tx, in.ProjectID, in.ModuleID); err != nil {
			return err
		}
		if err := checkParent(tx, in.ProjectID, in.ParentID); err != nil {
			return err
		}
		order, err := nextItemOrder(tx, in.ProjectID)
		if err != nil {
			return err
		}
		now := s.millis()
		res, err := tx.Exec(`INSERT INTO items (project_id, parent_id, module_id, type, status, title, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?)`, in.ProjectID, nullable(in.ParentID), nullable(in.ModuleID), in.Type, title, order, now, now)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		if err := syncAutoTitles(tx, in.ParentID); err != nil {
			return err
		}
		it, err = itemIn(tx, id)
		return err
	})
	return it, err
}

// updateItem runs fn on the item with id in a transaction and returns the
// item as fn left it.
func (s *Store) updateItem(id int64, fn func(tx *sql.Tx, it Item) error) (Item, error) {
	var it Item
	err := s.inTx(func(tx *sql.Tx) error {
		current, err := itemIn(tx, id)
		if err != nil {
			return err
		}
		if err := fn(tx, current); err != nil {
			return err
		}
		it, err = itemIn(tx, id)
		return err
	})
	return it, err
}

// SetItemTitle changes the title of an item. A title the user gives is
// theirs: the app no longer makes it from the item's children.
func (s *Store) SetItemTitle(id int64, title string) (Item, error) {
	title, err := cleanLine(title, "标题", maxTitle)
	if err != nil {
		return Item{}, err
	}
	return s.updateItem(id, func(tx *sql.Tx, it Item) error {
		if _, err := tx.Exec(`UPDATE items SET title = ?, auto_title = 0, updated_at = ? WHERE id = ?`, title, s.millis(), id); err != nil {
			return err
		}
		return syncAutoTitles(tx, it.ParentID)
	})
}

// SetItemType changes the kind of an item.
func (s *Store) SetItemType(id int64, t ItemType) (Item, error) {
	if !t.valid() {
		return Item{}, userErr("未知的类型：%s", t)
	}
	return s.updateItem(id, func(tx *sql.Tx, _ Item) error {
		_, err := tx.Exec(`UPDATE items SET type = ?, updated_at = ? WHERE id = ?`, t, s.millis(), id)
		return err
	})
}

// SetItemModule puts an item in a module of its project, or in none when
// moduleID is 0.
func (s *Store) SetItemModule(id, moduleID int64) (Item, error) {
	return s.updateItem(id, func(tx *sql.Tx, it Item) error {
		if err := checkModule(tx, it.ProjectID, moduleID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE items SET module_id = ?, updated_at = ? WHERE id = ?`, nullable(moduleID), s.millis(), id)
		return err
	})
}

// SetItemNote replaces the notes of an item.
func (s *Store) SetItemNote(id int64, note string) (Item, error) {
	if err := checkText(note, "备注"); err != nil {
		return Item{}, err
	}
	return s.updateItem(id, func(tx *sql.Tx, _ Item) error {
		_, err := tx.Exec(`UPDATE items SET note = ?, updated_at = ? WHERE id = ?`, note, s.millis(), id)
		return err
	})
}

// SetItemDeeplink binds an item to a link, or unbinds it when link is
// blank. See NormalizeDeeplink for the links it takes.
func (s *Store) SetItemDeeplink(id int64, link string) (Item, error) {
	link, err := NormalizeDeeplink(link)
	if err != nil {
		return Item{}, err
	}
	return s.updateItem(id, func(tx *sql.Tx, _ Item) error {
		_, err := tx.Exec(`UPDATE items SET deeplink = ?, updated_at = ? WHERE id = ?`, link, s.millis(), id)
		return err
	})
}

// SetItemStatus moves an item to status. Becoming doing stamps StartedAt;
// becoming done stamps DoneAt; going back to do clears both, and so does
// reopening a done item, which keeps its place among the items to do.
func (s *Store) SetItemStatus(id int64, status ItemStatus) (Item, error) {
	if !status.valid() {
		return Item{}, userErr("未知的状态：%s", status)
	}
	return s.updateItem(id, func(tx *sql.Tx, it Item) error {
		if it.Status == status {
			return nil
		}
		now := s.millis()
		var err error
		switch status {
		case StatusDoing:
			_, err = tx.Exec(`UPDATE items SET status = 'doing', started_at = ?, done_at = NULL, updated_at = ? WHERE id = ?`, now, now, id)
		case StatusDone:
			_, err = tx.Exec(`UPDATE items SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?`, now, now, id)
		case StatusTodo:
			_, err = tx.Exec(`UPDATE items SET status = 'todo', started_at = NULL, done_at = NULL, updated_at = ? WHERE id = ?`, now, id)
		}
		return err
	})
}

// Place is where MoveItem puts an item, against its anchor.
type Place string

// The places.
const (
	PlaceBefore Place = "before" // right before the anchor, under the same parent
	PlaceAfter  Place = "after"  // right after the anchor, under the same parent
	PlaceInside Place = "inside" // the anchor's last child
)

// childIDs returns the children of parentID in their order, or the
// project's top-level items when parentID is 0.
func childIDs(tx *sql.Tx, projectID, parentID int64) ([]int64, error) {
	if parentID == 0 {
		return idsIn(tx, `SELECT id FROM items WHERE project_id = ? AND parent_id IS NULL ORDER BY sort_order, id`, projectID)
	}
	return idsIn(tx, `SELECT id FROM items WHERE parent_id = ? ORDER BY sort_order, id`, parentID)
}

// within reports whether id is root or sits under it, at any depth.
func within(tx *sql.Tx, id, root int64) (bool, error) {
	var n int
	err := tx.QueryRow(`WITH RECURSIVE up(id) AS (
			SELECT ? UNION SELECT i.parent_id FROM items i JOIN up ON i.id = up.id WHERE i.parent_id IS NOT NULL
		) SELECT COUNT(*) FROM up WHERE id = ?`, id, root).Scan(&n)
	return n > 0, err
}

// subtreeIDs returns id and every item under it.
func subtreeIDs(tx *sql.Tx, id int64) ([]int64, error) {
	return idsIn(tx, `WITH RECURSIVE down(id) AS (
			SELECT ? UNION SELECT i.id FROM items i JOIN down ON i.parent_id = down.id
		) SELECT id FROM down`, id)
}

// MoveItem moves an item, with the items under it, right before or after
// anchorID among the anchor's siblings, or inside the anchor as its last
// child. It renumbers the siblings, so the order holds however the queue
// was filtered when dragging.
func (s *Store) MoveItem(id, anchorID int64, place Place) error {
	if place != PlaceBefore && place != PlaceAfter && place != PlaceInside {
		return userErr("未知的位置：%s", place)
	}
	return s.inTx(func(tx *sql.Tx) error {
		it, err := itemIn(tx, id)
		if err != nil {
			return err
		}
		anchor, err := itemIn(tx, anchorID)
		if err != nil {
			return err
		}
		if anchor.ProjectID != it.ProjectID {
			return userErr("只能在同一个项目里移动")
		}
		if id == anchorID && place != PlaceInside {
			return nil
		}
		under, err := within(tx, anchorID, id)
		if err != nil {
			return err
		}
		if under {
			return userErr("不能移到自己或自己的子改进点里")
		}
		parent := anchor.ParentID
		if place == PlaceInside {
			parent = anchorID
		}
		ids, err := childIDs(tx, it.ProjectID, parent)
		if err != nil {
			return err
		}
		ids = slices.DeleteFunc(ids, func(v int64) bool { return v == id })
		at := len(ids)
		if place != PlaceInside {
			at = slices.Index(ids, anchorID)
			if place == PlaceAfter {
				at++
			}
		}
		ids = slices.Insert(ids, at, id)
		if parent != it.ParentID {
			if _, err := tx.Exec(`UPDATE items SET parent_id = ?, updated_at = ? WHERE id = ?`, nullable(parent), s.millis(), id); err != nil {
				return err
			}
		}
		if err := renumber(tx, `UPDATE items SET sort_order = ? WHERE id = ?`, ids); err != nil {
			return err
		}
		return syncAutoTitles(tx, it.ParentID, parent)
	})
}

// MergeItems puts the item id and the item targetID under a new parent,
// which takes the target's place: the target first, then id. The parent
// takes the target's kind and module; it is done when both are, else to
// do. Its title comes from autoTitle and follows its children until the
// user renames it.
func (s *Store) MergeItems(id, targetID int64) (Item, error) {
	var parent Item
	err := s.inTx(func(tx *sql.Tx) error {
		it, err := itemIn(tx, id)
		if err != nil {
			return err
		}
		target, err := itemIn(tx, targetID)
		if err != nil {
			return err
		}
		if target.ProjectID != it.ProjectID {
			return userErr("只能合并同一个项目里的改进点")
		}
		if id == targetID {
			return userErr("不能和自己合并")
		}
		under, err := within(tx, targetID, id)
		if err != nil {
			return err
		}
		if under {
			return userErr("不能和自己的子改进点合并")
		}
		now := s.millis()
		status, doneAt := StatusTodo, int64(0)
		if it.Status == StatusDone && target.Status == StatusDone {
			status, doneAt = StatusDone, now
		}
		res, err := tx.Exec(`INSERT INTO items (project_id, parent_id, module_id, type, status, title, auto_title, sort_order, created_at, done_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
			target.ProjectID, nullable(target.ParentID), nullable(target.ModuleID), target.Type, status,
			autoTitle(target.Title, 2), now, nullable(doneAt), now)
		if err != nil {
			return err
		}
		pid, err := res.LastInsertId()
		if err != nil {
			return err
		}
		// The parent takes the target's place among its siblings.
		ids, err := childIDs(tx, target.ProjectID, target.ParentID)
		if err != nil {
			return err
		}
		ids = slices.DeleteFunc(ids, func(v int64) bool { return v == id || v == pid })
		ids[slices.Index(ids, targetID)] = pid
		if err := renumber(tx, `UPDATE items SET sort_order = ? WHERE id = ?`, ids); err != nil {
			return err
		}
		for i, child := range []int64{targetID, id} {
			if _, err := tx.Exec(`UPDATE items SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?`, pid, i+1, now, child); err != nil {
				return err
			}
		}
		if err := syncAutoTitles(tx, it.ParentID); err != nil {
			return err
		}
		parent, err = itemIn(tx, pid)
		return err
	})
	return parent, err
}

// autoTitleLen is how much of the first child's title a parent the app
// made takes, in characters.
const autoTitleLen = 6

// autoTitle is the title of a parent the app made: the first 6 characters
// of its first child's title, or all of a shorter one, then how many
// children it has, as in 「修复登录按钮等 3 个改进点」.
func autoTitle(first string, n int) string {
	r := []rune(first)
	if len(r) > autoTitleLen {
		r = r[:autoTitleLen]
	}
	return fmt.Sprintf("%s等 %d 个改进点", strings.TrimSpace(string(r)), n)
}

// syncAutoTitles brings the titles the app made for the parents ids up to
// date with their children. Parents the user renamed, those left without
// children and 0 stay as they are.
func syncAutoTitles(tx *sql.Tx, ids ...int64) error {
	for _, id := range ids {
		if id == 0 {
			continue
		}
		var auto bool
		err := tx.QueryRow(`SELECT auto_title FROM items WHERE id = ?`, id).Scan(&auto)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if !auto {
			continue
		}
		var n int
		var first sql.NullString
		err = tx.QueryRow(`SELECT COUNT(*), (SELECT title FROM items WHERE parent_id = ?1 ORDER BY sort_order, id LIMIT 1)
			FROM items WHERE parent_id = ?1`, id).Scan(&n, &first)
		if err != nil {
			return err
		}
		if n == 0 {
			continue
		}
		if _, err := tx.Exec(`UPDATE items SET title = ? WHERE id = ?`, autoTitle(first.String, n), id); err != nil {
			return err
		}
	}
	return nil
}

// Descendants returns every item under id: each one's children right
// after it, in their order.
func (s *Store) Descendants(id int64) ([]Item, error) {
	all, err := s.queryItems(`WITH RECURSIVE down(id) AS (
			SELECT id FROM items WHERE parent_id = ? UNION SELECT i.id FROM items i JOIN down ON i.parent_id = down.id
		) SELECT `+itemColumns+` FROM items WHERE id IN (SELECT id FROM down) ORDER BY sort_order, id`, id)
	if err != nil {
		return nil, err
	}
	children := map[int64][]Item{}
	for _, it := range all {
		children[it.ParentID] = append(children[it.ParentID], it)
	}
	out := make([]Item, 0, len(all))
	var walk func(int64)
	walk = func(parent int64) {
		for _, it := range children[parent] {
			out = append(out, it)
			walk(it.ID)
		}
	}
	walk(id)
	return out, nil
}

// MoveItemToProject moves an item, with the items under it, to another
// project: at the end of its list, at the top level, all without a module.
func (s *Store) MoveItemToProject(id, projectID int64) (Item, error) {
	return s.updateItem(id, func(tx *sql.Tx, it Item) error {
		if it.ProjectID == projectID {
			return nil
		}
		if _, err := projectIn(tx, projectID); err != nil {
			return err
		}
		order, err := nextItemOrder(tx, projectID)
		if err != nil {
			return err
		}
		ids, err := subtreeIDs(tx, id)
		if err != nil {
			return err
		}
		now := s.millis()
		for _, v := range ids {
			if _, err := tx.Exec(`UPDATE items SET project_id = ?, module_id = NULL, updated_at = ? WHERE id = ?`, projectID, now, v); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE items SET parent_id = NULL, sort_order = ? WHERE id = ?`, order, id); err != nil {
			return err
		}
		return syncAutoTitles(tx, it.ParentID)
	})
}

// DeleteItem deletes an item. Its children move up a level, into its place.
func (s *Store) DeleteItem(id int64) error {
	return s.inTx(func(tx *sql.Tx) error {
		it, err := itemIn(tx, id)
		if err != nil {
			return err
		}
		children, err := childIDs(tx, it.ProjectID, id)
		if err != nil {
			return err
		}
		if len(children) > 0 {
			siblings, err := childIDs(tx, it.ProjectID, it.ParentID)
			if err != nil {
				return err
			}
			at := slices.Index(siblings, id)
			siblings = slices.Concat(siblings[:at], children, siblings[at+1:])
			if _, err := tx.Exec(`UPDATE items SET parent_id = ? WHERE parent_id = ?`, nullable(it.ParentID), id); err != nil {
				return err
			}
			if err := renumber(tx, `UPDATE items SET sort_order = ? WHERE id = ?`, siblings); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM items WHERE id = ?`, id); err != nil {
			return err
		}
		return syncAutoTitles(tx, it.ParentID)
	})
}
