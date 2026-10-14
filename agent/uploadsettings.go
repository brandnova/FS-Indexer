package main

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

// validateDropFolder checks a folder the person chose for uploads and returns its real path.
func validateDropFolder(raw, configPath string) (string, error) {
	abs, err := filepath.Abs(expandTilde(strings.TrimSpace(raw)))
	if err != nil {
		return "", errors.New("That doesn't look like a folder path.")
	}
	real, err := resolveDir(abs)
	switch {
	case errors.Is(err, errNotDir):
		return "", errors.New("That's a file, not a folder.")
	case err != nil:
		return "", errors.New("That folder doesn't exist or can't be opened.")
	}

	if filepath.Dir(real) == real {
		return "", errors.New("Choose a folder inside the drive, not the whole drive.")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" && pathsEqual(real, resolvedPath(home)) {
		return "", errors.New("Choose a folder inside your home folder, not the whole thing. A new folder just for phone uploads works best.")
	}
	settingsDir := resolvedPath(filepath.Dir(configPath))
	if pathsEqual(real, settingsDir) || pathInside(real, settingsDir) || pathInside(settingsDir, real) {
		return "", errors.New("That folder holds (or contains) the agent's own settings. Pick a different one.")
	}

	probe, err := os.CreateTemp(real, ".fsindexer-write-test-*")
	if err != nil {
		return "", errors.New("The agent can't write to that folder. Pick another one.")
	}
	name := probe.Name()
	probe.Close()
	_ = os.Remove(name)
	return real, nil
}

type uploadSettingsIn struct {
	Enabled       bool   `json:"enabled"`
	Dir           string `json:"dir"`
	MaxMB         int    `json:"max_mb"`
	PerHour       int    `json:"per_hour"`
	AllowPrograms bool   `json:"allow_programs"`
}

// applyUploadSettings checks the dashboard's upload settings and returns the new configuration.
func applyUploadSettings(cfg *Config, configPath string, in uploadSettingsIn) (*Config, error) {
	if in.MaxMB < 1 || in.MaxMB > maxUploadMaxMB {
		return nil, fmt.Errorf("The largest file must be between 1 and %d MB.", maxUploadMaxMB)
	}
	if in.PerHour < 1 || in.PerHour > maxUploadPerHour {
		return nil, fmt.Errorf("Files per hour must be between 1 and %d.", maxUploadPerHour)
	}
	dir := strings.TrimSpace(in.Dir)
	if dir != "" {
		real, err := validateDropFolder(dir, configPath)
		if err != nil {
			return nil, err
		}
		dir = real
	}
	if in.Enabled && dir == "" {
		return nil, errors.New("Choose a drop folder first.")
	}

	next := cfg.clone()
	next.AllowUploads = in.Enabled
	next.UploadDir = dir
	next.UploadMaxMB = in.MaxMB
	next.UploadPerHour = in.PerHour
	next.UploadAllowPrograms = in.AllowPrograms
	return next, nil
}

// ---------- the dashboard ----------

type uploadView struct {
	Enabled        bool   `json:"enabled"`
	Dir            string `json:"dir"`
	DirOK          bool   `json:"dir_ok"`
	MaxMB          int    `json:"max_mb"`
	PerHour        int    `json:"per_hour"`
	AllowPrograms  bool   `json:"allow_programs"`
	UsedThisHour   int    `json:"used_this_hour"`
	DefaultMaxMB   int    `json:"default_max_mb"`
	DefaultPerHour int    `json:"default_per_hour"`
}

func (ui *WebUI) uploadView() uploadView {
	cfg := ui.opts.Indexer.Config()
	ok := false
	if cfg.UploadDir != "" {
		st, err := os.Stat(cfg.UploadDir)
		ok = err == nil && st.IsDir()
	}
	return uploadView{
		Enabled: cfg.AllowUploads, Dir: cfg.UploadDir, DirOK: ok,
		MaxMB: cfg.uploadMaxMB(), PerHour: cfg.uploadPerHour(), AllowPrograms: cfg.UploadAllowPrograms,
		UsedThisHour: uploads.Count(time.Now()), DefaultMaxMB: defaultUploadMaxMB, DefaultPerHour: defaultUploadPerHour,
	}
}

func (ui *WebUI) handleUploads(rw http.ResponseWriter, r *http.Request, _ *session) {
	writeJSON(rw, http.StatusOK, ui.uploadView())
}

func (ui *WebUI) handleUploadsSave(rw http.ResponseWriter, r *http.Request, _ *session) {
	var in uploadSettingsIn
	if !readJSON(rw, r, &in) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next, err := applyUploadSettings(ui.opts.Indexer.Config(), ui.opts.ConfigPath, in)
	if err != nil {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := saveConfig(ui.opts.ConfigPath, next); err != nil {
		logs.Errorf("config", "couldn't save the settings: %v", err)
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	ui.opts.Indexer.SetConfig(next) // no rescan: the shared folders didn't change

	if next.AllowUploads {
		logs.Infof("config", "phones may now send files into %s (up to %d MB each, %d per hour; program files %v)",
			next.UploadDir, next.uploadMaxMB(), next.uploadPerHour(), next.UploadAllowPrograms)
		ui.opts.Events.Addf("Phones can now send files to this computer")
	} else {
		logs.Infof("config", "receiving files from phones is off (folder %q, up to %d MB each, %d per hour)",
			next.UploadDir, next.uploadMaxMB(), next.uploadPerHour())
		ui.opts.Events.Addf("Receiving files from phones is off")
	}
	writeJSON(rw, http.StatusOK, ui.uploadView())
}

// validNewFolderName allows a plain name: no slashes, no characters Windows forbids, not "." or "..".
func validNewFolderName(s string) bool {
	if s == "" || s == "." || s == ".." || len(s) > 80 || strings.ContainsAny(s, `/\<>:"|?*`) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return s == strings.TrimSpace(s) && !strings.HasSuffix(s, ".")
}

// handleMkdir makes a new folder for the folder picker. Only a signed-in dashboard can ask.
func (ui *WebUI) handleMkdir(rw http.ResponseWriter, r *http.Request, _ *session) {
	var in struct {
		Parent string `json:"parent"`
		Name   string `json:"name"`
	}
	if !readJSON(rw, r, &in) {
		return
	}
	name := strings.TrimSpace(in.Name)
	if !validNewFolderName(name) {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "Use a plain name, without slashes or characters like : * ? \" < > |."})
		return
	}
	if !filepath.IsAbs(in.Parent) {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "Open a folder first."})
		return
	}
	parent, err := resolveDir(filepath.Clean(in.Parent))
	if err != nil {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "That folder can't be opened."})
		return
	}

	path := filepath.Join(parent, name)
	if err := os.Mkdir(path, 0o755); err != nil {
		msg := "The folder couldn't be created."
		switch {
		case errors.Is(err, fs.ErrExist):
			msg = "A folder with that name already exists."
		case errors.Is(err, fs.ErrPermission):
			msg = "You don't have permission to create a folder here."
		}
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}
	logs.Infof("folders", "created the folder %q", path)
	writeJSON(rw, http.StatusOK, map[string]string{"path": path})
}