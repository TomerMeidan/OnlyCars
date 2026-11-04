# API contract: EXP-1a, the full export as one ZIP

Published by backend-engineer, verified with curl against the API on LocalDB with the dev R2 bucket. Additive: `GET /api/me/export` (ACC-1, the JSON) is unchanged.

The browser downloads the ZIP through a one-time link, because the client signs requests with a Bearer header and only a plain navigation (no header) streams to the downloads folder instead of into the page's memory.

## Endpoints

| Method and path | Auth | Body | Success |
|---|---|---|---|
| `POST /api/me/export/full` | JWT | none | 200 `ExportLinkDto` |
| `GET /api/me/export/full/{token}` | none: the token is the credential | | 200 `application/zip`, streamed |

```
ExportLinkDto { url, expiresAt }   // url: "/api/me/export/full/{token}", relative to the API origin; expiresAt: 60 s from now
```

- The token is 32 random bytes (43 characters, base64url), kept only in the server's memory, bound to the user who asked, and **used up by the first GET**. A server restart within the 60 seconds loses it (tap again).
- Start the download by navigating to `url` (`window.location.assign(url)` or a link click), not with `fetch`.
- GET headers: `Content-Type: application/zip`, `Content-Disposition: attachment; filename=onlycars-export-YYYY-MM-DD.zip` (UTC date), `Cache-Control: no-store`, chunked (no `Content-Length`, so the browser shows bytes received, not a percentage).
- Rate limits (shared with the JSON export): the POST uses the `export` policy (1 at a time and 5 per 10 minutes per user). The GET allows 1 ZIP download at a time per user. At most 3 exports (JSON or ZIP) run at once across all users.

## Errors

| Status | `code` | When |
|---|---|---|
| 401 | (no body) | POST without a valid JWT |
| 503 | `file.storageUnavailable` | POST when file storage isn't configured (as for uploads) |
| 429 | `http.429` | POST: 6th in 10 minutes, or the user's JSON export is running, or 3 exports run app-wide. GET: the same user's ZIP is already downloading, or 3 exports run app-wide. `Retry-After` header in seconds. A GET refused with 429 doesn't use up its token. |
| 404 | `export.linkExpired` | GET with an unknown, used or expired token |

The GET's errors are ProblemDetails JSON. Because the browser navigates to it, a 404 or 429 there shows as a JSON page, not in the app. Requesting a fresh link right before navigating keeps this rare.

## ZIP layout

Entry names are UTF-8 (Hebrew names open on Windows, macOS and Android).

```
data.json
cars/<car>/photo.<ext>
cars/<car>/services/<yyyy-MM-dd> <first 8 of record id>/<file name>
cars/<car>/checklist-runs/<yyyy-MM-dd> <first 8 of run id>/<file name>
missing-files.txt          only when a file couldn't be read from storage
```

- `data.json`: the same document as `GET /api/me/export`. Each item of a service record's `attachments` and a run's `photos` also has `path`, its entry in the ZIP. The car photo isn't listed in the JSON (only `hasPhoto`, as before). Its entry is `cars/<car>/photo.<ext>`.
- `<car>`: the nickname, else make and model, else the car's id. Archived cars and voided records are included.
- Names are made safe: `\ / : * ? " < > |` and control characters become `_`. A run of dots becomes one dot. Leading and trailing dots and spaces are trimmed. Names are cut to at most 80 characters, keeping a file's extension. A duplicate name in the same folder (case-insensitive) gets ` (2)`, ` (3)`, before the extension. Folders with no files don't appear.
- File bytes are exactly what was stored (no recompression). `data.json` and `missing-files.txt` are deflated.
- `missing-files.txt`: one line per file that couldn't be read: `<path> - not found in storage` or `<path> - could not be read from storage`. The rest of the ZIP is complete. A missing file's `path` is still in `data.json`.
- No storage key, signed link or token appears anywhere in the ZIP.

## Example (from the curl check)

```
POST /api/me/export/full
Authorization: Bearer <jwt>

200 {"url":"/api/me/export/full/hXMYgR35x1JzS3-3JJBviDM4DWn7ZhK9vXgQFOXhc4Q","expiresAt":"2026-11-04T03:06:40.8432697+00:00"}
```

```
GET /api/me/export/full/<token>

200
Content-Type: application/zip
Cache-Control: no-store
Content-Disposition: attachment; filename=onlycars-export-2026-11-04.zip; filename*=UTF-8''onlycars-export-2026-11-04.zip

entries (a second car of the same user, with a photo and two files called "receipt.pdf", omitted):
data.json
cars/המאזדה שלי/services/2026-11-02 fe17df4f/קבלה מוסך.pdf
cars/המאזדה שלי/services/2026-11-02 fe17df4f/קבלה מוסך (2).pdf
```

`data.json` excerpt:

```json
"attachments": [
  { "fileName": "קבלה מוסך.pdf", "contentType": "application/pdf", "sizeBytes": 45, "createdAt": "2026-11-04T03:06:13.0959428+00:00",
    "path": "cars/המאזדה שלי/services/2026-11-02 fe17df4f/קבלה מוסך.pdf" }
]
```

The same GET again:

```
404 {"title":"Not found","status":404,"detail":"This download link has expired. Start the export again.","code":"export.linkExpired"}
```
