package main

import (
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Names the login entries go by. Change them together with the project name.
const (
	autostartName = "FSIndexerAgent"             // Windows: the value under the Run key
	autostartID   = "com.brandnova.fsindexer"    // macOS: the login item's label and file name
	autostartFile = "fsagent-autostart.desktop" // Linux: the file in ~/.config/autostart
)

// AutostartState is what the dashboard shows.
type AutostartState struct {
	Supported bool   `json:"supported"`
	Enabled   bool   `json:"enabled"`
	Detail    string `json:"detail,omitempty"`
}

// The per-OS files provide:
//   autostartSupported() error
//   autostartEnabled() (bool, error)
//   enableAutostart(exe string, args []string) error
//   disableAutostart() error

func autostartState() AutostartState {
	if err := autostartSupported(); err != nil {
		return AutostartState{Detail: err.Error()}
	}
	on, err := autostartEnabled()
	if err != nil {
		return AutostartState{Supported: true, Detail: "Couldn't check: " + err.Error()}
	}
	return AutostartState{Supported: true, Enabled: on}
}

// setAutostart turns "start when I sign in" on or off for this copy of the agent.
func setAutostart(on bool, configPath string) error {
	if err := autostartSupported(); err != nil {
		return err
	}
	if !on {
		if err := disableAutostart(); err != nil {
			return fmt.Errorf("Couldn't turn it off: %w", err)
		}
		return nil
	}
	exe, err := exePath()
	if err != nil {
		return err
	}
	if err := enableAutostart(exe, autostartArgs(configPath)); err != nil {
		return fmt.Errorf("Couldn't turn it on: %w", err)
	}
	return nil
}

// autostartArgs are the options the login entry starts the agent with.
// Windows runs the background mode (otherwise a console window would stay open).
// macOS and Linux run the agent directly and quietly: their login managers
// supervise the process, and a detached child could be cleaned up with it.
// A login start never opens a browser.
func autostartArgs(configPath string) []string {
	return autostartArgsFor(runtime.GOOS, configPath)
}

func autostartArgsFor(goos, configPath string) []string {
	args := []string{"-quiet", "-no-open", "-no-qr"}
	if goos == "windows" {
		args = []string{"-background", "-no-open"}
	}
	abs, err := filepath.Abs(configPath)
	def, errDef := filepath.Abs(DefaultConfigPath())
	if err == nil && errDef == nil && !pathsEqual(abs, def) {
		args = append(args, "-config", abs) // a custom settings file must be remembered
	}
	return args
}

// exePath is this program's own permanent location. Temporary builds are refused.
func exePath() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	if isTemporaryPath(p) {
		return "", errors.New("This copy of the agent is a temporary build (for example from \"go run\"). Install or unpack the agent somewhere permanent, then turn this on from there.")
	}
	return p, nil
}

// isTemporaryPath reports whether p is inside the system's temporary folder, or is a
// "go run" build. Both the plain and the symlink-resolved forms of each path are compared:
// macOS keeps /var as a link to /private/var, and Windows can show the same folder under a
// short name (RUNNER~1) or its long one.
func isTemporaryPath(p string) bool {
	if strings.Contains(p, "go-build") {
		return true
	}
	tmpDirs := []string{os.TempDir(), resolvedPath(os.TempDir())}
	paths := []string{p, resolvedPath(p)}
	for _, tmp := range tmpDirs {
		for _, q := range paths {
			if pathInside(q, tmp) {
				return true
			}
		}
	}
	return false
}

// ---------- file contents (the same on every system, so they can be tested everywhere) ----------

// desktopEntry is the Linux autostart file.
func desktopEntry(exe string, args []string) string {
	parts := []string{desktopQuote(exe)}
	for _, a := range args {
		parts = append(parts, desktopQuote(a))
	}
	return "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=" + displayName + " agent\n" +
		"Comment=Shares your file names with your phone\n" +
		"Exec=" + strings.Join(parts, " ") + "\n" +
		"Terminal=false\n" +
		"NoDisplay=true\n" +
		"X-GNOME-Autostart-enabled=true\n"
}

// desktopQuote follows the Exec quoting rules of the Desktop Entry specification.
func desktopQuote(s string) string {
	if !strings.ContainsAny(s, " \t\n\"'\\><~|&;$*?#()`") {
		return s
	}
	r := strings.NewReplacer(`\`, `\\\\`, `"`, `\"`, "`", "\\`", "$", `\$`)
	return `"` + r.Replace(s) + `"`
}

// launchdPlist is the macOS login item.
func launchdPlist(exe string, args []string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>` + xmlText(autostartID) + `</string>
  <key>ProgramArguments</key>
  <array>
    <string>` + xmlText(exe) + `</string>
`)
	for _, a := range args {
		b.WriteString("    <string>" + xmlText(a) + "</string>\n")
	}
	b.WriteString(`  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
`)
	return b.String()
}

func xmlText(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// ---------- the -autostart command ----------

func runAutostartCommand(c *Console, action, configPath string) {
	act := strings.ToLower(strings.TrimSpace(action))
	switch act {
	case "status":
		st := autostartState()
		switch {
		case !st.Supported:
			c.Warn("Starting on login isn't available here: " + st.Detail)
		case st.Enabled:
			c.OK("Start on login", "on")
		default:
			c.OK("Start on login", "off")
		}
	case "on", "off":
		if err := setAutostart(act == "on", configPath); err != nil {
			logs.Warnf("autostart", "couldn't turn it %s: %v", act, err)
			fail(c, friendlyError{Title: "Couldn't change start on login", Detail: err.Error()})
		}
		logs.Infof("autostart", "start on login is now %s", act)
		c.OK("Start on login", act)
		if act == "on" {
			c.Hint(`The agent now starts quietly when you sign in. Run "` + binaryName + ` -ui" to open the dashboard.`)
		}
	default:
		fail(c, friendlyError{
			Title:  "Unknown option for -autostart",
			Detail: fmt.Sprintf("%q isn't one of on, off or status.", action),
			Hint:   binaryName + " -autostart on",
		})
	}
}