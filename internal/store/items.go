package store

import (
	"database/sql"
	"errors"
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
// feature.
type Item struct {
	ID        int64 `json:"id"`
	ProjectID int64 `json:"projectId"`
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
	// SortOrder orders the items to do, as the user dragged them.
	SortOrder int64 `json:"sortOrder"`
	CreatedAt int64 `json:"createdAt"`
	// StartedAt is when the item became doing, or 0.
	StartedAt int64 `json:"startedAt"`
	// DoneAt is when the item was done, or 0.
	DoneAt    int64 `json:"doneAt"`
	UpdatedAt int64 `json:"updatedAt"`
}

const itemColumns = `id, project_id, COALESCE(module_id, 0), type, status, title, note, deeplink,
	sort_order, created_at, COALESCE(started_at, 0), COALESCE(done_at, 0), updated_at`

func scanItem(row scanner) (Item, error) {
	var it Item
	err := row.Scan(&it.ID, &it.ProjectID, &it.ModuleID, &it.Type, &it.Status, &it.Title, &it.Note, &it.Deeplink,
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

// CreateItem adds an item to do, at the end of the project's list.
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
		order, err := nextItemOrder(tx, in.ProjectID)
		if err != nil {
			return err
		}
		now := s.millis()
		res, err := tx.Exec(`INSERT INTO items (project_id, module_id, type, status, title, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, 'todo', ?, ?, ?, ?)`, in.ProjectID, nullable(in.ModuleID), in.Type, title, order, now, now)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
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

// SetItemTitle changes the title of an item.
func (s *Store) SetItemTitle(id int64, title string) (Item, error) {
	title, err := cleanLine(title, "标题", maxTitle)
	if err != nil {
		return Item{}, err
	}
	return s.updateItem(id, func(tx *sql.Tx, _ Item) error {
		_, err := tx.Exec(`UPDATE items SET title = ?, updated_at = ? WHERE id = ?`, title, s.millis(), id)
		return err
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

// MoveTodoItem moves an item to do right before the item to do anchorID,
// or right after it when after is true. It renumbers the project's items to
// do, so the order holds however the list was filtered when dragging.
func (s *Store) MoveTodoItem(id, anchorID int64, after bool) error {
	return s.inTx(func(tx *sql.Tx) error {
		it, err := itemIn(tx, id)
		if err != nil {
			return err
		}
		anchor, err := itemIn(tx, anchorID)
		if err != nil {
			return err
		}
		if it.Status != StatusTodo || anchor.Status != StatusTodo || anchor.ProjectID != it.ProjectID {
			return userErr("只能在同一个项目的待办里调整顺序")
		}
		if id == anchorID {
			return nil
		}
		ids, err := idsIn(tx, `SELECT id FROM items WHERE project_id = ? AND status = 'todo' ORDER BY sort_order, id`, it.ProjectID)
		if err != nil {
			return err
		}
		order := make([]int64, 0, len(ids))
		for _, v := range ids {
			if v != id {
				order = append(order, v)
			}
		}
		at := len(order)
		for i, v := range order {
			if v == anchorID {
				at = i
				if after {
					at++
				}
				break
			}
		}
		order = append(order[:at], append([]int64{id}, order[at:]...)...)
		return renumber(tx, `UPDATE items SET sort_order = ? WHERE id = ?`, order)
	})
}

// MoveItemToProject moves an item to another project, at the end of its
// list and without a module.
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
		_, err = tx.Exec(`UPDATE items SET project_id = ?, module_id = NULL, sort_order = ?, updated_at = ? WHERE id = ?`,
			projectID, order, s.millis(), id)
		return err
	})
}

// DeleteItem deletes an item.
func (s *Store) DeleteItem(id int64) error {
	return s.inTx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`DELETE FROM items WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}
