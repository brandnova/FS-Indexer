package main

import (
	"net/http"
	"sync/atomic"
)

var doctorBusy atomic.Bool // one run at a time: it listens on the network for a few seconds

// handleDoctor runs the checks inside the agent. It is a POST so that a web page on
// another site can't trigger it, and it needs the session's token like every other change.
func (ui *WebUI) handleDoctor(rw http.ResponseWriter, r *http.Request, _ *session) {
	if !doctorBusy.CompareAndSwap(false, true) {
		writeJSON(rw, http.StatusTooManyRequests, map[string]string{"error": "The checks are already running."})
		return
	}
	defer doctorBusy.Store(false)

	checks := RunDoctor(DoctorInput{
		Config:     ui.opts.Indexer.Config(),
		ConfigPath: ui.opts.ConfigPath,
		LogPath:    logs.Path(),
		Indexer:    ui.opts.Indexer,
		WebPort:    ui.port,
		Discovery:  ui.opts.Discovery,
	})
	ok, warn, fail := countChecks(checks)
	logs.Infof("doctor", "checked from the dashboard: %d fine, %d to look at, %d to fix", ok, warn, fail)

	writeJSON(rw, http.StatusOK, map[string]any{"checks": checks, "ok": ok, "warn": warn, "fail": fail})
}