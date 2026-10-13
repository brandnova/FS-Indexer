package main

import "net/http"

func (ui *WebUI) handleFileAccess(rw http.ResponseWriter, r *http.Request, _ *session) {
	writeJSON(rw, http.StatusOK, map[string]bool{"enabled": ui.opts.Indexer.Config().AllowFileAccess})
}

// handleFileAccessSave switches "phones may open and download files" on or off. It takes effect at once.
func (ui *WebUI) handleFileAccessSave(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !readJSON(rw, r, &body) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next := ui.opts.Indexer.Config().clone()
	next.AllowFileAccess = body.Enabled
	if err := saveConfig(ui.opts.ConfigPath, next); err != nil {
		logs.Errorf("config", "couldn't save the settings: %v", err)
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	ui.opts.Indexer.SetConfig(next) // no rescan: the files didn't change

	if body.Enabled {
		logs.Infof("config", "phones may now open and download files (switched on from the dashboard)")
		ui.opts.Events.Addf("Phones can now open and download files")
	} else {
		logs.Infof("config", "phones can no longer open files (switched off from the dashboard)")
		ui.opts.Events.Addf("Phones can only see file names again")
	}
	writeJSON(rw, http.StatusOK, map[string]bool{"enabled": body.Enabled})
}