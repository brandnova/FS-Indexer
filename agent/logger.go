package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Level says how serious a log line is.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

func (l Level) label() string {
	switch l {
	case LevelDebug:
		return "DEBUG"
	case LevelInfo:
		return "INFO "
	case LevelWarn:
		return "WARN "
	}
	return "ERROR"
}

const (
	logMaxBytes   = 2 << 20 // start a new file after 2 MB...
	logKeepFiles  = 3       // ...and keep this many old ones (agent.log.1 .. .3)
	logRecentKept = 500     // lines kept in memory for the dashboard
)

// Logger writes timestamped lines to a file, rotates it, and remembers the
// latest lines for the dashboard and for problem reports.
//
// Line format:  2026-10-11 14:03:22 INFO  [scan] finished: 2,367 items
//
// It never receives the access token, and it is safe to call on a nil Logger.
type Logger struct {
	mu       sync.Mutex
	path     string
	file     *os.File
	size     int64
	maxBytes int64
	debug    bool
	recent   []string
	now      func() time.Time
}

// logs is the agent's log. It stays nil until main opens it; every method is safe on nil.
var logs *Logger

// OpenLogger opens (or creates) the log file. With debug on, DEBUG lines are kept too.
func OpenLogger(path string, debug bool) (*Logger, error) {
	l := &Logger{path: path, debug: debug, maxBytes: logMaxBytes, now: time.Now}
	l.recent = tailLines(path, logRecentKept) // show history from before this start
	if err := l.open(); err != nil {
		return nil, err
	}
	if l.size > l.maxBytes {
		l.rotate()
	}
	return l, nil
}

func (l *Logger) open() error {
	if dir := filepath.Dir(l.path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	l.size = 0
	if st, err := f.Stat(); err == nil {
		l.size = st.Size()
	}
	l.file = f
	return nil
}

// rotate moves agent.log to agent.log.1 (and .1 to .2 ...), then starts a fresh file.
func (l *Logger) rotate() {
	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
	_ = os.Remove(fmt.Sprintf("%s.%d", l.path, logKeepFiles))
	for i := logKeepFiles - 1; i >= 1; i-- {
		_ = os.Rename(fmt.Sprintf("%s.%d", l.path, i), fmt.Sprintf("%s.%d", l.path, i+1))
	}
	_ = os.Rename(l.path, l.path+".1")
	_ = l.open()
}

func (l *Logger) Close() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
}

// Path is where the log file lives ("" for a nil Logger).
func (l *Logger) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

func (l *Logger) logf(level Level, component, format string, args ...any) {
	if l == nil || (level == LevelDebug && !l.debug) {
		return
	}
	msg := strings.ReplaceAll(fmt.Sprintf(format, args...), "\n", " | ")
	line := fmt.Sprintf("%s %s [%s] %s", l.now().Format("2006-01-02 15:04:05"), level.label(), component, msg)

	l.mu.Lock()
	defer l.mu.Unlock()

	l.recent = append(l.recent, line)
	if len(l.recent) > logRecentKept {
		l.recent = l.recent[len(l.recent)-logRecentKept:]
	}
	if l.file == nil {
		return
	}
	if l.size+int64(len(line))+1 > l.maxBytes {
		l.rotate()
		if l.file == nil {
			return
		}
	}
	n, _ := fmt.Fprintln(l.file, line)
	l.size += int64(n)
}

func (l *Logger) Debugf(component, format string, args ...any) { l.logf(LevelDebug, component, format, args...) }
func (l *Logger) Infof(component, format string, args ...any)  { l.logf(LevelInfo, component, format, args...) }
func (l *Logger) Warnf(component, format string, args ...any)  { l.logf(LevelWarn, component, format, args...) }
func (l *Logger) Errorf(component, format string, args ...any) { l.logf(LevelError, component, format, args...) }

// Recent returns up to n of the newest lines, oldest first.
func (l *Logger) Recent(n int) []string {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	lines := l.recent
	if n > 0 && len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return append([]string(nil), lines...)
}

// tailLines reads the last n lines of a file (the log is capped at about 2 MB).
func tailLines(path string, n int) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	text := strings.TrimRight(strings.ReplaceAll(string(data), "\r", ""), "\n")
	if text == "" {
		return nil
	}
	lines := strings.Split(text, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}