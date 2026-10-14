package main

import (
	"net/http"
	"os"
	"path/filepath"
)

// uploadFolderName is the drop folder's name (not its full path), for the phone to show.
func uploadFolderName(c *Config) string {
	if c.UploadDir == "" {
		return ""
	}
	return filepath.Base(c.UploadDir)
}

// handleUploadsOpen shows the drop folder in the file manager on this computer.
func (ui *WebUI) handleUploadsOpen(rw http.ResponseWriter, r *http.Request, _ *session) {
	dir := ui.opts.Indexer.Config().UploadDir
	if dir == "" {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "No drop folder is chosen yet."})
		return
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "The drop folder can't be found right now."})
		return
	}
	if err := openFolder(dir); err != nil {
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "Couldn't open the file manager: " + err.Error()})
		return
	}
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}