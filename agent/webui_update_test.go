package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateSettingsEndpoints(t *testing.T) {
	oldV, oldU := version, updates
	t.Cleanup(func() { version, updates = oldV, oldU })
	version = "0.1.0"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"tag_name":"v9.9.9","html_url":"https://github.com/x/y/releases/tag/v9.9.9","draft":false,"prerelease":false}]`))
	}))
	t.Cleanup(srv.Close)

	ui, c, _ := newTestUI(t)
	updates = NewUpdateChecker(ui.opts.Indexer)
	updates.endpoint = srv.URL

	if resp, _ := c.do("GET", "/api/update", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a session got %d, want 401", resp.StatusCode)
	}
	c.login(ui)
	token := c.csrf()

	if _, body := c.do("GET", "/api/update", nil); !strings.Contains(body, `"enabled":false`) {
		t.Errorf("update checks should be off by default: %s", body)
	}
	if resp, _ := c.postJSON("/api/update/check", token, "{}"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("checking while off got %d, want 400", resp.StatusCode)
	}

	if resp, body := c.postJSON("/api/update", token, `{"enabled":true}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("switching on got %d: %s", resp.StatusCode, body)
	}
	if saved, err := readRaw(ui.opts.ConfigPath); err != nil || !saved.CheckForUpdates {
		t.Errorf("the setting should be saved: %v %+v", err, saved)
	}

	resp, body := c.postJSON("/api/update/check", token, "{}")
	var info UpdateInfo
	if resp.StatusCode != http.StatusOK || json.Unmarshal([]byte(body), &info) != nil || info.Latest != "9.9.9" || !info.Newer {
		t.Fatalf("check got %d: %s", resp.StatusCode, body)
	}
	if resp, _ := c.postJSON("/api/update/check", token, "{}"); resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("checking twice at once got %d, want 429", resp.StatusCode)
	}

	_, body = c.do("GET", "/api/status", nil)
	var st statusResponse
	if err := json.Unmarshal([]byte(body), &st); err != nil || !st.UpdateNewer || st.UpdateLatest != "9.9.9" {
		t.Errorf("the status should announce the update: %v %+v", err, st)
	}
}