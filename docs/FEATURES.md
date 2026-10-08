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
- [x] `GET /api/v1/roots` shares each root's location on the PC (label, absolute path) and the PC's path separator
- [x] `POST /api/v1/reindex` (202 started / 409 already scanning)
- [x] Bearer-token auth (constant-time compare)
- [x] LAN-only guard (rejects non-private source addresses with 403)
- [x] Pairing QR code and manual-entry fallback printed in the terminal on startup
- [x] LAN IP auto-detection (default-route interface, virtual interfaces skipped) and `-host` override
- [x] `-dump` debug flag (prints the index as NDJSON and exits)
- [x] Graceful shutdown on Ctrl+C
- [x] mDNS advertising of `_fs-sync._tcp` (device id and name only, never the token), limited to the LAN interface; `-no-mdns` flag
- [x] `/index` is gzip-compressed for clients that ask for it, and each sync is logged with entries, encoding, bytes sent and duration

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

## Post-MVP roadmap

Work top to bottom: each milestone builds on the one before it. Effort: S = under 2 hours, M = about half a day, L = a day or more. Items marked (new) were added when this roadmap was reordered.

### Milestone 1: Release-ready
Goal: anyone can download, install and trust a first public version.
- [ ] Decide the final project name and rename everything before publishing (S) (deferred: the working name is fine until publishing)
- [x] LICENSE (MIT) and SECURITY.md (S)
- [ ] README screenshots or a short GIF (S) (after Milestone 3)
- [x] Agent keeps its config in the OS config folder by default (`-config` still overrides) (S) (new)
- [x] Agent `-version` flag, with the version injected at build time (S) (new)
- [x] Agent `-pair` flag to reprint the pairing QR and token, and `-rotate-token` to generate a new token (S) (new)
- [x] Rate-limit failed auth attempts (S)
- [x] Sensitive-name ignores on by default (S) (new)
- [x] Compatibility check: the app warns if the agent's API version isn't supported (S) (new)
- [x] Go tests and CI on Linux, Windows and macOS, plus a cross-build of every release target (M) (new)
- [x] Windows: real-machine test (agent starts, QR shows, scan works) (new)
- [ ] macOS: real-machine test (tester requested) (new)
- [x] Release pipeline: GoReleaser + GitHub Actions publish agent binaries with checksums on every version tag; `v0.1.0-rc1` dry run published (M)
- [x] Attach the Android APK to each GitHub Release (S)

### Milestone 2: Quick wins
Small features that fit the project's core job of finding your files from your phone.
- [x] OS-aware default folders (Linux XDG user dirs, macOS standard folders, Windows known folders), with hidden and system folders ignored by default (M)
- [x] Recent files view (S)
- [x] Copy a file's path or name from the file details (S) (new)
- [x] Pinned folders for quick access (S) (new)
- [x] Auto-sync on app open when the PC is reachable and the index is stale (S) (new)
- [x] Home summary: entries and total size per root (S) (new)
- [x] File-type icons (images, audio, video, documents, archives, code) (S)
- [x] Filters (extension, size, date) and sort options (M)
- [x] Search by folder path as well as file name (needs a `path_lc` column and a migration) (S)
- [x] Configurable allowed networks (for example Tailscale's 100.64.0.0/10) so the app works away from home over a VPN (S) (new)
- [x] gzip for `/index`, only if the smoke-test payload sizes justify it (S)
- [x] Copy the full PC path of a file (the agent shares each root's location) (S) (new)

### Milestone 3: Look and feel
- [ ] General UI/UX optimization for the mobile client (visual design pass, typography and spacing, loading/empty/error states, dark mode, animations, accessibility) (L)
- [ ] General UI/UX optimization for the agent (clearer terminal output and startup banner, friendlier errors, config helpers) (M)
- [ ] Demo mode with a bundled sample index, so people (and store reviewers) can try the app without an agent (M) (new)

### Milestone 4: Agent management
- [ ] Local web UI served by the agent (loopback only): status, roots, pairing QR page, rescan (L)
- [ ] Add, remove and disable roots and edit ignore rules at runtime, with a folder picker (config written back, then rescan) (M)
- [ ] Explicit opt-in for whole-home or whole-drive indexing, with hard exclusions (`/proc`, `/sys`, `/dev`, `/run`, OS system folders) (S). Measured: the agent uses about 0.5 KB of memory per entry at peak (316k entries = 168 MB), so reduce per-entry memory first (share string memory between Path, Parent and Name, or keep the index in SQLite) before allowing millions of entries
- [ ] gitignore-style `.ignore` file support (M)
- [ ] Run in the background and start on login (systemd user unit, Windows startup entry or service, launchd) (M)
- [ ] System tray icon that opens the web UI (M; may need per-OS build runners)

### Milestone 5: Security hardening
Must be finished before any feature that serves file contents.
- [ ] Per-device tokens via a one-time pairing code, `devices.json` on the agent, revoke a single phone (M)
- [ ] Short-lived pairing codes so the QR stops being a permanent secret (S)
- [ ] TLS with a self-signed cert; certificate fingerprint carried in the QR and pinned by the phone (M to L)

### Milestone 6: Files
- [ ] `GET /api/v1/download` with path-traversal hardening and range requests (M)
- [ ] Open, preview and share files from the phone (M)
- [ ] Upload from phone into a single configured drop folder on the PC (M, needs Milestone 5)

### Milestone 7: Scale and reach
- [ ] Manage multiple PCs from one app: pair several agents, switch between them, browse or search per PC or across all (L)
- [ ] Phone as an additional source: index and search folders chosen on the phone, Android first (L, builds on multi-PC)
- [ ] Delta sync, file watcher for live updates, resumable sync (L, driven by real numbers)
- [ ] Real fuzzy search (FTS5 trigram) with ranking (M)

### Milestone 8: Publishing
- [ ] Linux packages (`.deb`, `.rpm`), Homebrew tap, Scoop and winget manifests (M)
- [ ] Code signing: Windows signing, macOS Developer ID and notarization (M, needs accounts)
- [ ] Google Play release: privacy policy, data safety form, closed testing (M)
- [ ] App Store release: Local Network justification, reviewer notes, demo mode (M, needs Apple Developer account)
- [ ] OTA updates for JS-only fixes via EAS Update (S, optional)
- [ ] Localization and accessibility pass (M)
- [ ] Third-party license notices generated by tooling (agent and app) (S) (new)

### Why this order
- **Release-ready comes first** because a few things are painful to retrofit once people use the app: where the config lives, the version number, and the project name.
- **TLS comes before downloads.** In my earlier order I put downloads first, and I'm changing that. File names are sensitive, but file contents are more so, and plain HTTP on a shared Wi-Fi exposes them.
- **Look and feel comes before the stores,** but after the quick wins, so the polish pass covers the final feature set.
- **Delta sync and the file watcher wait for real numbers.** If the smoke test shows your index syncs in seconds, they may never be worth building.

## Changelog

- 2026-10-05: Phases 1 and 2 complete. Pairing QR display added to the agent (not in the original plan).
- 2026-10-05: Phases 3 to 7 complete. mDNS advertising and discovery, auto-reconnect, Lucide icons.
- 2026-10-05: Post-MVP roadmap reordered into milestones.
- 2026-10-05: Milestone 1 batch: config in the OS config folder, `-version`, `-pair`, `-rotate-token`, auth rate-limiting, sensitive-name ignores, API compatibility check, tests and CI, release pipeline. Relicensed to AGPL-3.0-or-later.
- 2026-10-07: Milestone 1 complete apart from the macOS test: CI green on all systems, `v0.1.0-rc1` published with the APK.
- 2026-10-07: Milestone 2, batch A: OS-aware default folders and ignores, hidden files skipped by default (`include_hidden`), `allowed_networks` for VPN use.
- 2026-10-07: Milestone 2, batch B: Browse tabs (Browse, Recent, Pinned), copy path/name, pinned folders, auto-sync on open, per-folder summary on Home, file-type icons. Fixed the breadcrumbs being cropped on long lists.
- 2026-10-08: Milestone 2 complete: filters, sort and search scope (names or names and folders) in the app; gzip for `/index`; database schema version 3.
- 2026-10-08: Milestone 2 complete: `GET /roots`, full PC paths in a new file details sheet, "Copy PC path" for files and folders. Scale test: 316k entries index in 21 s, about 168 MB; gzip makes the 64.5 MB index 4.6 MB.