package main

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	ansiReset  = "\x1b[0m"
	ansiBold   = "\x1b[1m"
	ansiDim    = "\x1b[2m"
	ansiRed    = "\x1b[31m"
	ansiGreen  = "\x1b[32m"
	ansiYellow = "\x1b[33m"
	ansiCyan   = "\x1b[36m"
)

// colorDecision says whether to use colours and Unicode symbols: only on a real
// terminal, and never when the user asked for plain output.
func colorDecision(isTerminal, noColorFlag bool, getenv func(string) string) bool {
	if noColorFlag || !isTerminal {
		return false
	}
	if getenv("NO_COLOR") != "" || strings.EqualFold(getenv("TERM"), "dumb") {
		return false
	}
	return true
}

func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// Console prints the agent's friendly, human-facing output. It writes to stderr
// so that stdout stays clean for `-dump`. In quiet mode only warnings and
// problems are shown. It is safe to use from several goroutines.
type Console struct {
	mu    sync.Mutex
	w     io.Writer
	color bool
	quiet bool
	now   func() time.Time
}

// NewConsole talks to the terminal on f.
func NewConsole(f *os.File, quiet, noColor bool) *Console {
	color := colorDecision(isTerminal(f), noColor, os.Getenv)
	if color && !enableANSI(f) {
		color = false
	}
	return &Console{w: f, color: color, quiet: quiet, now: time.Now}
}

// newConsoleFor builds a console on any writer (used by tests).
func newConsoleFor(w io.Writer, color, quiet bool) *Console {
	return &Console{w: w, color: color, quiet: quiet, now: time.Now}
}

func (c *Console) paint(code, s string) string {
	if !c.color {
		return s
	}
	return code + s + ansiReset
}

func (c *Console) symbol(kind string) string {
	if c.color {
		switch kind {
		case "ok":
			return "✔"
		case "warn":
			return "!"
		case "fail":
			return "✖"
		}
		return "·"
	}
	switch kind {
	case "ok":
		return "OK"
	case "warn":
		return "!!"
	case "fail":
		return "XX"
	}
	return "--"
}

// emit prints one line. Quiet mode drops everything that isn't marked "always".
func (c *Console) emit(always bool, line string) {
	if c.quiet && !always {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	fmt.Fprintln(c.w, line)
}

func (c *Console) status(kind, code, label, value string) {
	c.emit(false, fmt.Sprintf("  %s %s %s",
		c.paint(code, fmt.Sprintf("%-2s", c.symbol(kind))),
		c.paint(ansiBold, fmt.Sprintf("%-10s", label)),
		value))
}

// Blank prints an empty line.
func (c *Console) Blank() { c.emit(false, "") }

// Title prints a bold heading.
func (c *Console) Title(text string) { c.emit(false, "  "+c.paint(ansiBold, text)) }

// Text prints an ordinary line.
func (c *Console) Text(text string) { c.emit(false, "  "+text) }

// OK prints a finished step, such as "✔ Folders   Documents, Videos".
func (c *Console) OK(label, value string) { c.status("ok", ansiGreen, label, value) }

// Info prints something still in progress or optional.
func (c *Console) Info(label, value string) { c.status("dot", ansiCyan, label, value) }

// Hint prints a dimmed explanation under a line.
func (c *Console) Hint(text string) { c.emit(false, "     "+c.paint(ansiDim, text)) }

// Warn prints a warning. It is shown even in quiet mode.
func (c *Console) Warn(text string) {
	c.emit(true, fmt.Sprintf("  %s %s", c.paint(ansiYellow, fmt.Sprintf("%-2s", c.symbol("warn"))), text))
}

// Activity prints a timestamped line about something that just happened.
func (c *Console) Activity(format string, args ...any) {
	when := c.now().Format("15:04:05")
	c.emit(false, "  "+c.paint(ansiDim, when)+"  "+fmt.Sprintf(format, args...))
}

// Problem prints an error with an explanation and a way to fix it. Always shown.
func (c *Console) Problem(title, detail, hint string) {
	c.emit(true, "")
	c.emit(true, fmt.Sprintf("  %s %s", c.paint(ansiRed+ansiBold, fmt.Sprintf("%-2s", c.symbol("fail"))), c.paint(ansiBold, title)))
	if detail != "" {
		c.emit(true, "     "+detail)
	}
	if hint != "" {
		c.emit(true, "")
		c.emit(true, "     "+c.paint(ansiBold, "How to fix: ")+hint)
	}
	c.emit(true, "")
}

// WithWriter gives exclusive access to the output for multi-line drawings such as
// the QR code, so other messages can't land in the middle. Skipped in quiet mode.
func (c *Console) WithWriter(draw func(w io.Writer)) {
	if c.quiet {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	draw(c.w)
}