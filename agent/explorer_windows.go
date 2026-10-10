//go:build windows

package main

import (
	"os"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// startedByExplorer reports whether Windows Explorer started this program: a
// double-click, the Start menu or the Run box, as opposed to a terminal.
func startedByExplorer() bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(snap)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return false
	}

	names := map[uint32]string{}
	var parent uint32
	self := uint32(os.Getpid())
	for {
		names[entry.ProcessID] = windows.UTF16ToString(entry.ExeFile[:])
		if entry.ProcessID == self {
			parent = entry.ParentProcessID
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return strings.EqualFold(names[parent], "explorer.exe")
}