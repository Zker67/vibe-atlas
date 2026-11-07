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
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// SetClock replaces the clock that stamps changes, for tests.
func (s *Store) SetClock(now func() time.Time) { s.now = now }

func (s *Store) millis() int64 { return s.now().UnixMilli() }

// schemaVersion is the structure this code reads and writes, kept in the
// database's user_version.
const schemaVersion = 1

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
