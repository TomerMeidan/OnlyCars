# API contract: MVP5-E, tire checks (pressure and tread) and rotations

Published by backend-engineer. Builds on `docs/contracts/MVP5-D.md`. **Status: done.** The migration `AddTireMeasurements` is applied; `dotnet test` 493 of 493 (including the LocalDB schema test) and smoke 368 of 368 against the live API. The shapes below come from the code and the xUnit tests; no separate curl run was made. The migration adds `TireChecks` (one per mount per date, unique), `TireMeasurements` (one per wheel of a check) and `TireRotations`, all cascading from the mount; the API shapes don't show this split.

Every endpoint needs the bearer token (401 without it) and only sees the caller's data. Another user's mount is a 404 `tireMount.notFound`; another user's rotation is a 404 `tireRotation.notFound`. Bodies over 64 KB are 413 `http.413`. Enums bind by name only: `"position": 0` is a 400 `http.400` with `errors`.

Dates are `YYYY-MM-DD`. Every km value is in **km** (convert for display and back on input, as in `tires-miles`). Pressure is always in **bar**, tread in **mm**. Numbers come back as JSON numbers; SQL Server returns them at column scale (`2.40`, `6.5`), so format them with up to 2 (pressure) and 1 (tread) fraction digits and no padding to show what the user typed.

## Shapes

```
TirePosition = "FL" | "FR" | "RL" | "RR" | "Spare"

TireCheckDto {
  "measuredAt": date,
  "items": [ { "position": TirePosition, "pressureBar": number|null, "treadDepthMm": number|null } ]   // FL, FR, RL, RR, Spare order; at least one value per item
}
TireRotationDto { "id": guid, "date": date, "odometerKm": number, "notes": string|null }
LastTireRotationDto { "date": date, "odometerKm": number, "kmSince": number }   // kmSince = max(0, car's current odometer - odometerKm), in km
```

`TireMountDto` (MVP5-D) gains two fields, **filled only on `VehicleTiresDto.current`** and always `null` on `past[]` and on `GET /api/tire-sets/{id}/mounts`:

```
"lastCheck": TireCheckDto|null,          // the newest check of the set on the car, or null
"lastRotation": LastTireRotationDto|null  // the newest rotation (by date, then odometer), or null
```

## Endpoints

| Method and path | Body | Success |
|---|---|---|
| `GET /api/tire-mounts/{id}/checks` | | 200 `TireCheckDto[]`, newest date first, at most the newest 50 dates. Works on closed mounts and archived cars. |
| `POST /api/tire-mounts/{id}/checks` | `{ measuredAt, items: [{ position, pressureBar, treadDepthMm }] }` | 201 `TireCheckDto` (the saved check) |
| `DELETE /api/tire-mounts/{id}/checks/{measuredAt}` | | 204; deletes every wheel of that date. Allowed on closed mounts and archived cars. |
| `GET /api/tire-mounts/{id}/rotations` | | 200 `TireRotationDto[]`, newest first (date, then odometer). At most 100 exist per mount. |
| `POST /api/tire-mounts/{id}/rotations` | `{ date, odometerKm, notes }` | 201 `TireRotationDto` |
| `DELETE /api/tire-rotations/{id}` | | 204. Allowed on closed mounts and archived cars. |
| `GET /api/vehicles/{vehicleId}/tires` | | 200 `VehicleTiresDto`, now with `current.lastCheck` and `current.lastRotation` |

`{id}` is the mount id: `current.id` from `GET /api/vehicles/{vehicleId}/tires`.

**Check**: `measuredAt` defaults to today (UTC) when omitted; send the user's local date. `items` has 1 to 5 entries, each position at most once, and each with `pressureBar`, `treadDepthMm` or both. Leave out empty rows. Pressure is 0.5 to 6.0 with up to 2 decimals; tread is 0 to 20 with up to 1 decimal (more decimals are a 400, never rounded). There is one check per mount per date; to change one, delete it and log it again.

**Rotation**: `date` defaults to today (UTC); `odometerKm` is required; `notes` is optional, up to 500 characters, trimmed (blank becomes null). A rotation **does not** add an odometer reading or change the car's odometer.

Logging (both POSTs) needs the set to be on the car (an open mount) and the car to be active. Deleting does not.

## Errors

All are ProblemDetails with `code`; 400 unless noted. `index` is the 0-based position of the bad entry in the `items` you sent (not the wheel), so map it back to the row you sent.

| Code | When | Extensions | Show on |
|---|---|---|---|
| `tireMount.notFound` (404) | mount id unknown or another user's | | section (reload, close the form) |
| `tireMount.vehicleArchived` | check or rotation on an archived car | | form |
| `tireMount.notOpen` | check or rotation on a closed mount (the set came off) | | section (reload, close the form) |
| `tireMount.dateBeforeMount` | date before the mount's `mountedAt` | `mountedAt` (date) | date |
| `tireMount.futureDate` | date after tomorrow (UTC; one day of slack for the local date) | | date |
| `date.tooEarly` | date before 1900-01-01 | `minDate` | date |
| `tireMeasurement.empty` | `items` missing or empty (no `index`), or an item with neither value | `index` (when an item) | that row, or the form |
| `tireMeasurement.invalidPosition` | an item with no `position` (or `null`) | `index` | that row |
| `tireMeasurement.invalidPressure` | pressure below 0.5, over 6.0 or more than 2 decimals | `index` | that row's pressure |
| `tireMeasurement.invalidTread` | tread below 0, over 20 or more than 1 decimal | `index` | that row's tread |
| `tireMeasurement.duplicatePosition` | the same position twice | `index` (the second one) | that row |
| `tireMeasurement.duplicate` (409) | a check already exists on that date for this mount, also when two arrive at once | `measuredAt` (date) | date |
| `tireMeasurement.limitReached` | a 201st check date on the mount | | form |
| `tireMeasurement.notFound` (404) | delete of a date with no check | | row (reload) |
| `odometer.invalidValue` | rotation odometer missing, below 0 or over 10,000,000 km | | odometer |
| `tireMount.odometerBeforeMount` | rotation odometer below the mount's `mountOdometerKm` | `mountOdometerKm` (km) | odometer |
| `tireRotation.invalidNotes` | notes over 500 | | notes |
| `tireRotation.limitReached` | a 101st rotation on the mount | | form |
| `tireRotation.notFound` (404) | rotation id unknown or another user's | | row (reload) |
| `http.400` | a numeric or unknown `position`, or a bad date in the path | `errors` | form |

## Examples (from the xUnit tests; curl examples to follow once the migration is applied)

```
POST /api/tire-mounts/{mount}/checks  {"measuredAt":"2026-10-17","items":[{"position":"Spare","treadDepthMm":8},{"position":"RR","pressureBar":2.25,"treadDepthMm":6.5},{"position":"FL","pressureBar":2.3}]}
201 {"measuredAt":"2026-10-17","items":[{"position":"FL","pressureBar":2.3,"treadDepthMm":null},{"position":"RR","pressureBar":2.25,"treadDepthMm":6.5},{"position":"Spare","pressureBar":null,"treadDepthMm":8}]}

POST the same date again
409 {"title":…,"status":409,"code":"tireMeasurement.duplicate","measuredAt":"2026-10-17"}

POST /api/tire-mounts/{mount}/checks  {"measuredAt":"2026-10-17","items":[{"position":"FL","pressureBar":2.4},{"position":"FR","pressureBar":6.01}]}
400 {…,"code":"tireMeasurement.invalidPressure","index":1}

POST /api/tire-mounts/{mount}/rotations  {"date":"2026-10-17","odometerKm":51200,"notes":"Front to back"}   (mounted at 50,000; car now at 52,000)
201 {"id":"…","date":"2026-10-17","odometerKm":51200,"notes":"Front to back"}
GET /api/vehicles/{car}/tires  →  "current": {…, "lastCheck": {…}, "lastRotation": {"date":"2026-10-17","odometerKm":51200,"kmSince":800}}
```
