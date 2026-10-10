package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestColorDecision(t *testing.T) {
	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}

	cases := []struct {
		name     string
		terminal bool
		flag     bool
		env      map[string]string
		want     bool
	}{
		{"terminal", true, false, nil, true},
		{"not a terminal (pipe or file)", false, false, nil, false},
		{"-no-color flag", true, true, nil, false},
		{"NO_COLOR set", true, false, map[string]string{"NO_COLOR": "1"}, false},
		{"dumb terminal", true, false, map[string]string{"TERM": "dumb"}, false},
		{"normal TERM", true, false, map[string]string{"TERM": "xterm-256color"}, true},
	}
	for _, c := range cases {
		if got := colorDecision(c.terminal, c.flag, env(c.env)); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestConsolePlainOutput(t *testing.T) {
	var buf bytes.Buffer
	c := newConsoleFor(&buf, false, false)

	c.OK("Folders", "Documents, Videos")
	c.Warn("careful")
	c.Problem("Port 8080 is already in use", "Another copy is running.", "close it")

	out := buf.String()
	if strings.Contains(out, "\x1b") {
		t.Error("plain output must not contain colour codes")
	}
	for _, want := range []string{"OK", "Folders", "Documents, Videos", "!!", "careful", "XX", "already in use", "How to fix"} {
		if !strings.Contains(out, want) {
			t.Errorf("output is missing %q:\n%s", want, out)
		}
	}
}

func TestConsoleColourOutput(t *testing.T) {
	var buf bytes.Buffer
	c := newConsoleFor(&buf, true, false)
	c.OK("Folders", "Documents")

	out := buf.String()
	if !strings.Contains(out, "\x1b[") || !strings.Contains(out, "✔") {
		t.Errorf("expected colours and a tick, got %q", out)
	}
}

func TestConsoleQuietKeepsOnlyProblems(t *testing.T) {
	var buf bytes.Buffer
	c := newConsoleFor(&buf, false, true)

	c.Title("Agent")
	c.OK("Folders", "Documents")
	c.Text("Scan this QR code")
	c.Activity("a phone connected")
	c.WithWriter(func(w io.Writer) { w.Write([]byte("QR")) })
	c.Warn("a warning")
	c.Problem("a problem", "", "")

	out := buf.String()
	for _, hidden := range []string{"Agent", "Folders", "QR code", "phone connected", "QR"} {
		if strings.Contains(out, hidden) {
			t.Errorf("quiet mode should hide %q:\n%s", hidden, out)
		}
	}
	for _, shown := range []string{"a warning", "a problem"} {
		if !strings.Contains(out, shown) {
			t.Errorf("quiet mode must still show %q:\n%s", shown, out)
		}
	}
}

func TestCommas(t *testing.T) {
	cases := map[int]string{0: "0", 7: "7", 999: "999", 1000: "1,000", 1234: "1,234", 12345: "12,345", 316416: "316,416", 1234567: "1,234,567"}
	for n, want := range cases {
		if got := commas(n); got != want {
			t.Errorf("commas(%d) = %q, want %q", n, got, want)
		}
	}
}