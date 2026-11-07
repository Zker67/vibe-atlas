package store

import (
	"database/sql"
	"errors"
)

// Module is a part of a project, such as its weapons, its characters or
// its UI. An item belongs to one module of its project, or to none, which
// the pages show as 「未分类」.
type Module struct {
	ID        int64 `json:"id"`
	ProjectID int64 `json:"projectId"`
	// Name is unique within the project, ignoring the case of Latin letters.
	Name      string `json:"name"`
	SortOrder int64  `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
	// Counts are the module's items in each status.
	Counts Counts `json:"counts"`
}

const moduleColumns = `m.id, m.project_id, m.name, m.sort_order, m.created_at,
	COALESCE(SUM(i.status = 'todo'), 0), COALESCE(SUM(i.status = 'doing'), 0), COALESCE(SUM(i.status = 'done'), 0)`

func scanModule(row scanner) (Module, error) {
	var m Module
	err := row.Scan(&m.ID, &m.ProjectID, &m.Name, &m.SortOrder, &m.CreatedAt,
		&m.Counts.Todo, &m.Counts.Doing, &m.Counts.Done)
	return m, err
}

// Modules returns the modules of a project in the user's order.
func (s *Store) Modules(projectID int64) ([]Module, error) {
	rows, err := s.db.Query(`SELECT `+moduleColumns+`
		FROM modules m LEFT JOIN items i ON i.module_id = m.id
		WHERE m.project_id = ? GROUP BY m.id ORDER BY m.sort_order, m.id`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	modules := []Module{}
	for rows.Next() {
		m, err := scanModule(rows)
		if err != nil {
			return nil, err
		}
		modules = append(modules, m)
	}
	return modules, rows.Err()
}

func moduleIn(q queryer, id int64) (Module, error) {
	m, err := scanModule(q.QueryRow(`SELECT `+moduleColumns+`
		FROM modules m LEFT JOIN items i ON i.module_id = m.id
		WHERE m.id = ? GROUP BY m.id`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

func moduleNameTaken(tx *sql.Tx, projectID int64, name string, except int64) (bool, error) {
	var n int
	err := tx.QueryRow(`SELECT COUNT(*) FROM modules WHERE project_id = ? AND name = ? AND id != ?`,
		projectID, name, except).Scan(&n)
	return n > 0, err
}

// CreateModule adds a module named name at the end of the project's.
func (s *Store) CreateModule(projectID int64, name string) (Module, error) {
	name, err := cleanLine(name, "模块名称", maxModuleName)
	if err != nil {
		return Module{}, err
	}
	var m Module
	err = s.inTx(func(tx *sql.Tx) error {
		if _, err := projectIn(tx, projectID); err != nil {
			return err
		}
		taken, err := moduleNameTaken(tx, projectID, name, 0)
		if err != nil {
			return err
		}
		if taken {
			return userErr("这个项目里已经有「%s」模块了", name)
		}
		res, err := tx.Exec(`INSERT INTO modules (project_id, name, sort_order, created_at)
			VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules WHERE project_id = ?), ?)`,
			projectID, name, projectID, s.millis())
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		m, err = moduleIn(tx, id)
		return err
	})
	return m, err
}

// RenameModule renames the module with id.
func (s *Store) RenameModule(id int64, name string) (Module, error) {
	name, err := cleanLine(name, "模块名称", maxModuleName)
	if err != nil {
		return Module{}, err
	}
	var m Module
	err = s.inTx(func(tx *sql.Tx) error {
		current, err := moduleIn(tx, id)
		if err != nil {
			return err
		}
		taken, err := moduleNameTaken(tx, current.ProjectID, name, id)
		if err != nil {
			return err
		}
		if taken {
			return userErr("这个项目里已经有「%s」模块了", name)
		}
		if _, err := tx.Exec(`UPDATE modules SET name = ? WHERE id = ?`, name, id); err != nil {
			return err
		}
		m, err = moduleIn(tx, id)
		return err
	})
	return m, err
}

// DeleteModule deletes the module with id. Its items stay in the project,
// without a module; DeleteModule returns how many there were.
func (s *Store) DeleteModule(id int64) (int, error) {
	var moved int
	err := s.inTx(func(tx *sql.Tx) error {
		if _, err := moduleIn(tx, id); err != nil {
			return err
		}
		res, err := tx.Exec(`UPDATE items SET module_id = NULL, updated_at = ? WHERE module_id = ?`, s.millis(), id)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		moved = int(n)
		_, err = tx.Exec(`DELETE FROM modules WHERE id = ?`, id)
		return err
	})
	return moved, err
}

// ReorderModules puts the modules of a project in the order of ids, as
// ReorderProjects does for projects.
func (s *Store) ReorderModules(projectID int64, ids []int64) error {
	return s.inTx(func(tx *sql.Tx) error {
		if _, err := projectIn(tx, projectID); err != nil {
			return err
		}
		current, err := idsIn(tx, `SELECT id FROM modules WHERE project_id = ? ORDER BY sort_order, id`, projectID)
		if err != nil {
			return err
		}
		return renumber(tx, `UPDATE modules SET sort_order = ? WHERE id = ?`, reorder(current, ids))
	})
}
