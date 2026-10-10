package main

import (
	"log"
	"sync/atomic"
	"time"
)

// ScanResult summarises one finished scan.
type ScanResult struct {
	Entries  int
	Files    int
	Folders  int
	Bytes    int64
	Skipped  int
	Duration time.Duration
}

// Indexer owns the snapshot and knows how to refresh it in the background.
type Indexer struct {
	cfg      *Config
	snap     *Snapshot
	scanning atomic.Bool

	// OnScan, if set, is told about every finished scan (the first and each
	// rescan). Set it before the first StartScan.
	OnScan func(ScanResult)
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
		defer ix.scanning.Store(false) // also covers a panic

		start := time.Now()
		entries, skipped := Crawl(ix.cfg)
		ix.snap.Set(entries, time.Now())

		// The new data is in place: phones waiting for a rescan may continue.
		ix.scanning.Store(false)

		res := summarize(entries, skipped, time.Since(start))
		if ix.OnScan != nil {
			ix.OnScan(res)
			return
		}
		log.Printf("scan complete: %d entries, %d skipped, %s", res.Entries, res.Skipped, res.Duration.Round(time.Millisecond))
	}()
	return true
}

func summarize(entries []Entry, skipped int, d time.Duration) ScanResult {
	r := ScanResult{Entries: len(entries), Skipped: skipped, Duration: d}
	for _, e := range entries {
		if e.IsDir {
			r.Folders++
		} else {
			r.Files++
			r.Bytes += e.Size
		}
	}
	return r
}