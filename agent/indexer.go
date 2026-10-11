package main

import (
	"sync"
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
	cfgMu    sync.RWMutex
	cfg      *Config
	snap     *Snapshot
	scanning atomic.Bool
	again    atomic.Bool // a rescan was asked for while one was running

	// OnScan, if set, is told about every finished scan (the first and each
	// rescan). Set it before the first StartScan.
	OnScan func(ScanResult)
}

func NewIndexer(cfg *Config) *Indexer {
	return &Indexer{cfg: cfg, snap: &Snapshot{}}
}

// Config returns the settings in use right now. Treat it as read-only: to change
// settings, build a modified clone and give it to SetConfig.
func (ix *Indexer) Config() *Config {
	ix.cfgMu.RLock()
	defer ix.cfgMu.RUnlock()
	return ix.cfg
}

// SetConfig switches to new settings. A scan that is already running finishes with the old ones.
func (ix *Indexer) SetConfig(c *Config) {
	ix.cfgMu.Lock()
	defer ix.cfgMu.Unlock()
	ix.cfg = c
}

func (ix *Indexer) Scanning() bool {
	return ix.scanning.Load()
}

// Snapshot returns the last completed scan (empty, zero time before the first one).
func (ix *Indexer) Snapshot() ([]Entry, time.Time) {
	return ix.snap.Get()
}

// RequestScan scans now, or right after the current scan if one is running.
// Used after settings change, so the new settings always get a scan of their own.
func (ix *Indexer) RequestScan() {
	if !ix.StartScan() {
		ix.again.Store(true)
	}
}

// StartScan begins a scan in the background. It returns false, and does
// nothing, if a scan is already running.
func (ix *Indexer) StartScan() bool {
	if !ix.scanning.CompareAndSwap(false, true) {
		return false
	}
	go func() {
		defer ix.scanning.Store(false) // also covers a panic

		cfg := ix.Config()
		logs.Infof("scan", "started (%d folders)", len(cfg.enabledRoots()))
		start := time.Now()
		entries, skipped := Crawl(cfg)
		ix.snap.Set(entries, time.Now())

		// The new data is in place: phones waiting for a rescan may continue.
		ix.scanning.Store(false)

		res := summarize(entries, skipped, time.Since(start))
		logs.Infof("scan", "finished: %d items (%d files, %d folders) in %s", res.Entries, res.Files, res.Folders, res.Duration.Round(time.Millisecond))
		if res.Skipped > 0 {
			logs.Warnf("scan", "%d paths couldn't be read (usually missing permissions)", res.Skipped)
		}
		if ix.OnScan != nil {
			ix.OnScan(res)
		}
		if ix.again.CompareAndSwap(true, false) {
			ix.StartScan()
		}
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