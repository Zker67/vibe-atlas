package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
)

// TrashEntry is an item in the trash, as it was when it was deleted.
type TrashEntry struct {
	// ID is the entry's, which RestoreTrash and PurgeTrash take.
	ID int64 `json:"id"`
	// Batch is shared by the entries deleted together, which RestoreBatch
	// brings back at once.
	Batch     int64 `json:"batch"`
	DeletedAt int64 `json:"deletedAt"`
	// Item is the item as it was: its id, which it gets back, and its
	// parent then.
	Item Item `json:"item"`
	// Lifted is how many of its children moved up a level when it went.
	Lifted int `json:"lifted"`
}

// trashRef is an item a trash entry refers to, told from a later item that
// took the same id by when it was created.
type trashRef struct {
	ID      int64 `json:"id"`
	Created int64 `json:"created"`
}

const trashColumns = `t.id, t.batch, t.deleted_at, t.item_id, t.project_id, COALESCE(t.parent_id, 0), COALESCE(t.module_id, 0),
	t.type, t.status, t.title, t.note, t.deeplink, t.created_at, COALESCE(t.started_at, 0), COALESCE(t.done_at, 0),
	COALESCE(t.done_with, 0), t.updated_at, json_array_length(t.lifted)`

func scanTrash(row scanner) (TrashEntry, error) {
	var e TrashEntry
	it := &e.Item
	err := row.Scan(&e.ID, &e.Batch, &e.DeletedAt, &it.ID, &it.ProjectID, &it.ParentID, &it.ModuleID,
		&it.Type, &it.Status, &it.Title, &it.Note, &it.Deeplink, &it.CreatedAt, &it.StartedAt, &it.DoneAt,
		&it.DoneWith, &it.UpdatedAt, &e.Lifted)
	return e, err
}

// Trash returns the items in the trash of every project, the last deleted
// first.
func (s *Store) Trash() ([]TrashEntry, error) {
	rows, err := s.db.Query(`SELECT ` + trashColumns + ` FROM trash t ORDER BY t.deleted_at DESC, t.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrashEntry{}
	for rows.Next() {
		e, err := scanTrash(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// TrashCount returns how many items the trash holds.
func (s *Store) TrashCount() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM trash`).Scan(&n)
	return n, err
}

// TrashItems moves the items ids to the trash, in their order, all at
// once: when one fails, none moves. As DeleteItem, each one's children
// move up a level, into its place; the trash remembers them, and where the
// item sat, to put it back. It returns the batch of the entries.
func (s *Store) TrashItems(ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, userErr("没有要删除的改进点")
	}
	var batch int64
	err := s.inTx(func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT COALESCE(MAX(batch), 0) + 1 FROM trash`).Scan(&batch); err != nil {
			return err
		}
		now := s.millis()
		for _, id := range ids {
			if err := trashItemIn(tx, id, batch, now); err != nil {
				return err
			}
		}
		return nil
	})
	return batch, err
}

func trashItemIn(tx *sql.Tx, id, batch, now int64) error {
	it, err := itemIn(tx, id)
	if err != nil {
		return err
	}
	siblings, err := childIDs(tx, it.ProjectID, it.ParentID)
	if err != nil {
		return err
	}
	var parentCreated any
	if it.ParentID != 0 {
		p, err := itemIn(tx, it.ParentID)
		if err != nil {
			return err
		}
		parentCreated = p.CreatedAt
	}
	lifted, err := refsIn(tx, `SELECT id, created_at FROM items WHERE parent_id = ? ORDER BY sort_order, id`, id)
	if err != nil {
		return err
	}
	carried, err := refsIn(tx, `SELECT id, created_at FROM items WHERE done_with = ? ORDER BY id`, id)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO trash (batch, deleted_at, item_id, project_id, parent_id, parent_created, place, module_id,
			type, status, title, note, deeplink, auto_title, created_at, started_at, done_at, done_with, updated_at, lifted, carried)
		SELECT ?, ?, id, project_id, parent_id, ?, ?, module_id,
			type, status, title, note, deeplink, auto_title, created_at, started_at, done_at, done_with, updated_at, ?, ?
		FROM items WHERE id = ?`,
		batch, now, parentCreated, slices.Index(siblings, id), lifted, carried, id); err != nil {
		return err
	}
	return deleteItemIn(tx, id)
}

// refsIn returns the items a query of (id, created_at) selects as a JSON
// list of trashRef.
func refsIn(tx *sql.Tx, query string, args ...any) (string, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	refs := []trashRef{}
	for rows.Next() {
		var r trashRef
		if err := rows.Scan(&r.ID, &r.Created); err != nil {
			return "", err
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	b, err := json.Marshal(refs)
	return string(b), err
}

// RestoreTrash puts the items of the trash entries ids back, all at once:
// when one fails, none comes back. It returns them as they are back, the
// first deleted first.
//
// Each goes back under its parent, at its place among its siblings, with
// the children that moved up when it went and have stayed there since;
// without its parent (deleted, or moved to another project), at the end of
// its project's top level. Its module, gone, makes it 未分类. The items it
// had carried to done, still under it and done, are carried again.
func (s *Store) RestoreTrash(ids []int64) ([]Item, error) {
	var out []Item
	err := s.inTx(func(tx *sql.Tx) error {
		var err error
		out, err = restoreIn(tx, ids)
		return err
	})
	return out, err
}

// RestoreBatch puts back the items of the trash deleted together in batch,
// as RestoreTrash does. Entries of the batch restored or purged since are
// left out; with none left, it fails.
func (s *Store) RestoreBatch(batch int64) ([]Item, error) {
	var out []Item
	err := s.inTx(func(tx *sql.Tx) error {
		ids, err := idsIn(tx, `SELECT id FROM trash WHERE batch = ?`, batch)
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return userErr("回收站里已经没有这些改进点了")
		}
		out, err = restoreIn(tx, ids)
		return err
	})
	return out, err
}

func restoreIn(tx *sql.Tx, ids []int64) ([]Item, error) {
	// The last deleted goes back first: undoing the deletions one by one,
	// each finds the items around it as they were when it went.
	order := slices.Clone(ids)
	slices.Sort(order)
	order = slices.Compact(order)
	restored := make([]Item, 0, len(order))
	for i := len(order) - 1; i >= 0; i-- {
		it, err := restoreEntryIn(tx, order[i])
		if err != nil {
			return nil, err
		}
		restored = append(restored, it)
	}
	slices.Reverse(restored)
	// As they are now: items put back after one may have changed it.
	out := make([]Item, 0, len(restored))
	for _, r := range restored {
		it, err := itemIn(tx, r.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, nil
}

func restoreEntryIn(tx *sql.Tx, entryID int64) (Item, error) {
	var (
		id, projectID, place              int64
		parentID, parentCreated, moduleID sql.NullInt64
		doneWith                          sql.NullInt64
		liftedJSON, carriedJSON           string
	)
	err := tx.QueryRow(`SELECT item_id, project_id, parent_id, parent_created, place, module_id, done_with, lifted, carried
		FROM trash WHERE id = ?`, entryID).
		Scan(&id, &projectID, &parentID, &parentCreated, &place, &moduleID, &doneWith, &liftedJSON, &carriedJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, err
	}
	var lifted, carried []trashRef
	if err := json.Unmarshal([]byte(liftedJSON), &lifted); err != nil {
		return Item{}, err
	}
	if err := json.Unmarshal([]byte(carriedJSON), &carried); err != nil {
		return Item{}, err
	}

	// Its parent, if still there in its project; else the top level.
	parent := int64(0)
	if parentID.Valid {
		if p, err := itemIn(tx, parentID.Int64); err == nil && p.ProjectID == projectID && p.CreatedAt == parentCreated.Int64 {
			parent = p.ID
		} else if err != nil && !errors.Is(err, ErrNotFound) {
			return Item{}, err
		}
	}
	module := int64(0)
	if moduleID.Valid {
		if m, err := moduleIn(tx, moduleID.Int64); err == nil && m.ProjectID == projectID {
			module = m.ID
		} else if err != nil && !errors.Is(err, ErrNotFound) {
			return Item{}, err
		}
	}
	// Ids of the trash stay free (see newItemID); should one be taken
	// anyway, the item comes back with a new one.
	var taken int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM items WHERE id = ?`, id).Scan(&taken); err != nil {
		return Item{}, err
	}
	newID := id
	if taken > 0 {
		if newID, err = newItemID(tx); err != nil {
			return Item{}, err
		}
	}
	if _, err := tx.Exec(`INSERT INTO items (id, project_id, parent_id, module_id, type, status, title, note, deeplink,
			auto_title, sort_order, created_at, started_at, done_at, updated_at)
		SELECT ?, project_id, ?, ?, type, status, title, note, deeplink, auto_title, 0, created_at, started_at, done_at, updated_at
		FROM trash WHERE id = ?`, newID, nullable(parent), nullable(module), entryID); err != nil {
		return Item{}, err
	}
	if _, err := tx.Exec(`DELETE FROM trash WHERE id = ?`, entryID); err != nil {
		return Item{}, err
	}

	// The children that moved up when it went, still where they moved to.
	var back []int64
	if parent != 0 || !parentID.Valid {
		for _, r := range lifted {
			c, err := itemIn(tx, r.ID)
			if errors.Is(err, ErrNotFound) {
				continue
			}
			if err != nil {
				return Item{}, err
			}
			if c.CreatedAt == r.Created && c.ProjectID == projectID && c.ParentID == parent {
				back = append(back, c.ID)
			}
		}
	}
	siblings, err := childIDs(tx, projectID, parent)
	if err != nil {
		return Item{}, err
	}
	siblings = slices.DeleteFunc(siblings, func(v int64) bool { return v == newID || slices.Contains(back, v) })
	at := len(siblings)
	if parent != 0 || !parentID.Valid {
		at = min(max(int(place), 0), len(siblings))
	}
	siblings = slices.Insert(siblings, at, newID)
	if err := renumber(tx, `UPDATE items SET sort_order = ? WHERE id = ?`, siblings); err != nil {
		return Item{}, err
	}
	if len(back) > 0 {
		for _, c := range back {
			if _, err := tx.Exec(`UPDATE items SET parent_id = ? WHERE id = ?`, newID, c); err != nil {
				return Item{}, err
			}
		}
		if err := renumber(tx, `UPDATE items SET sort_order = ? WHERE id = ?`, back); err != nil {
			return Item{}, err
		}
	}

	// What carried it to done, if still above it; what it carried, if
	// still under it and done.
	if doneWith.Valid {
		if above, err := within(tx, newID, doneWith.Int64); err != nil {
			return Item{}, err
		} else if above && doneWith.Int64 != newID {
			if _, err := tx.Exec(`UPDATE items SET done_with = ? WHERE id = ? AND status = 'done'`, doneWith.Int64, newID); err != nil {
				return Item{}, err
			}
		}
	}
	for _, r := range carried {
		c, err := itemIn(tx, r.ID)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return Item{}, err
		}
		if c.CreatedAt != r.Created || c.Status != StatusDone || c.DoneWith != 0 {
			continue
		}
		under, err := within(tx, c.ID, newID)
		if err != nil {
			return Item{}, err
		}
		if under {
			if _, err := tx.Exec(`UPDATE items SET done_with = ? WHERE id = ?`, newID, c.ID); err != nil {
				return Item{}, err
			}
		}
	}
	if err := syncAutoTitles(tx, parent, newID); err != nil {
		return Item{}, err
	}
	return itemIn(tx, newID)
}

// PurgeTrash deletes the trash entries ids for good.
func (s *Store) PurgeTrash(ids []int64) error {
	return s.inTx(func(tx *sql.Tx) error {
		for _, id := range ids {
			if _, err := tx.Exec(`DELETE FROM trash WHERE id = ?`, id); err != nil {
				return err
			}
		}
		return nil
	})
}

// EmptyTrash deletes every entry of the trash for good and returns how
// many there were.
func (s *Store) EmptyTrash() (int, error) {
	res, err := s.db.Exec(`DELETE FROM trash`)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}

// PurgeTrashBefore deletes for good the entries of the trash deleted
// before cutoff, in Unix milliseconds, and returns how many.
func (s *Store) PurgeTrashBefore(cutoff int64) (int, error) {
	res, err := s.db.Exec(`DELETE FROM trash WHERE deleted_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}
