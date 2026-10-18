# API contract: LOW-6, backend changes (files and photos Lows)

Published by backend-engineer, checked with Node `fetch` against the live API (LocalDB, Development) and the real `onlycars-dev` R2 bucket; the test car's photo was deleted through the API afterwards. No migration, no new endpoint, no new field. Only what changed; the rest is `FILE-1.md`, `FILE-2.md` and `FILE-3.md` (FILE-1's error table is updated).

## Changed: `PUT /api/vehicles/{id}/photo` and `DELETE /api/vehicles/{id}/photo` can answer 409 (L116)

| Code | Status | Extensions | When |
|---|---|---|---|
| `concurrency.conflict` | 409 | none | Another photo change (`PUT` or `DELETE`) on the same car saved while this one ran. The file this request uploaded is deleted; the car keeps the other change. Same body as every other 409 conflict. |

The client should reload the car (`GET /api/vehicles/{id}`) and show the conflict message, as it does for service files and run photos.

Approach: the new key is saved with a conditional update, `UPDATE Vehicles SET PhotoUrl = @new, UpdatedAt = @now WHERE Id = @id AND PhotoUrl = @keyThisRequestRead` (`ExecuteUpdate`, `VehicleService.SwapPhotoKeyAsync`). No row changed means another change won: the new object is deleted and the request gets 409. `Vehicle` has **no** concurrency token, so car edits, archiving and odometer recomputes never conflict with a photo change (they don't write `PhotoUrl`). `DELETE` uses the same conditional, so a remove racing a replace can't orphan the replacement either.

## Changed: `DELETE /api/vehicles/{id}/photo` clears a broken key (L118)

A stored key that fails the key check (not `users/{userId}/vehicles/{vehicleId}/photo/{32 hex}.jpg|png|webp`) is now set to null: **204**, and nothing is deleted from storage. Before, the column kept it. (The client never sees the difference: such a key was already `photoUrl: null`.)

## Changed: animated WebP (L117)

Inside each `ANMF` frame only `ALPH`, `VP8 ` and `VP8L` chunks are kept (after the frame's 16-byte header); anything else (`EXIF`-like, unknown) is dropped and the frame and RIFF sizes are rewritten. An `ANMF` chunk shorter than its 16-byte header is `400 file.unsupportedType`. Applies to the car photo, service files and run photos (one `ImageFiles.Clean`).

## Changed: Development upload limit (L119; closes L120)

| Config | `RateLimiting:UploadPermitLimit` (per user, per 10 minutes) |
|---|---|
| Production (`appsettings.json`, code default) | **10**, unchanged |
| Development (`appsettings.Development.json`) | **10,000**, like the other dev limits |

The 2-at-once concurrency part of the `upload` limit is unchanged in both (a third upload while two run is still 429; xUnit `Http_AThirdUploadWhileTwoAreRunning_Is429` stays the evidence for L120, since a live check under high dev limits proves nothing).

## Examples (live, Development)

```
PUT /api/vehicles/{id}/photo  x12 in a row (a 1x1 PNG)          -> 200 x12 (more than 10 in 10 minutes accepted in Development)
PUT /api/vehicles/{id}/photo  x2 at once, 5 rounds              -> 5 x 200, 5 x 409
409 {"title":"Conflict","status":409,"detail":"This was changed at the same time somewhere else. Reload and try again.","code":"concurrency.conflict"}
PUT /api/vehicles/{id}/photo  (134-byte animated WebP, EXIF and UNKN chunks inside its ANMF frame)
200, photoUrl ends in .webp; the stored file is 94 bytes, contains neither chunk, RIFF size = length - 8, ANMF size 42 (16 + ALPH + VP8L)
DELETE /api/vehicles/{id}/photo                                 -> 204; the old signed URL then gives 404; GET the car -> "photoUrl":null
```

## No behaviour change

- L138: comments only (the early `Storage()` calls keep 503 ahead of 404).
- L125: a test only (`vehicle.vinTaken` on `PUT /api/vehicles/{id}`, unchanged behaviour).
- L128: closed as accepted; the quota shortcut stays.
- L139: `scripts/cleanup-test-users.sql` only (not part of the app).
