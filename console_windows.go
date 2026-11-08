package main

import (
	"os/exec"
	"syscall"
)

// createNoWindow keeps a console program from opening a console window.
const createNoWindow = 0x08000000

// hideConsole runs cmd without a console window showing.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
