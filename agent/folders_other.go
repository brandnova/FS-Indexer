//go:build !windows

package main

// windowsFolders exists on every platform so the presets registry compiles
// everywhere; the real implementation is in folders_windows.go.
func windowsFolders() []Root { return nil }