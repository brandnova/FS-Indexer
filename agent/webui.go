package main

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"rsc.io/qr"
)

//go:embed web
var webFS embed.FS

const sessionCookie = "fsagent_session"

// WebOptions is everything the dashboard needs from the rest of the agent.
type WebOptions struct {
	Config     *Config // the settings at startup (token, ports and so on never change while running)
	Indexer    *Indexer
	Events     *EventLog
	ConfigPath string
	HostFlag   string // the -host override, if any
	Discovery  string // how automatic discovery is doing, in words
	Mode       string // "foreground" or "background"
	Devices *DeviceStore  // the paired phones (made for you if left empty)
	Codes   *PairingCodes // the current pairing code (made for you if left empty)
	Quit       func() // asks the agent to shut down
}

type session struct {
	csrf    string
	created time.Time
}

// WebUI is the dashboard: a small web page served on 127.0.0.1 for the person
// who runs the agent. It is protected in layers:
//   - it listens on the loopback address only;
//   - it opens with a one-time link (a "ticket"), which starts a private session;
//   - every request must carry the right Host, and unsafe ones the right Origin
//     (this blocks DNS-rebinding and cross-site attacks);
//   - every action needs the session's CSRF token.
type WebUI struct {
	opts    WebOptions
	started time.Time
	port    int
	secret  string // lets a second launch of the agent talk to this one (see launch.go)

	editMu sync.Mutex // one settings change at a time

	mu       sync.Mutex
	tickets  map[string]time.Time
	sessions map[string]*session

	tpl    *template.Template
	static http.Handler
}

func NewWebUI(opts WebOptions) (*WebUI, error) {
	tpl, err := template.ParseFS(webFS, "web/templates/*.html")
	if err != nil {
		return nil, err
	}
	assets, err := fs.Sub(webFS, "web/static")
	if err != nil {
		return nil, err
	}

	if opts.Codes == nil {
		opts.Codes = NewPairingCodes(pairingCodeTTL)
	}
	if opts.Devices == nil {
		d, err := OpenDevices(siblingPath(opts.ConfigPath, "devices.json", ".devices.json"))
		if err != nil {
			return nil, err
		}
		opts.Devices = d
	}

	return &WebUI{
		opts:     opts,
		started:  time.Now(),
		secret:   randomHex(24),
		tickets:  map[string]time.Time{},
		sessions: map[string]*session{},
		tpl:      tpl,
		static:   http.FileServer(http.FS(assets)),
	}, nil
}

// Listen opens the dashboard's port on the loopback address. If the preferred
// port is busy, the system picks a free one.
func (ui *WebUI) Listen(preferred int) (net.Listener, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferred))
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
	}
	ui.port = ln.Addr().(*net.TCPAddr).Port
	return ln, nil
}

func (ui *WebUI) BaseURL() string { return fmt.Sprintf("http://127.0.0.1:%d", ui.port) }

func (ui *WebUI) allowedHost(host string) bool {
	host = strings.ToLower(host)
	return host == fmt.Sprintf("127.0.0.1:%d", ui.port) || host == fmt.Sprintf("localhost:%d", ui.port)
}

// ---------- tickets and sessions ----------

// NewTicket makes a one-time key that can be exchanged for a session.
func (ui *WebUI) NewTicket(ttl time.Duration) string {
	t := randomHex(16)
	now := time.Now()

	ui.mu.Lock()
	defer ui.mu.Unlock()
	for k, expires := range ui.tickets {
		if now.After(expires) {
			delete(ui.tickets, k)
		}
	}
	ui.tickets[t] = now.Add(ttl)
	return t
}

func (ui *WebUI) useTicket(t string) bool {
	ui.mu.Lock()
	defer ui.mu.Unlock()
	expires, ok := ui.tickets[t]
	delete(ui.tickets, t) // one use only
	return ok && time.Now().Before(expires)
}

// LoginURL is a link that opens the dashboard once. `next` can be "pair" to land on the pairing page.
func (ui *WebUI) LoginURL(ttl time.Duration, next string) string {
	link := fmt.Sprintf("%s/login?ticket=%s", ui.BaseURL(), ui.NewTicket(ttl))
	if next != "" {
		link += "&next=" + next
	}
	return link
}

func (ui *WebUI) newSession() string {
	id := randomHex(32)

	ui.mu.Lock()
	defer ui.mu.Unlock()
	if len(ui.sessions) >= 20 { // forget the oldest browser
		oldest, oldestAt := "", time.Now()
		for k, s := range ui.sessions {
			if s.created.Before(oldestAt) {
				oldest, oldestAt = k, s.created
			}
		}
		delete(ui.sessions, oldest)
	}
	ui.sessions[id] = &session{csrf: randomHex(16), created: time.Now()}
	return id
}

func (ui *WebUI) sessionFor(r *http.Request) *session {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	ui.mu.Lock()
	defer ui.mu.Unlock()
	return ui.sessions[c.Value]
}

// ---------- routing and protection ----------

type apiHandler func(rw http.ResponseWriter, r *http.Request, s *session)

func (ui *WebUI) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /static/", http.StripPrefix("/static/", ui.static))
	mux.HandleFunc("GET /login", ui.handleLogin)
	mux.HandleFunc("GET /{$}", ui.handleIndex)

	mux.HandleFunc("GET /api/status", ui.api(ui.handleStatus))
	mux.HandleFunc("GET /api/pairing", ui.api(ui.handlePairing))
	mux.HandleFunc("GET /api/pairing.svg", ui.api(ui.handlePairingSVG))
	mux.HandleFunc("POST /api/rescan", ui.api(ui.handleRescan))
	mux.HandleFunc("POST /api/quit", ui.api(ui.handleQuit))

	mux.HandleFunc("GET /api/folders", ui.api(ui.handleFolders))
	mux.HandleFunc("POST /api/folders/add", ui.api(ui.handleFolderAdd))
	mux.HandleFunc("POST /api/folders/update", ui.api(ui.handleFolderUpdate))
	mux.HandleFunc("POST /api/folders/remove", ui.api(ui.handleFolderRemove))
	mux.HandleFunc("GET /api/fs/list", ui.api(ui.handleFSList))

	mux.HandleFunc("GET /api/rules", ui.api(ui.handleRules))
	mux.HandleFunc("POST /api/rules", ui.api(ui.handleRulesSave))
	mux.HandleFunc("POST /api/rules/test", ui.api(ui.handleRulesTest))

	mux.HandleFunc("GET /api/logs", ui.api(ui.handleLogs))
	mux.HandleFunc("GET /api/logs/download", ui.api(ui.handleLogDownload))
	mux.HandleFunc("POST /api/logs/open", ui.api(ui.handleLogOpen))
	mux.HandleFunc("GET /api/report", ui.api(ui.handleReport))
	mux.HandleFunc("GET /api/autostart", ui.api(ui.handleAutostart))
	mux.HandleFunc("POST /api/autostart", ui.api(ui.handleAutostartSave))
	mux.HandleFunc("POST /api/doctor", ui.api(ui.handleDoctor))

	mux.HandleFunc("POST /api/pairing/new", ui.api(ui.handlePairingNew))
	mux.HandleFunc("GET /api/devices", ui.api(ui.handleDevices))
	mux.HandleFunc("POST /api/devices/revoke", ui.api(ui.handleDeviceRevoke))
	mux.HandleFunc("POST /api/devices/legacy", ui.api(ui.handleLegacyToken))
	mux.HandleFunc("POST /internal/pair", ui.handleInternalPair)
	mux.HandleFunc("POST /internal/status", ui.handleInternalStatus)

	mux.HandleFunc("GET /api/fileaccess", ui.api(ui.handleFileAccess))
	mux.HandleFunc("POST /api/fileaccess", ui.api(ui.handleFileAccessSave))
	mux.HandleFunc("GET /api/uploads", ui.api(ui.handleUploads))
	mux.HandleFunc("POST /api/uploads", ui.api(ui.handleUploadsSave))
	mux.HandleFunc("POST /api/uploads/open", ui.api(ui.handleUploadsOpen))
	mux.HandleFunc("POST /api/fs/mkdir", ui.api(ui.handleMkdir))

	mux.HandleFunc("GET /api/update", ui.api(ui.handleUpdate))
	mux.HandleFunc("POST /api/update", ui.api(ui.handleUpdateSave))
	mux.HandleFunc("POST /api/update/check", ui.api(ui.handleUpdateCheck))

	mux.HandleFunc("POST /internal/launch", ui.handleInternalLaunch)
	mux.HandleFunc("POST /internal/quit", ui.handleInternalQuit)
	return ui.guard(mux)
}

// guard adds security headers and rejects requests meant for some other site.
func (ui *WebUI) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		h := rw.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")

		// DNS-rebinding protection: only our own address is accepted as the Host.
		if !ui.allowedHost(r.Host) {
			logs.Warnf("dashboard", "refused a request for the host %q", r.Host)
			http.Error(rw, "forbidden", http.StatusForbidden)
			return
		}

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || u.Scheme != "http" || !ui.allowedHost(u.Host) {
					logs.Warnf("dashboard", "refused a change that came from another site (%q)", origin)
					http.Error(rw, "forbidden", http.StatusForbidden)
					return
				}
			}
			if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
				logs.Warnf("dashboard", "refused a cross-site change (%s)", site)
				http.Error(rw, "forbidden", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(rw, r)
	})
}

// api requires a signed-in session, and for changes also the CSRF token.
func (ui *WebUI) api(h apiHandler) http.HandlerFunc {
	return func(rw http.ResponseWriter, r *http.Request) {
		s := ui.sessionFor(r)
		if s == nil {
			writeJSON(rw, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.csrf)) != 1 {
				logs.Warnf("dashboard", "refused a change without a valid session token")
				writeJSON(rw, http.StatusForbidden, map[string]string{"error": "bad_csrf_token"})
				return
			}
		}
		h(rw, r, s)
	}
}

func (ui *WebUI) secretOK(r *http.Request) bool {
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Launch-Secret")), []byte(ui.secret)) == 1
}

// readJSON reads a small JSON request body. It answers with an error and returns false if that fails.
func readJSON(rw http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(rw, r.Body, 1<<16)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeJSON(rw, http.StatusBadRequest, map[string]string{"error": "That request wasn't understood."})
		return false
	}
	return true
}

// applyConfig saves new settings, starts using them and rescans. Callers hold editMu.
func (ui *WebUI) applyConfig(next *Config) error {
	if err := saveConfig(ui.opts.ConfigPath, next); err != nil {
		logs.Errorf("config", "couldn't save the settings: %v", err)
		return err
	}
	ui.opts.Indexer.SetConfig(next)
	ui.opts.Indexer.RequestScan()
	return nil
}

// ---------- pages ----------

func (ui *WebUI) renderLocked(rw http.ResponseWriter, status int, title, message string) {
	rw.Header().Set("Content-Type", "text/html; charset=utf-8")
	rw.WriteHeader(status)
	_ = ui.tpl.ExecuteTemplate(rw, "locked.html", map[string]string{"Title": title, "Message": message})
}

func (ui *WebUI) handleLogin(rw http.ResponseWriter, r *http.Request) {
	if !ui.useTicket(r.URL.Query().Get("ticket")) {
		logs.Warnf("dashboard", "a sign-in link was refused (expired, already used or invalid)")
		ui.renderLocked(rw, http.StatusForbidden, "This link has expired",
			"Links from the agent work once and only for a few minutes. Run \""+binaryName+" -ui\" to get a fresh one.")
		return
	}
	logs.Infof("dashboard", "someone signed in from the browser")
	http.SetCookie(rw, &http.Cookie{
		Name:     sessionCookie,
		Value:    ui.newSession(),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	dest := "/"
	if r.URL.Query().Get("next") == "pair" {
		dest = "/#pair"
	}
	http.Redirect(rw, r, dest, http.StatusSeeOther)
}

func (ui *WebUI) handleIndex(rw http.ResponseWriter, r *http.Request) {
	s := ui.sessionFor(r)
	if s == nil {
		ui.renderLocked(rw, http.StatusForbidden, "Open the dashboard from the agent",
			"For your safety this page opens only with a link from the agent. Run \""+binaryName+" -ui\", or start the agent again, and a fresh link opens in your browser.")
		return
	}
	rw.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = ui.tpl.ExecuteTemplate(rw, "index.html", map[string]string{
		"CSRF":     s.csrf,
		"Name":     displayName,
		"Version":  versionLabel(),
		"BrandURL": brandURL,
		"SupportEmail": supportEmail,
		"IssuesURL":    issuesURL,
	})
}

// ---------- API ----------

type folderStat struct {
	Label    string `json:"label"`
	Path     string `json:"path"`
	Disabled bool   `json:"disabled"`
	Files    int    `json:"files"`
	Bytes    int64  `json:"bytes"`
}

type statusResponse struct {
	Name          string       `json:"name"`
	Version       string       `json:"version"`
	APIVersion    int          `json:"api_version"`
	ConfigPath    string       `json:"config_path"`
	LogPath       string       `json:"log_path"`
	Address       string       `json:"address"`
	Discovery     string       `json:"discovery"`
	Scanning      bool         `json:"scanning"`
	IndexedAt     int64        `json:"indexed_at"`
	Files         int          `json:"files"`
	SyncCount     int64        `json:"sync_count"`
	FileAccess    bool `json:"file_access"`
	Uploads       bool `json:"uploads"`
	Phones        int  `json:"phones"`
	PhonePort     int  `json:"phone_port"`
	DashboardPort int  `json:"dashboard_port"`
	UpdateLatest string `json:"update_latest"`
	UpdateURL    string `json:"update_url"`
	UpdateNewer  bool   `json:"update_newer"`
	UptimeSeconds int64        `json:"uptime_seconds"`
	Folders       []folderStat `json:"folders"`
	Events        []Event      `json:"events"`
}

// folderStats counts the files and bytes under each root of the index.
func folderStats(entries []Entry, roots []Root) []folderStat {
	out := make([]folderStat, len(roots))
	byLabel := map[string]int{}
	for i, r := range roots {
		out[i] = folderStat{Label: r.Label, Path: r.Path, Disabled: r.Disabled}
		byLabel[r.Label] = i
	}
	for i := range entries {
		e := &entries[i]
		if e.IsDir {
			continue
		}
		label := e.Path
		if j := strings.IndexByte(label, '/'); j >= 0 {
			label = label[:j]
		}
		if k, ok := byLabel[label]; ok {
			out[k].Files++
			out[k].Bytes += e.Size
		}
	}
	return out
}

func (ui *WebUI) host() string {
	if ui.opts.HostFlag != "" {
		return ui.opts.HostFlag
	}
	return PreferredLANIP()
}

func (ui *WebUI) handleStatus(rw http.ResponseWriter, r *http.Request, _ *session) {
	cfg := ui.opts.Config
	live := ui.opts.Indexer.Config()
	entries, at := ui.opts.Indexer.Snapshot()
	folders := folderStats(entries, live.Roots)

	files := 0
	for _, f := range folders {
		files += f.Files
	}
	address := ""
	if host := ui.host(); host != "" {
		address = fmt.Sprintf("%s:%d", host, cfg.Port)
	}
	var indexedAt int64
	if !at.IsZero() {
		indexedAt = at.Unix()
	}

	up := updates.Status()

	writeJSON(rw, http.StatusOK, statusResponse{
		Name:          cfg.DeviceName,
		Version:       versionLabel(),
		APIVersion:    apiVersion,
		ConfigPath:    ui.opts.ConfigPath,
		LogPath:       logs.Path(),
		Address:       address,
		Discovery:     ui.opts.Discovery,
		Scanning:      ui.opts.Indexer.Scanning(),
		IndexedAt:     indexedAt,
		Files:         files,
		SyncCount:     syncCount.Load(),
		FileAccess:    live.AllowFileAccess,
		Uploads:       live.uploadsEnabled(),
		Phones:        ui.opts.Devices.Count(),
		PhonePort:     cfg.Port,
		DashboardPort: ui.port,
		UpdateLatest:  up.Latest,
		UpdateURL:     up.URL,
		UpdateNewer:   up.Newer,
		UptimeSeconds: int64(time.Since(ui.started).Seconds()),
		Folders:       folders,
		Events:        ui.opts.Events.Recent(),
	})
}

func (ui *WebUI) handleRescan(rw http.ResponseWriter, r *http.Request, _ *session) {
	started := ui.opts.Indexer.StartScan()
	if started {
		logs.Infof("dashboard", "a rescan was started from the dashboard")
		ui.opts.Events.Addf("Rescan started from the dashboard")
	}
	writeJSON(rw, http.StatusOK, map[string]bool{"started": started})
}

func (ui *WebUI) handleQuit(rw http.ResponseWriter, r *http.Request, _ *session) {
	logs.Infof("dashboard", "the agent was asked to quit from the dashboard")
	writeJSON(rw, http.StatusOK, map[string]bool{"stopping": true})
	go func() {
		time.Sleep(300 * time.Millisecond) // let the answer reach the browser first
		ui.opts.Quit()
	}()
}

// ---------- calls from another copy of the agent ----------

// handleInternalLaunch gives a second launch of the agent a fresh dashboard link.
// It needs the secret from the runtime file, which only the same user can read.
func (ui *WebUI) handleInternalLaunch(rw http.ResponseWriter, r *http.Request) {
	if !ui.secretOK(r) {
		writeJSON(rw, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	logs.Infof("agent", "another launch asked for a fresh dashboard link")
	writeJSON(rw, http.StatusOK, map[string]string{"url": ui.LoginURL(2*time.Minute, "")})
}

// handleInternalQuit is what `perigee -stop` calls.
func (ui *WebUI) handleInternalQuit(rw http.ResponseWriter, r *http.Request) {
	if !ui.secretOK(r) {
		writeJSON(rw, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	logs.Infof("agent", "asked to stop by -stop")
	writeJSON(rw, http.StatusOK, map[string]bool{"stopping": true})
	go ui.opts.Quit()
}

// ---------- the QR code ----------

// qrSVG draws text as a QR code in SVG form, with the white border scanners need.
func qrSVG(text string) ([]byte, error) {
	code, err := qr.Encode(text, qr.M)
	if err != nil {
		return nil, err
	}
	const quiet = 4
	n := code.Size

	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges" role="img" aria-label="Pairing QR code">`, n+2*quiet, n+2*quiet)
	b.WriteString(`<rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="`)
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			if code.Black(x, y) {
				fmt.Fprintf(&b, "M%d %dh1v1h-1z", x+quiet, y+quiet)
			}
		}
	}
	b.WriteString(`"/></svg>`)
	return []byte(b.String()), nil
}
