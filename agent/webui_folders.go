package main

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

type folderView struct {
	Label         string `json:"label"`
	Path          string `json:"path"`
	Disabled      bool   `json:"disabled"`
	IncludeHidden bool   `json:"include_hidden"`
	Missing       bool   `json:"missing"`
	Files         int    `json:"files"`
	Bytes         int64  `json:"bytes"`
}

type suggestion struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

func (ui *WebUI) handleFolders(rw http.ResponseWriter, r *http.Request, _ *session) {
	cfg := ui.opts.Indexer.Config()
	entries, _ := ui.opts.Indexer.Snapshot()
	stats := folderStats(entries, cfg.Roots)

	views := make([]folderView, len(cfg.Roots))
	for i, root := range cfg.Roots {
		_, err := os.Stat(root.Path)
		views[i] = folderView{
			Label: root.Label, Path: root.Path, Disabled: root.Disabled, IncludeHidden: root.IncludeHidden,
			Missing: err != nil, Files: stats[i].Files, Bytes: stats[i].Bytes,
		}
	}

	// The standard folders (Documents, Downloads ...) that aren't shared yet.
	suggestions := []suggestion{}
	for _, d := range DefaultRoots() {
		dp := resolvedPath(d.Path)
		covered := false
		for _, root := range cfg.Roots {
			rp := resolvedPath(root.Path)
			if pathsEqual(dp, rp) || pathInside(dp, rp) || pathInside(rp, dp) {
				covered = true
				break
			}
		}
		if !covered {
			suggestions = append(suggestions, suggestion{Label: d.Label, Path: d.Path})
		}
	}

	writeJSON(rw, http.StatusOK, map[string]any{"folders": views, "suggestions": suggestions})
}

func (ui *WebUI) handleFolderAdd(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Path  string `json:"path"`
		Label string `json:"label"`
	}
	if !readJSON(rw, r, &body) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next, label, err := addFolder(ui.opts.Indexer.Config(), body.Path, body.Label)
	if err != nil {
		logs.Warnf("folders", "couldn't add %q: %v", body.Path, err)
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := ui.applyConfig(next); err != nil {
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	logs.Infof("folders", "added the folder %q (%s)", label, next.Roots[len(next.Roots)-1].Path)
	ui.opts.Events.Addf("Now sharing the folder %s", label)
	writeJSON(rw, http.StatusOK, map[string]string{"label": label})
}

func (ui *WebUI) handleFolderUpdate(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Label         string `json:"label"`
		Disabled      *bool  `json:"disabled"`
		IncludeHidden *bool  `json:"include_hidden"`
	}
	if !readJSON(rw, r, &body) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next, err := updateFolder(ui.opts.Indexer.Config(), body.Label, body.Disabled, body.IncludeHidden)
	if err != nil {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := ui.applyConfig(next); err != nil {
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	if body.Disabled != nil {
		state := "on"
		if *body.Disabled {
			state = "off"
		}
		logs.Infof("folders", "switched the folder %q %s", body.Label, state)
		ui.opts.Events.Addf("Switched the folder %s %s", body.Label, state)
	}
	if body.IncludeHidden != nil {
		logs.Infof("folders", "hidden files for %q: %v", body.Label, *body.IncludeHidden)
	}
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}

func (ui *WebUI) handleFolderRemove(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Label string `json:"label"`
	}
	if !readJSON(rw, r, &body) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next, err := removeFolder(ui.opts.Indexer.Config(), body.Label)
	if err != nil {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := ui.applyConfig(next); err != nil {
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	logs.Infof("folders", "removed the folder %q", body.Label)
	ui.opts.Events.Addf("Stopped sharing the folder %s", body.Label)
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- the folder picker ----------

type pickerEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type pickerResponse struct {
	Path      string        `json:"path"`   // "" at the top level of a Windows computer (the drives)
	Parent    string        `json:"parent"` // "" when there is nothing above; "@drives" above a Windows drive
	Home      string        `json:"home"`
	Entries   []pickerEntry `json:"entries"`
	Truncated bool          `json:"truncated"`
}

func listDrives() []pickerEntry {
	var out []pickerEntry
	for c := 'A'; c <= 'Z'; c++ {
		p := string(c) + `:\`
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			out = append(out, pickerEntry{Name: string(c) + ":", Path: p})
		}
	}
	return out
}

func isDirPath(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// handleFSList lists the folders inside a folder, for the picker. Only folder names
// are returned (never files), and only to a signed-in dashboard.
func (ui *WebUI) handleFSList(rw http.ResponseWriter, r *http.Request, _ *session) {
	q := r.URL.Query()
	showHidden := q.Get("hidden") == "1"
	home, _ := os.UserHomeDir()
	resp := pickerResponse{Home: home, Entries: []pickerEntry{}}

	path := q.Get("path")
	if path == "" {
		path = home
	}
	if runtime.GOOS == "windows" && path == "@drives" {
		resp.Entries = listDrives()
		writeJSON(rw, http.StatusOK, resp)
		return
	}
	if !filepath.IsAbs(path) {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": `Use a full path, like /home/you or C:\Users\you.`})
		return
	}
	path = filepath.Clean(path)

	items, err := os.ReadDir(path)
	if err != nil {
		msg := "That folder can't be opened."
		switch {
		case errors.Is(err, fs.ErrPermission):
			msg = "You don't have permission to open that folder."
		case errors.Is(err, fs.ErrNotExist):
			msg = "That folder doesn't exist."
		}
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}

	for _, it := range items {
		name := it.Name()
		if !showHidden && strings.HasPrefix(name, ".") {
			continue
		}
		full := filepath.Join(path, name)
		if it.IsDir() || (it.Type()&fs.ModeSymlink != 0 && isDirPath(full)) {
			resp.Entries = append(resp.Entries, pickerEntry{Name: name, Path: full})
		}
	}
	sort.Slice(resp.Entries, func(i, j int) bool {
		return strings.ToLower(resp.Entries[i].Name) < strings.ToLower(resp.Entries[j].Name)
	})
	if len(resp.Entries) > 1000 {
		resp.Entries, resp.Truncated = resp.Entries[:1000], true
	}

	resp.Path = path
	if parent := filepath.Dir(path); parent != path {
		resp.Parent = parent
	} else if runtime.GOOS == "windows" {
		resp.Parent = "@drives"
	}
	writeJSON(rw, http.StatusOK, resp)
}

// ---------- ignore rules ----------

func nonNil(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func (ui *WebUI) handleRules(rw http.ResponseWriter, r *http.Request, _ *session) {
	cfg := ui.opts.Indexer.Config()
	writeJSON(rw, http.StatusOK, map[string]any{
		"extra":          nonNil(cfg.ExtraIgnores),
		"include_hidden": cfg.IncludeHidden,
		"builtin":        builtinRuleGroups(),
	})
}

func (ui *WebUI) handleRulesSave(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Extra         []string `json:"extra"`
		IncludeHidden bool     `json:"include_hidden"`
	}
	if !readJSON(rw, r, &body) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next, err := updateRules(ui.opts.Indexer.Config(), body.Extra, body.IncludeHidden)
	if err != nil {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := ui.applyConfig(next); err != nil {
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	logs.Infof("rules", "skip rules updated: %d of your own, hidden files %v", len(next.ExtraIgnores), next.IncludeHidden)
	ui.opts.Events.Addf("Updated the privacy rules")
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}

func (ui *WebUI) handleRulesTest(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Path string `json:"path"`
	}
	if !readJSON(rw, r, &body) {
		return
	}
	writeJSON(rw, http.StatusOK, explainPath(ui.opts.Indexer.Config(), body.Path))
}