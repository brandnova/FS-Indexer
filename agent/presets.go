package main

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// A Preset holds the sensible defaults for one operating system.
type Preset struct {
	// Folders returns the user's standard folders that exist on this machine.
	Folders func() []Root
	// Ignores are extra names/globs skipped on this OS, on top of the global defaults.
	Ignores []string
}

// presets is the registry: add an entry to support another OS.
var presets = map[string]Preset{
	"linux": {
		Folders: linuxFolders,
		Ignores: []string{"lost+found", ".directory"},
	},
	"darwin": {
		Folders: macFolders,
		Ignores: []string{".localized", ".trashes", ".spotlight-v100", ".fseventsd", ".documentrevisions-v100", ".temporaryitems"},
	},
	"windows": {
		Folders: windowsFolders,
		Ignores: []string{"desktop.ini", "ntuser.dat*", "pagefile.sys", "hiberfil.sys", "swapfile.sys", "$winreagent", "$windows.~bt", "$windows.~ws"},
	},
}

func currentPreset() Preset { return presets[runtime.GOOS] }

// DefaultRoots returns the OS's standard folders that exist (nil on an unknown OS).
func DefaultRoots() []Root {
	if folders := currentPreset().Folders; folders != nil {
		return folders()
	}
	return nil
}

func presetIgnores() []string { return currentPreset().Ignores }

// ---------- standard folders ----------

type folderSpec struct {
	label    string // shown in the app and used as the path prefix
	xdgKey   string // key in ~/.config/user-dirs.dirs (Linux only)
	fallback string // folder name under the home directory
}

var linuxSpecs = []folderSpec{
	{"Documents", "XDG_DOCUMENTS_DIR", "Documents"},
	{"Downloads", "XDG_DOWNLOAD_DIR", "Downloads"},
	{"Desktop", "XDG_DESKTOP_DIR", "Desktop"},
	{"Pictures", "XDG_PICTURES_DIR", "Pictures"},
	{"Music", "XDG_MUSIC_DIR", "Music"},
	{"Videos", "XDG_VIDEOS_DIR", "Videos"},
}

var macSpecs = []folderSpec{
	{"Documents", "", "Documents"},
	{"Downloads", "", "Downloads"},
	{"Desktop", "", "Desktop"},
	{"Pictures", "", "Pictures"},
	{"Movies", "", "Movies"},
	{"Music", "", "Music"},
}

func linuxFolders() []Root {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	xdg := map[string]string{}
	if cfgDir, err := os.UserConfigDir(); err == nil {
		if f, err := os.Open(filepath.Join(cfgDir, "user-dirs.dirs")); err == nil {
			xdg = parseUserDirs(f, home)
			f.Close()
		}
	}
	return resolveFolders(home, linuxSpecs, xdg)
}

func macFolders() []Root {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	return resolveFolders(home, macSpecs, nil)
}

// parseUserDirs reads the XDG file ~/.config/user-dirs.dirs, whose lines look
// like:  XDG_DOCUMENTS_DIR="$HOME/Documents"
func parseUserDirs(r io.Reader, home string) map[string]string {
	out := map[string]string{}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		val = strings.Trim(strings.TrimSpace(val), `"`)
		if val == "" {
			continue
		}
		out[strings.TrimSpace(key)] = filepath.Clean(strings.Replace(val, "$HOME", home, 1))
	}
	return out
}

// resolveFolders turns folder specs into roots, using relocated paths from xdg when given.
func resolveFolders(home string, specs []folderSpec, xdg map[string]string) []Root {
	candidates := make([]Root, 0, len(specs))
	for _, s := range specs {
		p := xdg[s.xdgKey]
		if p == "" {
			p = filepath.Join(home, s.fallback)
		}
		candidates = append(candidates, Root{Path: p, Label: s.label})
	}
	return usableRoots(home, candidates)
}

// usableRoots keeps candidates that exist, are not the home directory itself
// (the XDG way of saying "this folder is disabled"), and aren't duplicates.
func usableRoots(home string, candidates []Root) []Root {
	homeReal := realPath(home)
	seen := map[string]bool{}
	var roots []Root
	for _, c := range candidates {
		real := realPath(c.Path)
		st, err := os.Stat(real)
		if err != nil || !st.IsDir() || real == homeReal || seen[real] {
			continue
		}
		seen[real] = true
		roots = append(roots, c)
	}
	return roots
}

func realPath(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return filepath.Clean(p)
}