package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateDropFolder(t *testing.T) {
	home := resolvedPath(t.TempDir())
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	settings := filepath.Join(home, ".config", "fsindexer")
	configPath := filepath.Join(settings, "config.json")
	for _, d := range []string{filepath.Join(settings, "inside"), filepath.Join(home, "Documents")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(home, "Documents", "f.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got, err := validateDropFolder(filepath.Join(home, "Documents"), configPath); err != nil || got != filepath.Join(home, "Documents") {
		t.Errorf("an ordinary folder should be fine: %q %v", got, err)
	}

	refused := map[string]string{
		string(filepath.Separator): "",
		filepath.VolumeName(os.TempDir()) + string(filepath.Separator): "whole drive",
		home:                                    "home folder",
		settings:                                "settings",
		filepath.Join(settings, "inside"):       "settings",
		filepath.Join(home, ".config"):          "settings",
		file:                                    "file, not a folder",
		filepath.Join(home, "Documents", "nope"): "doesn't exist",
	}
	for dir, want := range refused {
		_, err := validateDropFolder(dir, configPath)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: error = %v, want one containing %q", dir, err, want)
		}
	}
}

func TestUploadSettingsEndpoints(t *testing.T) {
	ui, c, _ := newTestUI(t)

	if resp, _ := c.do("GET", "/api/uploads", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a session got %d, want 401", resp.StatusCode)
	}
	c.login(ui)
	token := c.csrf()

	var view uploadView
	_, body := c.do("GET", "/api/uploads", nil)
	if err := json.Unmarshal([]byte(body), &view); err != nil || view.Enabled || view.MaxMB != defaultUploadMaxMB || view.PerHour != defaultUploadPerHour {
		t.Fatalf("unexpected defaults: %v %s", err, body)
	}

	drop := resolvedPath(t.TempDir())
	good := func(enabled bool, dir string, max, hour int) string {
		return fmt.Sprintf(`{"enabled":%v,"dir":%q,"max_mb":%d,"per_hour":%d,"allow_programs":false}`, enabled, dir, max, hour)
	}

	for name, payload := range map[string]string{
		"no folder":        good(true, "", 50, 10),
		"size too small":   good(false, drop, 0, 10),
		"size too big":     good(false, drop, maxUploadMaxMB+1, 10),
		"hour too small":   good(false, drop, 50, 0),
		"hour too big":     good(false, drop, 50, maxUploadPerHour+1),
		"folder not found": good(true, filepath.Join(drop, "nope"), 50, 10),
	} {
		if resp, _ := c.postJSON("/api/uploads", token, payload); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s got %d, want 400", name, resp.StatusCode)
		}
	}

	resp, body := c.postJSON("/api/uploads", token, good(true, drop, 50, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("saving got %d: %s", resp.StatusCode, body)
	}
	cfg := ui.opts.Indexer.Config()
	if !cfg.uploadsEnabled() || cfg.UploadDir != drop || cfg.uploadMaxMB() != 50 || cfg.uploadPerHour() != 10 {
		t.Errorf("the agent isn't using the new settings: %+v", cfg)
	}
	if saved, err := readRaw(ui.opts.ConfigPath); err != nil || saved.UploadDir != drop || saved.UploadMaxMB != 50 || saved.UploadPerHour != 10 {
		t.Errorf("the settings weren't saved: %v %+v", err, saved)
	}

	if resp, _ := c.do("POST", "/api/uploads", map[string]string{"Content-Type": "application/json"}, good(false, drop, 50, 10)); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a change without the session token got %d, want 403", resp.StatusCode)
	}
}

func TestMakeAFolderForThePicker(t *testing.T) {
	ui, c, _ := newTestUI(t)
	c.login(ui)
	token := c.csrf()
	parent := resolvedPath(t.TempDir())

	resp, body := c.postJSON("/api/fs/mkdir", token, fmt.Sprintf(`{"parent":%q,"name":"Phone uploads"}`, parent))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d: %s", resp.StatusCode, body)
	}
	if st, err := os.Stat(filepath.Join(parent, "Phone uploads")); err != nil || !st.IsDir() {
		t.Errorf("the folder wasn't created: %v", err)
	}

	for name, payload := range map[string]string{
		"it exists":      fmt.Sprintf(`{"parent":%q,"name":"Phone uploads"}`, parent),
		"dot dot":        fmt.Sprintf(`{"parent":%q,"name":".."}`, parent),
		"a slash":        fmt.Sprintf(`{"parent":%q,"name":"a/b"}`, parent),
		"empty":          fmt.Sprintf(`{"parent":%q,"name":"  "}`, parent),
		"a bad char":     fmt.Sprintf(`{"parent":%q,"name":"a:b"}`, parent),
		"relative":       `{"parent":"relative/dir","name":"x"}`,
		"parent missing": fmt.Sprintf(`{"parent":%q,"name":"x"}`, filepath.Join(parent, "gone")),
	} {
		if resp, _ := c.postJSON("/api/fs/mkdir", token, payload); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s got %d, want 400", name, resp.StatusCode)
		}
	}
}