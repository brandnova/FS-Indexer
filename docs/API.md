# API reference (version 1)

The agent's phone API is a small HTTP/JSON API served on port **8080** (configurable). The dashboard is a separate, local-only interface and isn't part of this API.

Base URL: `http://<pc-address>:8080/api/v1`

The connection is **not encrypted**. The agent only answers devices on the local network (private, loopback and link-local addresses, plus `allowed_networks`); anything else gets `403`.

## Versioning

`GET /ping` reports `api_version` (currently `1`). Additions (new endpoints, new fields) keep the version. A breaking change raises it, and the app refuses agents outside the range it supports.

## Authentication

Every request except `POST /pair` needs a key:

```
Authorization: Bearer <key>
```

A key is the one a phone receives from `POST /pair`. The old shared token (settings key `token`) is accepted unless `disable_legacy_token` is true. Uploading needs a phone key, never the shared token.

| Status | Meaning |
| --- | --- |
| `401 {"error":"unauthorized"}` | Missing or wrong key |
| `403 {"error":"forbidden"}` | The request doesn't come from an allowed network |
| `429 {"error":"too_many_attempts"}` + `Retry-After` | 10 failed attempts within a minute from one address lock it out for a minute |

## Endpoints

### `GET /ping`

```json
{
  "device_id": "0123456789abcdef", "name": "My PC", "version": "0.1.0", "api_version": 1,
  "indexed_at": 1760000000, "file_count": 2367, "scanning": false,
  "file_access": false, "uploads": false, "upload_max_mb": 100, "upload_folder": ""
}
```

`indexed_at` is Unix seconds (0 before the first scan). `file_access` says whether `/download` works, `uploads` whether `/upload` works. `upload_folder` is the drop folder's name (not its path).

### `GET /index`

Streams the file list as **NDJSON**, one entry per line. The header `X-File-Count` carries the number of entries. Send `Accept-Encoding: gzip` to receive it compressed. Entries:

```json
{"path":"Documents/cv/resume.pdf","parent":"Documents/cv","name":"resume.pdf","ext":"pdf","size":52113,"mtime":1759000000,"is_dir":false}
```

- `path` starts with the folder's label. A folder's own entry has `parent` set to `""`.
- `mtime` is Unix seconds. `size` is 0 for folders. `ext` is lower case, without the dot.
- Folders are entries too. The list reflects the last completed scan.

### `GET /roots`

Where each enabled shared folder lives on the PC: `{"sep":"/","roots":[{"label":"Documents","path":"/home/me/Documents"}]}`.

### `POST /reindex`

Starts a rescan. `202 {"status":"started"}`, or `409 {"status":"already_scanning"}`.

### `POST /pair` (no key)

Trades a one-time pairing code for the phone's own key.

Request: `{"code":"ABCDE-FGHJK","device_name":"Pixel 8"}` (not case sensitive; spaces and dashes are ignored).

| Status | Meaning |
| --- | --- |
| `200 {"token":"<64 hex>","phone_id":"...","pc_id":"...","pc_name":"..."}` | Use `token` as the key from now on |
| `401 {"error":"invalid_code"}` | Wrong, used or expired code (a code works once, for 10 minutes) |
| `404 {"error":"pairing_unavailable"}` | This agent has no pairing codes |
| `409` | Too many phones are paired (20) |
| `429` | Too many wrong attempts (shared with the key lockout) |

The QR code carries `{"v":2,"host":"...","port":8080,"code":"...","id":"...","name":"..."}`. Agents before per-phone keys carried `{"v":1,...,"token":"..."}`.

### `GET /download?path=<file path>`

Sends one file. `path` is the path as it appears in the file list. Off unless the person allows it (`file_access`).

- Supports `Range` (`206`) and `HEAD`. Headers: `Content-Disposition: attachment` (RFC 5987 name), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- `403 downloads_off`, `403 unreadable`, `404 not_found` (also for files that exist but aren't shared, so the answer reveals nothing), `503 busy` + `Retry-After` (four at a time).

### `POST /upload`

Saves one file into the drop folder. The body is the file's raw bytes. `X-File-Name` carries its name, percent-encoded. Off unless the person allows it (`uploads`). Phone keys only.

| Status | Meaning |
| --- | --- |
| `201 {"name":"<saved as>","size":123}` | Saved. A taken name becomes `name (1).ext` and nothing is overwritten. |
| `403 uploads_off` / `403 pair_again` | Switched off, or the phone uses the old shared token |
| `413 too_large` | Over `upload_max_mb` |
| `415 program_file` | `.exe`, `.sh` and similar, unless allowed |
| `429 upload_limit` + `Retry-After` | The hourly limit for all phones together |
| `503 busy` / `drop_folder_unavailable`, `507 disk_full` | |

## Discovery

The agent announces itself on the local network with mDNS (service `_fs-sync._tcp`) so the app can find a paired PC again after its address changes. The app matches the device id from `/ping`. Pairing always needs the code.

## Settings keys (for reference)

`device_id`, `device_name`, `port`, `web_port`, `disable_web_ui`, `token` (old shared token), `roots` (`path`, `label`, `disabled`, `include_hidden`), `extra_ignores`, `include_hidden`, `allowed_networks`, `disable_legacy_token`, `allow_file_access`, `allow_uploads`, `upload_dir`, `upload_max_mb`, `upload_per_hour`, `upload_allow_programs`. Most are changed from the dashboard.