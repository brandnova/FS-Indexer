# API Contract (v1)

Base URL: `http://<pc-ip>:<port>/api/v1` (default port `8080`)

## Authentication

Every request must include:

```
Authorization: Bearer <token>
```

The token lives in the agent's `config.json`. A missing or wrong token returns:

```
401 {"error": "unauthorized"}
```

## Path rules

- Always forward slashes, never a leading slash.
- The first segment is the **root label** from `config.json` (e.g. `Documents`).
- A root itself is an entry with `parent: ""`.

## Pairing (QR payload)

On startup the agent prints a QR code encoding this JSON. The app scans it, stores it, and uses it for all later requests. Manual entry (host, port, token) is the fallback.

```json
{"v":1,"host":"192.168.1.23","port":8080,"token":"<token>","id":"<device_id>","name":"My PC"}
```

## Other responses

- `403 {"error":"forbidden"}`: the request came from a non-LAN address (only private, loopback and link-local sources are served).
- Right after agent start, `indexed_at` is `0` until the first scan finishes. Clients should check `ping` and retry shortly instead of syncing an empty index.

## GET /ping

Health check, device identity, and index status.

```json
{
  "device_id": "a1b2c3d4e5f60718",
  "name": "My PC",
  "version": "0.1.0",
  "indexed_at": 1759660000,
  "file_count": 48213,
  "scanning": false
}
```

- `indexed_at`: Unix seconds of the last completed scan (`0` if none yet).
- `file_count`: number of entries (files and folders) in the snapshot.
- `scanning`: `true` while a scan is running.

## GET /index

Streams the full snapshot as NDJSON (`Content-Type: application/x-ndjson`), one entry per line. The `X-File-Count` response header holds the total number of lines, so the client can show progress.

```
{"path":"Documents","parent":"","name":"Documents","ext":"","size":0,"mtime":1759660000,"is_dir":true}
{"path":"Documents/cv","parent":"Documents","name":"cv","ext":"","size":0,"mtime":1759660000,"is_dir":true}
{"path":"Documents/cv/resume.pdf","parent":"Documents/cv","name":"resume.pdf","ext":"pdf","size":48213,"mtime":1759660000,"is_dir":false}
```

| Field | Type | Notes |
| --- | --- | --- |
| `path` | string | Unique, includes root label |
| `parent` | string | `""` for roots |
| `name` | string | Base name |
| `ext` | string | Lowercase, no dot; `""` for folders |
| `size` | int | Bytes; `0` for folders |
| `mtime` | int | Unix seconds |
| `is_dir` | bool | |

If a scan is running, this serves the previous completed snapshot.

**Compression.** If the request has `Accept-Encoding: gzip`, the body is gzip-compressed and the response carries `Content-Encoding: gzip`. Phones and `curl --compressed` ask for it automatically; other clients get plain NDJSON. `X-File-Count` is the number of entries either way.

## POST /reindex

Triggers a rescan in the background.

```
202 {"status": "started"}
409 {"status": "already_scanning"}
```

Poll `GET /ping` until `scanning` is `false` and `indexed_at` has changed.

## Versioning

Breaking changes bump the URL prefix (`/api/v2`). Adding fields to entries is not breaking, so clients must ignore unknown fields.

## GET /roots

Where each indexed folder lives on the PC, so a client can show real paths. Added after v0.1: older agents return 404, so clients must treat it as optional.

```json
{
  "sep": "/",
  "roots": [
    { "label": "Documents", "path": "/home/me/Documents" }
  ]
}
```

- `label` is the first segment of every path under that root in the index.
- `path` is the absolute folder on the PC.
- `sep` is the PC's path separator (`/` or `\`). To build a full path, join `path`, `sep`, and the rest of the index path with `/` replaced by `sep`.

### Pairing: `POST /api/v1/pair` (no Authorization header)

Trades a one-time pairing code (shown by the agent: in the terminal, in the QR code and in the dashboard) for this phone's own key.

Request: `{"code": "ABCDE-FGHJK", "device_name": "Pixel 8"}` (the code is not case sensitive; spaces and dashes are ignored)

Answers:
- `200 {"token": "<64 hex>", "phone_id": "...", "pc_id": "...", "pc_name": "..."}` - use the token as `Authorization: Bearer <token>` from now on
- `401 {"error": "invalid_code"}` - wrong, used or expired code (a code works once and lasts 10 minutes)
- `404 {"error": "pairing_unavailable"}` - this agent has no pairing codes
- `409` - too many phones are paired (20)
- `429` - too many wrong attempts; see `Retry-After`

The QR code carries `{"v":2,"host","port","code","id","name"}`. Agents before this change carried `{"v":1,"host","port","token","id","name"}`, which the app still understands.

### Keys

Every request except `/pair` needs `Authorization: Bearer <key>`. A key is either a phone's own key (from `/pair`) or, unless switched off in the dashboard (`disable_legacy_token`), the old shared token. The agent stores only a SHA-256 hash of each phone's key, in `devices.json`. Wrong keys and wrong codes count together toward the lockout (10 per minute per address).

### `GET /api/v1/download?path=<file path>`

Sends one file. `path` is the path as it appears in the file list (for example `Documents/cv/me.pdf`). Needs a key, like every request except `/pair`.

- Supports `Range` requests (`206 Partial Content`) and `HEAD`.
- `Content-Disposition: attachment` with the file name (RFC 5987), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- `403 {"error":"downloads_off"}`: the person hasn't allowed file access on the PC (the default). The ping answer says `"file_access": true|false`.
- `404 {"error":"not_found"}`: no such listed file. The same answer is given for files that exist but aren't shared (skipped by a rule, in a folder that is switched off, links, anything unusual), so the answer reveals nothing.
- `403 {"error":"unreadable"}`: the agent isn't allowed to read it.
- `503 {"error":"busy"}` + `Retry-After`: four files are already being sent.

The ping answer has a new field, `file_access` (boolean). The API version is unchanged (1).

### `POST /api/v1/upload`

Sends one file into the drop folder on the PC. The request body is the file itself (raw bytes); `X-File-Name` carries its name, percent-encoded. Only a phone paired with a code may use it (not the old shared token).

Answers:
- `201 {"name": "<saved as>", "size": <bytes>}`. A name that is taken becomes `name (1).ext`; nothing is ever overwritten.
- `403 uploads_off`: the person hasn't switched it on (the default). `403 pair_again`: this phone uses the old shared token.
- `413 too_large`: over the PC's limit (the ping answer has `upload_max_mb`). `415 program_file`: `.exe`, `.sh` and similar are refused unless the person allowed them.
- `429 upload_limit` + `Retry-After`: the hourly limit for all phones together. `503 busy` (two at once) or `503 drop_folder_unavailable`. `507 disk_full`.

The ping answer has two new fields, `uploads` (boolean) and `upload_max_mb`. The API version is unchanged (1).