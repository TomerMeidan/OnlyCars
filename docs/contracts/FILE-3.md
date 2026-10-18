# API contract: FILE-3, photos on checklist runs

Published by backend-engineer, checked with Node `fetch` against the live API (LocalDB) and the real `onlycars-dev` R2 bucket. Migration `AddRunAttachments` (`Attachments.ChecklistRunId`, index, check constraint `CK_Attachments_OneParent`). Same storage, limits, `file.*` codes and attachment shape as FILE-2 (`docs/contracts/FILE-2.md`); this page lists what differs. Both endpoints need the bearer token (401 without it).

Limits: **10 MB = 10,485,760 bytes** per photo, **10 photos per run** (`maxCount`), and the same **1 GiB per user** (`maxBytes` 1073741824) that now counts **service-record files and run photos together**: either upload endpoint refuses when the total would pass it, and deleting a file, a photo, a run or voiding a record frees space for both. Types by content only: **JPEG, PNG and WebP** (all metadata removed). **A PDF is refused on a run** (`file.unsupportedType`); so are HEIC, GIF and anything else.

## New: `POST /api/checklist-runs/{runId}/attachments`

Request: `multipart/form-data` with one file field named **`file`** (a `FormData` body; don't set `Content-Type` yourself), as FILE-2.

Response **200**: the updated **run** (`ChecklistRunDto`, the same shape as one item of `GET /api/vehicle-checklists/{id}/runs`, items and their `issueId` included), with the new photo at the end of `attachments`.

File name: cleaned as in FILE-2; if nothing is left it becomes `photo.<ext>` (FILE-2's records still use `receipt.<ext>`).

A turned-off checklist's runs still take photos. The car must not be archived.

## New: `DELETE /api/checklist-runs/{runId}/attachments/{attachmentId}`

No body. **204**. Deletes the row, then the stored file (a failed file delete is logged, not an error). Allowed on an archived car. Any id that isn't the caller's photo on that run (another user's, unknown, already deleted, a service-record file, or a mismatched run) is **404 `attachment.notFound`**.

## Changed: `ChecklistRunDto` gets `attachments`

`GET /api/vehicle-checklists/{id}/runs` (each run), `POST /api/vehicle-checklists/{id}/runs` (`run`, always `[]`), and the new POST above.

`attachments`: array, oldest first (upload order), never null; each item is exactly the FILE-2 shape `{ id, fileName, contentType, sizeBytes, url }`: `contentType` is `image/jpeg`, `image/png` or `image/webp`; `url` is a 1-hour signed GET URL (inline, `filename*` with the stored name, `Cache-Control: private, max-age=3600`), or `null` when storage isn't configured. Don't log, store or share the URL; after about 55 minutes reload the runs for fresh URLs. The list is loaded with the runs (no request per run).

## Deleting runs deletes their photos

| Path | What happens |
|---|---|
| `DELETE /api/checklist-runs/{id}` (run Delete) | Deletes the run's photo rows with the run, then their files (failures logged). |
| `DELETE /api/vehicle-checklists/{id}` (Remove a checklist from a car) | **Unchanged: refused with 409 `vehicleChecklist.hasRuns` while the checklist has any run**, so it never deletes a run or a photo. Once its runs are deleted (each deleting its photos), Remove works. |
| `DELETE /api/checklist-templates/{id}` (Delete a template) | **Unchanged: refused with 409 `checklistTemplate.inUse` while any car has it**, so it never deletes a run or a photo either. |

So the only way a run (and its photos) goes is run Delete, and only the run Delete confirm mentions photos; the Remove and template Delete confirms are unchanged, since those calls fail while runs exist (clarified at sign-off, decisions.md "FILE-3 sign-off").

The `ChecklistRunId` link is **`NoAction`** in the database (SQL Server allows only one cascade path to `Attachments`, taken by service records); the service deletes the rows itself. Consequence for scripts and the future delete-account: a raw car or user delete must first delete the run photo rows (`scripts/cleanup-test-users.sql` does).

## Errors

| Code | Status | Extensions | When |
|---|---|---|---|
| `http.429` | 429 | none; `Retry-After` header | POST only. **The same per-user budget as the car photo and service-record files** (policy `upload`: 2 at once, 10 per 10 minutes). Checked first. DELETE is not limited. |
| `file.storageUnavailable` | 503 | none | Storage not configured. POST and DELETE. |
| `checklistRun.notFound` | 404 | none | POST: another user's run, an unknown run, or a run deleted meanwhile. |
| `attachment.notFound` | 404 | none | DELETE: see above. |
| `attachment.vehicleArchived` | 400 | none | POST when the run's car is archived. |
| `attachment.tooMany` | 400 | `maxCount`: 10 | POST when the run already has 10 photos. Checked before the file itself. The detail text is generic ("Up to 10 files can be added here."), now shared with service records; show your own run text. |
| `file.required` | 400 | none | No `file` field, an empty file, a body that isn't multipart, or a malformed one. |
| `file.tooLarge` | 413 | `maxBytes`: 10485760 | Over 10 MB. Over about 10 MB + 64 KB the server stops reading and a browser may see a dropped connection instead, so check the size before sending. |
| `file.unsupportedType` | 400 | none | Not a well-formed JPEG, PNG or WebP, **including any PDF**. Detail: "The photo must be a JPEG, PNG or WebP image." |
| `file.quotaExceeded` | 400 | `maxBytes`: 1073741824 | The user's stored service files plus run photos plus this photo (its stored size) would pass 1 GiB. Checked after the type. Nothing is stored. |
| `concurrency.conflict` | 409 | none | The run changed while the photo was uploading: it was deleted, or another upload to the same run saved first (**any two overlapping uploads to one run: the second to save gets 409**, which keeps the 10-photo limit). The uploaded file is deleted; nothing is saved. Reload the runs; retry if the run is still there. Also: a run **Delete** that overlaps an upload which saved first gets 409 (nothing deleted); reload and delete again. |
| `http.500` | 500 | none | The upload to storage itself failed. Nothing is saved. |

Order of checks on POST: upload rate limit, storage, run (`checklistRun.notFound`), archived, 10 photos, file present, size, type, quota; then the upload, then the save (`concurrency.conflict`).

Unchanged for service-record files (FILE-2), apart from: the quota now includes run photos, and the `attachment.tooMany` detail text is the generic one above (the code and `maxCount` are the same).

## Examples (live API and the real bucket)

Account id, bucket, credential, signature and the random file id redacted; the rest is as returned.

```
POST /api/vehicle-checklists/574399ef-b6ba-4900-98a0-5743a4fa3c40/runs   (one Check item, boolValue false)
201  "run": { ..., "attachments": [] }

POST /api/checklist-runs/21d089d9-439e-4fbf-9242-840d772a8bd5/attachments
     (FormData file "צמיג שחוק.png", a 1x1 PNG with a tEXt chunk "GPS 32.08 34.78")
200
{"id":"21d089d9-439e-4fbf-9242-840d772a8bd5","vehicleChecklistId":"574399ef-b6ba-4900-98a0-5743a4fa3c40","runAt":"2026-10-17","odometerKm":0,
 "odometerReadingId":null,"notes":null,"flaggedCount":1,
 "items":[{"id":"0b67183b-84dd-4cce-a1c7-929a9de450e7","templateItemId":"f53e9291-bf0a-460a-9a67-926c4c77e031","label":"Tyres","type":"Check","unit":null,
   "minValue":null,"maxValue":null,"boolValue":false,"numberValue":null,"textValue":null,"isFlagged":true,"issueId":null}],
 "attachments":[{"id":"cf052154-6c6f-41d6-bc44-553e7373df36","fileName":"צמיג שחוק.png","contentType":"image/png","sizeBytes":70,
   "url":"https://<account>.r2.cloudflarestorage.com/<bucket>/users/9f459969-8706-4cfb-adc8-ed1510b614b3/vehicles/40cb4518-4877-4db7-a5ab-ce26c715b731/checklist-runs/21d089d9-439e-4fbf-9242-840d772a8bd5/<32hex>.png?X-Amz-Expires=3600&response-cache-control=private%2C%20max-age%3D3600&response-content-disposition=inline%3B%20filename%2A%3DUTF-8%27%27%25D7%25A6%25D7%259E%25D7%2599%25D7%2592%2520%25D7%25A9%25D7%2597%25D7%2595%25D7%25A7.png&response-content-type=image%2Fpng&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=<redacted>&X-Amz-Date=20261017T221546Z&X-Amz-SignedHeaders=host&X-Amz-Signature=<redacted>"}]}
```

Opening the signed URL (GET): `200 image/png`, `inline; filename*=UTF-8''%D7%A6%D7%9E%D7%99%D7%92%20%D7%A9%D7%97%D7%95%D7%A7.png`, `private, max-age=3600`, 70 bytes (the text chunk is gone). Without the signature: 400.

```
POST .../attachments  (a PDF)
400 {"title":"Validation failed","status":400,"detail":"The photo must be a JPEG, PNG or WebP image.","code":"file.unsupportedType"}
POST .../attachments  (another user's token)
404 {"title":"Not found","status":404,"detail":"ChecklistRun '21d089d9-…' was not found.","code":"checklistRun.notFound"}
DELETE .../attachments/cf052154-…  (another user's token)
404 {"title":"Not found","status":404,"detail":"Attachment 'cf052154-…' was not found.","code":"attachment.notFound"}
DELETE .../attachments/cf052154-…   -> 204; the signed URL -> 404; again -> 404 attachment.notFound
POST .../attachments  (car archived)
400 {"title":"Validation failed","status":400,"detail":"This car is archived.","code":"attachment.vehicleArchived"}
DELETE /api/checklist-runs/21d089d9-…  (run with 2 photos)  -> 204; both photos' signed URLs -> 404
POST .../attachments  (deleted run)
404 {"title":"Not found","status":404,"detail":"ChecklistRun '21d089d9-…' was not found.","code":"checklistRun.notFound"}
```

## Dependencies

None added.
