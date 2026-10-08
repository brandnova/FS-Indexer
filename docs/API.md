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
