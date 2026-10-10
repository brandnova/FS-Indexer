//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

// enableANSI switches the Windows console into the mode that understands colours,
// and makes it show Unicode (needed for the QR code). It reports whether colours work.
func enableANSI(f *os.File) bool {
	handle := windows.Handle(f.Fd())

	var mode uint32
	if err := windows.GetConsoleMode(handle, &mode); err != nil {
		return false
	}
	_ = windows.SetConsoleOutputCP(65001) // UTF-8; best effort

	if mode&windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING != 0 {
		return true
	}
	return windows.SetConsoleMode(handle, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING) == nil
}