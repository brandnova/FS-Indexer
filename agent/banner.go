package main

import (
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// displayName is what people see. Change it together with the project name.
const displayName = "FS Indexer"

// startupInfo is everything the banner needs besides the settings.
type startupInfo struct {
	ConfigPath  string
	Notice      string // e.g. "using ./config.json from the current folder..."
	Host        string // this computer's address on the network; "" if unknown
	Discovery   string // how automatic discovery is doing, in words
	DiscoveryOK bool
}

func versionLabel() string {
	if version == "dev" {
		return "(development build)"
	}
	return "v" + strings.TrimPrefix(version, "v")
}

// printBanner shows the startup screen (everything except the QR code).
func printBanner(c *Console, cfg *Config, info startupInfo) {
	c.Blank()
	c.Title(fmt.Sprintf("%s agent  %s", displayName, versionLabel()))
	c.Blank()

	if info.Notice != "" {
		c.Warn(info.Notice)
	}
	if cfg.firstRun {
		c.OK("Welcome", "first start: your settings file was created")
	}
	c.OK("Settings", info.ConfigPath)
	c.OK("Folders", rootLabels(cfg.Roots))
	if cfg.defaultRoots {
		c.Hint(`These are your standard folders. To choose others, edit "roots" in the settings file.`)
	}
	if info.Host != "" {
		c.OK("Address", fmt.Sprintf("%s:%d  (only devices on your network can connect)", info.Host, cfg.Port))
	}
	if len(cfg.AllowedNetworks) > 0 {
		c.OK("Networks", "also allowing "+strings.Join(cfg.AllowedNetworks, ", "))
	}
	if info.DiscoveryOK {
		c.OK("Discovery", info.Discovery)
	} else {
		c.Info("Discovery", info.Discovery)
	}
	c.Info("Indexing", "looking through your folders...")
}

// reportScan says how a scan went. The first one is a status line; later ones are activity.
func reportScan(c *Console, cfg *Config, r ScanResult, first bool) {
	summary := fmt.Sprintf("%s items (%s files, %s folders) in %s",
		commas(r.Entries), commas(r.Files), commas(r.Folders), roundDuration(r.Duration))
	if first {
		c.OK("Indexed", summary)
	} else {
		c.Activity("Rescanned your folders: %s", summary)
	}

	if r.Skipped == 0 {
		return
	}
	if r.Entries <= len(cfg.Roots) {
		c.Warn("Your computer is blocking access to your folders, so nothing could be listed.")
		c.Hint(permissionHint())
		return
	}
	c.Warn(fmt.Sprintf("%s items couldn't be read (usually missing permissions). Run with -verbose to see which.", commas(r.Skipped)))
}

func permissionHint() string {
	switch runtime.GOOS {
	case "darwin":
		return "On a Mac: open System Settings > Privacy & Security > Files and Folders (or Full Disk Access), allow Terminal or this program, then restart the agent."
	case "windows":
		return "Check that your account can open these folders, and that antivirus software isn't blocking the agent."
	}
	return "Check the folder permissions: the account running the agent must be able to read them."
}

// commas formats 1234567 as "1,234,567".
func commas(n int) string {
	s := strconv.Itoa(n)
	if n < 0 || len(s) <= 3 {
		return s
	}
	var b strings.Builder
	head := len(s) % 3
	if head > 0 {
		b.WriteString(s[:head])
		b.WriteByte(',')
	}
	for i := head; i < len(s); i += 3 {
		b.WriteString(s[i : i+3])
		if i+3 < len(s) {
			b.WriteByte(',')
		}
	}
	return b.String()
}

func roundDuration(d time.Duration) string {
	if d < time.Second {
		return d.Round(time.Millisecond).String()
	}
	return d.Round(100 * time.Millisecond).String()
}