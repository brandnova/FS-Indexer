package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestFileAccessSwitch(t *testing.T) {
	ui, c, _ := newTestUI(t)

	if resp, _ := c.do("GET", "/api/fileaccess", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a session got %d, want 401", resp.StatusCode)
	}
	c.login(ui)
	token := c.csrf()

	if _, body := c.do("GET", "/api/fileaccess", nil); !strings.Contains(body, `"enabled":false`) {
		t.Errorf("file access should be off by default: %s", body)
	}
	if resp, _ := c.do("POST", "/api/fileaccess", map[string]string{"Content-Type": "application/json"}, `{"enabled":true}`); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a change without the session token got %d, want 403", resp.StatusCode)
	}

	if resp, body := c.postJSON("/api/fileaccess", token, `{"enabled":true}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("switching on got %d: %s", resp.StatusCode, body)
	}
	if !ui.opts.Indexer.Config().AllowFileAccess {
		t.Error("the agent should now allow file access")
	}
	if saved, err := readRaw(ui.opts.ConfigPath); err != nil || !saved.AllowFileAccess {
		t.Errorf("the setting should be saved: %v %+v", err, saved)
	}

	c.postJSON("/api/fileaccess", token, `{"enabled":false}`)
	if ui.opts.Indexer.Config().AllowFileAccess {
		t.Error("the agent should be back to names only")
	}
}