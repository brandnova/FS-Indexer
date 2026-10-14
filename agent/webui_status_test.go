package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestStatusShowsPermissionsAndPhones(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)

	read := func() statusResponse {
		t.Helper()
		_, body := c.do("GET", "/api/status", nil)
		var st statusResponse
		if err := json.Unmarshal([]byte(body), &st); err != nil {
			t.Fatal(err)
		}
		return st
	}

	st := read()
	if st.FileAccess || st.Uploads || st.Phones != 0 || st.PhonePort != 8080 || st.DashboardPort == 0 {
		t.Errorf("unexpected defaults: %+v", st)
	}

	next := ui.opts.Indexer.Config().clone()
	next.AllowFileAccess = true
	next.AllowUploads = true
	next.UploadDir = resolvedPath(t.TempDir())
	ui.opts.Indexer.SetConfig(next)
	if _, _, err := ui.opts.Devices.Add("Pixel"); err != nil {
		t.Fatal(err)
	}

	st = read()
	if !st.FileAccess || !st.Uploads || st.Phones != 1 {
		t.Errorf("the permissions and the phone should show: %+v", st)
	}
}

func TestOpenTheDropFolderNeedsAFolder(t *testing.T) {
	ui, c, _ := newTestUI(t)
	if resp, _ := c.do("POST", "/api/uploads/open", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a session got %d, want 401", resp.StatusCode)
	}
	c.login(ui)
	token := c.csrf()

	if resp, _ := c.postJSON("/api/uploads/open", token, "{}"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("without a drop folder got %d, want 400", resp.StatusCode)
	}
	next := ui.opts.Indexer.Config().clone()
	next.UploadDir = resolvedPath(t.TempDir()) + "-gone"
	ui.opts.Indexer.SetConfig(next)
	if resp, _ := c.postJSON("/api/uploads/open", token, "{}"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("with a missing drop folder got %d, want 400", resp.StatusCode)
	}
}

func TestUploadFolderName(t *testing.T) {
	if got := uploadFolderName(&Config{}); got != "" {
		t.Errorf("no folder should give an empty name, got %q", got)
	}
	if got := uploadFolderName(&Config{UploadDir: "/home/me/Phone uploads"}); got != "Phone uploads" {
		t.Errorf("got %q", got)
	}
}