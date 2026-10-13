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
- [x] README screenshots or a short GIF (S) (after Milestone 3)
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
- [x] Design system: soft solid palette taken from the app icon, Nunito typeface, spacing and type scale (new)
- [x] Bottom navigation (Home, Files, Recent, Pinned, Settings) that keeps each tab's place; Android back button steps out of searches and folders first (new)
- [x] Home dashboard: one clear update card, search, folder tiles, recent files (new)
- [x] Secondary actions live in bottom sheets and menus (filters, file details, folder options) instead of taking screen space (new)
- [x] Settings screen with connection, update options, help, about and Unpair (new)
- [x] Dark mode (Settings, Appearance) (new)
- [x] Cancel button and a time-left estimate for long updates (new)
- [x] First-run walkthrough, shown once (new)
- [x] Demo mode with a bundled sample index, reachable from the walkthrough and the pairing screen (new)
- [x] Accessibility pass: AA contrast, 44 dp touch targets, screen-reader labels, roles and announcements, capped text scaling on fixed-height rows, reduced motion (new)
- [x] Loading placeholders and gentle fade-ins (new)
- [x] "About the agent" screen (what it shares, three-step setup, good to know), reachable from the walkthrough, pairing screen and Settings (new)
- [x] Agent terminal experience: startup banner, scan summary, activity lines, friendly errors with fixes, colour only where supported; `-quiet`, `-no-qr`, `-no-color`, `-verbose` (M)

### Milestone 4: Agent management
- [x] Local web UI, step 1: dashboard and pairing page on a loopback-only listener (Host/Origin checks, session token, QR in the browser) (M)
- [x] Smart double-click: opens the web UI when launched without a terminal, and on first run (M)
- [x] Folders page: add, remove, disable, per-folder options, folder picker; settings reload without a restart (M)
- [x] Ignore-rules editor with a "test a path" box (S)
- [x] Start on login (Windows registry, macOS LaunchAgent, Linux autostart or systemd user unit) (M)
- [x] Launchers per OS: Windows shortcut/installer, macOS .app, Linux .desktop entry and icon (M)
- [x] Troubleshooter: `fsagent doctor` and a web page (M)
- [x] Dashboard redesign: sidebar app, getting-started checklist, dialogs, toasts, logo from `static/images/` (M) (new)
- [x] Agent log file (timestamped, rotating) with a log viewer, "Report a problem" and `fsagent -report` (M) (new)
- [x] Windows `.exe` icon and version info embedded (S) (new)
- [x] Icons for macOS and Linux through the `.app` bundle and `.desktop` file (part of the launchers item)

### Milestone 5: Security hardening
Must be finished before any feature that serves file contents.
- [x] Per-device tokens via a one-time pairing code, `devices.json` on the agent, revoke a single phone (M)
- [x] Short-lived pairing codes so the QR stops being a permanent secret (S)

### Milestone 6: Files
- [x] `GET /api/v1/download` with path-traversal hardening and range requests (M)
- [x] "Trusted networks only" banners (S)
- [ ] Open, preview and share files from the phone (M)
- [ ] Upload from phone into a single configured drop folder on the PC (M, needs Milestone 5)

## Milestone 7: Brand and monetization

- [x] Brand identity line and About surfaces in the app, the agent dashboard, the terminal banner and the OS metadata (S)
- [ ] Brand-use note in the README: the MIT licence covers the code, not the Brand Nova name or logo (S)
- [ ] Choose the monetization model (a short decision note in docs/) (S)
- [ ] Support links (GitHub Sponsors, Ko-fi or similar) in the README, the agent dashboard and the app About screen (S)
- [ ] Optional: supporter / tip jar purchase in the app (S-M)
- [ ] Optional: a one-time paid unlock for the features that justify it (M-L; fits best after Milestone 6)
- [ ] Store paperwork for payments: pricing, tax and payout setup, purchase disclosures (S)

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

## Ideas for later (not scheduled)

Good ideas that don't block anything. Pull one into a milestone when it becomes the most useful next thing.

- [ ] System tray / menu-bar icon: Open dashboard, Show pairing code, Pause sharing, Quit (macOS needs cgo, GNOME needs an extension)
- [ ] Scheduled rescans ("keep my list fresh every 30 minutes")
- [ ] Pause sharing: one switch that turns phones away until resumed
- [ ] Private-folder marker: any folder containing a `.nosync` file is skipped automatically
- [ ] Disk-usage view (biggest folders and file types) in the dashboard and on the phone
- [ ] Duplicate finder (same name and size candidates)
- [ ] Per-device approval: "Allow Pixel 8?" the first time a phone connects (builds on per-device tokens)
- [ ] Update notifier (opt-in check against GitHub releases)
- [ ] Diagnostics export (version, OS and settings with the token removed) for bug reports
- [ ] Log viewer in the dashboard, with a rolling log file
- [ ] "Open in file manager" link per folder
- [ ] Several PCs in one app (one database per PC, a PC switcher)
- [ ] The phone as an extra source (index its own files into the same search)
- [ ] Faster syncing: delta sync, a file watcher on the agent, resumable transfers (only if real numbers show it's needed)
- [ ] Smarter search: fuzzy matching and SQLite FTS5
- [ ] Remote access through a hosted relay (long term; it would need a subscription to cover server costs, and it changes the "nothing leaves your network" promise)
- [ ] Include the "Check my setup" results in the problem report (S)
- [ ] Encrypt the phone-to-PC connection (a key exchange from the pairing code, then authenticated encryption of requests and the file list) (L)

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
- 2026-10-08: Milestone 3, batch A: new design system, navigation and screens; dark mode; cancellable updates with a time estimate; `scripts/cross-build.sh`.
- 2026-10-09: Milestone 3, batch B: first-run walkthrough, demo mode, accessibility pass (contrast, touch targets, screen-reader support, text scaling, reduced motion), loading placeholders.
- 2026-10-09: Milestone 3 complete: "About the agent" screen; agent startup banner, activity lines and friendly errors; new agent flags.
- 2026-10-10: Milestone 4, slice 1: loopback dashboard with pairing QR, folders and activity; smart double-click and background mode (`-ui`, `-background`, `-stop`); single running agent; errors shown in the browser when there's no terminal.
- 2026-10-11: Milestone 4, slice 2: Folders and Privacy pages with live settings reload, agent log file with viewer and problem reports, redesigned dashboard.
- 2026-10-12: Milestone 4, slice 3: start on login on all three systems, macOS app and Linux packages, "Made by Brand Nova" credit in the agent and app.
- 2026-10-12: Published v0.1.0-rc2 (pre-release) for Windows and macOS testing.
- 2026-10-12: Milestone 4, slice 4: `fsagent -doctor` and the dashboard's "Check my setup" page. Milestone 4 complete.
- 2026-10-12: Milestone 5, slice 1: per-phone keys, one-time pairing codes, paired-phones list.
- 2026-10-13: Milestone 6, slice 1: the agent can send files (off by default), trusted-network banners.