package main

import (
	"log"
	"runtime"
	"sync/atomic"
	"time"
)

// Indexer owns the snapshot and knows how to refresh it in the background.
type Indexer struct {
	cfg      *Config
	snap     *Snapshot
	scanning atomic.Bool
}

func NewIndexer(cfg *Config) *Indexer {
	return &Indexer{cfg: cfg, snap: &Snapshot{}}
}

func (ix *Indexer) Scanning() bool {
	return ix.scanning.Load()
}

// Snapshot returns the last completed scan (empty, zero time before the first one).
func (ix *Indexer) Snapshot() ([]Entry, time.Time) {
	return ix.snap.Get()
}

// StartScan begins a scan in the background. It returns false, and does
// nothing, if a scan is already running.
func (ix *Indexer) StartScan() bool {
	if !ix.scanning.CompareAndSwap(false, true) {
		return false
	}
	go func() {
		defer ix.scanning.Store(false)

		start := time.Now()
		entries, skipped := Crawl(ix.cfg)
		ix.snap.Set(entries, time.Now())

		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)
		log.Printf("scan complete: %d entries, %d skipped, %s, heap %.1f MB",
			len(entries), skipped, time.Since(start).Round(time.Millisecond), float64(mem.HeapAlloc)/1e6)
	}()
	return true
}