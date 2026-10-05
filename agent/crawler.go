package main

import (
	"io/fs"
	"log"
	"path"
	"path/filepath"
	"strings"
)

// Entry is one line of the index. Field names are the API contract
// (see docs/API.md) - don't rename them.
type Entry struct {
	Path   string `json:"path"`
	Parent string `json:"parent"`
	Name   string `json:"name"`
	Ext    string `json:"ext"`
	Size   int64  `json:"size"`
	Mtime  int64  `json:"mtime"`
	IsDir  bool   `json:"is_dir"`
}

// Names (or glob patterns) skipped everywhere, matched case-insensitively.
var defaultIgnores = []string{
	"node_modules",
	".git",
	"__pycache__",
	".venv",
	"venv",
	"$recycle.bin",
	"system volume information",
	".trash*",
	".ds_store",
	"thumbs.db",
}

type ignorer struct {
	patterns []string
}

func newIgnorer(extra []string) *ignorer {
	all := append([]string{}, defaultIgnores...)
	all = append(all, extra...)
	for i := range all {
		all[i] = strings.ToLower(all[i])
	}
	return &ignorer{patterns: all}
}

func (ig *ignorer) match(name string) bool {
	n := strings.ToLower(name)
	for _, p := range ig.patterns {
		if ok, _ := filepath.Match(p, n); ok {
			return true
		}
	}
	return false
}

// Crawl walks every configured root and returns a flat list of entries plus
// the number of paths that had to be skipped because of errors (permissions,
// files vanishing mid-scan, etc). Symlinks are never followed or indexed.
func Crawl(cfg *Config) ([]Entry, int) {
	ig := newIgnorer(cfg.ExtraIgnores)
	entries := make([]Entry, 0, 50_000)
	skipped := 0

	for _, root := range cfg.Roots {
		rootPath := root.Path
		label := root.Label

		_ = filepath.WalkDir(rootPath, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				log.Printf("skip %s: %v", p, err)
				skipped++
				return nil
			}

			isRoot := p == rootPath
			name := d.Name()

			if !isRoot {
				if ig.match(name) {
					if d.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
				if d.Type()&fs.ModeSymlink != 0 {
					return nil
				}
			}

			info, err := d.Info()
			if err != nil {
				skipped++
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			e := Entry{
				Mtime: info.ModTime().Unix(),
				IsDir: d.IsDir(),
			}

			if isRoot {
				e.Path = label
				e.Name = label
			} else {
				rel, err := filepath.Rel(rootPath, p)
				if err != nil {
					return nil
				}
				e.Path = label + "/" + filepath.ToSlash(rel)
				e.Name = name
				e.Parent = path.Dir(e.Path)
			}

			if !e.IsDir {
				e.Size = info.Size()
				e.Ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
			}

			entries = append(entries, e)
			return nil
		})
	}

	return entries, skipped
}