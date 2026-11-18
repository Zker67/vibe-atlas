package store

// ProjectActivity is how much a project has moved lately, for 全部项目.
type ProjectActivity struct {
	ProjectID int64 `json:"projectId"`
	// LastActive is when the project or one of its items last changed.
	LastActive int64 `json:"lastActive"`
	// Done lists when each of its items done since the time asked for was
	// done, the earliest first. The page groups them by local day.
	Done []int64 `json:"done"`
}

// ProjectActivity returns the activity of each project of organization
// orgID, in the user's order, counting the items done since since.
func (s *Store) ProjectActivity(orgID, since int64) ([]ProjectActivity, error) {
	if _, err := s.Org(orgID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT p.id, MAX(p.updated_at, COALESCE(MAX(i.updated_at), 0))
		FROM projects p LEFT JOIN items i ON i.project_id = p.id
		WHERE p.org_id = ? GROUP BY p.id ORDER BY p.sort_order, p.id`, orgID)
	if err != nil {
		return nil, err
	}
	out := []ProjectActivity{}
	at := map[int64]int{}
	for rows.Next() {
		a := ProjectActivity{Done: []int64{}}
		if err := rows.Scan(&a.ProjectID, &a.LastActive); err != nil {
			rows.Close()
			return nil, err
		}
		at[a.ProjectID] = len(out)
		out = append(out, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = s.db.Query(`SELECT i.project_id, i.done_at FROM items i JOIN projects p ON p.id = i.project_id
		WHERE p.org_id = ? AND i.status = 'done' AND i.done_at >= ? ORDER BY i.done_at, i.id`, orgID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, done int64
		if err := rows.Scan(&id, &done); err != nil {
			return nil, err
		}
		if k, ok := at[id]; ok {
			out[k].Done = append(out[k].Done, done)
		}
	}
	return out, rows.Err()
}
