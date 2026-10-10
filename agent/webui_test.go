package main

import (
	"encoding/json"
	"io"
	"net/http"
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
		DeviceID:   "0123456789abcdef",
		DeviceName: "test-pc",
		Port:       8080,
		WebPort:    8765,
		Token:      testToken,
		Roots:      []Root{{Path: root, Label: "Root"}},
	}
	ix := NewIndexer(cfg)
	ix.StartScan()
	waitForScan(t, ix)

	quit := make(chan struct{}, 4)
	ui, err := NewWebUI(WebOptions{
		Config:     cfg,
		Indexer:    ix,
		Events:     NewEventLog(10),
		ConfigPath: filepath.Join(root, "config.json"),
		HostFlag:   "192.168.1.5",
		Discovery:  "on",
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

func (c *uiClient) do(method, path string, headers map[string]string) (*http.Response, string) {
	c.t.Helper()
	req, err := http.NewRequest(method, c.base+path, nil)
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
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(body)
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