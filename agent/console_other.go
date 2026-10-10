//go:build !windows

package main

import "os"

// enableANSI is only needed on Windows; other terminals understand colours already.
func enableANSI(f *os.File) bool { return true }