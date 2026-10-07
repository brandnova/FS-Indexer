package main

import (
	"os"

	"golang.org/x/sys/windows"
)

func windowsFolders() []Root {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	known := []struct {
		label string
		id    *windows.KNOWNFOLDERID
	}{
		{"Documents", windows.FOLDERID_Documents},
		{"Downloads", windows.FOLDERID_Downloads},
		{"Desktop", windows.FOLDERID_Desktop},
		{"Pictures", windows.FOLDERID_Pictures},
		{"Music", windows.FOLDERID_Music},
		{"Videos", windows.FOLDERID_Videos},
	}

	var candidates []Root
	for _, k := range known {
		p, err := windows.KnownFolderPath(k.id, windows.KF_FLAG_DEFAULT)
		if err != nil || p == "" {
			continue
		}
		candidates = append(candidates, Root{Path: p, Label: k.label})
	}
	return usableRoots(home, candidates)
}