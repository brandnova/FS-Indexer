//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// detachAttrs starts the child with no console window, in its own process group.
func detachAttrs(cmd *exec.Cmd) {
	const createNoWindow = 0x08000000
	const createNewProcessGroup = 0x00000200
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow | createNewProcessGroup}
}