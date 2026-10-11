package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func expandTilde(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[1:])
		}
	}
	return p
}

// resolvedPath follows symlinks when it can, and cleans the path when it can't.
func resolvedPath(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return filepath.Clean(p)
}

func pathsEqual(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// pathInside reports whether child is somewhere below parent (not the same folder).
func pathInside(child, parent string) bool {
	if runtime.GOOS == "windows" {
		child, parent = strings.ToLower(child), strings.ToLower(parent)
	}
	rel, err := filepath.Rel(parent, child)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return false
	}
	return true
}

func findRoot(cfg *Config, label string) int {
	for i, r := range cfg.Roots {
		if strings.EqualFold(r.Label, label) {
			return i
		}
	}
	return -1
}

func tidyLabel(s string) string {
	s = strings.TrimSpace(strings.NewReplacer("/", "-", `\`, "-").Replace(s))
	if s == "" || s == "." {
		return "Folder"
	}
	return s
}

func uniqueLabel(cfg *Config, base string) string {
	label := base
	for n := 2; findRoot(cfg, label) >= 0; n++ {
		label = fmt.Sprintf("%s (%d)", base, n)
	}
	return label
}

// addFolder shares a new folder. The messages are shown to people as they are.
func addFolder(cfg *Config, rawPath, label string) (*Config, string, error) {
	p := expandTilde(strings.TrimSpace(rawPath))
	if p == "" {
		return nil, "", errors.New("Choose a folder first.")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return nil, "", errors.New("That doesn't look like a folder path.")
	}
	real, err := resolveDir(abs)
	switch {
	case errors.Is(err, errNotDir):
		return nil, "", errors.New("That's a file, not a folder.")
	case err != nil:
		return nil, "", errors.New("That folder doesn't exist or can't be opened.")
	}

	if filepath.Dir(real) == real {
		return nil, "", errors.New("Choose a folder inside the drive, not the whole drive. Sharing a whole drive will come later, with extra safeguards.")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" && pathsEqual(real, resolvedPath(home)) {
		return nil, "", errors.New("Choose a folder inside your home folder, not the whole thing. Sharing everything will come later, with extra safeguards.")
	}
	for _, r := range cfg.Roots {
		existing := resolvedPath(r.Path)
		switch {
		case pathsEqual(real, existing):
			return nil, "", fmt.Errorf("That folder is already shared as \"%s\".", r.Label)
		case pathInside(real, existing):
			return nil, "", fmt.Errorf("That folder is already covered by \"%s\".", r.Label)
		case pathInside(existing, real):
			return nil, "", fmt.Errorf("That folder contains \"%s\", which is already shared. Remove that one first.", r.Label)
		}
	}

	label = strings.TrimSpace(label)
	if label == "" {
		label = uniqueLabel(cfg, tidyLabel(filepath.Base(real)))
	} else {
		if len(label) > 40 || strings.ContainsAny(label, `/\`) {
			return nil, "", errors.New("A name can be up to 40 characters, without slashes.")
		}
		if findRoot(cfg, label) >= 0 {
			return nil, "", fmt.Errorf("A folder named \"%s\" is already shared. Pick another name.", label)
		}
	}

	next := cfg.clone()
	next.Roots = append(next.Roots, Root{Path: real, Label: label})
	return next, label, nil
}

// removeFolder stops sharing a folder (nothing on the computer is touched).
func removeFolder(cfg *Config, label string) (*Config, error) {
	i := findRoot(cfg, label)
	if i < 0 {
		return nil, errors.New("That folder isn't in the list any more.")
	}
	if len(cfg.Roots) <= 1 {
		return nil, errors.New("Keep at least one folder. You can switch it off instead.")
	}
	next := cfg.clone()
	next.Roots = append(next.Roots[:i], next.Roots[i+1:]...)
	return next, nil
}

// updateFolder changes a folder's switches. A nil value means "leave as is".
func updateFolder(cfg *Config, label string, disabled, includeHidden *bool) (*Config, error) {
	i := findRoot(cfg, label)
	if i < 0 {
		return nil, errors.New("That folder isn't in the list any more.")
	}
	next := cfg.clone()
	if disabled != nil {
		next.Roots[i].Disabled = *disabled
	}
	if includeHidden != nil {
		next.Roots[i].IncludeHidden = *includeHidden
	}
	return next, nil
}

// updateRules replaces the user's skip rules and the global hidden-files switch.
func updateRules(cfg *Config, extra []string, includeHidden bool) (*Config, error) {
	clean, err := cleanPatterns(extra)
	if err != nil {
		return nil, err
	}
	next := cfg.clone()
	next.ExtraIgnores = clean
	next.IncludeHidden = includeHidden
	return next, nil
}

// cleanPatterns checks the user's rules: each one matches a single file or folder name.
func cleanPatterns(in []string) ([]string, error) {
	if len(in) > 200 {
		return nil, errors.New("That's a lot of rules. Keep it to 200 or fewer.")
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, raw := range in {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}
		if len(p) > 100 {
			return nil, errors.New("A rule can be up to 100 characters.")
		}
		if strings.ContainsAny(p, `/\`) {
			return nil, fmt.Errorf("\"%s\" has a slash. A rule matches one file or folder name, like *.tmp or node_modules.", p)
		}
		if _, err := filepath.Match(p, "x"); err != nil {
			return nil, fmt.Errorf("\"%s\" isn't a valid pattern.", p)
		}
		key := strings.ToLower(p)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	return out, nil
}