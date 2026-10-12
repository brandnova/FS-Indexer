package main

import (
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAutostartArgs(t *testing.T) {
	def := DefaultConfigPath()

	if got := strings.Join(autostartArgsFor("windows", def), " "); got != "-background -no-open" {
		t.Errorf("windows args = %q", got)
	}
	if got := strings.Join(autostartArgsFor("linux", def), " "); got != "-quiet -no-open -no-qr" {
		t.Errorf("linux args = %q", got)
	}

	custom := filepath.Join(t.TempDir(), "work.json")
	got := autostartArgsFor("darwin", custom)
	if len(got) != 5 || got[3] != "-config" || got[4] != custom {
		t.Errorf("a custom settings file must be remembered: %v", got)
	}
}

func TestDesktopEntry(t *testing.T) {
	entry := desktopEntry("/opt/My Apps/fsagent", []string{"-quiet", "-no-open"})

	for _, want := range []string{
		"[Desktop Entry]",
		`Exec="/opt/My Apps/fsagent" -quiet -no-open`,
		"X-GNOME-Autostart-enabled=true",
		"Terminal=false",
	} {
		if !strings.Contains(entry, want) {
			t.Errorf("the entry is missing %q:\n%s", want, entry)
		}
	}
	if desktopQuote("/usr/bin/fsagent") != "/usr/bin/fsagent" {
		t.Error("a plain path needs no quotes")
	}
}

func TestLaunchdPlist(t *testing.T) {
	plist := launchdPlist("/Apps & Co/fsagent", []string{"-quiet", "-config", "/tmp/a b.json"})

	if !strings.Contains(plist, "/Apps &amp; Co/fsagent") || !strings.Contains(plist, autostartID) {
		t.Errorf("unexpected plist:\n%s", plist)
	}
	dec := xml.NewDecoder(strings.NewReader(plist))
	for {
		if _, err := dec.Token(); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("the plist isn't well-formed XML: %v", err)
		}
	}
}

func TestIsTemporaryPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{filepath.Join(os.TempDir(), "x", "fsagent"), true},
		{"/home/me/.cache/go-build/ab/exe/fsagent", true},
		{"/usr/bin/fsagent", false},
		{filepath.Join("C:", "Program Files", "fsagent", "fsagent.exe"), false},
	}
	for _, c := range cases {
		if got := isTemporaryPath(c.path); got != c.want {
			t.Errorf("isTemporaryPath(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}