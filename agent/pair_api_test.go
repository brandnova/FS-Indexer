package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newPairServer(t *testing.T, disableLegacy bool) (*httptest.Server, ServerDeps) {
	t.Helper()
	root := t.TempDir()
	cfg := &Config{
		DeviceID: "0123456789abcdef", DeviceName: "test-pc", Port: 8080, Token: testToken,
		Roots: []Root{{Path: resolvedPath(root), Label: "Root"}}, DisableLegacyToken: disableLegacy,
	}
	ix := NewIndexer(cfg)
	ix.StartScan()
	waitForScan(t, ix)

	devices, err := OpenDevices(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	deps := ServerDeps{Devices: devices, Codes: NewPairingCodes(time.Minute)}
	ts := httptest.NewServer(NewServerWith(cfg, ix, deps).Handler)
	t.Cleanup(ts.Close)
	return ts, deps
}

func pairDo(t *testing.T, method, url, bearer, body string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var sb strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		sb.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return resp, sb.String()
}

func extractToken(t *testing.T, body string) string {
	t.Helper()
	i := strings.Index(body, `"token":"`)
	if i < 0 {
		t.Fatalf("no token in %s", body)
	}
	rest := body[i+len(`"token":"`):]
	return rest[:strings.Index(rest, `"`)]
}

func TestPairingTradesACodeForAKey(t *testing.T) {
	ts, deps := newPairServer(t, false)
	code, _ := deps.Codes.Current()

	resp, body := pairDo(t, "POST", ts.URL+"/api/v1/pair", "", `{"code":"`+strings.ToLower(formatCode(code))+`","device_name":"Pixel 8"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pairing got %d: %s", resp.StatusCode, body)
	}
	token := extractToken(t, body)

	if resp, _ := pairDo(t, "GET", ts.URL+"/api/v1/ping", token, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the new key should work, got %d", resp.StatusCode)
	}
	if list := deps.Devices.List(); len(list) != 1 || list[0].Name != "Pixel 8" {
		t.Errorf("the phone should be listed: %+v", list)
	}
	if resp, _ := pairDo(t, "POST", ts.URL+"/api/v1/pair", "", `{"code":"`+code+`"}`); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a used code got %d, want 401", resp.StatusCode)
	}
	if resp, _ := pairDo(t, "GET", ts.URL+"/api/v1/ping", testToken, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the old shared token should still work by default, got %d", resp.StatusCode)
	}
}

func TestSharedTokenCanBeSwitchedOff(t *testing.T) {
	ts, deps := newPairServer(t, true)

	if resp, _ := pairDo(t, "GET", ts.URL+"/api/v1/ping", testToken, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the shared token should be refused when switched off, got %d", resp.StatusCode)
	}
	code, _ := deps.Codes.Current()
	_, body := pairDo(t, "POST", ts.URL+"/api/v1/pair", "", `{"code":"`+code+`","device_name":"Phone"}`)
	if resp, _ := pairDo(t, "GET", ts.URL+"/api/v1/ping", extractToken(t, body), ""); resp.StatusCode != http.StatusOK {
		t.Errorf("a paired phone should work, got %d", resp.StatusCode)
	}
}

func TestWrongCodesLockOut(t *testing.T) {
	ts, deps := newPairServer(t, false)

	for i := 0; i < 10; i++ {
		if resp, _ := pairDo(t, "POST", ts.URL+"/api/v1/pair", "", `{"code":"AAAAAAAAAA"}`); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d got %d, want 401", i+1, resp.StatusCode)
		}
	}
	code, _ := deps.Codes.Current()
	resp, _ := pairDo(t, "POST", ts.URL+"/api/v1/pair", "", `{"code":"`+code+`"}`)
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Errorf("after ten wrong codes even the right one is refused for a while, got %d", resp.StatusCode)
	}
}

func TestRemovedPhoneLosesAccess(t *testing.T) {
	ts, deps := newPairServer(t, false)
	code, _ := deps.Codes.Current()
	_, body := pairDo(t, "POST", ts.URL+"/api/v1/pair", "", `{"code":"`+code+`","device_name":"Phone"}`)
	token := extractToken(t, body)

	id := deps.Devices.List()[0].ID
	if _, found, err := deps.Devices.Revoke(id); !found || err != nil {
		t.Fatal(found, err)
	}
	if resp, _ := pairDo(t, "GET", ts.URL+"/api/v1/ping", token, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a removed phone got %d, want 401", resp.StatusCode)
	}
}

func TestPairingIsUnavailableWithoutTheStores(t *testing.T) {
	cfg := &Config{DeviceID: "x", Port: 8080, Token: testToken, Roots: []Root{{Path: resolvedPath(t.TempDir()), Label: "Root"}}}
	ts := httptest.NewServer(NewServer(cfg, NewIndexer(cfg)).Handler)
	defer ts.Close()

	if resp, _ := pairDo(t, "POST", ts.URL+"/api/v1/pair", "", `{"code":"AAAAAAAAAA"}`); resp.StatusCode != http.StatusNotFound {
		t.Errorf("got %d, want 404", resp.StatusCode)
	}
	if resp, _ := pairDo(t, "GET", ts.URL+"/api/v1/ping", testToken, ""); resp.StatusCode != http.StatusOK {
		t.Errorf("the shared token should keep working, got %d", resp.StatusCode)
	}
}

func TestDeviceNamesAreCleaned(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  Pixel 8  ", "Pixel 8"},
		{"Pi\x00xel\n8", "Pixel8"},
		{"", "Phone (10.0.0.5)"},
		{strings.Repeat("é", 60), strings.Repeat("é", 40)},
	}
	for _, c := range cases {
		if got := cleanDeviceName(c.in, "10.0.0.5"); got != c.want {
			t.Errorf("cleanDeviceName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}