package main

import (
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const version = "0.1.0"

func NewServer(cfg *Config, ix *Indexer) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/ping", pingHandler(cfg, ix))
	mux.HandleFunc("GET /api/v1/index", indexHandler(ix))
	mux.HandleFunc("POST /api/v1/reindex", reindexHandler(ix))

	return &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           lanOnly(auth(cfg.Token, mux)),
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
			"device_id":  cfg.DeviceID,
			"name":       cfg.DeviceName,
			"version":    version,
			"indexed_at": indexedAt,
			"file_count": len(entries),
			"scanning":   ix.Scanning(),
		})
	}
}

func indexHandler(ix *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, _ := ix.Snapshot()

		h := w.Header()
		h.Set("Content-Type", "application/x-ndjson")
		h.Set("X-File-Count", strconv.Itoa(len(entries)))
		h.Set("Cache-Control", "no-store")

		bw := bufio.NewWriterSize(w, 64*1024)
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
// link-local address. It's a cheap safety net in case the port is ever
// exposed to the internet, not a replacement for a firewall.
func lanOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if err != nil || ip == nil || !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func auth(token string, next http.Handler) http.Handler {
	want := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(got), want) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}