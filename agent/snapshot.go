package main

import (
	"sync"
	"time"
)

// Snapshot holds the latest completed scan. The slice is replaced wholesale
// and never mutated afterwards, so readers can safely iterate it without
// holding the lock.
type Snapshot struct {
	mu        sync.RWMutex
	entries   []Entry
	indexedAt time.Time
}

func (s *Snapshot) Set(entries []Entry, at time.Time) {
	s.mu.Lock()
	s.entries = entries
	s.indexedAt = at
	s.mu.Unlock()
}

func (s *Snapshot) Get() ([]Entry, time.Time) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.entries, s.indexedAt
}