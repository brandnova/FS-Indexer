package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoggerWritesTimestampedLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.log")
	l, err := OpenLogger(path, false)
	if err != nil {
		t.Fatal(err)
	}
	l.Infof("scan", "indexed %d items", 7)
	l.Warnf("security", "wrong token from %s", "192.168.1.9")
	l.Debugf("scan", "this is a debug detail")
	l.Close()

	data, _ := os.ReadFile(path)
	text := string(data)
	if !strings.Contains(text, " INFO  [scan] indexed 7 items") || !strings.Contains(text, " WARN  [security] wrong token") {
		t.Errorf("unexpected log:\n%s", text)
	}
	if strings.Contains(text, "debug detail") {
		t.Error("debug lines must stay out unless debug is on")
	}
	if first := strings.Fields(text)[0]; len(first) != len("2026-10-11") {
		t.Errorf("the line should start with a date, got %q", first)
	}
}

func TestLoggerDebugOnAndRecent(t *testing.T) {
	l, err := OpenLogger(filepath.Join(t.TempDir(), "agent.log"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	l.Debugf("scan", "detail")
	l.Errorf("agent", "boom")

	got := l.Recent(10)
	if len(got) != 2 || !strings.Contains(got[0], "DEBUG") || !strings.Contains(got[1], "ERROR") {
		t.Errorf("unexpected recent lines: %v", got)
	}
}

func TestLoggerRotates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.log")
	l, err := OpenLogger(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	l.maxBytes = 300

	for i := 0; i < 20; i++ {
		l.Infof("test", "line number %d with some padding to fill the file", i)
	}
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Errorf("expected a rotated file: %v", err)
	}
	if st, _ := os.Stat(path); st.Size() > 400 {
		t.Errorf("the current file should be small, got %d bytes", st.Size())
	}
}

func TestLoggerKeepsHistoryAcrossRestarts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.log")
	l, _ := OpenLogger(path, false)
	l.Infof("agent", "first run")
	l.Close()

	l2, _ := OpenLogger(path, false)
	defer l2.Close()
	if got := l2.Recent(5); len(got) != 1 || !strings.Contains(got[0], "first run") {
		t.Errorf("history was not loaded: %v", got)
	}
}

func TestNilLoggerIsSafe(t *testing.T) {
	var l *Logger
	l.Infof("x", "no panic %d", 1)
	l.Close()
	if l.Path() != "" || l.Recent(5) != nil {
		t.Error("a nil logger should be empty")
	}
	_ = fmt.Sprint(l)
}