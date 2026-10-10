//go:build !windows

package main

// startedByExplorer only exists for Windows double-clicks.
func startedByExplorer() bool { return false }