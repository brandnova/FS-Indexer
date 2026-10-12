package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/grandcat/zeroconf"
)

// doctorServiceType must match the service the agent announces in mdns.go.
const doctorServiceType = "_fs-sync._tcp"

// doctorBrowseWait is how long the discovery check listens. Tests shorten it.
var doctorBrowseWait = 3500 * time.Millisecond

type CheckStatus string

const (
	StatusOK   CheckStatus = "ok"
	StatusInfo CheckStatus = "info"
	StatusWarn CheckStatus = "warn"
	StatusFail CheckStatus = "fail"
)

// Check is the result of one test. Title, Detail and Fix are shown to people as they are.
type Check struct {
	ID     string      `json:"id"`
	Title  string      `json:"title"`
	Status CheckStatus `json:"status"`
	Detail string      `json:"detail"`
	Fix    string      `json:"fix,omitempty"`
}

// DoctorInput is everything the checks need. The checks only look: they change nothing.
type DoctorInput struct {
	Config     *Config // nil when the settings file couldn't be read
	ConfigErr  error   // why, when Config is nil
	ConfigPath string
	LogPath    string
	Indexer    *Indexer // set when the checks run inside the agent
	WebPort    int      // the dashboard's real port, when run inside the agent
	Discovery  string   // how discovery is doing ("off ...", "unavailable ...", or anything else for on)
}

type remoteInfo struct {
	DeviceID   string
	Version    string
	APIVersion int
	FileCount  int
	Scanning   bool
}

// doctorEnv shares one look at the running agent between all checks.
type doctorEnv struct {
	DoctorInput
	probed        bool
	running       bool
	tokenMismatch bool
	probeNote     string
	remote        remoteInfo
}

// probe finds out whether an agent is answering on the phone port. Inside the agent
// the answer is known without any network call.
func (e *doctorEnv) probe() {
	if e.probed || e.Config == nil {
		return
	}
	e.probed = true
	cfg := e.Config

	if e.Indexer != nil {
		entries, _ := e.Indexer.Snapshot()
		e.running = true
		e.remote = remoteInfo{
			DeviceID:   cfg.DeviceID,
			Version:    versionLabel(),
			APIVersion: apiVersion,
			FileCount:  len(entries),
			Scanning:   e.Indexer.Scanning(),
		}
		return
	}

	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/api/v1/ping", cfg.Port), nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			e.probeNote = "something is using that port but didn't answer"
		}
		return // "connection refused" simply means: not running
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
		case http.StatusOK:
			var body struct {
				DeviceID   string `json:"device_id"`
				Version    string `json:"version"`
				APIVersion int    `json:"api_version"`
				FileCount  int    `json:"file_count"`
				Scanning   bool   `json:"scanning"`
			}
			if json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body) != nil {
				e.probeNote = "something is using that port but doesn't answer like the agent"
				return
			}
			e.running = true
			e.remote = remoteInfo{DeviceID: body.DeviceID, Version: body.Version, APIVersion: body.APIVersion, FileCount: body.FileCount, Scanning: body.Scanning}
		case http.StatusUnauthorized:
			// The agent is there but doesn't take the shared token (it may be switched off): ask it directly.
			e.running = true
			if info, ok := e.askRunningAgent(); ok {
				e.remote = info
			} else {
				e.tokenMismatch = true
			}
		default:
			e.probeNote = fmt.Sprintf("something is using that port and answered with status %d", resp.StatusCode)
	}
}

// askRunningAgent uses the secret in the runtime file, which only the same user can read.
func (e *doctorEnv) askRunningAgent() (remoteInfo, bool) {
	rt, err := readRuntime(siblingPath(e.ConfigPath, "runtime.json", ".runtime.json"))
	if err != nil {
		return remoteInfo{}, false
	}
	body, err := callRunning(rt, "/internal/status")
	if err != nil {
		return remoteInfo{}, false
	}
	var out struct {
		DeviceID   string `json:"device_id"`
		Version    string `json:"version"`
		APIVersion int    `json:"api_version"`
		FileCount  int    `json:"file_count"`
		Scanning   bool   `json:"scanning"`
	}
	if json.Unmarshal(body, &out) != nil {
		return remoteInfo{}, false
	}
	return remoteInfo{DeviceID: out.DeviceID, Version: out.Version, APIVersion: out.APIVersion, FileCount: out.FileCount, Scanning: out.Scanning}, true
}

// ---------- the list of checks ----------

type doctorCheck struct {
	id  string
	run func(e *doctorEnv) (Check, bool) // false: nothing to report (the check doesn't apply)
}

// To add a check: write a function like the ones below and add it here.
var doctorChecks = []doctorCheck{
	{"settings", checkSettings},
	{"folders", checkFolders},
	{"network", checkNetwork},
	{"agent", checkAgent},
	{"phones", checkPhones},
	{"phone-port", checkPhonePort},
	{"dashboard", checkDashboardPort},
	{"index", checkIndex},
	{"discovery", checkDiscovery},
	{"firewall", checkFirewall},
	{"log", checkLog},
	{"autostart", checkAutostart},
}

func RunDoctor(in DoctorInput) []Check {
	e := &doctorEnv{DoctorInput: in}
	var out []Check
	for _, c := range doctorChecks {
		if res, ok := c.run(e); ok {
			res.ID = c.id
			out = append(out, res)
		}
	}
	return out
}

func countChecks(checks []Check) (ok, warn, fail int) {
	for _, c := range checks {
		switch c.Status {
			case StatusOK, StatusInfo:
				ok++
			case StatusWarn:
				warn++
			case StatusFail:
				fail++
		}
	}
	return
}

// ---------- the checks ----------

func checkSettings(e *doctorEnv) (Check, bool) {
	c := Check{Title: "Settings file"}

	problem := func(err error) (Check, bool) {
		fe := explainConfigError(e.ConfigPath, err)
		c.Status = StatusFail
		if strings.Contains(err.Error(), "does not exist yet") {
			c.Status = StatusWarn // a first start simply hasn't happened yet
		}
		c.Detail = fe.Title + ". " + fe.Detail
		c.Fix = fe.Hint
		return c, true
	}

	if e.Config == nil {
		err := e.ConfigErr
		if err == nil {
			err = errors.New("the settings couldn't be read")
		}
		return problem(err)
	}
	if err := e.Config.validatePorts(); err != nil {
		return problem(err)
	}
	if err := e.Config.parseAllowedNetworks(); err != nil {
		return problem(err)
	}

	if runtime.GOOS != "windows" {
		if st, err := os.Stat(e.ConfigPath); err == nil && st.Mode().Perm()&0o077 != 0 {
			c.Status = StatusWarn
			c.Detail = fmt.Sprintf("%s can be read by other users of this computer, and it holds your access token.", e.ConfigPath)
			c.Fix = fmt.Sprintf("chmod 600 %q", e.ConfigPath)
			return c, true
		}
	}
	c.Status = StatusOK
	c.Detail = e.ConfigPath
	return c, true
}

func checkFolders(e *doctorEnv) (Check, bool) {
	if e.Config == nil {
		return Check{}, false
	}
	c := Check{Title: "Shared folders"}

	var problems, good, reals []string
	blocked := false

	for _, r := range e.Config.Roots {
		if r.Disabled {
			continue
		}
		abs, err := filepath.Abs(expandTilde(r.Path))
		label := r.Label
		if label == "" && err == nil {
			label = filepath.Base(abs)
		}
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %q isn't a usable path", label, r.Path))
			continue
		}
		real, err := resolveDir(abs)
		if err != nil {
			if errors.Is(err, errNotDir) {
				problems = append(problems, fmt.Sprintf("%s: %s is a file, not a folder", label, abs))
			} else {
				problems = append(problems, fmt.Sprintf("%s: %s can't be found (is a drive unplugged?)", label, abs))
			}
			continue
		}
		f, err := os.Open(real)
		if err == nil {
			_, err = f.Readdirnames(1)
			f.Close()
		}
		if err != nil && err != io.EOF { // EOF just means the folder is empty
			if errors.Is(err, fs.ErrPermission) {
				blocked = true
			}
			problems = append(problems, fmt.Sprintf("%s: %s can't be read (%v)", label, real, err))
			continue
		}
		good = append(good, label)
		reals = append(reals, real)
	}

	switch {
		case len(problems) > 0:
			c.Status = StatusFail
			c.Detail = strings.Join(problems, "\n")
			if blocked {
				c.Fix = permissionHint()
			} else {
				c.Fix = "Check the path, or switch the folder off or remove it under Folders in the dashboard."
			}
		case len(good) == 0:
			c.Status = StatusWarn
			c.Detail = "No folders are switched on, so there is nothing to share."
			c.Fix = "Turn a folder on or add one under Folders in the dashboard."
		default:
			c.Status = StatusOK
			c.Detail = fmt.Sprintf("%d readable: %s", len(good), strings.Join(good, ", "))
			for i := range reals {
				for j := range reals {
					if i != j && pathInside(reals[i], reals[j]) {
						c.Status = StatusWarn
						c.Detail = fmt.Sprintf("%s is inside %s, so its files would be listed twice.", good[i], good[j])
						c.Fix = "Remove one of the two under Folders in the dashboard."
						return c, true
					}
				}
			}
	}
	return c, true
}

func checkNetwork(e *doctorEnv) (Check, bool) {
	c := Check{Title: "Network address"}
	host := PreferredLANIP()
	if host == "" {
		c.Status = StatusFail
		c.Detail = "This computer doesn't seem to be on a network, so a phone can't find it."
		c.Fix = "Connect to Wi-Fi or a network cable. You can also set an address yourself with the -host option."
		return c, true
	}
	c.Status = StatusOK
	c.Detail = "This computer's address is " + host + "."
	if others := otherLANIPs(host); len(others) > 0 {
		c.Detail += " It also has: " + strings.Join(others, ", ") + ". If the phone can't connect, try one of those under Connect a phone."
	}
	return c, true
}

func checkAgent(e *doctorEnv) (Check, bool) {
	if e.Config == nil {
		return Check{}, false
	}
	e.probe()
	cfg := e.Config
	c := Check{Title: "The agent"}

	switch {
		case e.tokenMismatch:
			c.Status = StatusWarn
			c.Detail = fmt.Sprintf("An agent is answering on port %d, but this check can't read its details: the shared token is switched off, or it was started with a different settings file.", cfg.Port)
			c.Fix = "Open Check my setup in the dashboard instead: it asks the running agent directly."
		case !e.running && e.probeNote != "":
			c.Status = StatusWarn
			c.Detail = fmt.Sprintf("Port %d is used by something else: %s.", cfg.Port, e.probeNote)
			c.Fix = `Close that program, or choose another "port" in the settings file.`
		case !e.running:
			c.Status = StatusInfo
			c.Detail = "The agent isn't running right now. Start it, then run this again to test the rest."
		default:
			c.Status = StatusOK
			c.Detail = fmt.Sprintf("Running (%s, API %d).", e.remote.Version, e.remote.APIVersion)
			if e.remote.DeviceID != "" && e.remote.DeviceID != cfg.DeviceID {
				c.Status = StatusWarn
				c.Detail += " But it uses a different settings file (another device ID)."
				c.Fix = "Stop it with  " + binaryName + " -stop  and start it with the settings file you want."
			}
	}
	return c, true
}

func checkPhonePort(e *doctorEnv) (Check, bool) {
	cfg := e.Config
	if cfg == nil {
		return Check{}, false
	}
	e.probe()
	c := Check{Title: "Port for your phone"}

	if e.running {
		c.Status = StatusOK
		c.Detail = fmt.Sprintf("The agent is listening on port %d.", cfg.Port)
		return c, true
	}
	addr := fmt.Sprintf(":%d", cfg.Port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fe := explainListenError(addr, err)
		c.Status = StatusFail
		c.Detail = fe.Title + ". " + fe.Detail
		c.Fix = fe.Hint
		return c, true
	}
	ln.Close()
	c.Status = StatusOK
	c.Detail = fmt.Sprintf("Port %d is free for the agent.", cfg.Port)
	return c, true
}

func checkPhones(e *doctorEnv) (Check, bool) {
	cfg := e.Config
	if cfg == nil {
		return Check{}, false
	}
	c := Check{Title: "Paired phones", Status: StatusInfo}

	devices, err := readDevicesFile(siblingPath(e.ConfigPath, "devices.json", ".devices.json"))
	if err != nil {
		c.Status = StatusFail
		c.Detail = "The list of paired phones is damaged: " + err.Error()
		c.Fix = "Move devices.json out of the settings folder. The phones will have to pair again."
		return c, true
	}

	var parts []string
	if len(devices) == 0 {
		parts = append(parts, "No phone is paired yet. Open Connect a phone in the dashboard to pair one.")
	} else {
		names := make([]string, len(devices))
		for i, d := range devices {
			names[i] = d.Name
		}
		c.Status = StatusOK
		parts = append(parts, fmt.Sprintf("%d paired: %s", len(devices), strings.Join(names, ", ")))
	}
	if !cfg.DisableLegacyToken {
		parts = append(parts, "The old shared token is still accepted, for phones paired before per-phone keys existed. Turn it off under Connect a phone once every phone has paired again.")
	}
	c.Detail = strings.Join(parts, "\n")
	return c, true
}

func checkDashboardPort(e *doctorEnv) (Check, bool) {
	cfg := e.Config
	if cfg == nil {
		return Check{}, false
	}
	c := Check{Title: "Dashboard"}

	switch {
		case cfg.DisableWebUI:
			c.Status = StatusInfo
			c.Detail = "The dashboard is switched off in the settings (disable_web_ui)."
		case e.Indexer != nil:
			c.Status = StatusOK
			c.Detail = fmt.Sprintf("The dashboard is on port %d (this page).", e.WebPort)
		default:
			if rt, err := readRuntime(siblingPath(e.ConfigPath, "runtime.json", ".runtime.json")); err == nil {
				if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", rt.Port), time.Second); err == nil {
					conn.Close()
					c.Status = StatusOK
					c.Detail = fmt.Sprintf("The dashboard is on port %d. Run  %s -ui  to open it.", rt.Port, binaryName)
					return c, true
				}
			}
			ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.WebPort))
			if err != nil {
				c.Status = StatusWarn
				c.Detail = fmt.Sprintf("Port %d is busy.", cfg.WebPort)
				c.Fix = "This is harmless: the agent picks another port for the dashboard by itself."
			} else {
				ln.Close()
				c.Status = StatusOK
				c.Detail = fmt.Sprintf("Port %d is free for the dashboard.", cfg.WebPort)
			}
	}
	return c, true
}

func checkIndex(e *doctorEnv) (Check, bool) {
	if e.Config == nil {
		return Check{}, false
	}
	e.probe()
	if !e.running || e.tokenMismatch {
		return Check{}, false
	}
	c := Check{Title: "File list"}

	switch {
		case e.remote.Scanning:
			c.Status = StatusInfo
			c.Detail = "The agent is scanning your folders right now. Run this again in a moment."
		case e.remote.FileCount == 0:
			c.Status = StatusWarn
			c.Detail = "The agent is running but has found no files."
			c.Fix = "Check the folders above: they may be empty, switched off, or blocked by your system's privacy settings. You can rescan from the dashboard's Home page."
		default:
			c.Status = StatusOK
			c.Detail = fmt.Sprintf("%s items are ready for your phone.", commas(e.remote.FileCount))
	}
	return c, true
}

func checkDiscovery(e *doctorEnv) (Check, bool) {
	cfg := e.Config
	if cfg == nil {
		return Check{}, false
	}
	e.probe()
	if !e.running || e.tokenMismatch || strings.HasPrefix(e.Discovery, "off") {
		return Check{}, false
	}
	c := Check{Title: "Automatic discovery"}
	const fix = "Automatic discovery is only a shortcut. Scanning the QR code or typing the address always works."

	if strings.HasPrefix(e.Discovery, "unavailable") {
		c.Status = StatusWarn
		c.Detail = "The agent couldn't turn it on: " + e.Discovery
		c.Fix = fix
		return c, true
	}

	host := PreferredLANIP()
	ips := append([]string{host}, otherLANIPs(host)...)
	found, err := seesOwnAnnouncement(cfg.Port, ips)
	switch {
		case err != nil:
			c.Status = StatusWarn
			c.Detail = "Couldn't test it: " + err.Error()
			c.Fix = fix
		case found:
			c.Status = StatusOK
			c.Detail = "Phones on your network can find this computer by themselves."
		default:
			c.Status = StatusWarn
			c.Detail = "This computer doesn't see its own announcement on the network. Some routers, VPNs and firewalls block it."
			c.Fix = fix
	}
	return c, true
}

// seesOwnAnnouncement listens for the agent's own mDNS announcement.
func seesOwnAnnouncement(port int, ips []string) (bool, error) {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		return false, err
	}
	entries := make(chan *zeroconf.ServiceEntry)
	ctx, cancel := context.WithTimeout(context.Background(), doctorBrowseWait)
	defer cancel()
	if err := resolver.Browse(ctx, doctorServiceType, "local.", entries); err != nil {
		return false, err
	}
	// Whatever happens, keep emptying the channel so the library can never block on us.
	defer func() { go func() { for range entries { } }() }()

	deadline := time.After(doctorBrowseWait + 500*time.Millisecond)
	for {
		select {
		case entry, ok := <-entries:
			if !ok {
				return false, nil
			}
			if entry.Port != port {
				continue
			}
			for _, ip := range entry.AddrIPv4 {
				for _, mine := range ips {
					if mine != "" && ip.String() == mine {
						return true, nil
					}
				}
			}
		case <-deadline:
			return false, nil
		}
	}
}

func checkFirewall(e *doctorEnv) (Check, bool) {
	cfg := e.Config
	if cfg == nil {
		return Check{}, false
	}
	e.probe()
	if !e.running || e.tokenMismatch {
		return Check{}, false
	}
	c := Check{Title: "Firewall"}

	switch firewallState(cfg.Port) {
		case "open":
			c.Status = StatusOK
			c.Detail = fmt.Sprintf("firewalld lets port %d in (default zone).", cfg.Port)
		case "closed":
			c.Status = StatusWarn
			c.Detail = fmt.Sprintf("firewalld is blocking port %d, so your phone can't reach the agent.", cfg.Port)
			c.Fix = fmt.Sprintf("sudo firewall-cmd --add-port=%d/tcp --permanent && sudo firewall-cmd --reload", cfg.Port)
		default:
			c.Status = StatusInfo
			c.Detail = "A firewall can't be tested from this computer. " + firewallAdvice(cfg.Port)
	}
	return c, true
}

func firewallAdvice(port int) string {
	switch runtime.GOOS {
		case "windows":
			return "Windows asks the first time the agent runs. If you chose Cancel or Public only: Windows Security > Firewall & network protection > Allow an app through firewall > fsagent, and tick Private."
		case "darwin":
			return "macOS asks the first time the agent runs. If you chose Deny: System Settings > Network > Firewall > Options, and allow incoming connections for fsagent."
	}
	return fmt.Sprintf("If you use a firewall (firewalld, ufw), allow TCP port %d from your local network.", port)
}

func checkLog(e *doctorEnv) (Check, bool) {
	if e.LogPath == "" {
		return Check{}, false
	}
	c := Check{Title: "Recent problems"}

	lines := tailLines(e.LogPath, 400)
	if len(lines) == 0 {
		c.Status = StatusInfo
		c.Detail = "The log is empty so far."
		return c, true
	}

	since := time.Now().Add(-24 * time.Hour)
	var errs, warns int
	var recent []string
	for _, l := range lines {
		if len(l) < 25 {
			continue
		}
		t, err := time.ParseInLocation("2006-01-02 15:04:05", l[:19], time.Local)
		if err != nil || t.Before(since) {
			continue
		}
		switch {
			case strings.Contains(l[19:], " ERROR "):
				errs++
			case strings.Contains(l[19:], " WARN "):
				warns++
			default:
				continue
		}
		recent = append(recent, l)
	}
	if len(recent) > 3 {
		recent = recent[len(recent)-3:]
	}

	switch {
		case errs > 0:
			c.Status = StatusWarn
			c.Detail = fmt.Sprintf("%d errors and %d warnings in the last 24 hours. The latest:\n%s", errs, warns, strings.Join(recent, "\n"))
			c.Fix = "See Activity & logs in the dashboard, or run  " + binaryName + " -report  to collect everything for a bug report."
		case warns > 0:
			c.Status = StatusInfo
			c.Detail = fmt.Sprintf("%d warnings in the last 24 hours. The latest:\n%s", warns, strings.Join(recent, "\n"))
		default:
			c.Status = StatusOK
			c.Detail = "No warnings or errors in the last 24 hours."
	}
	return c, true
}

func checkAutostart(e *doctorEnv) (Check, bool) {
	c := Check{Title: "Start on login", Status: StatusInfo}
	st := autostartState()
	switch {
		case !st.Supported:
			c.Detail = "Not available on this system."
		case st.Enabled:
			c.Status = StatusOK
			c.Detail = "On: the agent starts quietly when you sign in."
		default:
			c.Detail = "Off. Turn it on under Settings if you want the agent ready after you sign in."
	}
	return c, true
}

// ---------- the terminal ----------

// phoneTips is what to try when every check passes and the phone still can't connect.
func phoneTips(addr string) []string {
	if addr == "" {
		addr = "ADDRESS:PORT"
	}
	return []string{
		"Make sure the phone and this computer are on the same Wi-Fi or network. A guest network often stops devices from seeing each other.",
		`Turn off any VPN on the phone and on this computer, or add the VPN's range to "allowed_networks" in the settings file.`,
		fmt.Sprintf(`Open http://%s/api/v1/ping in the phone's browser. If it shows {"error":"unauthorized"}, the network is fine and only the token is wrong: scan the QR code again. If it doesn't load, something between the phone and this computer is blocking it, usually a firewall or a router setting.`, addr),
	}
}

func printDoctor(c *Console, checks []Check) {
	for _, ch := range checks {
		lines := strings.Split(ch.Detail, "\n")
		first, rest := lines[0], lines[1:]

		switch ch.Status {
			case StatusOK:
				c.OK(ch.Title, first)
			case StatusInfo:
				c.Info(ch.Title, first)
			case StatusWarn:
				c.Warn(ch.Title + ": " + first)
			case StatusFail:
				c.Problem(ch.Title, first, ch.Fix)
		}
		for _, l := range rest {
			c.Hint(l)
		}
		if ch.Status == StatusWarn && ch.Fix != "" {
			c.Hint("How to fix: " + ch.Fix)
		}
	}
}

// runDoctorCommand is  fsagent -doctor . It returns the exit code: 1 when something needs fixing.
func runDoctorCommand(c *Console, configPath, logPath string) int {
	in := DoctorInput{ConfigPath: configPath, LogPath: logPath, Discovery: "auto"}
	cfg, err := ReadConfig(configPath)
	if err != nil {
		in.ConfigErr = err
	} else {
		in.Config = cfg
	}

	logs.Infof("doctor", "checking the setup from the terminal")
	c.Blank()
	c.Title("Checking your setup")
	c.Blank()

	checks := RunDoctor(in)
	printDoctor(c, checks)

	ok, warn, fail := countChecks(checks)
	logs.Infof("doctor", "finished: %d fine, %d to look at, %d to fix", ok, warn, fail)

	c.Blank()
	c.Text(fmt.Sprintf("%d fine, %d to look at, %d to fix.", ok, warn, fail))
	if fail == 0 && cfg != nil {
		addr := ""
		if host := PreferredLANIP(); host != "" {
			addr = fmt.Sprintf("%s:%d", host, cfg.Port)
		}
		c.Blank()
		c.Text("Phone still can't connect?")
		for i, tip := range phoneTips(addr) {
			c.Hint(fmt.Sprintf("%d. %s", i+1, tip))
		}
	}
	c.Blank()

	if fail > 0 {
		return 1
	}
	return 0
}
