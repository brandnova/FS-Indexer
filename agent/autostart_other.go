//go:build !windows && !darwin && !linux

package main

import "errors"

var errNoAutostart = errors.New("Starting on login isn't supported on this system.")

func autostartSupported() error                        { return errNoAutostart }
func autostartEnabled() (bool, error)                  { return false, errNoAutostart }
func enableAutostart(exe string, args []string) error { return errNoAutostart }
func disableAutostart() error                          { return errNoAutostart }