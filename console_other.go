//go:build !windows

package main

import "os/exec"

// hideConsole does nothing: elsewhere, programs run from an app open no
// terminal.
func hideConsole(cmd *exec.Cmd) {}
