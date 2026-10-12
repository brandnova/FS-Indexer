//go:build darwin

package main

import (
	"errors"
	"os"
	"path/filepath"
)

func autostartPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", autostartID+".plist"), nil
}

func autostartSupported() error { return nil }

func autostartEnabled() (bool, error) {
	p, err := autostartPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(p)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

func enableAutostart(exe string, args []string) error {
	p, err := autostartPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(launchdPlist(exe, args)), 0o644)
}

func disableAutostart() error {
	p, err := autostartPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}