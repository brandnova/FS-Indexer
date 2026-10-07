package main

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseUserDirs(t *testing.T) {
	input := `# comment
XDG_DESKTOP_DIR="$HOME/Desktop"
XDG_DOCUMENTS_DIR="$HOME/Docs"

XDG_MUSIC_DIR="$HOME/"
not a setting
`
	got := parseUserDirs(strings.NewReader(input), "/home/u")

	if want := filepath.FromSlash("/home/u/Docs"); got["XDG_DOCUMENTS_DIR"] != want {
		t.Errorf("documents = %q, want %q", got["XDG_DOCUMENTS_DIR"], want)
	}
	if want := filepath.FromSlash("/home/u"); got["XDG_MUSIC_DIR"] != want {
		t.Errorf(`"$HOME/" should clean to the home dir, got %q`, got["XDG_MUSIC_DIR"])
	}
	if len(got) != 3 {
		t.Errorf("expected 3 settings, got %v", got)
	}
}

func TestResolveFolders(t *testing.T) {
	home := t.TempDir()
	for _, d := range []string{"Documents", "Downloads", "Tunes"} {
		if err := os.MkdirAll(filepath.Join(home, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	xdg := map[string]string{
		"XDG_MUSIC_DIR":   filepath.Join(home, "Tunes"), // relocated folder
		"XDG_DESKTOP_DIR": home,                          // "$HOME" means the user disabled it
	}

	roots := resolveFolders(home, linuxSpecs, xdg)

	got := map[string]string{}
	for _, r := range roots {
		got[r.Label] = r.Path
		if r.Path == home {
			t.Errorf("the home directory itself must never be a default root (%s)", r.Label)
		}
	}
	for _, label := range []string{"Documents", "Downloads", "Music"} {
		if _, ok := got[label]; !ok {
			t.Errorf("missing default folder %q (got %v)", label, got)
		}
	}
	if got["Music"] != filepath.Join(home, "Tunes") {
		t.Errorf("Music should use the relocated folder, got %q", got["Music"])
	}
	if _, ok := got["Desktop"]; ok {
		t.Error("a disabled Desktop must be skipped")
	}
	if _, ok := got["Pictures"]; ok {
		t.Error("a folder that doesn't exist must be skipped")
	}
}

func TestParseAllowedNetworks(t *testing.T) {
	good := &Config{AllowedNetworks: []string{"100.64.0.0/10", " fd7a:115c:a1e0::/48 "}}
	if err := good.parseAllowedNetworks(); err != nil {
		t.Fatal(err)
	}
	if len(good.allowedNets) != 2 {
		t.Errorf("parsed %d networks, want 2", len(good.allowedNets))
	}

	for _, bad := range []string{"not-a-network", "100.64.0.1", "0.0.0.0/0", "64.0.0.0/2", "::/0"} {
		c := &Config{AllowedNetworks: []string{bad}}
		if err := c.parseAllowedNetworks(); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

func TestLanOnlyWithExtraNetworks(t *testing.T) {
	_, tailscale, _ := net.ParseCIDR("100.64.0.0/10")
	h := lanOnly(okHandler, tailscale)

	if got := serve(h, "100.101.102.103:5000", "").Code; got != http.StatusOK {
		t.Errorf("an address in the allowed network got %d, want 200", got)
	}
	if got := serve(h, "8.8.8.8:53", "").Code; got != http.StatusForbidden {
		t.Errorf("a public address got %d, want 403", got)
	}
	if got := serve(lanOnly(okHandler), "100.101.102.103:5000", "").Code; got != http.StatusForbidden {
		t.Errorf("without the extra network that address got %d, want 403", got)
	}
}

func TestCrawlHiddenFiles(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "visible.txt"), "x")
	mustWrite(t, filepath.Join(root, ".hidden", "inner.txt"), "x")
	mustWrite(t, filepath.Join(root, ".dotfile"), "x")

	paths := func(includeHidden bool) map[string]bool {
		cfg := &Config{Roots: []Root{{Path: root, Label: "R"}}, IncludeHidden: includeHidden}
		entries, _ := Crawl(cfg)
		out := map[string]bool{}
		for _, e := range entries {
			out[e.Path] = true
		}
		return out
	}

	hidden := paths(false)
	if !hidden["R/visible.txt"] || hidden["R/.hidden"] || hidden["R/.hidden/inner.txt"] || hidden["R/.dotfile"] {
		t.Errorf("hidden files should be skipped by default: %v", hidden)
	}

	shown := paths(true)
	if !shown["R/.hidden"] || !shown["R/.hidden/inner.txt"] || !shown["R/.dotfile"] {
		t.Errorf("include_hidden should bring them back: %v", shown)
	}
}