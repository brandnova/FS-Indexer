package main

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func titleOf(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error to explain")
	}
	return strings.ToLower(explainConfigError("config.json", err).Title)
}

func TestExplainConfigErrors(t *testing.T) {
	dir := t.TempDir()

	t.Run("no folders", func(t *testing.T) {
		if got := titleOf(t, (&Config{}).normalizeRoots()); !strings.Contains(got, "no folders") {
			t.Errorf("title = %q", got)
		}
	})

	t.Run("missing folder", func(t *testing.T) {
		cfg := &Config{Roots: []Root{{Path: filepath.Join(dir, "nope")}}}
		if got := titleOf(t, cfg.normalizeRoots()); !strings.Contains(got, "doesn't exist") {
			t.Errorf("title = %q", got)
		}
	})

	t.Run("duplicate labels", func(t *testing.T) {
		a, b := t.TempDir(), t.TempDir()
		cfg := &Config{Roots: []Root{{Path: a, Label: "x"}, {Path: b, Label: "x"}}}
		if got := titleOf(t, cfg.normalizeRoots()); !strings.Contains(got, "same name") {
			t.Errorf("title = %q", got)
		}
	})

	t.Run("bad network", func(t *testing.T) {
		cfg := &Config{AllowedNetworks: []string{"nonsense"}}
		if got := titleOf(t, cfg.parseAllowedNetworks()); !strings.Contains(got, "network") {
			t.Errorf("title = %q", got)
		}
	})

	t.Run("broken settings file", func(t *testing.T) {
		file := filepath.Join(dir, "broken.json")
		if err := os.WriteFile(file, []byte("{"), 0o600); err != nil {
			t.Fatal(err)
		}
		_, err := LoadConfig(file)
		if got := titleOf(t, err); !strings.Contains(got, "mistake") {
			t.Errorf("title = %q", got)
		}
	})

	t.Run("no settings yet", func(t *testing.T) {
		_, err := ReadConfig(filepath.Join(dir, "missing.json"))
		if got := titleOf(t, err); !strings.Contains(got, "no settings") {
			t.Errorf("title = %q", got)
		}
	})

	t.Run("anything else", func(t *testing.T) {
		if got := titleOf(t, errors.New("something odd")); !strings.Contains(got, "couldn't start") {
			t.Errorf("title = %q", got)
		}
	})
}

func TestExplainListenError(t *testing.T) {
	first, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()

	// Binding the same address again gives the operating system's real "in use" error.
	_, err = net.Listen("tcp", first.Addr().String())
	if err == nil {
		t.Skip("this system allowed binding the same address twice")
	}

	got := explainListenError(":8080", err)
	if !strings.Contains(got.Title, "already in use") || !strings.Contains(got.Title, "8080") {
		t.Errorf("title = %q", got.Title)
	}
	if got.Hint == "" {
		t.Error("expected a hint")
	}
}