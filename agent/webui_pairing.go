package main

import (
	"fmt"
	"net/http"
	"time"
)

type pairingView struct {
	Address   string   `json:"address"`
	Code      string   `json:"code"`       // as people read it: ABCDE-FGHJK
	ExpiresAt int64    `json:"expires_at"` // unix seconds
	Name      string   `json:"name"`
	Others    []string `json:"others"`

	raw string // the code without the dash, for the QR code
}

// currentPairing gives the code to show. It reuses the current one, or makes a new one when
// there is none, it was used, or it ran out. With renew it always makes a new one.
func (ui *WebUI) currentPairing(renew bool) pairingView {
	cfg := ui.opts.Config
	host := ui.host()

	var code string
	var expires time.Time
	if renew {
		code, expires = ui.opts.Codes.Renew()
	} else {
		code, expires = ui.opts.Codes.Current()
	}

	v := pairingView{Code: formatCode(code), ExpiresAt: expires.Unix(), Name: cfg.DeviceName, Others: otherLANIPs(host), raw: code}
	if v.Others == nil {
		v.Others = []string{}
	}
	if host != "" {
		v.Address = fmt.Sprintf("%s:%d", host, cfg.Port)
	}
	return v
}

func (ui *WebUI) handlePairing(rw http.ResponseWriter, r *http.Request, _ *session) {
	writeJSON(rw, http.StatusOK, ui.currentPairing(false))
}

func (ui *WebUI) handlePairingNew(rw http.ResponseWriter, r *http.Request, _ *session) {
	logs.Infof("pairing", "a new pairing code was made from the dashboard")
	writeJSON(rw, http.StatusOK, ui.currentPairing(true))
}

func (ui *WebUI) handlePairingSVG(rw http.ResponseWriter, r *http.Request, _ *session) {
	host := ui.host()
	if host == "" {
		http.NotFound(rw, r)
		return
	}
	v := ui.currentPairing(false)
	svg, err := qrSVG(pairingPayloadFor(ui.opts.Config, host, v.raw))
	if err != nil {
		http.Error(rw, "could not draw the QR code", http.StatusInternalServerError)
		return
	}
	rw.Header().Set("Content-Type", "image/svg+xml")
	_, _ = rw.Write(svg)
}

// ---------- paired phones ----------

type deviceView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	LastSeen  int64  `json:"last_seen"`
	LastIP    string `json:"last_ip"`
}

func (ui *WebUI) handleDevices(rw http.ResponseWriter, r *http.Request, _ *session) {
	list := ui.opts.Devices.List()
	views := make([]deviceView, len(list))
	for i, d := range list {
		views[i] = deviceView{ID: d.ID, Name: d.Name, CreatedAt: d.CreatedAt, LastSeen: d.LastSeen, LastIP: d.LastIP}
	}
	writeJSON(rw, http.StatusOK, map[string]any{
		"devices": views,
		"legacy": map[string]any{
			"enabled":   !ui.opts.Indexer.Config().DisableLegacyToken,
			"last_used": legacyLastUsed.Load(),
		},
	})
}

func (ui *WebUI) handleDeviceRevoke(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		ID string `json:"id"`
	}
	if !readJSON(rw, r, &body) {
		return
	}
	d, found, err := ui.opts.Devices.Revoke(body.ID)
	switch {
	case err != nil:
		logs.Errorf("pairing", "couldn't remove a phone: %v", err)
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The list couldn't be saved: " + err.Error()})
		return
	case !found:
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "That phone isn't in the list any more."})
		return
	}
	logs.Infof("pairing", "removed the phone %q (%s)", d.Name, d.ID)
	ui.opts.Events.Addf("Removed the phone %s", d.Name)
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}

// handleLegacyToken switches the old shared token on or off. It takes effect at once.
func (ui *WebUI) handleLegacyToken(rw http.ResponseWriter, r *http.Request, _ *session) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !readJSON(rw, r, &body) {
		return
	}

	ui.editMu.Lock()
	defer ui.editMu.Unlock()

	next := ui.opts.Indexer.Config().clone()
	next.DisableLegacyToken = !body.Enabled
	if err := saveConfig(ui.opts.ConfigPath, next); err != nil {
		logs.Errorf("config", "couldn't save the settings: %v", err)
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "The settings couldn't be saved: " + err.Error()})
		return
	}
	ui.opts.Indexer.SetConfig(next) // no rescan needed: the files didn't change

	state := "on"
	if !body.Enabled {
		state = "off"
	}
	logs.Infof("pairing", "the old shared token was switched %s", state)
	ui.opts.Events.Addf("The old shared token was switched %s", state)
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- calls from another copy of the agent (secret required) ----------

// handleInternalPair is what  fsagent -pair  calls.
func (ui *WebUI) handleInternalPair(rw http.ResponseWriter, r *http.Request) {
	if !ui.secretOK(r) {
		writeJSON(rw, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	v := ui.currentPairing(false)
	payload := ""
	if host := ui.host(); host != "" {
		payload = pairingPayloadFor(ui.opts.Config, host, v.raw)
	}
	left := int(time.Until(time.Unix(v.ExpiresAt, 0)).Seconds())
	if left < 0 {
		left = 0
	}
	writeJSON(rw, http.StatusOK, map[string]any{"address": v.Address, "code": v.Code, "expires_in": left, "payload": payload})
}

// handleInternalStatus lets the troubleshooter read the agent's state without any phone key.
func (ui *WebUI) handleInternalStatus(rw http.ResponseWriter, r *http.Request) {
	if !ui.secretOK(r) {
		writeJSON(rw, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	entries, _ := ui.opts.Indexer.Snapshot()
	writeJSON(rw, http.StatusOK, map[string]any{
		"device_id":   ui.opts.Config.DeviceID,
		"version":     versionLabel(),
		"api_version": apiVersion,
		"file_count":  len(entries),
		"scanning":    ui.opts.Indexer.Scanning(),
	})
}