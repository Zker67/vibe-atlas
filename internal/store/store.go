// Package store keeps the projects, modules and items of Vibe Atlas in a
// SQLite database on the user's machine.
//
// Every change is written in a transaction before the call returns, so an
// app that is killed keeps everything it reported as saved.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite" // the database/sql driver, in pure Go
)

// Store is the database of one user.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Error is a problem the user can fix. Its message is written for the user
// and the pages show it as it is.
type Error struct{ msg string }

func (e *Error) Error() string { return e.msg }

func userErr(format string, args ...any) error {
	return &Error{msg: fmt.Sprintf(format, args...)}
}

// ErrNotFound is returned for a project, module or item that does not exist,
// for example one deleted in another window.
var ErrNotFound = &Error{msg: "找不到这条记录，它可能已经被删除"}

// Open opens the database at path, creating it when missing, and brings
// its structure up to date.
func Open(path string) (*Store, error) {
	dsn := path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One connection serializes the writes of concurrent calls; SQLite
	// allows one writer anyway, and the data of one user is small.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("打开数据文件失败：%w", err)
	}
	s := &Store{db: db, now: time.Now}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.once(keyDoingByStart, s.OrderDoingByStart); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// keyDoingByStart marks a database whose trees doing were put in the order
// they started, once, when 进行中 became an order the user drags.
const keyDoingByStart = "doingOrderedByStart"

// once runs fn unless the setting key says it ran already, and records
// that it did. Unlike a migration, it leaves the structure version alone,
// so older versions of the app still open the database.
func (s *Store) once(key string, fn func() error) error {
	if _, done, err := s.Setting(key); err != nil || done {
		return err
	}
	if err := fn(); err != nil {
		return err
	}
	return s.SetSetting(key, "1")
}

// OrderDoingByStart puts the top-level items whose tree has an item doing
// in the order their earliest such item started, in the places they take
// among the top-level items of their project; the others keep theirs.
func (s *Store) OrderDoingByStart() error {
	return s.inTx(func(tx *sql.Tx) error {
		_, err := tx.Exec(`
WITH RECURSIVE tree(root, id) AS (
	SELECT id, id FROM items WHERE parent_id IS NULL
	UNION ALL
	SELECT tree.root, i.id FROM items i JOIN tree ON i.parent_id = tree.id
),
doing(root, started) AS (
	SELECT tree.root, MIN(COALESCE(i.started_at, 0)) FROM tree JOIN items i ON i.id = tree.id
	WHERE i.status = 'doing' GROUP BY tree.root
),
slots(project_id, n, sort_order) AS (
	SELECT r.project_id, ROW_NUMBER() OVER (PARTITION BY r.project_id ORDER BY r.sort_order, r.id), r.sort_order
	FROM items r JOIN doing d ON d.root = r.id
),
wanted(id, project_id, n) AS (
	SELECT r.id, r.project_id, ROW_NUMBER() OVER (PARTITION BY r.project_id ORDER BY d.started, r.id)
	FROM items r JOIN doing d ON d.root = r.id
)
UPDATE items SET sort_order = (
	SELECT slots.sort_order FROM wanted JOIN slots ON slots.project_id = wanted.project_id AND slots.n = wanted.n
	WHERE wanted.id = items.id
)
WHERE id IN (SELECT root FROM doing)`)
		return err
	})
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// SetClock replaces the clock that stamps changes, for tests.
func (s *Store) SetClock(now func() time.Time) { s.now = now }

func (s *Store) millis() int64 { return s.now().UnixMilli() }

// schemaVersion is the structure this code reads and writes, kept in the
// database's user_version.
const schemaVersion = 5

// migrations[v] brings a database from version v to v+1.
var migrations = []string{
	0: `
CREATE TABLE projects (
	id          INTEGER PRIMARY KEY,
	name        TEXT    NOT NULL COLLATE NOCASE UNIQUE,
	description TEXT    NOT NULL DEFAULT '',
	folder_path TEXT    NOT NULL DEFAULT '',
	sort_order  INTEGER NOT NULL,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE TABLE modules (
	id         INTEGER PRIMARY KEY,
	project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
	name       TEXT    NOT NULL COLLATE NOCASE,
	sort_order INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	UNIQUE (project_id, name)
);
CREATE TABLE items (
	id         INTEGER PRIMARY KEY,
	project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
	module_id  INTEGER REFERENCES modules (id) ON DELETE SET NULL,
	type       TEXT    NOT NULL CHECK (type IN ('improve', 'bug', 'feature')),
	status     TEXT    NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
	title      TEXT    NOT NULL,
	note       TEXT    NOT NULL DEFAULT '',
	deeplink   TEXT    NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	started_at INTEGER,
	done_at    INTEGER,
	updated_at INTEGER NOT NULL
);
CREATE INDEX items_by_project ON items (project_id, status);
CREATE INDEX items_by_module ON items (module_id);
CREATE TABLE settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);`,
	// Sub-items: an item may sit under another of its project, to any
	// depth. auto_title marks a parent whose title the app made from its
	// children, kept up to date until the user renames it.
	1: `
ALTER TABLE items ADD COLUMN parent_id INTEGER REFERENCES items (id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN auto_title INTEGER NOT NULL DEFAULT 0;
CREATE INDEX items_by_parent ON items (parent_id);`,
	// done_with marks an item done because an item above it was: it goes
	// back when that one is reopened.
	2: `
ALTER TABLE items ADD COLUMN done_with INTEGER REFERENCES items (id) ON DELETE SET NULL;
CREATE INDEX items_by_done_with ON items (done_with);`,
	// The trash: items deleted the soft way, as they were, with where they
	// sat (parent_id, its created_at to tell it from a later item of the
	// same id, and place among its siblings), the children that moved up
	// (lifted) and the items it had carried to done (carried), both JSON
	// lists of {"id", "created"}. Entries deleted together share a batch.
	3: `
CREATE TABLE trash (
	id             INTEGER PRIMARY KEY,
	batch          INTEGER NOT NULL,
	deleted_at     INTEGER NOT NULL,
	item_id        INTEGER NOT NULL,
	project_id     INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
	parent_id      INTEGER,
	parent_created INTEGER,
	place          INTEGER NOT NULL,
	module_id      INTEGER,
	type           TEXT    NOT NULL,
	status         TEXT    NOT NULL,
	title          TEXT    NOT NULL,
	note           TEXT    NOT NULL,
	deeplink       TEXT    NOT NULL,
	auto_title     INTEGER NOT NULL,
	created_at     INTEGER NOT NULL,
	started_at     INTEGER,
	done_at        INTEGER,
	done_with      INTEGER,
	updated_at     INTEGER NOT NULL,
	lifted         TEXT    NOT NULL DEFAULT '[]',
	carried        TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX trash_by_batch ON trash (batch);
CREATE INDEX trash_by_project ON trash (project_id);`,
	// Icons: the one the user chose for a project or module (see checkIcon),
	// "" for the default, and the one found in a project's folder.
	4: `
ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN detected_icon TEXT NOT NULL DEFAULT '';
ALTER TABLE modules ADD COLUMN icon TEXT NOT NULL DEFAULT '';`,
}

// migrate applies the migrations the database lacks, each in a transaction
// with its version, so a failure leaves the database as it was.
func (s *Store) migrate() error {
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("读取数据文件版本失败：%w", err)
	}
	if version > schemaVersion {
		return userErr("数据文件来自更新版本的 Vibe Atlas（结构版本 %d），请升级应用后再打开", version)
	}
	for version < schemaVersion {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[version]); err != nil {
			tx.Rollback()
			return fmt.Errorf("升级数据文件到版本 %d 失败：%w", version+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, version+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("升级数据文件到版本 %d 失败：%w", version+1, err)
		}
		version++
	}
	return nil
}

// Version returns the structure version of the open database.
func (s *Store) Version() (int, error) {
	var v int
	err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v)
	return v, err
}

// inTx runs fn in a transaction, committed when fn returns nil.
func (s *Store) inTx(fn func(tx *sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Setting returns the value saved under key, and whether there is one.
func (s *Store) Setting(key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// SetSetting saves value under key.
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// cleanLine trims a one-line text, folds its runs of white space, line
// breaks included, into single spaces, and checks its length.
func cleanLine(s, what string, max int) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return "", userErr("%s不能为空", what)
	}
	if utf8.RuneCountInString(s) > max {
		return "", userErr("%s不能超过 %d 个字", what, max)
	}
	return s, nil
}

// Limits of what users write.
const (
	maxProjectName = 60
	maxModuleName  = 40
	maxTitle       = 300
	maxText        = 200_000 // notes and descriptions, in characters
)

func checkText(s, what string) error {
	if utf8.RuneCountInString(s) > maxText {
		return userErr("%s太长了（最多 %d 个字）", what, maxText)
	}
	return nil
}

// nullable turns 0 into NULL for optional references and times.
func nullable(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}
