package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func oneRootConfig(t *testing.T) (*Config, string) {
	t.Helper()
	root := t.TempDir()
	return &Config{Roots: []Root{{Path: resolvedPath(root), Label: "Main"}}, ExtraIgnores: []string{}}, root
}

func wantErr(t *testing.T, err error, part string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), part) {
		t.Errorf("error = %v, want one containing %q", err, part)
	}
}

func TestAddFolder(t *testing.T) {
	cfg, _ := oneRootConfig(t)
	other := t.TempDir()

	next, label, err := addFolder(cfg, other, "")
	if err != nil {
		t.Fatal(err)
	}
	if label != filepath.Base(resolvedPath(other)) || len(next.Roots) != 2 {
		t.Errorf("label %q, roots %+v", label, next.Roots)
	}
	if len(cfg.Roots) != 1 {
		t.Error("the original settings must not change")
	}
}

func TestAddFolderRefusals(t *testing.T) {
	cfg, root := oneRootConfig(t)
	sub := filepath.Join(root, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "f.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, _, err := addFolder(cfg, root, "")
	wantErr(t, err, "already shared")
	_, _, err = addFolder(cfg, sub, "")
	wantErr(t, err, "already covered")
	_, _, err = addFolder(cfg, filepath.Dir(root), "")
	wantErr(t, err, "contains")
	_, _, err = addFolder(cfg, file, "")
	wantErr(t, err, "file, not a folder")
	_, _, err = addFolder(cfg, filepath.Join(root, "nope"), "")
	wantErr(t, err, "doesn't exist")
	_, _, err = addFolder(cfg, "  ", "")
	wantErr(t, err, "Choose a folder")

	top := filepath.VolumeName(os.TempDir()) + string(filepath.Separator)
	_, _, err = addFolder(cfg, top, "")
	wantErr(t, err, "whole drive")

	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	_, _, err = addFolder(cfg, home, "")
	wantErr(t, err, "home folder")
}

func TestAddFolderLabels(t *testing.T) {
	cfg, _ := oneRootConfig(t)
	a := filepath.Join(t.TempDir(), "same")
	b := filepath.Join(t.TempDir(), "same")
	for _, p := range []string{a, b} {
		if err := os.Mkdir(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	cfg, first, err := addFolder(cfg, a, "")
	if err != nil || first != "same" {
		t.Fatalf("first label %q, %v", first, err)
	}
	_, second, err := addFolder(cfg, b, "")
	if err != nil || second != "same (2)" {
		t.Errorf("a clashing name should get a number, got %q, %v", second, err)
	}
	_, _, err = addFolder(cfg, t.TempDir(), "bad/name")
	wantErr(t, err, "slashes")
	_, _, err = addFolder(cfg, t.TempDir(), "MAIN")
	wantErr(t, err, "already shared")
}

func TestRemoveAndUpdateFolder(t *testing.T) {
	cfg, _ := oneRootConfig(t)
	_, err := removeFolder(cfg, "Main")
	wantErr(t, err, "at least one")

	cfg, _, _ = addFolder(cfg, t.TempDir(), "Second")
	next, err := removeFolder(cfg, "second")
	if err != nil || len(next.Roots) != 1 || len(cfg.Roots) != 2 {
		t.Errorf("remove failed: %v %+v", err, next.Roots)
	}
	_, err = removeFolder(cfg, "Nope")
	wantErr(t, err, "isn't in the list")

	yes := true
	next, err = updateFolder(cfg, "Second", &yes, &yes)
	if err != nil || !next.Roots[1].Disabled || !next.Roots[1].IncludeHidden || cfg.Roots[1].Disabled {
		t.Errorf("update failed: %v %+v", err, next.Roots)
	}
	if len(next.enabledRoots()) != 1 {
		t.Error("a switched-off folder must not count as enabled")
	}
}

func TestCleanPatterns(t *testing.T) {
	got, err := cleanPatterns([]string{" *.tmp ", "*.TMP", "", "draft-*"})
	if err != nil || len(got) != 2 || got[0] != "*.tmp" || got[1] != "draft-*" {
		t.Errorf("cleaned = %v, %v", got, err)
	}
	for _, bad := range []string{"a/b", `a\b`, "[abc", strings.Repeat("x", 101)} {
		if _, err := cleanPatterns([]string{bad}); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
}