package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

var ipv4Pattern = regexp.MustCompile(`\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b`)

// ReportInput is what goes into a problem report.
type ReportInput struct {
	Config     *Config
	ConfigPath string
	LogPath    string
	Mode       string
	Uptime     time.Duration
	Discovery  string
	Folders    []folderStat // nil when the agent isn't running (-report)
	Entries    int
	Scanning   bool
	IndexedAt  time.Time
	LogLines   []string
	MaskIPs    bool
}

// BuildReport makes the text people attach to a bug report. It never contains
// the access token, and it replaces the person's home folder with "~".
func BuildReport(in ReportInput) string {
	var b strings.Builder
	line := func(format string, args ...any) { fmt.Fprintf(&b, format+"\n", args...) }

	line("%s agent report", displayName)
	line("Created: %s", time.Now().Format("2006-01-02 15:04:05 -0700"))
	line("")
	line("== This computer and the agent ==")
	line("Agent: %s (API %d)", versionLabel(), apiVersion)
	line("System: %s/%s, %s", runtime.GOOS, runtime.GOARCH, runtime.Version())
	line("Mode: %s", in.Mode)
	if in.Uptime > 0 {
		line("Running for: %s", in.Uptime.Round(time.Second))
	}
	line("Settings file: %s", in.ConfigPath)
	line("Log file: %s", in.LogPath)
	if in.Discovery != "" {
		line("Discovery: %s", in.Discovery)
	}

	line("")
	line("== Your folders ==")
	switch {
	case in.Folders != nil:
		for _, f := range in.Folders {
			state := "shared"
			if f.Disabled {
				state = "switched off"
			}
			line("- %s: %d files, %s, %s", f.Label, f.Files, humanBytes(f.Bytes), state)
		}
		scan := "last scan " + in.IndexedAt.Format("15:04:05")
		if in.IndexedAt.IsZero() {
			scan = "no scan finished yet"
		}
		line("Index: %d items, %s, scanning now: %v", in.Entries, scan, in.Scanning)
	default:
		for _, r := range in.Config.Roots {
			line("- %s (%s)", r.Label, r.Path)
		}
		line("(The agent wasn't asked about its live state.)")
	}

	line("")
	line("== Settings (the token is removed) ==")
	view := *in.Config
	view.Token = "[token removed]"
	view.DeviceID = abbreviate(view.DeviceID)
	data, _ := json.MarshalIndent(&view, "", "  ")
	line("%s", data)

	line("")
	line("== Latest log lines ==")
	if len(in.LogLines) == 0 {
		line("(the log is empty)")
	}
	for _, l := range in.LogLines {
		line("%s", l)
	}

	return redactReport(b.String(), in.Config.Token, in.MaskIPs)
}

func abbreviate(id string) string {
	if len(id) > 4 {
		return id[:4] + "..."
	}
	return id
}

// redactReport removes what shouldn't be shared: the token, the person's home
// folder name, and (optionally) the last two parts of IP addresses.
func redactReport(s, token string, maskIPs bool) string {
	if token != "" {
		s = strings.ReplaceAll(s, token, "[token removed]")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		s = strings.ReplaceAll(s, home, "~")
		if slash := filepath.ToSlash(home); slash != home {
			s = strings.ReplaceAll(s, slash, "~")
		}
	}
	if maskIPs {
		s = ipv4Pattern.ReplaceAllString(s, "$1.$2.x.x")
	}
	return s
}