//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// detachAttrs makes the child its own session, so it keeps running when the terminal closes.
func detachAttrs(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}