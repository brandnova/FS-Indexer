package main

import (
	"bufio"
	"compress/gzip"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// version is set at build time: go build -ldflags "-X main.version=1.2.3"
var version = "dev"

// apiVersion is the REST API generation. Bump it only for breaking changes:
// the mobile app refuses agents whose API version it doesn't support.
const apiVersion = 1

// activity reports something worth telling the user, such as a phone updating
// its file list. The console replaces this; the default is the standard log.
var activity = func(format string, args ...any) { log.Printf(format, args...) }

func NewServer(cfg *Config, ix *Indexer) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/ping", pingHandler(cfg, ix))
	mux.HandleFunc("GET /api/v1/index", indexHandler(ix))
	mux.HandleFunc("GET /api/v1/roots", rootsHandler(cfg))
	mux.HandleFunc("POST /api/v1/reindex", reindexHandler(ix))

	// 10 failed attempts within a minute locks that address out for a minute.
	lim := newLimiter(10, time.Minute, time.Minute)

	return &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           lanOnly(auth(cfg.Token, lim, mux), cfg.allowedNets...),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		// No WriteTimeout on purpose: /index streams and can take a while.
	}
}

// ---------- handlers ----------

func pingHandler(cfg *Config, ix *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, at := ix.Snapshot()
		var indexedAt int64
		if !at.IsZero() {
			indexedAt = at.Unix()
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"device_id":   cfg.DeviceID,
			"name":        cfg.DeviceName,
			"version":     version,
			"api_version": apiVersion,
			"indexed_at":  indexedAt,
			"file_count":  len(entries),
			"scanning":    ix.Scanning(),
		})
	}
}

// indexHandler streams the snapshot as NDJSON, gzip-compressed when the
// client asks for it (phones do automatically).
func indexHandler(ix *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		entries, _ := ix.Snapshot()

		h := w.Header()
		h.Set("Content-Type", "application/x-ndjson")
		h.Set("X-File-Count", strconv.Itoa(len(entries)))
		h.Set("Cache-Control", "no-store")
		h.Add("Vary", "Accept-Encoding")

		// Counts the bytes that really go over the network (after compression).
		sent := &countingWriter{w: w}
		var out io.Writer = sent
		var gz *gzip.Writer
		encoding := "plain"

		if acceptsGzip(r) {
			if zw, err := gzip.NewWriterLevel(sent, gzip.BestSpeed); err == nil {
				gz = zw
				h.Set("Content-Encoding", "gzip")
				out = zw
				encoding = "gzip"
			}
		}

		bw := bufio.NewWriterSize(out, 64*1024)
		enc := json.NewEncoder(bw)
		enc.SetEscapeHTML(false)

		for i := range entries {
			// Stop early if the phone disconnected.
			if i%1000 == 0 && r.Context().Err() != nil {
				return
			}
			if err := enc.Encode(&entries[i]); err != nil {
				return
			}
		}
		_ = bw.Flush()
		if gz != nil {
			_ = gz.Close() // writes the final compressed block
		}

		activity("%s copied the file list: %d items, %s sent (%s) in %s",
			clientIP(r), len(entries), humanBytes(sent.n), encoding, time.Since(start).Round(time.Millisecond))
	}
}

// rootsHandler tells the phone where each indexed folder lives on this PC, so
// it can show real paths. Roots were resolved to absolute paths at startup.
func rootsHandler(cfg *Config) http.HandlerFunc {
	type rootInfo struct {
		Label string `json:"label"`
		Path  string `json:"path"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		roots := make([]rootInfo, 0, len(cfg.Roots))
		for _, root := range cfg.Roots {
			roots = append(roots, rootInfo{Label: root.Label, Path: root.Path})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"sep":   string(filepath.Separator),
			"roots": roots,
		})
	}
}

func reindexHandler(ix *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ix.StartScan() {
			writeJSON(w, http.StatusAccepted, map[string]string{"status": "started"})
			return
		}
		writeJSON(w, http.StatusConflict, map[string]string{"status": "already_scanning"})
	}
}

// ---------- middleware ----------

// lanOnly rejects any request that doesn't come from a private, loopback or
// link-local address, or from one of the extra networks the user allowed
// (e.g. a VPN range). It's a cheap safety net in case the port is ever
// exposed to the internet, not a replacement for a firewall.
func lanOnly(next http.Handler, extra ...*net.IPNet) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if err != nil || ip == nil || !(isLocalAddress(ip) || inAnyNetwork(ip, extra)) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLocalAddress(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func inAnyNetwork(ip net.IP, nets []*net.IPNet) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// auth checks the bearer token and locks out clients that keep guessing.
func auth(token string, lim *limiter, next http.Handler) http.Handler {
	want := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		now := time.Now()

		if wait, blocked := lim.blocked(ip, now); blocked {
			w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too_many_attempts"})
			return
		}

		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(got), want) != 1 {
			lim.fail(ip, now)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		lim.reset(ip)
		next.ServeHTTP(w, r)
	})
}

// ---------- helpers ----------

func acceptsGzip(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("Accept-Encoding")), "gzip")
}

type countingWriter struct {
	w io.Writer
	n int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}

func humanBytes(n int64) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1f MB", float64(n)/1e6)
	case n >= 1_000:
		return fmt.Sprintf("%.0f KB", float64(n)/1e3)
	}
	return fmt.Sprintf("%d B", n)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}