# API contract: SCAN-2a, files on vehicle documents

Published by backend-engineer, checked with curl against a private API on the new code (LocalDB dev database, the real `onlycars-dev` R2 bucket). Migration `DocumentAttachments` (nullable `Attachments.VehicleDocumentId`, indexed, NoAction FK; `CK_Attachments_OneParent` now "exactly one of three"; `VehicleDocuments.UpdatedAt` is a concurrency token). Both endpoints need the bearer token (401 without it).

**Same rules as a service record's files (`docs/contracts/FILE-2.md`)**: JPEG, PNG, WebP (metadata removed) and PDF, judged by content; **10 MB** per file; **10 files per document**; the one **1 GiB per user** quota, which now counts service files, run photos and document files together on all three upload endpoints; the shared `upload` rate limit; the same `file.*` and `attachment.*` codes; signed 1-hour inline URLs; the same file-name cleaning. Only differences: the fallback name is `document.<ext>` (not `receipt.<ext>`), a missing document is `vehicleDocument.notFound`, and the POST returns the **document** DTO and takes `?today=`.

## New: `POST /api/vehicles/{vehicleId}/documents/{documentId}/attachments?today=YYYY-MM-DD`

Request: `multipart/form-data` with one file field named **`file`** (a `FormData` body; don't set `Content-Type` yourself). `today` is optional, the user's local date, as on the other document calls (it only feeds `status` and `daysLeft`).

```
const body = new FormData(); body.append('file', file, 'scan-2026-11-04.pdf');
fetch(`/api/vehicles/${vehicleId}/documents/${documentId}/attachments?today=${today}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body })
```

Response **200**: the updated **document DTO** (the same shape as one item of `GET /api/vehicles/{id}/documents`), with the new file at the end of `attachments`.

## New: `DELETE /api/vehicles/{vehicleId}/documents/{documentId}/attachments/{attachmentId}`

No body. **204**. Deletes the row, then the stored file (a failed file delete is logged, not an error). **Allowed on an archived car.** Any id that isn't the caller's file on that car and document (another user's, unknown, already deleted, or a mismatched path) is **404 `attachment.notFound`**. Not rate limited.

## Changed: every document DTO gets `attachments`

`GET /api/vehicles/{id}/documents`, `POST /api/vehicles/{id}/documents` (always `[]`), `PUT /api/vehicles/{id}/documents/{documentId}`, and the new POST above. `GET /api/reminders` is **unchanged** (no files).

`attachments`: array, oldest first (upload order), never null. Each item is exactly the service-file `AttachmentDto`: `id`, `fileName`, `contentType`, `sizeBytes`, `url` (signed, 1 hour, inline; `null` without storage). See FILE-2 for the field details.

- **Renewing or editing** a document (`PUT`, a new expiry date included) keeps its files.
- **Deleting a document** (`DELETE /api/vehicles/{id}/documents/{documentId}`, 204, still refused on an archived car with `vehicleDocument.vehicleArchived`) deletes its files too: the rows with the document, then the stored files. No undo. If another upload to that document saved after the client loaded it, the delete is **409 `concurrency.conflict`** and nothing is deleted; reload and ask again.
- **Deleting the account** removes them; the data export (`data.json`) lists each document's files under `vehicles[].documents[].attachments` (`fileName`, `contentType`, `sizeBytes`, `createdAt`; plus `path` in the ZIP), and the ZIP holds them at `cars/<car>/documents/<Type> <expiry yyyy-MM-dd> <id8>/<file>` (e.g. `cars/Corolla/documents/Insurance 2027-01-31 99607359/policy.png`); an unreadable one is listed in `missing-files.txt`.

## Errors (POST unless marked)

| Code | Status | Extensions | When |
|---|---|---|---|
| `http.429` | 429 | none; `Retry-After` header | One `upload` budget per user, shared with the car photo, service files and run photos. Checked first. |
| `vehicleDocument.invalidDate` | 400 | none | `today` is not within a day of the server's date (as the other document calls). |
| `file.storageUnavailable` | 503 | none | Storage not configured. POST and DELETE. |
| `vehicle.notFound` | 404 | none | Another user's car, or no such car. |
| `vehicleDocument.notFound` | 404 | none | No such document on that car (another user's, another car's, or deleted). |
| `attachment.notFound` | 404 | none | DELETE: see above. |
| `attachment.vehicleArchived` | 400 | none | The car is archived. (DELETE is allowed.) |
| `attachment.tooMany` | 400 | `maxCount`: 10 | The document already has 10 files. Checked before the file itself. |
| `file.required` | 400 | none | No `file` field, an empty file, or a malformed body. |
| `file.tooLarge` | 413 | `maxBytes`: 10485760 | Over 10 MB (check before sending; far over, the connection may drop instead). |
| `file.unsupportedType` | 400 | none | Not a JPEG, PNG, WebP or PDF by content. |
| `file.quotaExceeded` | 400 | `maxBytes`: 1073741824 | All the user's files (service, run, document) plus this one would be over 1 GiB. |
| `concurrency.conflict` | 409 | none | The document changed while the file uploaded: it was edited or deleted, or another upload to it saved first. **Upload a document's files one after another, not in parallel.** The uploaded file is deleted; reload and retry. |
| `http.500` | 500 | none | The upload to storage failed; nothing is saved. |

Order of checks on POST: rate limit, `today`, storage, car, document, archived, 10 files, file present, size, type, quota; then the upload, then the save (409).

## Examples (from the curl checks; signature, credential and account host shortened)

`POST /api/vehicles/f700f0ec-.../documents/99607359-.../attachments?today=2026-11-04` with `file=@scan-2026-11-04.pdf` (the second file) → **200**

```json
{"id":"99607359-3e9b-4fb7-8f13-e361d40441e2","vehicleId":"f700f0ec-76c7-4e23-a95b-4d3eba3f0191","type":"Insurance","expiryDate":"2027-01-31","cost":1200.00,"notes":null,"status":"Ok","daysLeft":88,
 "attachments":[
  {"id":"15834247-5227-4a36-9c04-e2f4a93518f2","fileName":"policy.png","contentType":"image/png","sizeBytes":70,"url":"https://<account>.r2.cloudflarestorage.com/onlycars-dev/users/d5c20b7a-.../vehicles/f700f0ec-.../documents/99607359-.../ab30d8e6be0344d8acca4ac0dcaca8dc.png?X-Amz-Expires=3600&response-cache-control=private%2C%20max-age%3D3600&response-content-disposition=inline%3B%20filename%2A%3DUTF-8%27%27policy.png&response-content-type=image%2Fpng&...&X-Amz-Signature=<sig>"},
  {"id":"e08b898e-605d-41f7-9c0f-dd7cca92b8fe","fileName":"scan-2026-11-04.pdf","contentType":"application/pdf","sizeBytes":48,"url":"https://<account>.r2.cloudflarestorage.com/onlycars-dev/users/.../documents/99607359-.../daca5a0be9954cfa8c7969e0c32283cb.pdf?...&response-content-type=application%2Fpdf&...&X-Amz-Signature=<sig>"}]}
```

Opening the PDF's `url`: 200 `application/pdf`.

`DELETE .../documents/99607359-.../attachments/15834247-...` → **204** (no body); again → **404**

```json
{"title":"Not found","status":404,"detail":"Attachment '15834247-5227-4a36-9c04-e2f4a93518f2' was not found.","code":"attachment.notFound"}
```

Each error, as returned:

```json
{"title":"Validation failed","status":400,"detail":"Choose a file to upload.","code":"file.required"}
{"title":"Validation failed","status":400,"detail":"The file must be a JPEG, PNG or WebP image, or a PDF.","code":"file.unsupportedType"}
{"title":"Payload too large","status":413,"detail":"The file must be 10 MB or smaller.","code":"file.tooLarge","maxBytes":10485760}
{"title":"Not found","status":404,"detail":"VehicleDocument '00000000-0000-0000-0000-000000000001' was not found.","code":"vehicleDocument.notFound"}
{"title":"Not found","status":404,"detail":"Vehicle '00000000-0000-0000-0000-000000000001' was not found.","code":"vehicle.notFound"}
{"title":"Validation failed","status":400,"detail":"The date must be today.","code":"vehicleDocument.invalidDate"}
{"title":"Validation failed","status":400,"detail":"Up to 10 files can be added here.","code":"attachment.tooMany","maxCount":10}
{"title":"Validation failed","status":400,"detail":"This car is archived.","code":"attachment.vehicleArchived"}
```

On the archived car, `DELETE` of a file → 204. Deleting the document with its files → 204; deleting the account with a document file → 204, no rows left. `file.quotaExceeded`, `concurrency.conflict` and `http.429` were checked in the xUnit tests (`DocumentAttachmentTests`, `MaintenanceSchemaTests` on LocalDB), not with curl.
