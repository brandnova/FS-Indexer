package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	defaultUploadMaxMB   = 100
	defaultUploadPerHour = 30
	maxUploadMaxMB       = 4096
	maxUploadPerHour     = 1000
	maxNameBytes         = 200 // most file systems allow 255 bytes; room is left for " (12)"
)

// uploadsEnabled: switched on, and a drop folder chosen.
func (c *Config) uploadsEnabled() bool { return c.AllowUploads && c.UploadDir != "" }

func (c *Config) uploadMaxMB() int {
	if c.UploadMaxMB > 0 {
		return c.UploadMaxMB
	}
	return defaultUploadMaxMB
}

func (c *Config) uploadPerHour() int {
	if c.UploadPerHour > 0 {
		return c.UploadPerHour
	}
	return defaultUploadPerHour
}

func (c *Config) uploadMaxBytes() int64 { return int64(c.uploadMaxMB()) << 20 }

// uploadSlots limits how many files are being received at once. Tests replace it.
var uploadSlots = make(chan struct{}, 2)

// ---------- the hourly limit ----------

type uploadCounter struct {
	mu    sync.Mutex
	times []time.Time
}

// uploads counts the files accepted in the last hour, from all phones together. Tests replace it.
var uploads = &uploadCounter{}

func (u *uploadCounter) prune(now time.Time) {
	cut := now.Add(-time.Hour)
	i := 0
	for i < len(u.times) && u.times[i].Before(cut) {
		i++
	}
	u.times = u.times[i:]
}

// Take records one upload if the limit allows it. Otherwise it says how long until one may start.
func (u *uploadCounter) Take(limit int, now time.Time) (bool, time.Duration) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.prune(now)
	if len(u.times) >= limit {
		return false, u.times[len(u.times)-limit].Add(time.Hour).Sub(now)
	}
	u.times = append(u.times, now)
	return true, 0
}

func (u *uploadCounter) Count(now time.Time) int {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.prune(now)
	return len(u.times)
}

// ---------- names ----------

var windowsReserved = func() map[string]bool {
	m := map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true}
	for i := 1; i <= 9; i++ {
		m[fmt.Sprintf("COM%d", i)] = true
		m[fmt.Sprintf("LPT%d", i)] = true
	}
	return m
}()

var programExtensions = map[string]bool{
	".exe": true, ".msi": true, ".bat": true, ".cmd": true, ".com": true, ".scr": true, ".ps1": true,
	".vbs": true, ".vbe": true, ".wsf": true, ".hta": true, ".reg": true, ".lnk": true, ".dll": true,
	".jar": true, ".sh": true, ".command": true, ".desktop": true, ".appimage": true, ".run": true,
	".app": true, ".dmg": true, ".pkg": true,
}

func isProgramFile(name string) bool { return programExtensions[strings.ToLower(filepath.Ext(name))] }

// sanitizeUploadName turns whatever the phone sent into a plain, safe file name. It is stripped
// of any folder part, of characters Windows forbids, of leading dots and trailing dots/spaces, and
// of Windows' reserved device names. The phone sends the name percent-encoded.
func sanitizeUploadName(raw string) string {
	name := raw
	if decoded, err := url.PathUnescape(raw); err == nil {
		name = decoded
	}
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsControl(r):
			return -1
		case strings.ContainsRune(`<>:"|?*`, r):
			return '_'
		}
		return r
	}, name)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")

	dots := 0
	for dots < len(name) && name[dots] == '.' {
		dots++
	}
	name = strings.Repeat("_", dots) + name[dots:]

	if name == "" {
		return "upload"
	}
	if base, _, _ := strings.Cut(name, "."); windowsReserved[strings.ToUpper(base)] {
		name = "_" + name
	}

	if len(name) > maxNameBytes {
		ext := filepath.Ext(name)
		if len(ext) > 20 {
			ext = ""
		}
		stem := strings.TrimSuffix(name, ext)
		for len(stem)+len(ext) > maxNameBytes {
			_, size := utf8.DecodeLastRuneInString(stem)
			stem = stem[:len(stem)-size]
		}
		name = stem + ext
	}
	return name
}

// reserveName creates the final file exclusively, so nothing is ever overwritten, and returns
// its path and name. A taken name becomes "name (1).ext", "name (2).ext", ...
func reserveName(dir, name string) (string, string, error) {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 0; i < 1000; i++ {
		candidate := name
		if i > 0 {
			candidate = fmt.Sprintf("%s (%d)%s", stem, i, ext)
		}
		full := filepath.Join(dir, candidate)
		f, err := os.OpenFile(full, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			f.Close()
			return full, candidate, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", "", err
		}
	}
	return "", "", errors.New("too many files with that name")
}

// ---------- the handler ----------

// uploadHandler receives one file (the request body) from a paired phone and saves it in the drop folder.
func uploadHandler(ix *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := ix.Config()
		if !cfg.uploadsEnabled() {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "uploads_off"})
			return
		}
		// Only a phone paired with a code may send files, not the old shared token.
		if phone, _ := r.Context().Value(phoneKey{}).(string); phone == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "pair_again"})
			return
		}

		limit := cfg.uploadMaxBytes()
		if r.ContentLength > limit {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "too_large"})
			return
		}
		name := sanitizeUploadName(r.Header.Get("X-File-Name"))
		if isProgramFile(name) && !cfg.UploadAllowPrograms {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "program_file"})
			return
		}

		select {
		case uploadSlots <- struct{}{}:
			defer func() { <-uploadSlots }()
		default:
			w.Header().Set("Retry-After", "2")
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "busy"})
			return
		}

		if ok, wait := uploads.Take(cfg.uploadPerHour(), time.Now()); !ok {
			w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			logs.Warnf("phone", "%s reached the upload limit (%d per hour)", phoneLabel(r), cfg.uploadPerHour())
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "upload_limit"})
			return
		}

		// The file is written under a temporary name and only gets its real name once it has fully arrived.
		tmp, err := os.CreateTemp(cfg.UploadDir, ".upload-*.part")
		if err != nil {
			logs.Errorf("phone", "can't write to the drop folder: %v", err)
			status, code := http.StatusInternalServerError, "write_failed"
			if errors.Is(err, fs.ErrNotExist) {
				status, code = http.StatusServiceUnavailable, "drop_folder_unavailable"
			}
			writeJSON(w, status, map[string]string{"error": code})
			return
		}
		tmpPath := tmp.Name()
		done := false
		defer func() {
			if !done {
				tmp.Close()
				os.Remove(tmpPath)
			}
		}()

		rc := http.NewResponseController(w)
		body := http.MaxBytesReader(w, r.Body, limit)
		buf := make([]byte, 64<<10)
		var total int64
		for {
			_ = rc.SetReadDeadline(time.Now().Add(30 * time.Second)) // a stalled phone can't hold a slot forever
			n, rerr := body.Read(buf)
			if n > 0 {
				if _, werr := tmp.Write(buf[:n]); werr != nil {
					status, code := http.StatusInternalServerError, "write_failed"
					if errors.Is(werr, syscall.ENOSPC) {
						status, code = http.StatusInsufficientStorage, "disk_full"
					}
					logs.Errorf("phone", "couldn't save an upload: %v", werr)
					writeJSON(w, status, map[string]string{"error": code})
					return
				}
				total += int64(n)
			}
			if rerr == io.EOF {
				break
			}
			if rerr != nil {
				var tooBig *http.MaxBytesError
				if errors.As(rerr, &tooBig) {
					writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "too_large"})
				} else {
					logs.Warnf("phone", "an upload from %s was interrupted: %v", phoneLabel(r), rerr)
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "interrupted"})
				}
				return
			}
		}
		_ = rc.SetReadDeadline(time.Time{})
		if err := tmp.Close(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "write_failed"})
			return
		}

		finalPath, finalName, err := reserveName(cfg.UploadDir, name)
		if err != nil {
			logs.Errorf("phone", "couldn't name an uploaded file: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "write_failed"})
			return
		}
		if err := os.Rename(tmpPath, finalPath); err != nil {
			_ = os.Remove(finalPath)
			logs.Errorf("phone", "couldn't finish an upload: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "write_failed"})
			return
		}
		done = true
		_ = os.Chmod(finalPath, 0o644)

		logs.Infof("phone", "%s sent %q to the drop folder (%s)", phoneLabel(r), finalName, humanBytes(total))
		activity("%s sent %s (%s)", phoneLabel(r), finalName, humanBytes(total))
		writeJSON(w, http.StatusCreated, map[string]any{"name": finalName, "size": total})
	}
}