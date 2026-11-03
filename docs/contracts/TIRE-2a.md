# API contract: TIRE-2a, tires per wheel

Published by backend-engineer, verified with curl against the API on LocalDB. Replaces the MVP5-D/E tire contract: **`/api/tire-sets*`, `/api/tire-mounts*`, `POST .../tires/mount` and `.../tires/unmount` are gone.** All endpoints need the JWT; another user's car, tire or rotation is **404** (`vehicle.notFound`, `tire.notFound`, `tireRotation.notFound`). Every distance is in **km**; dates are `YYYY-MM-DD`; a missing date is today (UTC), with one day of slack for the client's local date.

Enums are strings, case-sensitive: `TirePosition` = `FL | FR | RL | RR | Spare`, `TireSeason` = `Summer | Winter | AllSeason` (a number is the generic `http.400`).

## Shapes

```
TireDto {
  id, position,                 // on the car: its wheel now; removed: the wheel it came off
  brand, model?, size?, season, dotCode?,
  dotDate?,                     // Monday of the DOT week when dotCode ends in 4 digits WWYY, WW 01-53 (20YY); else null
  purchaseDate?, fittedAt, fittedOdometerKm,
  removedAt?, removedOdometerKm?,   // null while on the car
  kmOnTire,                     // max(0, (removedOdometerKm ?? car's current km) - fittedOdometerKm)
  notes?, serviceRecordId?,     // the Replace record that bought it; null for tires entered as already on the car, or after that record is deleted
  latestMeasurement?: { measuredAt, position, pressureBar?, treadDepthMm? }
}
VehicleTiresDto {
  current: TireDto[],           // on the car, in FL, FR, RL, RR, Spare order; an empty wheel is just missing
  removed: TireDto[],           // newest removal first (the Tire history)
  lastCheckDate?,
  lastRotation?: { id, date, odometerKm, kmSince }   // kmSince = max(0, car's current km - odometerKm)
}
TireCheckDto    { measuredAt, items: [{ tireId, position, pressureBar?, treadDepthMm? }] }   // items in wheel order
TireRotationDto { id, date, odometerKm, notes?, moves: [{ tireId, fromPosition, toPosition }] }  // moves [] = migrated, "Wheels not recorded"
```

Age (TIRE-2b): `dotDate`, else `purchaseDate`, else `fittedAt`.

## Endpoints

| Method and path | Body | Success |
|---|---|---|
| `GET /api/vehicles/{id}/tires` | | 200 `VehicleTiresDto` |
| `POST /api/vehicles/{id}/tires/replace` | `ReplaceTiresRequest` | 200 `VehicleTiresDto` (after the save) |
| `PUT /api/tires/{id}` | `UpdateTireRequest` | 200 `TireDto` |
| `DELETE /api/tires/{id}` | | 204 |
| `GET /api/vehicles/{id}/tires/checks` | | 200 `TireCheckDto[]`, newest 50 dates, removed tires' measurements included |
| `POST /api/vehicles/{id}/tires/checks` | `TireCheckRequest` | 201 `TireCheckDto`: the whole check of that date |
| `DELETE /api/vehicles/{id}/tires/checks/{measuredAt}` | | 204 (every measurement of the car on that date) |
| `GET /api/vehicles/{id}/tires/rotations` | | 200 `TireRotationDto[]`, newest first (by date, then the later created) |
| `POST /api/vehicles/{id}/tires/rotations` | `TireRotationRequest` | 201 `TireRotationDto` |
| `DELETE /api/tire-rotations/{rotationId}` | | 204; the tires go back to their `fromPosition` |

Replace, checks and rotations are refused on an archived car (`tire.vehicleArchived`); GET, PUT, DELETE work on it.

### Replace
```
ReplaceTiresRequest { positions: TirePosition[], date?, odometerKm, brand, model?, size?, season, dotCode?, purchaseDate?,
                      cost?, shopName?, notes?, confirmCorrection?: false }
```
- `positions`: one position, `["FL","FR"]`, `["RL","RR"]`, the four, or `["Spare"]` alone, in any order; anything else is `tire.invalidPositions`.
- One save: each tire on those positions is removed at `date`/`odometerKm`, one new tire per position is fitted with the same details.
- Not dated before the newest rotation that moved one of the tires on those positions (`tire.dateBeforeRotation`, `latestDate`): before it, that tire was on another wheel. The rotation's own date is fine; rotations of other tires don't count.
- It creates **one service record** (no tasks; `cost` → `totalCost`, `shopName`, `notes`) through the normal create path: same odometer reading and date-order rules (`odometer.lowerThanPrevious` / `higherThanNext`, resend with `confirmCorrection: true`). Each new tire's `serviceRecordId` points at it: use it for the "View record" link and the receipt (existing Add file on the record). It shows in history and counts under **Tires** in Reports.
- **No record** (and no odometer reading) when every position was empty and there is no `cost` and no `shopName` (entering tires already on the car). `cost: 0` or a shop makes one.
- `notes` go on the record and on each new tire.

### PUT tire
`UpdateTireRequest { brand, model?, size?, season, dotCode?, purchaseDate?, notes? }`: the detail fields only (a whole replace: a missing optional field is cleared). Fitted and removed dates can't be edited.

### DELETE tire
Fixes a mistake: deletes the tire and its measurements, leaves the wheel empty (the previous tire is not put back); its service record stays. `409 tire.rotated` if any rotation moved it (delete that rotation first).

### Checks
`TireCheckRequest { measuredAt?, items: [{ position, pressureBar?, treadDepthMm? }] }`. Each item is attached to the tire on that wheel now. Bar 0.5-6.0 with up to 2 decimals, mm 0-20 with up to 1; at least one per item. Another wheel on a date that already has a check joins that date's check.

### Rotations
`TireRotationRequest { date?, odometerKm, notes? (500), moves: [{ fromPosition, toPosition }] }`. A permutation: every `from` holds a tire, the `to` positions are the same set as the `from` positions, no position twice, no tire to its own wheel (`from` = `to`) (the spare may swap in). Front to back: `FL→RL, RL→FL, FR→RR, RR→FR`; cross: `FL→RR, RR→FL, FR→RL, RL→FR`. Not dated before the car's newest rotation. Adds no odometer reading. Only the newest rotation can be deleted.

## Error codes

| Code | Status | Extensions | When |
|---|---|---|---|
| `tire.invalidPositions` | 400 | | positions not one of the allowed groups |
| `tire.invalidBrand` / `invalidModel` / `invalidSize` / `invalidDotCode` / `invalidNotes` | 400 | | brand blank or > 50; model > 50; size > 30; DOT > 20; notes > 1,000 (after trimming) |
| `tire.invalidSeason` | 400 | | season missing |
| `tire.futurePurchaseDate` | 400 | | purchase date after today |
| `tire.futureDate` | 400 | | replace, check or rotation date after today |
| `date.tooEarly` | 400 | `minDate` | any date before 1900-01-01 |
| `odometer.invalidValue` | 400 | | km missing, negative or too large |
| `tire.dateBeforeFitted` | 400 | `fittedAt`, `position`, (`index` on checks and rotations) | the date is before a tire involved was fitted |
| `tire.odometerBeforeFitted` | 400 | `fittedOdometerKm`, `position` | replace km below the old tire's fitted km |
| `tire.dateBeforeRotation` | 400 | `latestDate` | replace dated before the newest rotation that moved one of the tires on those positions; a date-field error, like `tireRotation.beforeLatest` |
| `tire.limitReached` | 400 | `max` (100) | 100 tires per car, removed ones included |
| `tire.vehicleArchived` | 400 | | replace, check or rotation on an archived car |
| `odometer.lowerThanPrevious` / `odometer.higherThanNext` | 400 | `previousKm` / `nextKm` | replace that makes a record, against the car's readings |
| `serviceRecord.invalidCost` / `shopTooLong` / `notesTooLong` / `tooMany`, `odometer.tooMany` | 400 | as on POST service-records | replace that makes a record |
| `tire.rotated` | 409 | | DELETE tire that a rotation moved |
| `tireMeasurement.empty` | 400 | (`index`) | no items, or an item with neither value |
| `tireMeasurement.invalidPosition` / `invalidPressure` / `invalidTread` / `duplicatePosition` | 400 | `index` | per item |
| `tireMeasurement.noTire` | 400 | `index`, `position` | no tire on that wheel |
| `tireMeasurement.duplicate` | 409 | `measuredAt` | a tire of the request was already measured that date |
| `tireMeasurement.limitReached` | 400 | `max` (1,000) | per tire |
| `tireMeasurement.notFound` | 404 | | DELETE check on a date with no measurements |
| `tireRotation.invalidMoves` | 400 | | no moves, not a permutation, or a tire moved to its own wheel (`from` = `to`) |
| `tireRotation.noTire` | 400 | `index`, `position` | a `from` with no tire |
| `tireRotation.invalidNotes` | 400 | | notes > 500 |
| `tireRotation.beforeLatest` | 400 | `latestDate` | dated before the car's newest rotation |
| `tireRotation.limitReached` | 400 | `max` (200) | per car |
| `tireRotation.notLatest` | 409 | | DELETE a rotation that is not the car's newest |
| `tireRotation.tireRemoved` | 409 | | DELETE a rotation one of whose tires was removed since |
| `concurrency.conflict` | 409 | | the same car's tires changed at the same time elsewhere |

## Export (`GET /api/me/export`)
`formatVersion` is now **2**. The top-level `tireSets` is gone; each vehicle has `tires` (with `measurements: [{measuredAt, position, pressureBar, treadDepthMm}]`) and `rotations` (with `moves`).

## Migrated data
Every old mount became four tires (plus a Spare when it had Spare measurements) with the set's details, `fittedAt`/`removedAt` from the mount, no `serviceRecordId`. Old checks are under those tires; old rotations have `moves: []`. A set never mounted is not shown.

## Examples (curl, LocalDB)
```
POST /api/vehicles/{id}/tires/replace
{"positions":["FR","FL"],"date":"2026-10-01","odometerKm":52000,"brand":"Pirelli","model":"Cinturato P7","size":"205/55 R16",
 "season":"Summer","dotCode":"DOT XY 3825","purchaseDate":"2026-10-01","cost":720.50,"shopName":"Tire shop","notes":"Receipt attached"}
→ 200 {"current":[{"id":"72b5214d-…","position":"FL","brand":"Pirelli","model":"Cinturato P7","size":"205/55 R16","season":"Summer",
   "dotCode":"DOT XY 3825","dotDate":"2025-09-15","purchaseDate":"2026-10-01","fittedAt":"2026-10-01","fittedOdometerKm":52000.00,
   "removedAt":null,"removedOdometerKm":null,"kmOnTire":0,"notes":"Receipt attached","serviceRecordId":"8522770b-…","latestMeasurement":null}, …],
 "removed":[{"id":"e115eb55-…","position":"FR","brand":"Michelin","model":"Primacy 4",…,"fittedAt":"2026-02-01","fittedOdometerKm":41000.00,
   "removedAt":"2026-10-01","removedOdometerKm":52000.00,"kmOnTire":11000.00,"serviceRecordId":null,…}, …],
 "lastCheckDate":null,"lastRotation":null}

POST /api/vehicles/{id}/tires/replace {"positions":["FL","RL"],"odometerKm":52000,"brand":"X","season":"Summer"}
→ 400 {"title":"Validation failed","status":400,"detail":"Pick one wheel, the front pair, the rear pair, all four, or the spare.","code":"tire.invalidPositions"}

POST /api/vehicles/{id}/tires/replace {"positions":["FL"],"date":"2026-09-01","odometerKm":52000,"brand":"X","season":"Summer"}
→ 400 {…,"code":"tire.dateBeforeFitted","fittedAt":"2026-10-01","position":"FL"}

PUT /api/tires/{id} {"brand":"Pirelli","model":"Cinturato P7","size":"205/55 R16","season":"Summer","dotCode":"DOT XY 4025","purchaseDate":"2026-09-30","notes":"Left front, small cut"}
→ 200 {"id":"72b5214d-…","position":"RL",…,"dotDate":"2025-09-29",…,"latestMeasurement":{"measuredAt":"2026-10-20","position":"FL","pressureBar":2.30,"treadDepthMm":7.5}}

DELETE /api/tires/{id}   (a rotated tire)
→ 409 {"title":"Conflict","status":409,"detail":"A rotation moved this tire. Delete that rotation first.","code":"tire.rotated"}

POST /api/vehicles/{id}/tires/checks {"measuredAt":"2026-10-20","items":[{"position":"FL","pressureBar":2.3,"treadDepthMm":7.5},{"position":"RR","pressureBar":2.2}]}
→ 201 {"measuredAt":"2026-10-20","items":[{"tireId":"72b5214d-…","position":"FL","pressureBar":2.30,"treadDepthMm":7.5},
   {"tireId":"6dda2695-…","position":"RR","pressureBar":2.20,"treadDepthMm":null}]}

POST …/tires/checks {"measuredAt":"2026-10-21","items":[{"position":"Spare","pressureBar":3.5}]}
→ 400 {…,"code":"tireMeasurement.noTire","index":0,"position":"Spare"}
POST …/tires/checks {"measuredAt":"2026-10-20","items":[{"position":"FL","pressureBar":2.4}]}
→ 409 {…,"code":"tireMeasurement.duplicate","measuredAt":"2026-10-20"}
DELETE …/tires/checks/2026-10-20 → 204; again → 404 {…,"code":"tireMeasurement.notFound"}

POST /api/vehicles/{id}/tires/rotations {"date":"2026-10-25","odometerKm":53000,"notes":"Front to back","moves":[{"fromPosition":"FL","toPosition":"RL"},
  {"fromPosition":"RL","toPosition":"FL"},{"fromPosition":"FR","toPosition":"RR"},{"fromPosition":"RR","toPosition":"FR"}]}
→ 201 {"id":"560df714-…","date":"2026-10-25","odometerKm":53000,"notes":"Front to back","moves":[{"tireId":"72b5214d-…","fromPosition":"FL","toPosition":"RL"},
   {"tireId":"409667da-…","fromPosition":"FR","toPosition":"RR"},{"tireId":"20950632-…","fromPosition":"RL","toPosition":"FL"},{"tireId":"6dda2695-…","fromPosition":"RR","toPosition":"FR"}]}

POST …/tires/rotations {"date":"2026-10-26","odometerKm":53000,"moves":[{"fromPosition":"FL","toPosition":"RL"}]}
→ 400 {…,"code":"tireRotation.invalidMoves"}
POST …/tires/rotations {…,"moves":[{"fromPosition":"Spare","toPosition":"FL"},{"fromPosition":"FL","toPosition":"Spare"}]}
→ 400 {…,"code":"tireRotation.noTire","index":0,"position":"Spare"}
POST …/tires/rotations {"date":"2026-10-05","odometerKm":15100,"moves":[{"fromPosition":"FL","toPosition":"FL"}]}
→ 400 {"title":"Validation failed","status":400,"detail":"Each tire must move to another wheel, …","code":"tireRotation.invalidMoves"}

(after a rotation FL↔RL dated 2026-10-04)
POST …/tires/replace {"positions":["FL"],"date":"2026-09-04","odometerKm":14000,"brand":"Pirelli","season":"Summer"}
→ 400 {"title":"Validation failed","status":400,"detail":"The date is before the last rotation of these tires.","code":"tire.dateBeforeRotation","latestDate":"2026-10-04"}
the same dated 2026-10-04 → 200
DELETE /api/tire-rotations/560df714-… → 204 (the tires are back on FL, FR, RL, RR)

GET /api/reports/costs?year=2026 → 200 {…,"byCategory":[{"category":"Tires","total":720.50}],…}
```
