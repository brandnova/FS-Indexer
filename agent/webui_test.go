package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

type uiClient struct {
	t      *testing.T
	base   string
	cookie *http.Cookie
	http   *http.Client
}

func newTestUI(t *testing.T) (*WebUI, *uiClient, chan struct{}) {
	t.Helper()

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &Config{
		DeviceID:     "0123456789abcdef",
		DeviceName:   "test-pc",
		Port:         8080,
		WebPort:      8765,
		Token:        testToken,
		Roots:        []Root{{Path: resolvedPath(root), Label: "Root"}},
		ExtraIgnores: []string{},
	}
	ix := NewIndexer(cfg)
	ix.StartScan()
	waitForScan(t, ix)

	quit := make(chan struct{}, 4)
	ui, err := NewWebUI(WebOptions{
		Config:     cfg,
		Indexer:    ix,
		Events:     NewEventLog(10),
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		HostFlag:   "192.168.1.5",
		Discovery:  "on",
		Mode:       "test",
		Quit:       func() { quit <- struct{}{} },
	})
	if err != nil {
		t.Fatal(err)
	}
	ln, err := ui.Listen(0)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: ui.Handler()}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	c := &uiClient{
		t:    t,
		base: ui.BaseURL(),
		http: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
	}
	return ui, c, quit
}

func (c *uiClient) do(method, path string, headers map[string]string, body ...string) (*http.Response, string) {
	c.t.Helper()
	var reader io.Reader
	if len(body) > 0 {
		reader = strings.NewReader(body[0])
	}
	req, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		c.t.Fatal(err)
	}
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}
	for k, v := range headers {
		if k == "Host" {
			req.Host = v
		} else {
			req.Header.Set(k, v)
		}
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(data)
}

func (c *uiClient) postJSON(path, csrf, body string) (*http.Response, string) {
	c.t.Helper()
	return c.do("POST", path, map[string]string{"X-CSRF-Token": csrf, "Content-Type": "application/json"}, body)
}

func (c *uiClient) login(ui *WebUI) {
	c.t.Helper()
	resp, _ := c.do("GET", "/login?ticket="+ui.NewTicket(time.Minute), nil)
	for _, ck := range resp.Cookies() {
		if ck.Name == sessionCookie {
			c.cookie = ck
		}
	}
	if c.cookie == nil {
		c.t.Fatal("logging in did not set a session cookie")
	}
}

func (c *uiClient) csrf() string {
	c.t.Helper()
	_, body := c.do("GET", "/", nil)
	m := regexp.MustCompile(`name="csrf-token" content="([0-9a-f]+)"`).FindStringSubmatch(body)
	if m == nil {
		c.t.Fatal("the page has no CSRF token")
	}
	return m[1]
}

func TestDashboardNeedsLogin(t *testing.T) {
	_, c, _ := newTestUI(t)

	resp, body := c.do("GET", "/", nil)
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(body, "from the agent") {
		t.Errorf("the page without a session got %d: %s", resp.StatusCode, body)
	}
	if resp, _ := c.do("GET", "/api/status", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the API without a session got %d, want 401", resp.StatusCode)
	}
	if resp, _ := c.do("GET", "/static/style.css", nil); resp.StatusCode != http.StatusOK {
		t.Errorf("the stylesheet should be public, got %d", resp.StatusCode)
	}
	for _, path := range []string{"/api/folders", "/api/rules", "/api/logs", "/api/report", "/api/fs/list"} {
		if resp, _ := c.do("GET", path, nil); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s without a session got %d, want 401", path, resp.StatusCode)
		}
	}
}

func TestLoginTicketWorksOnce(t *testing.T) {
	ui, c, _ := newTestUI(t)

	ticket := ui.NewTicket(time.Minute)
	resp, _ := c.do("GET", "/login?ticket="+ticket, nil)
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("first use got %d, want 303", resp.StatusCode)
	}
	if resp, _ := c.do("GET", "/login?ticket="+ticket, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("second use got %d, want 403", resp.StatusCode)
	}
	if resp, _ := c.do("GET", "/login?ticket="+ui.NewTicket(-time.Second), nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("an expired ticket got %d, want 403", resp.StatusCode)
	}
	if resp, _ := c.do("GET", "/login?ticket=guess", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a made-up ticket got %d, want 403", resp.StatusCode)
	}
}

func TestStatusAfterLogin(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)

	resp, body := c.do("GET", "/api/status", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var st statusResponse
	if err := json.Unmarshal([]byte(body), &st); err != nil {
		t.Fatal(err)
	}
	if st.Name != "test-pc" || st.Address != "192.168.1.5:8080" || st.Files != 1 {
		t.Errorf("unexpected status: %+v", st)
	}
	if len(st.Folders) != 1 || st.Folders[0].Label != "Root" || st.Folders[0].Files != 1 {
		t.Errorf("unexpected folders: %+v", st.Folders)
	}

	resp, svg := c.do("GET", "/api/pairing.svg", nil)
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(svg, "<svg") {
		t.Errorf("the QR code is not an SVG: %d %.40s", resp.StatusCode, svg)
	}
}

func TestChangesNeedTokenAndSameOrigin(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)
	token := c.csrf()

	if resp, _ := c.do("POST", "/api/rescan", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("without the token got %d, want 403", resp.StatusCode)
	}
	if resp, _ := c.do("POST", "/api/rescan", map[string]string{"X-CSRF-Token": token}); resp.StatusCode != http.StatusOK {
		t.Errorf("with the token got %d, want 200", resp.StatusCode)
	}
	if resp, _ := c.do("POST", "/api/rescan", map[string]string{"X-CSRF-Token": token, "Origin": ui.BaseURL()}); resp.StatusCode != http.StatusOK {
		t.Errorf("from our own origin got %d, want 200", resp.StatusCode)
	}
	if resp, _ := c.do("POST", "/api/rescan", map[string]string{"X-CSRF-Token": token, "Origin": "http://evil.example"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("from another origin got %d, want 403", resp.StatusCode)
	}
	if resp, _ := c.do("POST", "/api/rescan", map[string]string{"X-CSRF-Token": token, "Sec-Fetch-Site": "cross-site"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a cross-site request got %d, want 403", resp.StatusCode)
	}
	// the new editing routes are protected in the same way
	if resp, _ := c.do("POST", "/api/folders/add", map[string]string{"Content-Type": "application/json"}, `{"path":"/tmp"}`); resp.StatusCode != http.StatusForbidden {
		t.Errorf("adding a folder without the token got %d, want 403", resp.StatusCode)
	}
}

func TestOtherHostsAreRefused(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)

	if resp, _ := c.do("GET", "/", map[string]string{"Host": "evil.example.com"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a request for another host got %d, want 403 (DNS rebinding)", resp.StatusCode)
	}
}

func TestInternalCallsNeedTheSecret(t *testing.T) {
	ui, c, quit := newTestUI(t)

	if resp, _ := c.do("POST", "/internal/launch", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("launch without the secret got %d, want 403", resp.StatusCode)
	}
	resp, body := c.do("POST", "/internal/launch", map[string]string{"X-Launch-Secret": ui.secret})
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, "/login?ticket=") {
		t.Errorf("launch with the secret got %d: %s", resp.StatusCode, body)
	}

	if resp, _ := c.do("POST", "/internal/quit", map[string]string{"X-Launch-Secret": "wrong"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("quit with a wrong secret got %d, want 403", resp.StatusCode)
	}
	select {
	case <-quit:
		t.Fatal("quit was called without the secret")
	default:
	}

	if resp, _ := c.do("POST", "/internal/quit", map[string]string{"X-Launch-Secret": ui.secret}); resp.StatusCode != http.StatusOK {
		t.Errorf("quit with the secret got %d, want 200", resp.StatusCode)
	}
	select {
	case <-quit:
	case <-time.After(2 * time.Second):
		t.Error("quit was not called")
	}
}

func TestFolderManagement(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)
	token := c.csrf()
	other := t.TempDir()

	resp, body := c.postJSON("/api/folders/add", token, fmt.Sprintf(`{"path":%q}`, other))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("adding got %d: %s", resp.StatusCode, body)
	}
	label := filepath.Base(resolvedPath(other))

	if got := ui.opts.Indexer.Config().Roots; len(got) != 2 {
		t.Fatalf("the new folder is not in use: %+v", got)
	}
	saved, err := readRaw(ui.opts.ConfigPath)
	if err != nil || len(saved.Roots) != 2 {
		t.Errorf("the settings were not saved: %v %+v", err, saved)
	}

	var listing struct {
		Folders []folderView `json:"folders"`
	}
	_, body = c.do("GET", "/api/folders", nil)
	if err := json.Unmarshal([]byte(body), &listing); err != nil || len(listing.Folders) != 2 {
		t.Errorf("the folder list is wrong: %v %s", err, body)
	}

	if resp, body := c.postJSON("/api/folders/update", token, `{"label":"Root","disabled":true}`); resp.StatusCode != http.StatusOK {
		t.Errorf("switching off got %d: %s", resp.StatusCode, body)
	}
	if !ui.opts.Indexer.Config().Roots[0].Disabled {
		t.Error("the folder should be switched off")
	}

	resp, body = c.postJSON("/api/folders/add", token, `{"path":"/definitely/not/here"}`)
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(body, "doesn't exist") {
		t.Errorf("a missing folder got %d: %s", resp.StatusCode, body)
	}

	if resp, body := c.postJSON("/api/folders/remove", token, fmt.Sprintf(`{"label":%q}`, label)); resp.StatusCode != http.StatusOK {
		t.Errorf("removing got %d: %s", resp.StatusCode, body)
	}
	if resp, body := c.postJSON("/api/folders/remove", token, `{"label":"Root"}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("removing the last folder got %d: %s", resp.StatusCode, body)
	}
	waitForScan(t, ui.opts.Indexer)
}

func TestFolderPicker(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)

	dir := t.TempDir()
	for _, name := range []string{"alpha", ".secret"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	names := func(query string) []string {
		resp, body := c.do("GET", "/api/fs/list?"+query, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("listing got %d: %s", resp.StatusCode, body)
		}
		var pr pickerResponse
		if err := json.Unmarshal([]byte(body), &pr); err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, e := range pr.Entries {
			out = append(out, e.Name)
		}
		return out
	}

	q := "path=" + url.QueryEscape(dir)
	if got := names(q); len(got) != 1 || got[0] != "alpha" {
		t.Errorf("only visible folders should be listed, got %v", got)
	}
	if got := names(q + "&hidden=1"); len(got) != 2 {
		t.Errorf("hidden folders should show when asked, got %v", got)
	}
	if resp, _ := c.do("GET", "/api/fs/list?path=relative/dir", nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a relative path got %d, want 400", resp.StatusCode)
	}
}

func TestRulesAPI(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)
	token := c.csrf()

	if resp, _ := c.postJSON("/api/rules", token, `{"extra":["bad/slash"],"include_hidden":false}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a rule with a slash got %d, want 400", resp.StatusCode)
	}
	if resp, body := c.postJSON("/api/rules", token, `{"extra":[" *.tmp ","*.TMP"],"include_hidden":true}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("saving got %d: %s", resp.StatusCode, body)
	}

	_, body := c.do("GET", "/api/rules", nil)
	var rules struct {
		Extra         []string    `json:"extra"`
		IncludeHidden bool        `json:"include_hidden"`
		Builtin       []RuleGroup `json:"builtin"`
	}
	if err := json.Unmarshal([]byte(body), &rules); err != nil || len(rules.Extra) != 1 || !rules.IncludeHidden || len(rules.Builtin) == 0 {
		t.Errorf("unexpected rules: %v %s", err, body)
	}

	verdict := func(path string) PathVerdict {
		_, body := c.postJSON("/api/rules/test", token, fmt.Sprintf(`{"path":%q}`, path))
		var v PathVerdict
		_ = json.Unmarshal([]byte(body), &v)
		return v
	}
	if v := verdict("Root/a.tmp"); v.Shared || v.Source != srcYours {
		t.Errorf("a .tmp file should be skipped by your rules: %+v", v)
	}
	if v := verdict("Root/a.txt"); !v.Shared {
		t.Errorf("a plain file should be shared: %+v", v)
	}
	waitForScan(t, ui.opts.Indexer)
}

func TestReportHidesTheToken(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)

	resp, body := c.do("GET", "/api/report", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, "agent report") {
		t.Fatalf("report got %d: %.100s", resp.StatusCode, body)
	}
	if strings.Contains(body, testToken) {
		t.Error("the report contains the access token")
	}
	resp, _ = c.do("GET", "/api/report?download=1", nil)
	if !strings.Contains(resp.Header.Get("Content-Disposition"), "attachment") {
		t.Error("a download should be sent as an attachment")
	}
}

func TestLogsEndpoint(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)

	l, err := OpenLogger(filepath.Join(t.TempDir(), "agent.log"), false)
	if err != nil {
		t.Fatal(err)
	}
	old := logs
	logs = l
	t.Cleanup(func() { logs = old; l.Close() })
	logs.Infof("test", "a calm line")
	logs.Warnf("test", "a worrying line")

	read := func(level string) []string {
		_, body := c.do("GET", "/api/logs?level="+level, nil)
		var out struct {
			Lines []string `json:"lines"`
		}
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			t.Fatal(err)
		}
		return out.Lines
	}
	if got := read("all"); len(got) < 2 {
		t.Errorf("expected both lines, got %v", got)
	}
	if got := read("warn"); len(got) != 1 || !strings.Contains(got[0], "worrying") {
		t.Errorf("the warning filter returned %v", got)
	}
}

func TestQRSVG(t *testing.T) {
	svg, err := qrSVG(`{"v":1,"host":"192.168.1.5"}`)
	if err != nil {
		t.Fatal(err)
	}
	if s := string(svg); !strings.HasPrefix(s, "<svg") || !strings.Contains(s, "<path") || !strings.HasSuffix(s, "</svg>") {
		t.Errorf("not a usable SVG: %.80s", s)
	}
}

func TestEventLogKeepsTheNewest(t *testing.T) {
	l := NewEventLog(2)
	l.Addf("one")
	l.Addf("two")
	l.Addf("three %d", 3)

	got := l.Recent()
	if len(got) != 2 || got[0].Text != "three 3" || got[1].Text != "two" {
		t.Errorf("unexpected events: %+v", got)
	}
}

func TestRuntimeFileAndPaths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime.json")
	if err := writeRuntime(path, runtimeInfo{Port: 8765, Secret: "abc"}); err != nil {
		t.Fatal(err)
	}
	got, err := readRuntime(path)
	if err != nil || got.Port != 8765 || got.Secret != "abc" {
		t.Errorf("round trip failed: %+v, %v", got, err)
	}
	removeRuntime(path)
	if _, err := readRuntime(path); err == nil {
		t.Error("the runtime file should be gone")
	}

	cases := []struct{ in, plain, suffix, want string }{
		{filepath.Join("a", "b", "config.json"), "runtime.json", ".runtime.json", filepath.Join("a", "b", "runtime.json")},
		{filepath.Join("a", "work.json"), "runtime.json", ".runtime.json", filepath.Join("a", "work.runtime.json")},
		{"config.json", "agent.log", ".log", "agent.log"},
	}
	for _, c := range cases {
		if got := siblingPath(c.in, c.plain, c.suffix); got != c.want {
			t.Errorf("siblingPath(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFileURL(t *testing.T) {
	if os.PathSeparator != '/' {
		t.Skip("checks Unix-style paths")
	}
	if got := fileURL("/tmp/fsagent-error.html"); got != "file:///tmp/fsagent-error.html" {
		t.Errorf("fileURL = %q", got)
	}
}