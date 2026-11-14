package store

import (
	"database/sql"
	"errors"
)

// PersonalOrg is the id of 个人, the organization every database has, which
// projects go to unless the user picks another. It cannot be deleted.
const PersonalOrg int64 = 1

// Org is an organization: the projects of one source, such as the user's
// own or a company's. It only groups projects on this machine; there are
// no members.
type Org struct {
	ID int64 `json:"id"`
	// Name is unique among organizations, ignoring the case of Latin letters.
	Name string `json:"name"`
	// Icon is the icon the user chose (see checkIcon), or "" for the default.
	Icon string `json:"icon"`
	// Personal marks 个人, which cannot be deleted.
	Personal  bool  `json:"personal"`
	CreatedAt int64 `json:"createdAt"`
}

// OrgDraft is what the user fills in to add or edit an organization.
type OrgDraft struct {
	Name string `json:"name"`
	// Icon is as Org.Icon.
	Icon string `json:"icon"`
}

const maxOrgName = 40

func (d OrgDraft) clean() (OrgDraft, error) {
	name, err := cleanLine(d.Name, "组织名称", maxOrgName)
	if err != nil {
		return d, err
	}
	d.Name = name
	if err := checkIcon(d.Icon); err != nil {
		return d, err
	}
	return d, nil
}

const orgColumns = `id, name, icon, created_at`

func scanOrg(row scanner) (Org, error) {
	var o Org
	err := row.Scan(&o.ID, &o.Name, &o.Icon, &o.CreatedAt)
	o.Personal = o.ID == PersonalOrg
	return o, err
}

// Orgs returns every organization: 个人 first, then the others in the order
// they were added.
func (s *Store) Orgs() ([]Org, error) {
	rows, err := s.db.Query(`SELECT ` + orgColumns + ` FROM orgs ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	orgs := []Org{}
	for rows.Next() {
		o, err := scanOrg(rows)
		if err != nil {
			return nil, err
		}
		orgs = append(orgs, o)
	}
	return orgs, rows.Err()
}

// Org returns the organization with id.
func (s *Store) Org(id int64) (Org, error) {
	return orgIn(s.db, id)
}

func orgIn(q queryer, id int64) (Org, error) {
	o, err := scanOrg(q.QueryRow(`SELECT `+orgColumns+` FROM orgs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return o, ErrNotFound
	}
	return o, err
}

func orgNameFree(tx *sql.Tx, name string, except int64) error {
	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM orgs WHERE name = ? AND id != ?`, name, except).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return userErr("已经有叫「%s」的组织了", name)
	}
	return nil
}

// CreateOrg adds an organization, after the others.
func (s *Store) CreateOrg(d OrgDraft) (Org, error) {
	d, err := d.clean()
	if err != nil {
		return Org{}, err
	}
	var o Org
	err = s.inTx(func(tx *sql.Tx) error {
		if err := orgNameFree(tx, d.Name, 0); err != nil {
			return err
		}
		res, err := tx.Exec(`INSERT INTO orgs (name, icon, created_at) VALUES (?, ?, ?)`, d.Name, d.Icon, s.millis())
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		o, err = orgIn(tx, id)
		return err
	})
	return o, err
}

// EditOrg replaces the name and icon of the organization with id.
func (s *Store) EditOrg(id int64, d OrgDraft) (Org, error) {
	d, err := d.clean()
	if err != nil {
		return Org{}, err
	}
	var o Org
	err = s.inTx(func(tx *sql.Tx) error {
		if _, err := orgIn(tx, id); err != nil {
			return err
		}
		if err := orgNameFree(tx, d.Name, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE orgs SET name = ?, icon = ? WHERE id = ?`, d.Name, d.Icon, id); err != nil {
			return err
		}
		o, err = orgIn(tx, id)
		return err
	})
	return o, err
}

// DeleteOrg deletes the organization with id. Its projects, with all they
// hold, move to 个人; it returns how many. 个人 cannot be deleted.
func (s *Store) DeleteOrg(id int64) (int, error) {
	var moved int
	err := s.inTx(func(tx *sql.Tx) error {
		o, err := orgIn(tx, id)
		if err != nil {
			return err
		}
		if o.Personal {
			return userErr("「%s」是默认的组织，不能删除", o.Name)
		}
		res, err := tx.Exec(`UPDATE projects SET org_id = ? WHERE org_id = ?`, PersonalOrg, id)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		moved = int(n)
		_, err = tx.Exec(`DELETE FROM orgs WHERE id = ?`, id)
		return err
	})
	return moved, err
}

// SetProjectOrg moves the project with id to the organization orgID, at the
// end of its projects. Names are unique among all organizations, so the
// move never makes two the same.
func (s *Store) SetProjectOrg(id, orgID int64) (Project, error) {
	var p Project
	err := s.inTx(func(tx *sql.Tx) error {
		if _, err := orgIn(tx, orgID); err != nil {
			return err
		}
		cur, err := projectIn(tx, id)
		if err != nil {
			return err
		}
		if cur.OrgID == orgID {
			p = cur
			return nil
		}
		if _, err := tx.Exec(`UPDATE projects SET org_id = ?, updated_at = ?,
			sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM projects) WHERE id = ?`, orgID, s.millis(), id); err != nil {
			return err
		}
		p, err = projectIn(tx, id)
		return err
	})
	return p, err
}
