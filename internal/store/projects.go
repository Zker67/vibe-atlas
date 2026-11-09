package store

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Counts are how many items are in each status.
type Counts struct {
	Todo  int `json:"todo"`
	Doing int `json:"doing"`
	Done  int `json:"done"`
}

// Project is a whole project, such as a game, with its modules and items.
type Project struct {
	ID int64 `json:"id"`
	// Name is unique among projects, ignoring the case of Latin letters.
	Name string `json:"name"`
	// Description is the project's notes, in Markdown.
	Description string `json:"description"`
	// FolderPath is the local folder the project is bound to, or "".
	FolderPath string `json:"folderPath"`
	// FolderExists tells whether FolderPath is a folder that exists now.
	FolderExists bool `json:"folderExists"`
	// Icon is the icon the user chose (see checkIcon), or "" for 自动: the
	// one found in the folder, else the default.
	Icon string `json:"icon"`
	// DetectedIcon is the project's own icon found in its folder, an
	// "image:<name>" picture, or "".
	DetectedIcon string `json:"detectedIcon"`
	SortOrder    int64  `json:"sortOrder"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	// Counts are the project's items in each status.
	Counts Counts `json:"counts"`
}

const projectColumns = `p.id, p.name, p.description, p.folder_path, p.icon, p.detected_icon, p.sort_order, p.created_at, p.updated_at,
	COALESCE(SUM(i.status = 'todo'), 0), COALESCE(SUM(i.status = 'doing'), 0), COALESCE(SUM(i.status = 'done'), 0)`

type scanner interface{ Scan(dest ...any) error }

func scanProject(row scanner) (Project, error) {
	var p Project
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.FolderPath, &p.Icon, &p.DetectedIcon, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
		&p.Counts.Todo, &p.Counts.Doing, &p.Counts.Done)
	if err != nil {
		return p, err
	}
	p.FolderExists = folderExists(p.FolderPath)
	return p, nil
}

func folderExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// Projects returns every project in the user's order.
func (s *Store) Projects() ([]Project, error) {
	rows, err := s.db.Query(`SELECT ` + projectColumns + `
		FROM projects p LEFT JOIN items i ON i.project_id = p.id
		GROUP BY p.id ORDER BY p.sort_order, p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

// Project returns the project with id.
func (s *Store) Project(id int64) (Project, error) {
	return projectIn(s.db, id)
}

type queryer interface {
	QueryRow(query string, args ...any) *sql.Row
}

func projectIn(q queryer, id int64) (Project, error) {
	p, err := scanProject(q.QueryRow(`SELECT `+projectColumns+`
		FROM projects p LEFT JOIN items i ON i.project_id = p.id
		WHERE p.id = ? GROUP BY p.id`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func projectNameTaken(tx *sql.Tx, name string, except int64) (bool, error) {
	var n int
	err := tx.QueryRow(`SELECT COUNT(*) FROM projects WHERE name = ? AND id != ?`, name, except).Scan(&n)
	return n > 0, err
}

// CreateProject adds a project named name at the end of the list.
func (s *Store) CreateProject(name string) (Project, error) {
	return s.AddProject(ProjectDraft{Name: name}, "")
}

// ProjectDraft is what the user fills in to add or edit a project.
type ProjectDraft struct {
	// Name may be left empty when FolderPath is set: the folder's name is
	// taken.
	Name string `json:"name"`
	// FolderPath is an absolute path, or "" for no folder.
	FolderPath string `json:"folderPath"`
	// Icon is as Project.Icon: "" for 自动.
	Icon string `json:"icon"`
}

// clean checks the draft and fills in the name from the folder.
func (d ProjectDraft) clean() (ProjectDraft, error) {
	if d.FolderPath != "" {
		if !filepath.IsAbs(d.FolderPath) {
			return d, userErr("文件夹路径需要是完整路径")
		}
		d.FolderPath = filepath.Clean(d.FolderPath)
		if strings.TrimSpace(d.Name) == "" {
			d.Name = FolderName(d.FolderPath)
		}
	}
	name, err := cleanLine(d.Name, "项目名称", maxProjectName)
	if err != nil {
		return d, err
	}
	d.Name = name
	if err := checkIcon(d.Icon); err != nil {
		return d, err
	}
	return d, nil
}

// FolderName is the last part of path, or "" for the root of a drive. It
// is cut to the longest name a project may have.
func FolderName(path string) string {
	base := filepath.Base(path)
	if base == "." || strings.Trim(base, `/\`) == "" || base == filepath.VolumeName(path) {
		return ""
	}
	if r := []rune(base); len(r) > maxProjectName {
		base = string(r[:maxProjectName])
	}
	return base
}

// AddProject adds a project at the end of the list, with the icon detected
// in its folder, or "".
func (s *Store) AddProject(d ProjectDraft, detected string) (Project, error) {
	d, err := d.clean()
	if err != nil {
		return Project{}, err
	}
	if err := checkDetected(detected); err != nil {
		return Project{}, err
	}
	var p Project
	err = s.inTx(func(tx *sql.Tx) error {
		taken, err := projectNameTaken(tx, d.Name, 0)
		if err != nil {
			return err
		}
		if taken {
			return userErr("已经有叫「%s」的项目了", d.Name)
		}
		now := s.millis()
		res, err := tx.Exec(`INSERT INTO projects (name, folder_path, icon, detected_icon, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM projects), ?, ?)`,
			d.Name, d.FolderPath, d.Icon, detected, now, now)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		p, err = projectIn(tx, id)
		return err
	})
	return p, err
}

// EditProject replaces the name, folder and icon of the project with id,
// and the icon detected in its folder.
func (s *Store) EditProject(id int64, d ProjectDraft, detected string) (Project, error) {
	d, err := d.clean()
	if err != nil {
		return Project{}, err
	}
	if err := checkDetected(detected); err != nil {
		return Project{}, err
	}
	var p Project
	err = s.inTx(func(tx *sql.Tx) error {
		if _, err := projectIn(tx, id); err != nil {
			return err
		}
		taken, err := projectNameTaken(tx, d.Name, id)
		if err != nil {
			return err
		}
		if taken {
			return userErr("已经有叫「%s」的项目了", d.Name)
		}
		if _, err := tx.Exec(`UPDATE projects SET name = ?, folder_path = ?, icon = ?, detected_icon = ?, updated_at = ?
			WHERE id = ?`, d.Name, d.FolderPath, d.Icon, detected, s.millis(), id); err != nil {
			return err
		}
		p, err = projectIn(tx, id)
		return err
	})
	return p, err
}

// SetProjectIcon sets the icon the user chose for the project, "" for 自动.
func (s *Store) SetProjectIcon(id int64, icon string) (Project, error) {
	if err := checkIcon(icon); err != nil {
		return Project{}, err
	}
	return s.updateProject(id, `UPDATE projects SET icon = ?, updated_at = ? WHERE id = ?`, icon)
}

// SetProjectDetectedIcon records the icon found in the project's folder,
// or "" for none. It leaves updated_at alone: the user changed nothing.
func (s *Store) SetProjectDetectedIcon(id int64, icon string) (Project, error) {
	if err := checkDetected(icon); err != nil {
		return Project{}, err
	}
	var p Project
	err := s.inTx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE projects SET detected_icon = ? WHERE id = ?`, icon, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		p, err = projectIn(tx, id)
		return err
	})
	return p, err
}

// RenameProject renames the project with id.
func (s *Store) RenameProject(id int64, name string) (Project, error) {
	name, err := cleanLine(name, "项目名称", maxProjectName)
	if err != nil {
		return Project{}, err
	}
	var p Project
	err = s.inTx(func(tx *sql.Tx) error {
		if _, err := projectIn(tx, id); err != nil {
			return err
		}
		taken, err := projectNameTaken(tx, name, id)
		if err != nil {
			return err
		}
		if taken {
			return userErr("已经有叫「%s」的项目了", name)
		}
		if _, err := tx.Exec(`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`, name, s.millis(), id); err != nil {
			return err
		}
		p, err = projectIn(tx, id)
		return err
	})
	return p, err
}

// SetProjectDescription replaces the project's notes.
func (s *Store) SetProjectDescription(id int64, description string) (Project, error) {
	if err := checkText(description, "项目说明"); err != nil {
		return Project{}, err
	}
	return s.updateProject(id, `UPDATE projects SET description = ?, updated_at = ? WHERE id = ?`, description)
}

// SetProjectFolder binds the project to the local folder at path, an
// absolute path, or unbinds it when path is "".
func (s *Store) SetProjectFolder(id int64, path string) (Project, error) {
	if path != "" {
		if !filepath.IsAbs(path) {
			return Project{}, userErr("文件夹路径需要是完整路径")
		}
		path = filepath.Clean(path)
	}
	// The icon found in the old folder is not the new one's.
	return s.updateProject(id, `UPDATE projects SET
		detected_icon = CASE WHEN folder_path = ?1 THEN detected_icon ELSE '' END,
		folder_path = ?1, updated_at = ?2 WHERE id = ?3`, path)
}

func (s *Store) updateProject(id int64, query string, value string) (Project, error) {
	var p Project
	err := s.inTx(func(tx *sql.Tx) error {
		res, err := tx.Exec(query, value, s.millis(), id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		p, err = projectIn(tx, id)
		return err
	})
	return p, err
}

// DeleteProject deletes the project with its modules and items.
func (s *Store) DeleteProject(id int64) error {
	return s.inTx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`DELETE FROM projects WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// ReorderProjects puts the projects in the order of ids. Projects missing
// from ids keep their order after those listed; unknown ids are ignored.
func (s *Store) ReorderProjects(ids []int64) error {
	return s.inTx(func(tx *sql.Tx) error {
		current, err := idsIn(tx, `SELECT id FROM projects ORDER BY sort_order, id`)
		if err != nil {
			return err
		}
		return renumber(tx, `UPDATE projects SET sort_order = ? WHERE id = ?`, reorder(current, ids))
	})
}

// idsIn returns the ids a query selects, read to the end so that the one
// connection is free for the next statement.
func idsIn(tx *sql.Tx, query string, args ...any) ([]int64, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// reorder returns current with the ids of wanted first, in their order,
// then the others of current in theirs.
func reorder(current, wanted []int64) []int64 {
	known := make(map[int64]bool, len(current))
	for _, id := range current {
		known[id] = true
	}
	out := make([]int64, 0, len(current))
	placed := make(map[int64]bool, len(current))
	for _, id := range wanted {
		if known[id] && !placed[id] {
			out = append(out, id)
			placed[id] = true
		}
	}
	for _, id := range current {
		if !placed[id] {
			out = append(out, id)
		}
	}
	return out
}

// renumber gives ids the sort orders 1, 2, 3… in their order.
func renumber(tx *sql.Tx, query string, ids []int64) error {
	stmt, err := tx.Prepare(query)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for i, id := range ids {
		if _, err := stmt.Exec(i+1, id); err != nil {
			return err
		}
	}
	return nil
}
