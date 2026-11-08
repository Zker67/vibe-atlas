package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/Zker67/vibe-atlas/internal/sessions"
)

// openClaudeSession opens the Claude Code session of a claude-session:
// link in the Claude desktop app, as claude --desktop --resume <id> does,
// since claude: links cannot reach a session yet. The command hands the
// session over and ends; no terminal shows.
func openClaudeSession(link string) error {
	cmd, err := startClaude(link)
	if err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// startClaude runs claude for the session of link, in the folder the
// session works in, where claude looks for it, and returns it running.
func startClaude(link string) (*exec.Cmd, error) {
	id, ok := sessions.ClaudeSessionID(link)
	if !ok {
		return nil, errors.New("这不是有效的 Claude Code 会话链接")
	}
	cwd, ok := sessions.ClaudeCwd(id)
	if !ok {
		return nil, errors.New("在本机的 Claude Code 里找不到这个会话，它可能已经被删除")
	}
	if cwd == "" {
		return nil, errors.New("不知道这个 Claude Code 会话是在哪个文件夹里开的，没法打开")
	}
	if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("这个会话所在的文件夹不在了：%s", cwd)
	}
	bin, ok := claudeBin()
	if !ok {
		return nil, errors.New("没有找到 claude 命令，请确认 Claude Code 已安装，并且在 PATH 里")
	}
	// The ID is a UUID (checked above), passed as an argument of its own.
	cmd := exec.Command(bin, "--desktop", "--resume", id)
	cmd.Dir = cwd
	hideConsole(cmd)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("没能运行 claude：%w", err)
	}
	return cmd, nil
}

// claudeBin finds the claude command: on the PATH, else where Claude
// Code's installers put it, which an app started from the desktop may not
// have on its PATH (on macOS, apps get a short one).
func claudeBin() (string, bool) {
	if bin, err := exec.LookPath("claude"); err == nil {
		return bin, true
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", false
	}
	for _, dir := range []string{
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, ".claude", "local"),
	} {
		for _, name := range []string{"claude.exe", "claude.cmd", "claude"} {
			if runtime.GOOS == "windows" && name == "claude" || runtime.GOOS != "windows" && name != "claude" {
				continue
			}
			path := filepath.Join(dir, name)
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				return path, true
			}
		}
	}
	return "", false
}
