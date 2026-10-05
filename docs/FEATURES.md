# Features & Roadmap

Living document. Update it whenever a feature is added, changed, or moved between lists.
`[x]` = shipped and tested · `[ ]` = not done yet.

## MVP progress

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Agent core: config, crawler, snapshot | Done |
| 2 | Agent API: ping, streaming index, auth, reindex, pairing QR | Done |
| 3 | Mobile foundation: Expo app, SQLite, pairing screen | Done |
| 4 | Sync engine | Done |
| 5 | Browse and search | Done |
| 6 | mDNS discovery | Done |
| 7 | Smoke test on real directories | Done |

## Agent (Go): shipped

- [x] `config.json` auto-created on first run (generated `device_id` and `token`, defaults to `~/Documents`)
- [x] Multiple roots, each with a label used as the path prefix; `~` expansion; roots resolved to real paths
- [x] Fast `WalkDir` crawl: path, parent, name, ext, size, mtime, is_dir
- [x] Default ignores (`node_modules`, `.git`, `__pycache__`, `.venv`, `venv`, `$RECYCLE.BIN`, ...) plus `extra_ignores` globs
- [x] Symlinks never followed or indexed
- [x] In-memory snapshot; startup scan runs in the background
- [x] `GET /api/v1/ping` (includes `scanning` flag)
- [x] `GET /api/v1/index` streamed as NDJSON, with `X-File-Count` header
- [x] `POST /api/v1/reindex` (202 started / 409 already scanning)
- [x] Bearer-token auth (constant-time compare)
- [x] LAN-only guard (rejects non-private source addresses with 403)
- [x] Pairing QR code and manual-entry fallback printed in the terminal on startup
- [x] LAN IP auto-detection (default-route interface, virtual interfaces skipped) and `-host` override
- [x] `-dump` debug flag (prints the index as NDJSON and exits)
- [x] Graceful shutdown on Ctrl+C
- [x] mDNS advertising of `_fs-sync._tcp` (device id and name only, never the token), limited to the LAN interface; `-no-mdns` flag

## Mobile (Expo): shipped

- [x] Pairing by QR scan or manual address + token; token kept in the secure keystore
- [x] Nearby-PC list via mDNS; pairing a listed PC requires scanning its QR code (dev build only)
- [x] Auto-reconnect: finds a paired PC by device id after its IP changes (dev build only)
- [x] SQLite schema with migrations; OS-specific code isolated in `src/platform/`
- [x] Streamed NDJSON sync with batched inserts, stale-row cleanup, progress, last-synced time
- [x] "Rescan PC & sync" button
- [x] Folder browser with breadcrumbs; Android back button navigates up
- [x] Offline multi-word substring search
- [x] Lucide icon set

## Post-MVP checklist

### UI/UX
- [ ] General UI/UX optimization for the mobile client (visual design pass, typography and spacing, loading/empty/error states, file-type icons, dark mode, animations, accessibility)
- [ ] General UI/UX optimization for the agent (clearer terminal output and startup banner, friendlier errors, config helpers)

### Security and pairing
- [ ] Localhost pairing page (`/pair`, loopback only, shows the QR in a browser) (about 30 to 45 min)
- [ ] Per-device tokens via a one-time pairing code, `devices.json` on the agent, revoke a single phone (about 2 to 3 hrs)
- [ ] Short-lived QR codes so the QR is no longer a permanent secret
- [ ] TLS with a self-signed cert; certificate fingerprint carried in the QR and pinned by the phone
- [ ] Rate-limit failed auth attempts

### Discovery
- [ ] Multiple paired PCs

### Sync and performance
- [ ] Delta sync (subtree hashes, fetch only what changed)
- [ ] gzip for `/index`
- [ ] File watcher for live index updates
- [ ] Resume an interrupted sync

### Browse and search
- [ ] Real fuzzy search (FTS5 trigram) with ranking
- [ ] Search by folder path as well as file name
- [ ] Filters (extension, size, date) and sort options
- [ ] Recent files view

### Files
- [ ] `GET /api/v1/download` with path-traversal hardening
- [ ] Open, preview and share files from the phone

### Multiple PCs
- [ ] Manage multiple PCs from one app: pair several agents, switch between them, and browse or search per PC or across all of them

### Platform and distribution
- [ ] Development build / standalone APK; iOS build
- [ ] Agent as a system service (systemd unit / Windows service) and tray icon
- [ ] gitignore-style `.ignore` file support

### Agent configuration
- [ ] OS-aware default folders (Linux XDG user dirs, macOS standard folders, Windows known folders), with hidden and system folders ignored by default
- [ ] Explicit opt-in for whole-home or whole-drive indexing, with hard exclusions (`/proc`, `/sys`, `/dev`, `/run`, OS system folders)
- [ ] Add, remove and disable roots and edit ignore rules at runtime (config written back, then rescan)
- [ ] Local web UI served by the agent (loopback only): status, roots, pairing QR, rescan
- [ ] System tray icon that opens the web UI

### Transfer and sources
- [ ] Upload from phone into a single configured drop folder on the PC
- [ ] Phone as an additional source: index and search folders chosen on the phone (Android first)

## Changelog

- 2026-10-05: Phases 1 and 2 complete. Pairing QR display added to the agent (not in the original plan).
- 2026-10-05: Phases 3 to 7 complete. mDNS advertising and discovery, auto-reconnect, Lucide icons.