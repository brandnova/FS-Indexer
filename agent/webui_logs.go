package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func matchesLevel(line, level string) bool {
	switch level {
	case "warn":
		return strings.Contains(line, " WARN ") || strings.Contains(line, " ERROR ")
	case "error":
		return strings.Contains(line, " ERROR ")
	}
	return true
}

func (ui *WebUI) handleLogs(rw http.ResponseWriter, r *http.Request, _ *session) {
	level := r.URL.Query().Get("level")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > logRecentKept {
		limit = 300
	}

	lines := make([]string, 0, limit)
	for _, l := range logs.Recent(logRecentKept) {
		if matchesLevel(l, level) {
			lines = append(lines, l)
		}
	}
	if len(lines) > limit {
		lines = lines[len(lines)-limit:]
	}
	writeJSON(rw, http.StatusOK, map[string]any{"path": logs.Path(), "lines": lines})
}

func (ui *WebUI) handleLogDownload(rw http.ResponseWriter, r *http.Request, _ *session) {
	var data []byte
	if p := logs.Path(); p != "" {
		data, _ = os.ReadFile(p)
	}
	if len(data) == 0 {
		data = []byte(strings.Join(logs.Recent(logRecentKept), "\n") + "\n")
	}
	rw.Header().Set("Content-Type", "text/plain; charset=utf-8")
	rw.Header().Set("Content-Disposition", `attachment; filename="agent.log"`)
	_, _ = rw.Write(data)
}

// handleLogOpen shows the log's folder in the file manager. It opens one fixed place only.
func (ui *WebUI) handleLogOpen(rw http.ResponseWriter, r *http.Request, _ *session) {
	p := logs.Path()
	if p == "" {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "There is no log file."})
		return
	}
	if err := openFolder(filepath.Dir(p)); err != nil {
		writeJSON(rw, http.StatusInternalServerError, map[string]string{"error": "Couldn't open the file manager: " + err.Error()})
		return
	}
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}

// handleReport builds the problem report: ?mask=0 keeps IP addresses, ?download=1 sends it as a file.
func (ui *WebUI) handleReport(rw http.ResponseWriter, r *http.Request, _ *session) {
	cfg := ui.opts.Indexer.Config()
	entries, at := ui.opts.Indexer.Snapshot()

	text := BuildReport(ReportInput{
		Config:     cfg,
		ConfigPath: ui.opts.ConfigPath,
		LogPath:    logs.Path(),
		Mode:       ui.opts.Mode,
		Uptime:     time.Since(ui.started),
		Discovery:  ui.opts.Discovery,
		Folders:    folderStats(entries, cfg.Roots),
		Entries:    len(entries),
		Scanning:   ui.opts.Indexer.Scanning(),
		IndexedAt:  at,
		LogLines:   logs.Recent(150),
		MaskIPs:    r.URL.Query().Get("mask") != "0",
	})
	logs.Infof("dashboard", "a problem report was created")

	rw.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if r.URL.Query().Get("download") == "1" {
		rw.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="fsagent-report-%s.txt"`, time.Now().Format("2006-01-02")))
	}
	_, _ = io.WriteString(rw, text)
}