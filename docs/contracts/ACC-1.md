# API contract: ACC-1, export my data

Published by backend-engineer. Needs the JWT. Errors are problem+json with `code`.

## `GET /api/me/export`

No query, no body. Rate limit per signed-in user: 1 export at a time and 5 per 10 minutes; app-wide, 3 exports at a time.

**200** headers:
- `Content-Type: application/json; charset=utf-8` (UTF-8, no BOM, indented, Hebrew written as is, not `\u` escapes)
- `Content-Disposition: attachment; filename=onlycars-export-YYYY-MM-DD.json; filename*=UTF-8''onlycars-export-YYYY-MM-DD.json`
  (the server's UTC date; ASP.NET writes the name without quotes and adds `filename*`; read either)
- `Cache-Control: no-store`

To use the server's file name from `fetch`, read `Content-Disposition` (`filename=` up to `;`). It is readable same-origin (the Vite proxy
in dev) and cross-origin (the CORS policy now exposes `Content-Disposition`). Fallback if it is missing: `onlycars-export-` +
`exportedAt.slice(0, 10)` + `.json`, the same UTC date.

### Errors
| Status | code | When | Extensions |
|---|---|---|---|
| 401 | (empty body) | no or invalid token | |
| 429 | `http.429` | a second export while one is running, a 6th in 10 minutes, or a 4th running at once across all users | `Retry-After` header (seconds) |
| 404 | `user.notFound` | the token's user no longer exists | |

### Body
Values as stored: distances in km (whatever the user's display unit), money as numbers in `units.currency`, dates `YYYY-MM-DD`,
timestamps ISO 8601 with offset (`+00:00`), enums as their names. Every list is oldest first, then by id (items by their sort order),
so two exports of unchanged data differ only in `exportedAt`. Archived cars, voided records, turned-off tasks and checklists, done to-dos
and tire sets not on a car are all included.

```
{ formatVersion: 1, exportedAt, units: { distance: "km", currency },
  account: { email, distanceUnit, currency, locale, theme, reminderLeadDays, createdAt },
  vehicles: [ { id, nickname, make, model, year, vin, plate, fuelType, purchaseDate, purchasePrice, currentOdometerKm,
      isArchived, archivedAt, hasPhoto, createdAt,
      odometerReadings: [ { id, valueKm, readingDate, source, serviceRecordId } ],
      maintenanceTasks: [ { id, templateKey, name, category, intervalKm, intervalDays, dueSoonPercent, isEnabled,
          lastDoneOdometerKm, lastDoneDate } ],
      serviceRecords: [ { id, date, odometerKm, shopName, totalCost, notes, isVoided, taskIds: [guid],
          items: [ { description, brand, partNumber, quantity, unitCost, isLabor } ],
          attachments: [ { fileName, contentType, sizeBytes, createdAt } ] } ],
      checklists: [ { id, templateId, intervalKm, intervalDays, lastRunOdometerKm, lastRunDate, startDate, startOdometerKm, isEnabled,
          runs: [ { id, runAt, odometerKm, odometerReadingId, notes,
              items: [ { id, templateItemId, label, type, unit, minValue, maxValue, boolValue, numberValue, textValue, isFlagged } ],
              photos: [ { fileName, contentType, sizeBytes, createdAt } ] } ] } ],
      issues: [ { id, title, description, status, sourceRunItemId, resolvedAt, createdAt } ],
      documents: [ { id, type, expiryDate, cost, notes } ] } ],
  checklistTemplates: [ { id, name, items: [ { id, label, type, unit, minValue, maxValue, sortOrder } ] } ],
  tireSets: [ { id, brand, model, size, season, purchaseDate, dotCode, notes,
      mounts: [ { vehicleId, mountedAt, mountOdometerKm, unmountedAt, unmountOdometerKm, kmDriven,
          checks: [ { measuredAt, measurements: [ { position, pressureBar, treadDepthMm } ] } ],
          rotations: [ { date, odometerKm, notes } ] } ] } ] }
```

Differences from the ticket's sketch (all additions; every sketched name is as written):
- `checklists[].startDate`, `startOdometerKm`: the attach values the countdown falls back to (`VehicleChecklist.StartDate/StartOdometerKm`).
- `runs[].items[].id`: so an issue's `sourceRunItemId` can be followed; `type` and `unit` are the run-time snapshots, `label` is
  `ChecklistRunItem.LabelSnapshot`.
- `kmDriven` is computed as on the tire screens: unmount km minus mount km, or the car's current km minus mount km (at least 0) while mounted.
- `templateKey` is the starter task's key (`TaskTemplate.Key`), null for a task added by hand.
- `taskIds` are the tasks a record reset (`ServiceRecordTask.MaintenanceTaskId`).
- `issues[].description` has U+200E, U+200F and U+2066 to U+2069 removed; nothing else is altered.
- `runs[].odometerReadingId`: the reading the run logged (`ChecklistRun.OdometerReadingId`), null when the run had no odometer.
- `runs[].items[].minValue`, `maxValue`: the run-time snapshot of the number range (`ChecklistRunItem.MinValue/MaxValue`), null when unset.

Never in the body: the password hash, `PhotoUrl`/`FileUrl` storage keys, signed URLs, lockout or login data, `AvgKmPerDay`, snoozes
(`Notification` rows), other users' data.

### Example (live `curl`, 2026-10-18; a test user with one car and one record, trimmed)
```
GET /api/me/export
Authorization: Bearer <token>

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Content-Disposition: attachment; filename=onlycars-export-2026-10-18.json; filename*=UTF-8''onlycars-export-2026-10-18.json

{
  "formatVersion": 1,
  "exportedAt": "2026-10-18T12:38:25.740519+00:00",
  "units": { "distance": "km", "currency": "ILS" },
  "account": { "email": "acc1-1792327103357@onlycars.test", "distanceUnit": "Km", "currency": "ILS", "locale": "En",
    "theme": "System", "reminderLeadDays": 30, "createdAt": "2026-10-18T12:38:24.5697039+00:00" },
  "vehicles": [
    { "id": "0398965b-00e6-4c51-ac2c-7a5ba6966df2", "nickname": "Mazda 3", "make": "Mazda", "model": null, "year": 2018,
      "vin": null, "plate": null, "fuelType": null, "purchaseDate": null, "purchasePrice": null, "currentOdometerKm": 61000.00,
      "isArchived": false, "archivedAt": null, "hasPhoto": false, "createdAt": "2026-10-18T12:38:24.9456464+00:00",
      "odometerReadings": [ { "id": "3af63eb9-…", "valueKm": 61000.00, "readingDate": "2026-10-01", "source": "Service",
          "serviceRecordId": "31b39cc2-…" } ],
      "maintenanceTasks": [],
      "serviceRecords": [ { "id": "31b39cc2-…", "date": "2026-10-01", "odometerKm": 61000.00, "shopName": "Garage",
          "totalCost": 450.50, "notes": null, "isVoided": false, "taskIds": [], "items": [], "attachments": [] } ],
      "checklists": [], "issues": [], "documents": [] } ],
  "checklistTemplates": [],
  "tireSets": []
}
```
The real file is indented one property per line. The 6th export in 10 minutes:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 600
{"title":"Too many requests","status":429,"detail":"Too many requests. Try again later.","code":"http.429"}
```
Without a token: `401`, empty body.

## Caps (ACC-1 fix round)

Delegated decision, so an account and its export can't grow without bound. All are **400** problem+json, checked on create only,
each with the extension `max`. Existing data is never touched; editing, voiding and deleting stay allowed.

| code | When | `max` |
|---|---|---|
| `vehicle.tooMany` | adding a car when the user already has 50 (archived cars count) | `50` |
| `serviceRecord.tooMany` | logging a service (`POST /api/vehicles/{id}/service-records`) or marking a task done, when the car already has 2,000 records (voided ones count) | `2000` |
| `odometer.tooMany` | adding a reading when the car already has 5,000 of any source: a manual reading, a logged service, marking a task done, or a checklist run with an odometer | `5000` |

`odometer.` matches the other reading codes (`odometer.lowerThanPrevious` and so on). Example:
```
{"title":"Validation failed","status":400,"detail":"You can have up to 50 cars.","code":"vehicle.tooMany","max":50}
```

The export also has an app-wide limit: at most 3 exports run at once across all users; a 4th gets the same `429 http.429` as above.
Every API response now carries `X-Content-Type-Options: nosniff`.
