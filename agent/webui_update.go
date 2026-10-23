package main

import (
	"context"
	"net/http"
)

func (ui *WebUI) handleUpdate(rw http.ResponseWriter, r *http.Request, _ *session) {
	writeJSON(rw, http.StatusOK, updates.Status())
}

// handleUpdateSave switches the daily update check on or off.
func (ui *WebUI) handleUpdateSave(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !readJSON(rw, r, &body) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next := ui.opts.Indexer.Config().clone()
	next.CheckForUpdates = body.Enabled
	if err := saveConfig(ui.opts.ConfigPath, next); err != nil {
		logs.Errorf("config", "couldn't save the settings: %v", err)
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	ui.opts.Indexer.SetConfig(next)

	if body.Enabled {
		logs.Infof("update", "checking for updates was switched on")
		go updates.Check(context.Background()) // so the answer is there soon
	} else {
		logs.Infof("update", "checking for updates was switched off")
	}
	writeJSON(rw, http.StatusOK, updates.Status())
}

// handleUpdateCheck is the "Check now" button.
func (ui *WebUI) handleUpdateCheck(rw http.ResponseWriter, r *http.Request, _ *session) {
	if !ui.opts.Indexer.Config().CheckForUpdates {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "Turn on update checks first."})
		return
	}
	info, err := updates.CheckManually(r.Context())
	if err != nil {
		writeJSON(rw, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(rw, http.StatusOK, info)
}