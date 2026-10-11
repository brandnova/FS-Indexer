package main

import (
	"path/filepath"
	"testing"
)

func TestExplainPath(t *testing.T) {
	docs := resolvedPath(t.TempDir())
	cfg := &Config{
		Roots: []Root{
			{Path: docs, Label: "Docs"},
			{Path: resolvedPath(t.TempDir()), Label: "Off", Disabled: true},
		},
		ExtraIgnores: []string{"*.tmp"},
	}

	cases := []struct {
		in     string
		shared bool
		source string
	}{
		{"Docs/report.pdf", true, ""},
		{"Docs/.env", false, srcSecret},
		{"docs/node_modules/x/y.js", false, srcNoise},
		{"Docs/notes.tmp", false, srcYours},
		{"Docs/.hidden/file.txt", false, srcHidden},
		{filepath.Join(docs, "a", "b.txt"), true, ""},
		{filepath.Join(docs, ".git", "config"), false, srcNoise},
		{"Other/file.txt", false, ""},
		{"Off/file.txt", false, ""},
	}
	for _, c := range cases {
		v := explainPath(cfg, c.in)
		if v.Shared != c.shared || v.Source != c.source {
			t.Errorf("explainPath(%q) = %+v, want shared=%v source=%q", c.in, v, c.shared, c.source)
		}
		if v.Reason == "" {
			t.Errorf("explainPath(%q) gave no reason", c.in)
		}
	}

	cfg.Roots[0].IncludeHidden = true
	if v := explainPath(cfg, "Docs/.hidden/file.txt"); !v.Shared {
		t.Errorf("hidden files should be shared when switched on for the folder: %+v", v)
	}
}