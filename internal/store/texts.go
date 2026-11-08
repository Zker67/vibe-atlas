package store

// TextsWith returns every item note, those in the trash too, and project
// description that contains sub, for example to find the pictures still
// referred to.
func (s *Store) TextsWith(sub string) ([]string, error) {
	rows, err := s.db.Query(`SELECT note FROM items WHERE instr(note, ?1) > 0
		UNION ALL SELECT note FROM trash WHERE instr(note, ?1) > 0
		UNION ALL SELECT description FROM projects WHERE instr(description, ?1) > 0`, sub)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return nil, err
		}
		out = append(out, text)
	}
	return out, rows.Err()
}
