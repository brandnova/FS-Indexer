package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestAutostartStatusEndpoint(t *testing.T) {
	ui, c, _ := newTestUI(t)

	if resp, _ := c.do("GET", "/api/autostart", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a session got %d, want 401", resp.StatusCode)
	}
	if resp, _ := c.do("POST", "/api/autostart", map[string]string{"Content-Type": "application/json"}, `{"enabled":true}`); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a change without a session got %d, want 401", resp.StatusCode)
	}

	c.login(ui)
	resp, body := c.do("GET", "/api/autostart", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status got %d: %s", resp.StatusCode, body)
	}
	var st AutostartState
	if err := json.Unmarshal([]byte(body), &st); err != nil {
		t.Fatal(err)
	}
	if !st.Supported && st.Detail == "" {
		t.Errorf("an unsupported system should say why: %+v", st)
	}
}