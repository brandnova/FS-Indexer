package main

import (
	"os"
	"path/filepath"
	"testing"
)

func mustWrite(t *testing.T, file, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestIgnorerMatches(t *testing.T) {
	ig := newIgnorer([]string{"*.tmp"})

	ignored := []string{
		"node_modules", "NODE_MODULES", ".git", "__pycache__", "$RECYCLE.BIN",
		".ssh", ".gnupg", ".aws", ".env", ".env.local",
		"server.pem", "SERVER.PEM", "vault.kdbx", "id.key", "cert.p12", "cert.pfx",
		"scratch.tmp",
	}
	for _, name := range ignored {
		if !ig.match(name) {
			t.Errorf("%q should be ignored", name)
		}
	}

	kept := []string{"readme.md", "environment.txt", "main.go", "pem.txt", "src", "keyboard.md"}
	for _, name := range kept {
		if ig.match(name) {
			t.Errorf("%q should be kept", name)
		}
	}
}

func TestCrawl(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "a.txt"), "hello")
	mustWrite(t, filepath.Join(root, "sub", "b.PDF"), "12345678")
	mustWrite(t, filepath.Join(root, "node_modules", "x.js"), "x")
	mustWrite(t, filepath.Join(root, ".ssh", "id_rsa"), "secret")
	mustWrite(t, filepath.Join(root, "sub", "cert.pem"), "secret")
	mustWrite(t, filepath.Join(root, "sub", ".git", "config"), "x")
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	// Creating symlinks needs privileges on Windows, so this part is best-effort.
	if err := os.Symlink(root, filepath.Join(root, "loop")); err != nil {
		t.Logf("symlink not created (%v); skipping the symlink check", err)
	}

	cfg := &Config{Roots: []Root{{Path: root, Label: "Root"}}}
	entries, _ := Crawl(cfg)

	got := map[string]Entry{}
	for _, e := range entries {
		got[e.Path] = e
	}

	want := []string{"Root", "Root/a.txt", "Root/empty", "Root/sub", "Root/sub/b.PDF"}
	for _, p := range want {
		if _, ok := got[p]; !ok {
			t.Errorf("missing entry %q", p)
		}
	}
	if len(got) != len(want) {
		t.Errorf("got %d entries, want %d: %v", len(got), len(want), keys(got))
	}

	if e := got["Root"]; e.Parent != "" || !e.IsDir {
		t.Errorf("root entry wrong: %+v", e)
	}
	if e := got["Root/a.txt"]; e.Parent != "Root" || e.Ext != "txt" || e.Size != 5 || e.IsDir {
		t.Errorf("a.txt entry wrong: %+v", e)
	}
	if e := got["Root/sub/b.PDF"]; e.Parent != "Root/sub" || e.Ext != "pdf" || e.Size != 8 {
		t.Errorf("b.PDF entry wrong: %+v", e)
	}
	if e := got["Root/empty"]; !e.IsDir {
		t.Errorf("empty folder should be indexed as a directory: %+v", e)
	}
}

func keys(m map[string]Entry) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}