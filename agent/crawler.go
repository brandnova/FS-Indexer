package main

import (
	"io/fs"
	"path"
	"path/filepath"
	"strings"
)

// verbose is set by -verbose: the log then also records every path that couldn't be read.
var verbose bool

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

// Where a rule comes from, in words a person understands (shown in the dashboard).
const (
	srcSecret = "passwords and keys"
	srcNoise  = "common clutter"
	srcSystem = "system files"
	srcHidden = "hidden files"
	srcYours  = "your own rules"
)

// Names (or glob patterns) skipped everywhere, matched case-insensitively.
var noiseIgnores = []string{
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

// Secrets and credentials: these names are never indexed.
var secretIgnores = []string{
	".ssh",
	".gnupg",
	".aws",
	".env",
	".env.*",
	"*.kdbx",
	"*.pem",
	"*.key", // also matches Apple Keynote files
	"*.p12",
	"*.pfx",
}

// defaultIgnores is every built-in pattern.
var defaultIgnores = append(append([]string{}, noiseIgnores...), secretIgnores...)

type rule struct {
	pattern string
	source  string
}

type ignorer struct {
	rules []rule
}

func (ig *ignorer) add(source string, patterns ...string) {
	for _, p := range patterns {
		ig.rules = append(ig.rules, rule{pattern: strings.ToLower(p), source: source})
	}
}

// newIgnorer combines the built-in defaults with extra patterns of the user's.
func newIgnorer(extra []string) *ignorer {
	ig := &ignorer{}
	ig.add(srcNoise, noiseIgnores...)
	ig.add(srcSecret, secretIgnores...)
	ig.add(srcYours, extra...)
	return ig
}

// ignorerFor builds the full rule set for a config: built-in defaults, the OS
// preset, hidden files (unless allowed) and the user's own patterns.
func ignorerFor(cfg *Config, includeHidden bool) *ignorer {
	ig := &ignorer{}
	ig.add(srcNoise, noiseIgnores...)
	ig.add(srcSecret, secretIgnores...)
	ig.add(srcSystem, presetIgnores()...)
	if !includeHidden {
		ig.add(srcHidden, ".*")
	}
	ig.add(srcYours, cfg.ExtraIgnores...)
	return ig
}

// why says which rule (if any) skips a file or folder name.
func (ig *ignorer) why(name string) (rule, bool) {
	n := strings.ToLower(name)
	for _, r := range ig.rules {
		if ok, _ := filepath.Match(r.pattern, n); ok {
			return r, true
		}
	}
	return rule{}, false
}

func (ig *ignorer) match(name string) bool {
	_, ok := ig.why(name)
	return ok
}

// Crawl walks every folder that is switched on and returns a flat list of
// entries plus the number of paths that had to be skipped because of errors
// (permissions, files vanishing mid-scan, etc). Symlinks are never followed or indexed.
func Crawl(cfg *Config) ([]Entry, int) {
	entries := make([]Entry, 0, 50_000)
	skipped := 0

	for _, root := range cfg.Roots {
		if root.Disabled {
			continue
		}
		ig := ignorerFor(cfg, cfg.IncludeHidden || root.IncludeHidden)
		rootPath := root.Path
		label := root.Label

		_ = filepath.WalkDir(rootPath, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				logs.Debugf("scan", "couldn't read %s: %v", p, err)
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