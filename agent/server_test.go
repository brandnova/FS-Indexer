package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const testToken = "test-token"

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

func waitForScan(t *testing.T, ix *Indexer) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for ix.Scanning() {
		if time.Now().After(deadline) {
			t.Fatal("scan did not finish in time")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// newTestServer runs the real handler chain on a loopback port. (A fake
// request from httptest.NewRequest has a non-LAN address and would be refused
// by the LAN guard.)
func newTestServer(t *testing.T) (*httptest.Server, *Indexer) {
	t.Helper()

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		DeviceID:   "0123456789abcdef",
		DeviceName: "test-pc",
		Port:       8080,
		Token:      testToken,
		Roots:      []Root{{Path: root, Label: "Root"}},
	}
	ix := NewIndexer(cfg)
	ix.StartScan()
	waitForScan(t, ix)

	ts := httptest.NewServer(NewServer(cfg, ix).Handler)
	t.Cleanup(ts.Close)
	return ts, ix
}

func request(t *testing.T, method, url, token string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// serve calls a handler directly with a chosen client address.
func serve(h http.Handler, remoteAddr, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", "/x", nil)
	req.RemoteAddr = remoteAddr
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAuth(t *testing.T) {
	ts, _ := newTestServer(t)

	cases := []struct {
		name  string
		token string
		want  int
	}{
		{"missing token", "", http.StatusUnauthorized},
		{"wrong token", "nope", http.StatusUnauthorized},
		{"correct token", testToken, http.StatusOK},
	}
	for _, c := range cases {
		resp := request(t, "GET", ts.URL+"/api/v1/ping", c.token)
		if resp.StatusCode != c.want {
			t.Errorf("%s: got %d, want %d", c.name, resp.StatusCode, c.want)
		}
	}
}

func TestPing(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := request(t, "GET", ts.URL+"/api/v1/ping", testToken)

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["device_id"] != "0123456789abcdef" {
		t.Errorf("device_id = %v", body["device_id"])
	}
	if body["api_version"] != float64(apiVersion) {
		t.Errorf("api_version = %v, want %d", body["api_version"], apiVersion)
	}
	if body["file_count"] != float64(2) { // the root folder + a.txt
		t.Errorf("file_count = %v, want 2", body["file_count"])
	}
	if body["scanning"] != false {
		t.Errorf("scanning = %v, want false", body["scanning"])
	}
}

func TestIndexStreamsNDJSON(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := request(t, "GET", ts.URL+"/api/v1/index", testToken)

	if got := resp.Header.Get("Content-Type"); got != "application/x-ndjson" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := resp.Header.Get("X-File-Count"); got != "2" {
		t.Errorf("X-File-Count = %q, want 2", got)
	}

	seen := map[string]bool{}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		var e Entry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatalf("bad NDJSON line %q: %v", sc.Text(), err)
		}
		seen[e.Path] = true
	}
	if len(seen) != 2 || !seen["Root"] || !seen["Root/a.txt"] {
		t.Errorf("unexpected entries: %v", seen)
	}
}

func TestReindex(t *testing.T) {
	ts, ix := newTestServer(t)
	resp := request(t, "POST", ts.URL+"/api/v1/reindex", testToken)
	if resp.StatusCode != http.StatusAccepted {
		t.Errorf("status = %d, want 202", resp.StatusCode)
	}
	waitForScan(t, ix)
}

func TestLanOnly(t *testing.T) {
	h := lanOnly(okHandler)

	for _, addr := range []string{"192.168.1.5:5000", "10.0.0.2:1", "172.16.4.4:80", "127.0.0.1:9", "[::1]:9"} {
		if got := serve(h, addr, "").Code; got != http.StatusOK {
			t.Errorf("%s should be allowed, got %d", addr, got)
		}
	}
	for _, addr := range []string{"8.8.8.8:53", "[2001:4860:4860::8888]:53", "nonsense"} {
		if got := serve(h, addr, "").Code; got != http.StatusForbidden {
			t.Errorf("%s should be refused, got %d", addr, got)
		}
	}
}

func TestAuthRateLimit(t *testing.T) {
	h := auth(testToken, newLimiter(3, time.Minute, time.Minute), okHandler)

	for i := 0; i < 3; i++ {
		if got := serve(h, "10.0.0.1:1000", "wrong").Code; got != http.StatusUnauthorized {
			t.Fatalf("attempt %d: got %d, want 401", i+1, got)
		}
	}

	// Locked out: even the right token is refused for now.
	rec := serve(h, "10.0.0.1:1000", testToken)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("locked-out client got %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("missing Retry-After header")
	}

	// A different client is unaffected.
	if got := serve(h, "10.0.0.2:1000", testToken).Code; got != http.StatusOK {
		t.Errorf("other client got %d, want 200", got)
	}
}

func TestAuthSuccessResetsFailures(t *testing.T) {
	h := auth(testToken, newLimiter(3, time.Minute, time.Minute), okHandler)

	for round := 0; round < 3; round++ {
		serve(h, "10.0.0.1:1", "wrong")
		serve(h, "10.0.0.1:1", "wrong")
		if got := serve(h, "10.0.0.1:1", testToken).Code; got != http.StatusOK {
			t.Fatalf("round %d: got %d, want 200 (failures should reset on success)", round, got)
		}
	}
}

func TestLimiterUnblocksAfterCooldown(t *testing.T) {
	l := newLimiter(2, time.Minute, 30*time.Second)
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	l.fail("ip", t0)
	if _, blocked := l.blocked("ip", t0); blocked {
		t.Error("one failure should not block")
	}
	l.fail("ip", t0.Add(time.Second))
	if _, blocked := l.blocked("ip", t0.Add(2*time.Second)); !blocked {
		t.Error("two failures should block")
	}
	if _, blocked := l.blocked("ip", t0.Add(40*time.Second)); blocked {
		t.Error("lockout should have ended")
	}
}