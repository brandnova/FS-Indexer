package main

import "net/http"

func (ui *WebUI) handleAutostart(rw http.ResponseWriter, r *http.Request, _ *session) {
	writeJSON(rw, http.StatusOK, autostartState())
}

func (ui *WebUI) handleAutostartSave(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !readJSON(rw, r, &body) {
		return
	}
	if err := setAutostart(body.Enabled, ui.opts.ConfigPath); err != nil {
		logs.Warnf("autostart", "couldn't change start on login: %v", err)
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.Enabled {
		logs.Infof("autostart", "start on login was turned on from the dashboard")
		ui.opts.Events.Addf("Start on login turned on")
	} else {
		logs.Infof("autostart", "start on login was turned off from the dashboard")
		ui.opts.Events.Addf("Start on login turned off")
	}
	writeJSON(rw, http.StatusOK, autostartState())
}