package main

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestDoctorEndpoint(t *testing.T) {
	old := doctorBrowseWait
	doctorBrowseWait = 50 * time.Millisecond // don't wait seconds for the discovery test
	t.Cleanup(func() { doctorBrowseWait = old })

	ui, c, _ := newTestUI(t)

	if resp, _ := c.do("POST", "/api/doctor", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a session got %d, want 401", resp.StatusCode)
	}

	c.login(ui)
	token := c.csrf()

	if resp, _ := c.do("POST", "/api/doctor", map[string]string{"Content-Type": "application/json"}, "{}"); resp.StatusCode != http.StatusForbidden {
		t.Errorf("without the token got %d, want 403", resp.StatusCode)
	}

	resp, body := c.postJSON("/api/doctor", token, "{}")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d: %s", resp.StatusCode, body)
	}
	var out struct {
		Checks []Check `json:"checks"`
		OK     int     `json:"ok"`
		Fail   int     `json:"fail"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Checks) == 0 || out.Checks[0].ID != "settings" {
		t.Fatalf("unexpected checks: %+v", out.Checks)
	}
	if agent := findCheck(out.Checks, "agent"); agent == nil || agent.Status != StatusOK {
		t.Errorf("inside the agent the check must see it running: %+v", agent)
	}
	if folders := findCheck(out.Checks, "folders"); folders == nil || folders.Status != StatusOK {
		t.Errorf("the test folder should be fine: %+v", folders)
	}
}
