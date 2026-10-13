package main

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

// downloadSlots limits how many files are being sent at once. Tests replace it.
var downloadSlots = make(chan struct{}, 4)

var errNotShared = errors.New("not a shared file")

// resolveSharedFile turns the path a phone knows ("Documents/cv/me.pdf") into a real file on
// this computer, but only if the agent would list that file right now. That means:
//   - the path is spelled exactly like an entry of the file list (so "..", absolute paths and
//     anything unusual can't match);
//   - the folder it is in is switched on, and no rule skips it (rules may have changed since the scan);
//   - after following any links, it is still inside its shared folder, and it is a plain file.
func resolveSharedFile(cfg *Config, entries []Entry, indexPath string) (string, error) {
	if indexPath == "" || len(indexPath) > 4096 || strings.ContainsRune(indexPath, 0) || strings.Contains(indexPath, `\`) {
		return "", errNotShared
	}
	if runtime.GOOS == "windows" && strings.Contains(indexPath, ":") {
		return "", errNotShared // drive letters and alternate data streams
	}
	segments := strings.Split(indexPath, "/")
	if len(segments) < 2 {
		return "", errNotShared
	}
	for _, s := range segments {
		if s == "" || s == "." || s == ".." {
			return "", errNotShared
		}
	}

	found := false
	for i := range entries {
		if entries[i].Path == indexPath {
			found = !entries[i].IsDir
			break
		}
	}
	if !found {
		return "", errNotShared
	}

	if !explainPath(cfg, indexPath).Shared {
		return "", errNotShared
	}
	root, rel, ok := locate(cfg, indexPath)
	if !ok || rel == "" {
		return "", errNotShared
	}

	real, err := filepath.EvalSymlinks(filepath.Join(root.Path, filepath.FromSlash(rel)))
	if err != nil || !pathInside(real, resolvedPath(root.Path)) {
		return "", errNotShared // gone, or a link now leads out of the folder
	}
	return real, nil
}

// downloadHandler sends one shared file, with support for ranges (resuming and previews).
func downloadHandler(ix *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := ix.Config()
		if !cfg.AllowFileAccess {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "downloads_off"})
			return
		}

		select {
		case downloadSlots <- struct{}{}:
			defer func() { <-downloadSlots }()
		default:
			w.Header().Set("Retry-After", "2")
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "busy"})
			return
		}

		indexPath := r.URL.Query().Get("path")
		entries, _ := ix.Snapshot()
		real, err := resolveSharedFile(cfg, entries, indexPath)
		if err != nil {
			for _, s := range strings.Split(indexPath, "/") {
				if s == ".." {
					logs.Warnf("security", "%s asked for a path with \"..\" in it: %q", phoneLabel(r), indexPath)
					break
				}
			}
			logs.Debugf("phone", "%s asked for %q, which isn't shared", phoneLabel(r), indexPath)
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}

		f, err := os.Open(real)
		if err != nil {
			status, code := http.StatusNotFound, "not_found"
			if errors.Is(err, fs.ErrPermission) {
				status, code = http.StatusForbidden, "unreadable"
			}
			writeJSON(w, status, map[string]string{"error": code})
			return
		}
		defer f.Close()

		st, err := f.Stat() // checked again on the open file, so nothing can be swapped in between
		if err != nil || !st.Mode().IsRegular() {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}

		name := path.Base(indexPath)
		ctype := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		h := w.Header()
		h.Set("Content-Type", ctype)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "no-store")
		h.Set("Content-Disposition", contentDisposition(name))

		// A file fetched in many pieces is one event: log it when its first piece is asked for.
		if rng := r.Header.Get("Range"); rng == "" || strings.HasPrefix(rng, "bytes=0-") {
			logs.Infof("phone", "%s opened %q (%s)", phoneLabel(r), indexPath, humanBytes(st.Size()))
			activity("%s opened %s (%s)", phoneLabel(r), indexPath, humanBytes(st.Size()))
		}
		http.ServeContent(w, r, name, st.ModTime(), f) // handles Range, HEAD and If-Modified-Since
	}
}

// contentDisposition names the download. It carries a plain fallback name and the real one (RFC 5987).
func contentDisposition(name string) string {
	ascii := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	return `attachment; filename="` + ascii + `"; filename*=UTF-8''` + url.PathEscape(name)
}