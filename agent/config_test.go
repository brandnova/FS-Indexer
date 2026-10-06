package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPickConfigPath(t *testing.T) {
	def := "/cfg/fs-indexer/config.json"

	cases := []struct {
		name          string
		flag          string
		defaultExists bool
		legacyExists  bool
		wantPath      string
		wantNotice    bool
	}{
		{"flag wins", "/custom.json", true, true, "/custom.json", false},
		{"default when it exists", "", true, true, def, false},
		{"legacy when default is missing", "", false, true, "config.json", true},
		{"default for new installs", "", false, false, def, false},
	}
	for _, c := range cases {
		path, notice := pickConfigPath(c.flag, c.defaultExists, c.legacyExists, def)
		if path != c.wantPath {
			t.Errorf("%s: path = %q, want %q", c.name, path, c.wantPath)
		}
		if (notice != "") != c.wantNotice {
			t.Errorf("%s: notice = %q, wantNotice = %v", c.name, notice, c.wantNotice)
		}
	}
}

func TestApplyDefaults(t *testing.T) {
	c := &Config{}
	if !c.applyDefaults() {
		t.Fatal("an empty config should be changed by applyDefaults")
	}
	if c.DeviceID == "" || c.DeviceName == "" || c.Port != 8080 || len(c.Token) != 32 {
		t.Errorf("defaults not filled in: %+v", c)
	}
	if c.applyDefaults() {
		t.Error("a second call should change nothing")
	}
}

func TestNormalizeRoots(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()

	t.Run("fills in labels", func(t *testing.T) {
		c := &Config{Roots: []Root{{Path: a, Label: "Docs"}, {Path: b}}}
		if err := c.normalizeRoots(); err != nil {
			t.Fatal(err)
		}
		if c.Roots[0].Label != "Docs" || c.Roots[1].Label == "" {
			t.Errorf("labels: %+v", c.Roots)
		}
	})

	t.Run("duplicate labels (case-insensitive)", func(t *testing.T) {
		c := &Config{Roots: []Root{{Path: a, Label: "X"}, {Path: b, Label: "x"}}}
		if err := c.normalizeRoots(); err == nil {
			t.Error("expected an error for duplicate labels")
		}
	})

	t.Run("missing folder", func(t *testing.T) {
		c := &Config{Roots: []Root{{Path: filepath.Join(a, "nope")}}}
		if err := c.normalizeRoots(); err == nil {
			t.Error("expected an error for a missing folder")
		}
	})

	t.Run("no roots", func(t *testing.T) {
		if err := (&Config{}).normalizeRoots(); err == nil {
			t.Error("expected an error when no roots are configured")
		}
	})
}

func TestRotateTokenKeepsRootsAndIdentity(t *testing.T) {
	file := filepath.Join(t.TempDir(), "sub", "config.json")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}

	orig := &Config{
		DeviceID:     "0123456789abcdef",
		DeviceName:   "pc",
		Port:         9000,
		Token:        "old-token",
		Roots:        []Root{{Path: "~/Documents"}},
		ExtraIgnores: []string{"*.tmp"},
	}
	data, _ := json.Marshal(orig)
	if err := os.WriteFile(file, data, 0o600); err != nil {
		t.Fatal(err)
	}

	rotated, err := RotateToken(file)
	if err != nil {
		t.Fatal(err)
	}
	if rotated.Token == "old-token" || len(rotated.Token) != 32 {
		t.Errorf("token not rotated: %q", rotated.Token)
	}

	saved, err := ReadConfig(file)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Token != rotated.Token || saved.DeviceID != orig.DeviceID || saved.Port != 9000 {
		t.Errorf("saved config differs: %+v", saved)
	}
	if saved.Roots[0].Path != "~/Documents" {
		t.Errorf("roots were rewritten: %q", saved.Roots[0].Path)
	}
}

func TestReadConfigRejectsIncompleteOrMissing(t *testing.T) {
	dir := t.TempDir()

	incomplete := filepath.Join(dir, "config.json")
	if err := os.WriteFile(incomplete, []byte(`{"roots":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadConfig(incomplete); err == nil {
		t.Error("expected an error for an incomplete config")
	}
	if _, err := ReadConfig(filepath.Join(dir, "missing.json")); err == nil {
		t.Error("expected an error for a missing config")
	}
}