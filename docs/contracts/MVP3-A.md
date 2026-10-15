# API contract: MVP3-A, service history and recording a past service

Published by backend-engineer, verified with curl against the live API. Extends `MVP2-C.md`; everything there still holds unless changed below. All distances are km; all endpoints need the bearer token.

## New endpoints

### `GET /api/vehicles/{vehicleId}/service-records`
**200** `ServiceRecordDto[]`: the car's non-voided records, ordered by `date` DESC, then odometer DESC, then creation time DESC, then id (same order as `GET /api/service-records`, since MVP3-C).

```
ServiceRecordDto = {
  "id": guid,
  "date": "YYYY-MM-DD",
  "odometerKm": number,
  "shopName": string | null,     // null = DIY
  "totalCost": number | null,    // null = no cost entered
  "notes": string | null,
  "tasks": [ { "id": guid, "name": string, "category": TaskCategory } ]   // linked tasks that still exist, by name
}
```

Errors: `vehicle.notFound` (404, also another user's car).

### `POST /api/vehicles/{vehicleId}/service-records`
```
{
  "date": "YYYY-MM-DD" | null,   // send localToday() or the picked date; missing/null = UTC today
  "odometerKm": number,          // required, km
  "shopName": string | null,     // trimmed; empty or blank = DIY (null); up to 100 chars after trimming
  "totalCost": number | null,    // 0 to 1,000,000, at most 2 decimals
  "notes": string | null,        // trimmed; blank = null; up to 1,000 chars after trimming
  "taskIds": guid[] | null,      // 0 or more of this car's tasks; duplicates ignored
  "confirmCorrection": boolean   // default false; skips the date-order checks, as for readings
}
```

**201** `{ "record": ServiceRecordDto, "tasks": MaintenanceTaskDto[] }`. `tasks` are the linked tasks (by name), with status recomputed.

In one save:
- the record, and one link per task holding the task's previous last done (for Undo);
- each linked task's `lastDone*` moves to the record's date and odometer **only if the record is at least as recent** (by date, then odometer). An older record is linked and listed, but the task keeps its last done;
- an odometer reading with `source: "Service"` at the record's date and odometer. The car's current odometer and average are recomputed, so a record dated on or after the latest reading becomes the current odometer. Re-fetch the car and the odometer history.

Order of checks (the first failure wins; nothing is saved on any error):

| Code | Status | Extensions | When |
|---|---|---|---|
| `vehicle.notFound` | 404 | none | Not the caller's car |
| `serviceRecord.futureDate` | 400 | none | `date` after UTC today + 1 day |
| `odometer.invalidValue` | 400 | none | `odometerKm` missing |
| `serviceRecord.invalidCost` | 400 | none | Same rule as the reset |
| `serviceRecord.shopTooLong` | 400 | none | `shopName` over 100 characters after trimming |
| `serviceRecord.notesTooLong` | 400 | none | `notes` over 1,000 characters after trimming |
| `maintenanceTask.notFound` | 404 | none | A task id that isn't this car's (also another user's task) |
| `odometer.invalidValue` | 400 | none | `odometerKm` below 0 or above 10,000,000 (checked with the reading rules, so after the task check) |
| `odometer.lowerThanPrevious` | 400 | `previousKm` (km) | Without `confirmCorrection`, below the reading before `date` |
| `odometer.higherThanNext` | 400 | `nextKm` (km) | Without `confirmCorrection`, above the reading after `date` |

## Changed

### `POST /api/vehicles/{vehicleId}/service-records/{recordId}/void`
Same response (**200** `MaintenanceTaskDto[]` of all the record's linked tasks, by name) and same side effects on the odometer (its Service reading is deleted, or kept as `Manual` if it is the car's only reading).

- **`serviceRecord.notLatest` is retired.** Any non-voided record can be voided, in any order.
- New task rule: each linked task whose current `lastDone*` equals the voided record's date and odometer is recomputed (decisions.md "Void recompute, corrected"): start from the value it had before the voided record; while that value equals another voided linked record's date and odometer, replace it with the value that record had before it; then take the later, by date then odometer, of that value and the latest remaining non-voided linked record. So undo never goes back past a manual edit made before the voided record. Tasks whose last done came from somewhere else (a later record or a manual edit) are returned unchanged.
- Order of checks: `vehicle.notFound`, `serviceRecord.notFound`, `serviceRecord.alreadyVoided` (409).

`POST .../tasks/{taskId}/reset` is unchanged (it always moves last done, and its reading skips the date-order checks).

## Examples (from curl)
```
GET /api/vehicles/{id}/service-records
→ 200 []

POST /api/vehicles/{id}/service-records
  {"date":"2026-10-15","odometerKm":50300,"shopName":" Garage Cohen ","totalCost":250.5,"notes":"Full service","taskIds":["d4e10a7e-…","30fa1670-…"]}
→ 201 {"record":{"id":"9334b226-…","date":"2026-10-15","odometerKm":50300,"shopName":"Garage Cohen","totalCost":250.5,"notes":"Full service",
        "tasks":[{"id":"30fa1670-…","name":"Air filter","category":"Filters"},{"id":"d4e10a7e-…","name":"Oil","category":"Oil"}]},
       "tasks":[{"id":"30fa1670-…",…,"lastDoneOdometerKm":50300,"lastDoneDate":"2026-10-15","status":"Ok",…},{"id":"d4e10a7e-…",…}]}

POST …/service-records  {"date":"2026-09-15","odometerKm":44000,"shopName":"","taskIds":["d4e10a7e-…"]}   (a 45,000 reading is dated 2026-08-16)
→ 400 {"title":"Validation failed","status":400,"detail":"New reading (44000 km) is lower than the reading before it (45000.00 km). …","code":"odometer.lowerThanPrevious","previousKm":45000.00}

POST …/service-records  {"date":"2026-09-15","odometerKm":51000,"taskIds":[]}
→ 400 {…,"code":"odometer.higherThanNext","nextKm":50000.00}

POST …/service-records  {"date":"2026-09-15","odometerKm":44000,"shopName":"","taskIds":["d4e10a7e-…"],"confirmCorrection":true}
→ 201 {"record":{"id":"a05630c7-…","date":"2026-09-15","odometerKm":44000,"shopName":null,"totalCost":null,"notes":null,"tasks":[{"id":"d4e10a7e-…","name":"Oil","category":"Oil"}]},
       "tasks":[{"id":"d4e10a7e-…",…,"lastDoneOdometerKm":50300.00,"lastDoneDate":"2026-10-15",…}]}      (older than Oil's last done: linked, last done unchanged)

POST …/service-records  {"date":"2026-10-17","odometerKm":50300}
→ 400 {"title":"Validation failed","status":400,"detail":"The service date can't be in the future.","code":"serviceRecord.futureDate"}

POST …/service-records  {"date":"2026-10-15","odometerKm":50300,"shopName":"xxx…(101)"}
→ 400 {…,"code":"serviceRecord.shopTooLong"}

POST …/service-records  {"date":"2026-10-15","odometerKm":50300,"taskIds":["00000000-0000-0000-0000-000000000001"]}
→ 404 {"title":"Not found","status":404,"detail":"MaintenanceTask '00000000-…-000000000001' was not found.","code":"maintenanceTask.notFound"}

POST …/service-records/9334b226-…/void        (the newer record first)
→ 200 [{"id":"30fa1670-…","name":"Air filter",…,"lastDoneOdometerKm":45000.00,"lastDoneDate":"2025-09-10",…},
       {"id":"d4e10a7e-…","name":"Oil",…,"lastDoneOdometerKm":44000.00,"lastDoneDate":"2026-09-15","status":"Overdue",…}]

POST …/service-records/a05630c7-…/void        (then the older one: back to Oil's original values)
→ 200 [{"id":"d4e10a7e-…","name":"Oil",…,"lastDoneOdometerKm":40000.00,"lastDoneDate":"2025-09-10",…}]

POST same again
→ 409 {…,"code":"serviceRecord.alreadyVoided"}
```
