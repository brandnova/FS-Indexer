# Local FS Indexer & Remote Browser

A lightweight, offline-first file system indexer and mobile browser. A background agent on your PC crawls selected folders, builds an index of file metadata, and serves it over your local Wi-Fi. A mobile app syncs that index into a local SQLite database, so you can browse and search your PC's files from your phone, including when you're away from home.

> **Away from home:** syncing needs both devices on the same network. Away from home, you browse and search the **last synced snapshot**. The app shows a "last synced" timestamp so you can tell how fresh the data is.

## Tech Stack

| Component | Technology | Why |
| --- | --- | --- |
| PC Agent | Go | Fast `filepath.WalkDir` crawling, tiny memory footprint, single binary |
| Mobile App | React Native (Expo, TypeScript) | Cross-platform, fast UI iteration |
| Mobile DB | SQLite (`expo-sqlite`) | Sub-millisecond offline search over 100k+ paths |
| Discovery (stretch) | mDNS / Zeroconf | Auto-discover the PC on Wi-Fi |

## How it works

1. The agent reads `config.json`, crawls the configured roots (skipping ignored folders), and keeps a **flat in-memory snapshot** of entries.
2. The phone pairs with the agent (manual IP:port + token, or a QR code printed in the agent's terminal).
3. The phone streams `GET /api/v1/index` (NDJSON) and upserts each line into SQLite in batched transactions. Rows that were not seen during the sync are deleted, so files removed on the PC disappear from the phone.
4. The phone builds the folder view from each row's `parent` column and runs search locally.

See [`docs/API.md`](docs/API.md) for the full API contract.

## MVP Features

### PC Agent
- Configurable roots via `config.json` (each root gets a label used as the path prefix)
- Metadata crawl: path, parent, name, extension, size, mtime, is_dir
- Default ignores: `node_modules`, `.git`, `__pycache__`, `.venv`, `venv`, `$RECYCLE.BIN`, `System Volume Information` and others, plus your own `extra_ignores`
- Symlinks are not followed
- REST API: `GET /api/v1/ping`, `GET /api/v1/index` (streamed NDJSON), `POST /api/v1/reindex`
- Bearer token auth (auto-generated on first run)
- Terminal output of the agent's address and a pairing QR code

### Mobile App
- Pairing screen (manual IP:port + token, or QR scan)
- Sync engine: streamed NDJSON, batched inserts, stale-row cleanup, progress and last-synced display
- Folder browser with breadcrumbs
- Offline substring search (tokenized, case-insensitive)
- Runs on Android and iOS; OS-specific code is isolated in `src/platform/`

## Design Decisions

- **Flat NDJSON, not a nested tree.** Memory stays flat on both ends at 200k+ files; the phone derives the tree from `parent`.
- **Root labels.** Every path starts with its root's label (`Documents/cv/resume.pdf`). Always forward slashes, so Windows and Linux agents look identical to the phone.
- **Folders are entries** (`is_dir: true`), so empty folders show up.
- **Bearer token from day one.** Anyone on the same Wi-Fi could otherwise read your file list.
- **Manual pairing first, mDNS last.** mDNS needs native modules and platform permissions, so it must not block the MVP.
- **Substring search for now.** Real fuzzy matching (FTS5 trigram or scoring) comes after the MVP.
- **No file watcher yet.** The agent rescans on startup and on `POST /api/v1/reindex`.

## Project Structure

```
fs-indexer/
├── README.md
├── docs/API.md
├── agent/          # Go daemon
└── mobile/         # Expo app
```

## Quick Start

### 1. Run the agent (PC)

```bash
cd agent
go run .
```

The first run creates `config.json`. Edit `roots` to choose your folders, then restart. The terminal prints a pairing QR code plus the address and token.

### 2. Run the app (phone)

The app needs a **development build** (Expo Go can't load its native modules). Build one once:

```bash
cd mobile
npm install
npx eas-cli@latest build --profile development --platform android
```

Install the APK, then start the dev server and open the app:

```bash
npx expo start
```

Tap **Scan QR code**, scan the code from the agent's terminal, then tap **Sync now** and **Browse files**.

### Security notes

Traffic is plain HTTP on your local network, protected by a shared token, and the agent refuses non-LAN clients. Don't expose the port to the internet. Anyone who has the token can read your file listing. See `docs/FEATURES.md` for the planned hardening (per-device tokens, TLS).

## Agent Configuration

The agent keeps `config.json` in your OS config folder (`~/.config/fs-indexer/` on Linux, `%AppData%\fs-indexer\` on Windows, `~/Library/Application Support/fs-indexer/` on macOS). It's created on first run, and `-config <path>` overrides the location.

With no `roots` configured, the agent indexes your standard folders that exist (Documents, Downloads, Desktop, Pictures, Music, and Videos or Movies), using the locations your OS reports, and writes them into the file so you can edit them.

```json
{
  "device_id": "auto-generated",
  "device_name": "My PC",
  "port": 8080,
  "token": "auto-generated",
  "roots": [
    { "path": "~/Documents", "label": "Documents" },
    { "path": "D:/Projects" }
  ],
  "extra_ignores": ["*.tmp", "dist"],
  "include_hidden": false,
  "allowed_networks": []
}
```

| Setting | Meaning |
| --- | --- |
| `roots` | Folders to index. `label` is optional and defaults to the folder name. Use forward slashes on Windows (`D:/Projects`) |
| `extra_ignores` | Extra file or folder names (wildcards allowed) to skip |
| `include_hidden` | `false` (default) skips names starting with `.`; set `true` to include them |
| `allowed_networks` | Extra networks allowed to connect, in CIDR notation, e.g. `["100.64.0.0/10"]` for Tailscale. Very broad ranges are rejected |

## Build Phases

| Phase | Scope |
| --- | --- |
| 1 | Agent core: config, crawler, snapshot |
| 2 | Agent API: ping, streaming index, auth, reindex, QR |
| 3 | Mobile foundation: Expo dev build, SQLite, pairing screen |
| 4 | Sync engine |
| 5 | Browse and search |
| 6 | (Stretch) mDNS discovery |
| 7 | Smoke test on real directories |

## Features & Roadmap

See [`docs/FEATURES.md`](docs/FEATURES.md) for what's shipped, MVP progress by phase, and the post-MVP checklist.

## License, security and privacy

- License: [MIT](LICENSE)
- Security policy and known limitations: [SECURITY.md](SECURITY.md)
- Privacy policy: [docs/PRIVACY.md](docs/PRIVACY.md)
