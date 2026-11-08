package sessions

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // the database/sql driver, in pure Go
)

// codegDB is codeg's database: in CODEG_DATA_DIR when set, else in the
// folder app.codeg of the system's folder for app data.
func codegDB() string {
	if v := strings.TrimSpace(os.Getenv("CODEG_DATA_DIR")); v != "" {
		return filepath.Join(v, "codeg.db")
	}
	var base string
	switch runtime.GOOS {
	case "windows", "darwin":
		// %APPDATA%, ~/Library/Application Support
		base, _ = os.UserConfigDir()
	default:
		base = os.Getenv("XDG_DATA_HOME")
		if base == "" {
			base = filepath.Join(home(), ".local", "share")
		}
	}
	return filepath.Join(base, "app.codeg", "codeg.db")
}

// readOnlyDSN opens the database at path to read only, waiting while
// codeg writes, as a URI, which keeps spaces and other letters of the path.
func readOnlyDSN(path string) string {
	p := filepath.ToSlash(path)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p // C:/… as /C:/…
	}
	u := url.URL{Scheme: "file", Path: p}
	return u.String() + "?mode=ro&_pragma=busy_timeout(5000)&_pragma=query_only(1)"
}

// codegAgents names the agents of codeg as the icons know them.
var codegAgents = map[string]string{
	"claude_code": "claude",
	"codex":       "codex",
	"gemini":      "gemini",
}

// readCodeg reads the conversations codeg lists in its sidebar: not
// deleted, in a folder not deleted, neither a part of another
// conversation nor a chat or a loop.
func readCodeg() ([]Session, error) {
	path := codegDB()
	if _, err := os.Stat(path); err != nil {
		return nil, nil
	}
	db, err := sql.Open("sqlite", readOnlyDSN(path))
	if err != nil {
		return nil, fmt.Errorf("打不开 codeg 的会话库：%w", err)
	}
	defer db.Close()
	rows, err := db.Query(`
		SELECT c.id, COALESCE(c.title, ''), c.agent_type, c.updated_at, f.path
		FROM conversation c JOIN folder f ON f.id = c.folder_id
		WHERE c.deleted_at IS NULL AND f.deleted_at IS NULL
		  AND c.parent_id IS NULL AND c.kind = 'regular'`)
	if err != nil {
		return nil, fmt.Errorf("读不了 codeg 的会话库，可能是 codeg 的版本不同：%w", err)
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var (
			id                    int64
			title, agent, at, cwd string
		)
		if err := rows.Scan(&id, &title, &agent, &at, &cwd); err != nil {
			return nil, fmt.Errorf("读不了 codeg 的会话库：%w", err)
		}
		if a, ok := codegAgents[agent]; ok {
			agent = a
		}
		title = cleanTitle(title)
		if title == "" {
			title = "未命名会话"
		}
		var updated int64
		if t, err := time.Parse(time.RFC3339Nano, at); err == nil {
			updated = t.UnixMilli()
		}
		sid := strconv.FormatInt(id, 10)
		out = append(out, Session{Agent: agent, ID: sid, Title: title, Cwd: cwd, UpdatedAt: updated, Link: Link(Codeg, sid)})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("读不了 codeg 的会话库：%w", err)
	}
	return out, nil
}
