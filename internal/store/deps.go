package store

import (
	"database/sql"
	"encoding/json"
	"errors"
)

// Dep is a prerequisite: the item ToID waits for the item FromID to be
// done. Both are of one project. It tells only: no status changes because
// of it, and the user may start or finish an item still waiting.
type Dep struct {
	// FromID is the item done first, the prerequisite.
	FromID int64 `json:"fromId"`
	// ToID is the item that waits for it.
	ToID      int64 `json:"toId"`
	CreatedAt int64 `json:"createdAt"`
}

// Deps returns the prerequisites between the items of a project, the
// oldest first.
func (s *Store) Deps(projectID int64) ([]Dep, error) {
	return depsIn(s.db, projectID)
}

type rowsQueryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

func depsIn(q rowsQueryer, projectID int64) ([]Dep, error) {
	rows, err := q.Query(`SELECT d.from_id, d.to_id, d.created_at FROM item_deps d JOIN items i ON i.id = d.from_id
		WHERE i.project_id = ? ORDER BY d.created_at, d.from_id, d.to_id`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Dep{}
	for rows.Next() {
		var d Dep
		if err := rows.Scan(&d.FromID, &d.ToID, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// AddDep makes toID wait for fromID. Both must be of one project, neither
// above the other, and the new prerequisite must not close a loop. When
// it is there already, it returns it as it is.
func (s *Store) AddDep(fromID, toID int64) (Dep, error) {
	var d Dep
	err := s.inTx(func(tx *sql.Tx) error {
		var err error
		d, err = addDepIn(tx, fromID, toID, s.millis())
		return err
	})
	return d, err
}

func addDepIn(tx *sql.Tx, fromID, toID, now int64) (Dep, error) {
	if fromID == toID {
		return Dep{}, userErr("前置和后续不能是同一条改进点")
	}
	from, err := itemIn(tx, fromID)
	if err != nil {
		return Dep{}, err
	}
	to, err := itemIn(tx, toID)
	if err != nil {
		return Dep{}, err
	}
	if from.ProjectID != to.ProjectID {
		return Dep{}, userErr("只能和同一个项目里的改进点建立前置关系")
	}
	d := Dep{FromID: fromID, ToID: toID}
	err = tx.QueryRow(`SELECT created_at FROM item_deps WHERE from_id = ? AND to_id = ?`, fromID, toID).Scan(&d.CreatedAt)
	if err == nil {
		return d, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Dep{}, err
	}
	for _, pair := range [][2]int64{{fromID, toID}, {toID, fromID}} {
		under, err := within(tx, pair[0], pair[1])
		if err != nil {
			return Dep{}, err
		}
		if under {
			return Dep{}, userErr("不能和自己的上级或子改进点建立前置关系")
		}
	}
	loop, err := waitsFor(tx, fromID, toID)
	if err != nil {
		return Dep{}, err
	}
	if loop {
		return Dep{}, userErr("会形成循环：「%s」已经在等「%s」", clipTitle(from.Title), clipTitle(to.Title))
	}
	d.CreatedAt = now
	_, err = tx.Exec(`INSERT INTO item_deps (from_id, to_id, created_at) VALUES (?, ?, ?)`, fromID, toID, now)
	return d, err
}

// waitsFor reports whether id waits for other, directly or through other
// prerequisites: whether other reaches id along them.
func waitsFor(tx *sql.Tx, id, other int64) (bool, error) {
	var n int
	err := tx.QueryRow(`WITH RECURSIVE reach(id) AS (
			SELECT ? UNION SELECT d.to_id FROM item_deps d JOIN reach r ON d.from_id = r.id
		) SELECT COUNT(*) FROM reach WHERE id = ?`, other, id).Scan(&n)
	return n > 0, err
}

// clipTitle shortens a title for a message.
func clipTitle(title string) string {
	r := []rune(title)
	if len(r) > 20 {
		return string(r[:20]) + "…"
	}
	return title
}

// RemoveDep makes toID no longer wait for fromID. Removing one that is
// not there does nothing.
func (s *Store) RemoveDep(fromID, toID int64) error {
	_, err := s.db.Exec(`DELETE FROM item_deps WHERE from_id = ? AND to_id = ?`, fromID, toID)
	return err
}

// dropForeignDeps removes the prerequisites between items of different
// projects, as moving items to another project leaves them.
func dropForeignDeps(tx *sql.Tx) error {
	_, err := tx.Exec(`DELETE FROM item_deps WHERE
		(SELECT project_id FROM items WHERE id = from_id) <> (SELECT project_id FROM items WHERE id = to_id)`)
	return err
}

// trashDep is a prerequisite of an item in the trash: the other item, told
// from a later one with its id by when it was created, and which way it
// goes. Next: the other one waits for this one; else this one waits for it.
type trashDep struct {
	ID      int64 `json:"id"`
	Created int64 `json:"created"`
	Next    bool  `json:"next"`
}

// depsOfIn returns the prerequisites of id, both ways, as the trash keeps
// them: a JSON list of trashDep.
func depsOfIn(tx *sql.Tx, id int64) (string, error) {
	rows, err := tx.Query(`SELECT i.id, i.created_at, 1 FROM item_deps d JOIN items i ON i.id = d.to_id WHERE d.from_id = ?1
		UNION ALL SELECT i.id, i.created_at, 0 FROM item_deps d JOIN items i ON i.id = d.from_id WHERE d.to_id = ?1
		ORDER BY 1`, id)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	deps := []trashDep{}
	for rows.Next() {
		var d trashDep
		if err := rows.Scan(&d.ID, &d.Created, &d.Next); err != nil {
			return "", err
		}
		deps = append(deps, d)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	b, err := json.Marshal(deps)
	return string(b), err
}

// restoreDepsIn puts back the prerequisites of it, just back from the
// trash, as depsJSON kept them. One goes back when the other item is still
// there, in its project, and it closes no loop; when the other item is in
// the trash too, it goes to that one's entry, to come back with it.
func restoreDepsIn(tx *sql.Tx, it Item, depsJSON string, now int64) error {
	var deps []trashDep
	if err := json.Unmarshal([]byte(depsJSON), &deps); err != nil {
		return err
	}
	for _, d := range deps {
		other, err := itemIn(tx, d.ID)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		if err == nil && other.CreatedAt == d.Created {
			if other.ProjectID != it.ProjectID {
				continue
			}
			from, to := other.ID, it.ID
			if d.Next {
				from, to = it.ID, other.ID
			}
			if _, err := addDepIn(tx, from, to, now); err != nil {
				var ue *Error
				if errors.As(err, &ue) {
					continue // a loop now, or the two sit one above the other: left out
				}
				return err
			}
			continue
		}
		if err := handOverDep(tx, d, it); err != nil {
			return err
		}
	}
	return nil
}

// handOverDep gives a prerequisite of it, just back from the trash, to the
// entry of the other item, when that one is in the trash, so that it comes
// back with that one.
func handOverDep(tx *sql.Tx, d trashDep, it Item) error {
	var entry int64
	var depsJSON string
	err := tx.QueryRow(`SELECT id, deps FROM trash WHERE item_id = ? AND created_at = ? ORDER BY id DESC LIMIT 1`, d.ID, d.Created).
		Scan(&entry, &depsJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var theirs []trashDep
	if err := json.Unmarshal([]byte(depsJSON), &theirs); err != nil {
		return err
	}
	mine := trashDep{ID: it.ID, Created: it.CreatedAt, Next: !d.Next}
	for _, t := range theirs {
		if t == mine {
			return nil
		}
	}
	b, err := json.Marshal(append(theirs, mine))
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE trash SET deps = ? WHERE id = ?`, string(b), entry)
	return err
}
