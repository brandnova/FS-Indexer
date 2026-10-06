package main

import (
	"sync"
	"time"
)

// limiter locks out a client address after too many failed attempts.
// Times are passed in so the logic is easy to test.
type limiter struct {
	mu      sync.Mutex
	max     int           // failures allowed inside `window`
	window  time.Duration // how long failures are remembered
	block   time.Duration // lockout length once `max` is reached
	entries map[string]*limitEntry
}

type limitEntry struct {
	failures     int
	windowStart  time.Time
	blockedUntil time.Time
}

func newLimiter(max int, window, block time.Duration) *limiter {
	return &limiter{max: max, window: window, block: block, entries: map[string]*limitEntry{}}
}

// blocked reports whether ip is locked out, and for how much longer.
func (l *limiter) blocked(ip string, now time.Time) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	e, ok := l.entries[ip]
	if !ok || !now.Before(e.blockedUntil) {
		return 0, false
	}
	return e.blockedUntil.Sub(now), true
}

// fail records a failed attempt and starts a lockout when the limit is hit.
func (l *limiter) fail(ip string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.entries) > 1000 {
		l.prune(now)
	}

	e, ok := l.entries[ip]
	if !ok {
		e = &limitEntry{windowStart: now}
		l.entries[ip] = e
	}
	if now.Sub(e.windowStart) > l.window {
		e.failures = 0
		e.windowStart = now
	}

	e.failures++
	if e.failures >= l.max {
		e.blockedUntil = now.Add(l.block)
		e.failures = 0
		e.windowStart = now
	}
}

// reset forgets an address after a successful login.
func (l *limiter) reset(ip string) {
	l.mu.Lock()
	delete(l.entries, ip)
	l.mu.Unlock()
}

func (l *limiter) prune(now time.Time) {
	for ip, e := range l.entries {
		if now.After(e.blockedUntil) && now.Sub(e.windowStart) > l.window {
			delete(l.entries, ip)
		}
	}
}