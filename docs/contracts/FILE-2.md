# API contract: FILE-2, attachments on service records

Published by backend-engineer, checked with curl and Node `fetch` against the live API (LocalDB) and the real `onlycars-dev` R2 bucket. Migration `AddAttachments` (new table `Attachments`). Same storage, limits and `file.*` codes as FILE-1 (`docs/contracts/FILE-1.md`). Both endpoints need the bearer token (401 without it).

Limit: **10 MB = 10,485,760 bytes** per file (`maxBytes` in the 413 body), **10 files per service record** (`maxCount` in the 400 body), **1 GiB = 1,073,741,824 bytes of attachments per user** across all their cars and records (`maxBytes` in the 400 `file.quotaExceeded` body; config `Storage:UserQuotaBytes`; the car photo does not count; deleting a file or voiding its record frees its space). Types by content only: JPEG, PNG, WebP (metadata removed, as the car photo) and PDF (must start with `%PDF-`; stored byte for byte). The part's `Content-Type` is ignored; the file name is kept (cleaned) for display only and never decides the type.

## New: `POST /api/vehicles/{vehicleId}/service-records/{recordId}/attachments`

Request: `multipart/form-data` with one file field named **`file`**. Pass a `FormData` body and do **not** set `Content-Type` yourself.

```
const body = new FormData(); body.append('file', input.files[0]);
fetch(`/api/vehicles/${vehicleId}/service-records/${recordId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body })
```

Response **200**: the updated **service record DTO** (the same shape as one item of `GET /api/vehicles/{id}/service-records`), with the new file at the end of `attachments`.

File name: the last path segment of the name the browser sends, without control characters (Unicode Cc), format characters (Unicode Cf: bidi controls such as U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069, zero-width U+200B to U+200D, U+2060, and U+FEFF) and the line and paragraph separators U+2028, U+2029, trimmed, and cut to 255 characters keeping the extension. If nothing is left it becomes `receipt.<ext>` (ext from the content: `jpg`, `png`, `webp` or `pdf`). The name is **not** forced to match the type: a PNG named `scan.pdf` keeps the name `scan.pdf` with `contentType` `image/png`.

## New: `DELETE /api/vehicles/{vehicleId}/service-records/{recordId}/attachments/{attachmentId}`

No body. **204**. Deletes the row, then the stored file (a failed file delete is logged, not an error). Allowed on an archived car. Any id that isn't the caller's attachment on that car and record (another user's, unknown, already deleted, or a mismatched path) is **404 `attachment.notFound`**.

## Changed: every service record DTO gets `attachments`

`GET /api/vehicles/{id}/service-records`, `GET /api/service-records` (items), `POST /api/vehicles/{id}/service-records` (`record`, always `[]`), `PUT /api/vehicles/{id}/service-records/{recordId}` (`record`), and the new POST above.

`attachments`: array, oldest first (upload order), never null.

| Field | Type | Meaning |
|---|---|---|
| `id` | guid | For DELETE. |
| `fileName` | string | The cleaned original name, 1 to 255 characters. Can be any script (Hebrew, etc.) and any length up to 255 without spaces: show it in `<bdi>` and let it wrap. |
| `contentType` | string | `image/jpeg`, `image/png`, `image/webp` or `application/pdf`, from the content. |
| `sizeBytes` | number | The stored size in bytes (for an image it can be smaller than the file chosen, after metadata removal). |
| `url` | string or null | A signed GET URL, valid for **1 hour** from the response. Opening it shows the file **inline** with `Content-Type` = `contentType` and `Content-Disposition: inline; filename*=UTF-8''<fileName>` (so a browser's Save keeps the name) and `Cache-Control: private, max-age=3600` (no shared cache keeps it). `null` when storage isn't configured: show the name as plain text, no link. Anyone holding the URL can open the file until it expires, so don't log, store or share it. After about 55 minutes reload the records for fresh URLs. |

Editing a record (`PUT`) never changes its attachments. Voiding a record (`POST .../void`, the UI's Delete and Undo) deletes its attachments and their files; the record then no longer appears, and uploads to it are 404.

## Errors

| Code | Status | Extensions | When |
|---|---|---|---|
| `http.429` | 429 | none; `Retry-After` header in seconds | POST only. **One budget per signed-in user shared with the car photo upload** (rate-limit policy `upload`; config `RateLimiting:UploadPermitLimit` and `RateLimiting:UploadWindowSeconds`, renamed from `PhotoUpload*`): a third upload while two are running, or more than 10 uploads (photos and attachments together) in 10 minutes. Checked first, before the body is read. DELETE is not limited. |
| `file.storageUnavailable` | 503 | none | Storage not configured. POST and DELETE. |
| `vehicle.notFound` | 404 | none | POST: another user's car, or no such car. |
| `serviceRecord.notFound` | 404 | none | POST: no such record on that car, or the record is voided. |
| `attachment.notFound` | 404 | none | DELETE: see above. |
| `attachment.vehicleArchived` | 400 | none | POST on an archived car. (DELETE is allowed.) |
| `attachment.tooMany` | 400 | `maxCount`: 10 | POST when the record already has 10 files. Checked before the file itself. |
| `file.required` | 400 | none | No `file` field, an empty file, a body that isn't multipart, or a malformed multipart body. |
| `file.tooLarge` | 413 | `maxBytes`: 10485760 | The file is over 10 MB. Over about 10 MB + 64 KB the server stops reading the body and a browser may see a dropped connection instead, so check the size before sending. |
| `file.unsupportedType` | 400 | none | Not a well-formed JPEG, PNG or WebP, and doesn't start with `%PDF-` (a text file named `.pdf`, a GIF, HEIC, a cut-off image). |
| `file.quotaExceeded` | 400 | `maxBytes`: 1073741824 | The user's stored attachments plus this file (its stored size, after metadata removal) would be over 1 GiB. Checked after the type, just before the upload. Nothing is stored. |
| `concurrency.conflict` | 409 | none | The record changed while the file was uploading: it was voided or edited, or another upload to the same record saved first. **Any two uploads to the same record that overlap: the one that saves second gets 409, at any file count** (this is what keeps the 10-file limit), so upload a record's files one after another, not in parallel. The uploaded file is deleted; nothing is saved. Reload the records; after a void the record is gone, otherwise retry. |
| `http.500` | 500 | none | The upload to storage itself failed. Nothing is saved. |

Order of checks on POST: upload rate limit, storage, car (`vehicle.notFound`), record (`serviceRecord.notFound`), archived, 10 files, file present, size, type, quota (`file.quotaExceeded`); then the upload, then the save (`concurrency.conflict`).

Other endpoints keep the 64 KB body limit (`http.413`).

Also changed (FILE-1): the car `photoUrl` now opens with `Cache-Control: private, max-age=3600` too; nothing else about it changed.

## Examples (live API and the real bucket)

Account id, bucket, credential and signature redacted; the rest is as returned.

```
POST /api/vehicles/c15deb29-df72-4f18-bf19-b3db6a3501f0/service-records/16a774a9-ced5-4a51-b34e-5c00010b6182/attachments
     (-F "file=@receipt.png;filename=scan.pdf;type=application/pdf", a 70-byte PNG)
200
{"id":"16a774a9-ced5-4a51-b34e-5c00010b6182","date":"2026-10-17","odometerKm":1500.00,"shopName":"Garage","totalCost":120.00,"notes":null,
 "tasks":[],"items":[],"vehicleId":"c15deb29-df72-4f18-bf19-b3db6a3501f0",
 "attachments":[{"id":"febea052-7667-48cc-8d24-478cc7a81867","fileName":"scan.pdf","contentType":"image/png","sizeBytes":70,
   "url":"https://<account>.r2.cloudflarestorage.com/<bucket>/users/9be51919-e4c3-493d-8347-c186373544e8/vehicles/c15deb29-df72-4f18-bf19-b3db6a3501f0/service-records/16a774a9-ced5-4a51-b34e-5c00010b6182/72893819262f4a5d888d537ebd008ed6.png?X-Amz-Expires=3600&response-content-disposition=inline%3B%20filename%2A%3DUTF-8%27%27scan.pdf&response-content-type=image%2Fpng&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=<redacted>&X-Amz-Date=20261017T211326Z&X-Amz-SignedHeaders=host&X-Amz-Signature=<redacted>"}]}
```

Opening the signed URLs (GET, Node `fetch`):

```
"scan.pdf"        200  image/png        inline; filename*=UTF-8''scan.pdf                                                   70 bytes, as sent
"חשבונית מס.pdf"  200  application/pdf  inline; filename*=UTF-8''%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA%20%D7%9E%D7%A1.pdf  193 bytes, as sent
The same URLs without the signature: 400. After DELETE or void: 404.
```

```
POST .../attachments  (-F "file=@text.pdf", 5 bytes of text)
400 {"title":"Validation failed","status":400,"detail":"The file must be a JPEG, PNG or WebP image, or a PDF.","code":"file.unsupportedType"}
POST .../attachments  (12,000,000 bytes, and also 10,485,762 bytes)
413 {"title":"Payload too large","status":413,"detail":"The file must be 10 MB or smaller.","code":"file.tooLarge","maxBytes":10485760}
POST .../attachments  (another user's token)
404 {"title":"Not found","status":404,"detail":"Vehicle 'c15deb29-…' was not found.","code":"vehicle.notFound"}
DELETE .../attachments/9db03ab2-…  (another user's token)
404 {"title":"Not found","status":404,"detail":"Attachment '9db03ab2-…' was not found.","code":"attachment.notFound"}
DELETE .../attachments/ef8684e6-…   -> 204; again -> 404 attachment.notFound
POST .../service-records/2276b440-…/void   -> 200; that record's file URL -> 404
POST .../service-records/2276b440-…/attachments  (voided record)
404 {"title":"Not found","status":404,"detail":"ServiceRecord '2276b440-…' was not found.","code":"serviceRecord.notFound"}
POST .../attachments  (car archived)
400 {"title":"Validation failed","status":400,"detail":"This car is archived.","code":"attachment.vehicleArchived"}
DELETE .../attachments/{id}  (car archived)   -> 204
```

Note for the smoke test: `curl -F "file=@x;filename=<Hebrew>"` from Git Bash on Windows sends the name in the ANSI code page, so it arrives as `?`. Browsers and Node `fetch` send UTF-8 and the name arrives intact (checked).

## Dependencies

None added.
