package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestPairingEndpoints(t *testing.T) {
	ui, c, _ := newTestUI(t)

	if resp, _ := c.do("GET", "/api/pairing", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a session got %d, want 401", resp.StatusCode)
	}
	c.login(ui)
	token := c.csrf()

	_, body := c.do("GET", "/api/pairing", nil)
	if strings.Contains(body, testToken) {
		t.Error("the pairing answer must never contain the shared token")
	}
	var p struct {
		Address   string `json:"address"`
		Code      string `json:"code"`
		ExpiresAt int64  `json:"expires_at"`
	}
	if err := json.Unmarshal([]byte(body), &p); err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9A-Z]{5}-[0-9A-Z]{5}$`).MatchString(p.Code) || p.Address != "192.168.1.5:8080" || p.ExpiresAt <= time.Now().Unix() {
		t.Errorf("unexpected pairing view: %+v", p)
	}

	if resp, svg := c.do("GET", "/api/pairing.svg", nil); resp.StatusCode != http.StatusOK || !strings.HasPrefix(svg, "<svg") {
		t.Errorf("the QR code isn't an SVG: %d", resp.StatusCode)
	}

	_, body = c.postJSON("/api/pairing/new", token, "{}")
	var fresh struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal([]byte(body), &fresh)
	if fresh.Code == "" || fresh.Code == p.Code {
		t.Errorf("a new code should differ: %q vs %q", fresh.Code, p.Code)
	}
	if ui.opts.Codes.Redeem(p.Code) {
		t.Error("the old code must stop working when a new one is made")
	}
}

func TestPairingPayloadHasTheCodeNotTheToken(t *testing.T) {
	cfg := &Config{DeviceID: "id1", DeviceName: "pc", Port: 8080, Token: "secret-token"}
	payload := pairingPayloadFor(cfg, "192.168.1.5", "ABCDE12345")

	for _, want := range []string{`"v":2`, `"code":"ABCDE12345"`, `"host":"192.168.1.5"`, `"id":"id1"`} {
		if !strings.Contains(payload, want) {
			t.Errorf("the QR payload is missing %s: %s", want, payload)
		}
	}
	if strings.Contains(payload, "secret-token") || strings.Contains(payload, "token") {
		t.Errorf("the QR payload must not carry a token: %s", payload)
	}
}

func TestDevicesEndpoints(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)
	token := c.csrf()

	_, dev, err := ui.opts.Devices.Add("Pixel 8")
	if err != nil {
		t.Fatal(err)
	}

	_, body := c.do("GET", "/api/devices", nil)
	var out struct {
		Devices []deviceView `json:"devices"`
		Legacy  struct {
			Enabled bool `json:"enabled"`
		} `json:"legacy"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil || len(out.Devices) != 1 || out.Devices[0].Name != "Pixel 8" || !out.Legacy.Enabled {
		t.Fatalf("unexpected devices: %v %s", err, body)
	}
	if strings.Contains(body, "token_hash") {
		t.Error("the dashboard must not be sent key hashes")
	}

	if resp, _ := c.postJSON("/api/devices/legacy", token, `{"enabled":false}`); resp.StatusCode != http.StatusOK {
		t.Fatal("switching the shared token off failed")
	}
	if !ui.opts.Indexer.Config().DisableLegacyToken {
		t.Error("the shared token should now be off")
	}

	if resp, _ := c.postJSON("/api/devices/revoke", token, fmt.Sprintf(`{"id":%q}`, dev.ID)); resp.StatusCode != http.StatusOK {
		t.Error("removing the phone failed")
	}
	if resp, _ := c.postJSON("/api/devices/revoke", token, fmt.Sprintf(`{"id":%q}`, dev.ID)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("removing it twice got %d, want 400", resp.StatusCode)
	}
	if ui.opts.Devices.Count() != 0 {
		t.Error("the phone should be gone")
	}
}

func TestInternalPairNeedsTheSecret(t *testing.T) {
	ui, c, _ := newTestUI(t)

	if resp, _ := c.do("POST", "/internal/pair", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("without the secret got %d, want 403", resp.StatusCode)
	}
	resp, body := c.do("POST", "/internal/pair", map[string]string{"X-Launch-Secret": ui.secret})
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, `\"v\":2`) || strings.Contains(body, testToken) {
		t.Errorf("unexpected answer %d: %s", resp.StatusCode, body)
	}
	if resp, _ := c.do("POST", "/internal/status", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("status without the secret got %d, want 403", resp.StatusCode)
	}
	if resp, body := c.do("POST", "/internal/status", map[string]string{"X-Launch-Secret": ui.secret}); resp.StatusCode != http.StatusOK || !strings.Contains(body, "file_count") {
		t.Errorf("status got %d: %s", resp.StatusCode, body)
	}
}