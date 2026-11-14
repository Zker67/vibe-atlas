package store

import (
	"database/sql"
	"math"
)

// CanvasSpot is where an item sits on its project's flow chart: the top
// left corner of its card, in the chart's pixels.
type CanvasSpot struct {
	ItemID int64   `json:"itemId"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
}

// maxCanvas bounds the chart's coordinates, far past any real chart.
const maxCanvas = 1e7

// Canvas returns where the items of a project sit on its flow chart; items
// it leaves out have no place yet.
func (s *Store) Canvas(projectID int64) ([]CanvasSpot, error) {
	rows, err := s.db.Query(`SELECT c.item_id, c.x, c.y FROM item_canvas c JOIN items i ON i.id = c.item_id
		WHERE i.project_id = ? ORDER BY c.item_id`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CanvasSpot{}
	for rows.Next() {
		var c CanvasSpot
		if err := rows.Scan(&c.ItemID, &c.X, &c.Y); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetCanvas puts items of a project where spots say on its flow chart, all
// at once. Spots of items not in the project, deleted meanwhile for
// example, are left out.
func (s *Store) SetCanvas(projectID int64, spots []CanvasSpot) error {
	for _, c := range spots {
		if math.IsNaN(c.X) || math.IsNaN(c.Y) || math.Abs(c.X) > maxCanvas || math.Abs(c.Y) > maxCanvas {
			return userErr("流程图上的位置超出范围")
		}
	}
	return s.inTx(func(tx *sql.Tx) error {
		if _, err := projectIn(tx, projectID); err != nil {
			return err
		}
		stmt, err := tx.Prepare(`INSERT INTO item_canvas (item_id, x, y)
			SELECT id, ?2, ?3 FROM items WHERE id = ?1 AND project_id = ?4
			ON CONFLICT (item_id) DO UPDATE SET x = excluded.x, y = excluded.y`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, c := range spots {
			if _, err := stmt.Exec(c.ItemID, c.X, c.Y, projectID); err != nil {
				return err
			}
		}
		return nil
	})
}

// ClearCanvas takes the items ids of a project off its flow chart's saved
// places: the chart lays them out again by itself.
func (s *Store) ClearCanvas(projectID int64, ids []int64) error {
	return s.inTx(func(tx *sql.Tx) error {
		for _, id := range ids {
			if _, err := tx.Exec(`DELETE FROM item_canvas WHERE item_id = ?
				AND item_id IN (SELECT id FROM items WHERE project_id = ?)`, id, projectID); err != nil {
				return err
			}
		}
		return nil
	})
}
