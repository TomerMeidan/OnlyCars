# API contract: OFF-1, idempotent odometer add (offline queue)

Published by backend-engineer. One endpoint changes; no new error codes; reading DTOs and the export are unchanged.

## `POST /api/vehicles/{vehicleId}/odometer`

Request body (`AddOdometerReadingRequest`), one new optional field:

```json
{ "valueKm": 12345, "readingDate": "2026-10-24", "confirmCorrection": false, "clientRequestId": "3f2b8c1e-9d4a-4c7e-8b1a-2e5f6a7b8c9d" }
```

- `clientRequestId`: optional GUID (`crypto.randomUUID()`), made once per queued reading and resent unchanged on every retry,
  also on the "Save as correction" resend.
- Without it (or `null`) the endpoint behaves exactly as before.

Response: **200** `OdometerReadingDto` `{ id, vehicleId, valueKm, readingDate, source }`, the same shape as before (no `clientRequestId` in it).

Rules, in order:
1. Ownership: an unknown car or another user's car is **404** (`vehicle.notFound`), even if the id exists there.
2. If this car already has a reading with this `clientRequestId`: **200** with that reading **as it is now** (also if edited since,
   so `valueKm`/`readingDate` may differ from the body), nothing created, no date-order, cap or value checks.
   The client should treat this exactly like a fresh success.
3. Otherwise the usual checks and create. The id is scoped per car: the same id on another car (or another user's car) is a normal new reading.
4. Two identical posts at once give one row; both get **200** with the same reading.

Errors (unchanged, only reached when the id is new for this car):

| Status | `code` | Extensions |
|---|---|---|
| 400 | `odometer.lowerThanPrevious` | `previousKm` |
| 400 | `odometer.higherThanNext` | `nextKm` |
| 400 | `odometer.invalidValue` | |
| 400 | `odometer.futureDate` | |
| 400 | `odometer.tooMany` | `max` (5000) |
| 400 | `http.400` | `errors.clientRequestId` when it is not a GUID |
| 401 | | not signed in / token of a deleted user |
| 404 | `vehicle.notFound` | unknown or another user's car |
| 429 | `http.429` | app-wide per-user rate limit |

Note: archived cars are not refused by this endpoint (unchanged behaviour); there is no `vehicle.archived` code here.

## Example (from curl on 5150)

```
POST /api/vehicles/103668c9-584d-4e20-9a34-f650c067426d/odometer
{"valueKm":12345,"readingDate":"2026-10-24","confirmCorrection":false,"clientRequestId":"3f2b8c1e-9d4a-4c7e-8b1a-2e5f6a7b8c9d"}
200 {"id":"9c90250d-d022-475c-812b-590526078f10","vehicleId":"103668c9-584d-4e20-9a34-f650c067426d","valueKm":12345,"readingDate":"2026-10-24","source":"Manual"}

Same body again, and again with "valueKm":100 (would be lowerThanPrevious):
200 {"id":"9c90250d-d022-475c-812b-590526078f10","vehicleId":"103668c9-584d-4e20-9a34-f650c067426d","valueKm":12345.00,"readingDate":"2026-10-24","source":"Manual"}

{"valueKm":100,"readingDate":"2026-10-24","clientRequestId":"0b5e9a2d-1111-4c7e-8b1a-2e5f6a7b8c9d"}
400 {"title":"Validation failed","status":400,"code":"odometer.lowerThanPrevious","previousKm":12345.00,...}
```

`12345` vs `12345.00` is the same JSON number (a fresh reading vs one read back from the database); compare numerically.
