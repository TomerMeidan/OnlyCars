# API contract: FILE-1, the car photo

Published by backend-engineer, verified with curl against the live API (LocalDB) and the real `onlycars-dev` R2 bucket. No migration: `Vehicle.PhotoUrl` now holds the storage key. The API never returns the key as a field of its own, but the signed URL's path contains it. A stored key that isn't one the API writes for that car (`users/{userId}/vehicles/{vehicleId}/photo/{32 hex}.jpg|png|webp`) is treated as no photo: never signed, never deleted. Both endpoints need the bearer token (401 without it).

Limit: **10 MB = 10,485,760 bytes** (`maxBytes` in the 413 body). Types by content only: JPEG, PNG, WebP. The file name and the part's `Content-Type` are ignored.

## New: `PUT /api/vehicles/{id}/photo`

Request: `multipart/form-data` with one file field named **`file`**. With `fetch`, pass a `FormData` body and do **not** set `Content-Type` yourself (the browser adds the boundary).

```
const body = new FormData(); body.append('file', input.files[0]);
fetch(`/api/vehicles/${id}/photo`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body })
```

Response **200**: the vehicle DTO (same shape as `GET /api/vehicles/{id}`), with `photoUrl` set to a signed URL of the new photo.

What the server does: checks the type by content, removes all metadata by keeping only an allow-list of the blocks needed to show the image (so EXIF including GPS, XMP, IPTC, comments, C2PA and any unknown block are dropped; a JPEG keeps only its rotation, so phone photos stay upright; a PNG or WebP loses its rotation), uploads it under a new random name, points the car at it, then deletes the previous photo (if that delete fails it is logged, not an error). The stored file can be a different size from the one sent.

## New: `DELETE /api/vehicles/{id}/photo`

No body. **204**. Clears the photo and deletes the stored file. Allowed on an archived car. A car without a photo also gives 204.

## Changed: every vehicle DTO

`GET /api/vehicles`, `GET /api/vehicles/{id}`, `POST /api/vehicles`, `PUT /api/vehicles/{id}`, `PUT /api/vehicles/{id}/photo`:

| Field | Type | Meaning |
|---|---|---|
| `photoUrl` | string or null | A signed GET URL, valid for **1 hour** from the response. `null` when the car has no photo, or when storage isn't configured. The URL's path contains the storage key, and anyone holding the URL can load the photo until it expires (up to 1 hour), so don't log or share it. Use it directly as `<img src>`; don't store or cache it. When it has expired, `<img>` fails to load: refetch the car (`GET /api/vehicles/{id}`) for a fresh one. |

`POST /api/vehicles` and `PUT /api/vehicles/{id}` **ignore** `photoUrl` in the body (it stays in the request type for now so old clients don't break). Stop sending it. Saving the car form never changes or removes the photo.

Dashboard cards (`DashboardVehicleDto`) have no photo (out of scope).

## Errors

| Code | Status | Extensions | When |
|---|---|---|---|
| `file.storageUnavailable` | 503 | none | Storage not configured (no R2 settings, e.g. a fresh clone). Checked first, on both endpoints. |
| `vehicle.notFound` | 404 | none | Another user's car, or no such car (both endpoints). |
| `vehiclePhoto.vehicleArchived` | 400 | none | `PUT` on an archived car, like `issue.vehicleArchived` and `tireMount.vehicleArchived`. (`DELETE` is allowed.) |
| `http.429` | 429 | none; `Retry-After` header in seconds | `PUT` only, per signed-in user: a third upload while two are still running, or more than **10 uploads in 10 minutes** (fixed window). Checked before everything else, also before the body is read. Same shape as the app's other 429s. |
| `file.required` | 400 | none | No `file` field, an empty file, a body that isn't multipart, or a malformed multipart body. |
| `file.tooLarge` | 413 | `maxBytes`: 10485760 | The file is over 10 MB. Over about 10 MB + 64 KB the server stops reading the body; a browser may then see a dropped connection instead of the 413, so check the size before sending. |
| `file.unsupportedType` | 400 | none | Not a well-formed JPEG, PNG or WebP by content (a text file named `.jpg`, a GIF, HEIC, a cut-off file). |
| `http.500` | 500 | none | The upload to storage itself failed (R2 down or refused). The car is unchanged. |

Order of checks on `PUT`: upload rate limit, storage, car ownership, archived, file present, size, type.

Other endpoints keep the 64 KB body limit (`http.413`).

## Examples (curl, live API and the real bucket)

Account id, bucket, credential and signature redacted; the rest is as returned.

```
PUT /api/vehicles/bf52a4c4-a81c-4ddc-a537-312a69c83dac/photo   (-F "file=@gps.jpg;type=image/jpeg", a 788-byte JPEG with GPS EXIF and rotation 6)
200
{"id":"bf52a4c4-a81c-4ddc-a537-312a69c83dac","nickname":"Photo test","make":null,"model":null,"year":null,"vin":null,"plate":null,
 "fuelType":null,"purchaseDate":null,"purchasePrice":null,
 "photoUrl":"https://<account>.r2.cloudflarestorage.com/<bucket>/users/a5974571-50c8-4b44-bd49-488c23896e52/vehicles/bf52a4c4-a81c-4ddc-a537-312a69c83dac/photo/008ba686bcd94416a05dbc5127704c25.jpg?X-Amz-Expires=3600&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=<redacted>&X-Amz-Date=20261017T171137Z&X-Amz-SignedHeaders=host&X-Amz-Signature=<redacted>",
 "currentOdometerKm":0.00,"avgKmPerDay":null,"isArchived":false}
```
GET on that URL: 200 `image/jpeg`, 720 bytes; no GPS, rotation 6 kept, decodes as 64x48. The same URL without the signature: 400.

```
PUT .../photo  (-F "file=@car.jpg;type=image/jpeg", really a PNG)   -> 200, photoUrl ends in .png; the old .jpg's signed URL now gives 404
PUT .../photo  (-F "file=@text.jpg", 5 bytes of text)
400 {"title":"Validation failed","status":400,"detail":"The file must be a JPEG, PNG or WebP image.","code":"file.unsupportedType"}
PUT .../photo  (10,485,761 bytes, and also 12,000,000 bytes)
413 {"title":"Payload too large","status":413,"detail":"The photo must be 10 MB or smaller.","code":"file.tooLarge","maxBytes":10485760}
PUT .../photo  (-F "other=x")
400 {"title":"Validation failed","status":400,"detail":"Choose a photo to upload.","code":"file.required"}
PUT .../photo  (another user's token)   -> 404 {"...","code":"vehicle.notFound"}   (DELETE the same)
PUT .../photo  (car archived)
400 {"title":"Validation failed","status":400,"detail":"This car is archived.","code":"vehiclePhoto.vehicleArchived"}
DELETE .../photo  (car archived)   -> 204; the photo's signed URL now gives 404; GET the car -> "photoUrl":null
PUT /api/vehicles/{id}  {"nickname":"Photo test","photoUrl":"users/x/y.jpg"}   -> 200, "photoUrl":null
```

## Dependencies

- `AWSSDK.S3` 4.0.104.4 (Apache-2.0), in Infrastructure only.
- Metadata stripping is hand-written (`src/OnlyCars.Application/Common/ImageFiles.cs`, no library, no licence): it removes metadata blocks from the file structure without decoding or re-encoding the image.
