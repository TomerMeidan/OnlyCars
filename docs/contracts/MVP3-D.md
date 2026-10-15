# API contract: MVP3-D, edit a service's date, odometer and tasks

Published by backend-engineer, verified with curl against the live API (SQL Server). Extends `MVP3-B.md`; everything there still holds unless changed below. Distances are km; all endpoints need the bearer token. No schema change, no migration.

## Changed: `PUT /api/vehicles/{vehicleId}/service-records/{recordId}`

```
{
  "shopName": string | null,          // MVP3-B: full state, left out = cleared
  "totalCost": number | null,         // MVP3-B: full state, left out = cleared (ignored when items are sent)
  "notes": string | null,             // MVP3-B: full state, left out = cleared
  "items": ServiceItemRequest[] | null, // MVP3-B: replaces the list, left out = cleared
  "date": "YYYY-MM-DD" | null,        // new; null or left out = unchanged
  "odometerKm": number | null,        // new; null or left out = unchanged
  "taskIds": guid[] | null,           // new; null or left out = unchanged; [] removes every task; duplicates ignored
  "confirmCorrection": boolean        // new; default false; overrides the date-order checks, as on POST
}
```

Note the asymmetry: the four MVP3-B fields are still full state (always send them, or they are cleared), while the four new ones keep the record's value when left out. Sending all of them every time is simplest; sending only the changed new fields is also valid.

**200** (changed from MVP3-B, which returned a bare `ServiceRecordDto`):

```
{
  "record": ServiceRecordDto,          // the updated record (date, odometerKm, tasks, items, ...)
  "tasks": MaintenanceTaskDto[]        // EVERY task of the car (not only the linked ones), with fresh lastDone*, status, remaining*
}
```

Same shape as POST's response; on POST `tasks` is still only the linked tasks. After a save, also refresh the car (current odometer, average) and the odometer history: a date or odometer change moves the record's Service reading.

### Side effects

- **Date / odometer** (only when the value differs from the stored one): the record moves; its linked Service reading moves to the new date and value (one is created if the record has none); the car's `currentOdometerKm` and `avgKmPerDay` are recomputed.
- **Removed task:** if its last done equals the record's old (date, km), it falls back by the "Void recompute, corrected" rule for that task; the link is deleted.
- **Added task:** a link with a snapshot of the task's current last done; its last done moves to the record only if the record is at least as recent (by date, then km).
- **Kept task, when date or odometer changed:** if its last done equals the record's old (date, km), it becomes the later of the void-rule fallback and the record's new (date, km); otherwise it moves only if the new values are at least as recent.
- **Snapshot chain:** other records' links of the same task whose snapshot equals this record's old (date, km) are re-pointed: to this record's own snapshot when the task is removed, to the new (date, km) when it is kept and moved. So voiding the records later still restores the original last done, in any order. Internal only; no response change.
- Records made by Mark done are edited the same way.

### Order of checks (first failure wins; nothing is saved on any error)

| Code | Status | Extensions | When |
|---|---|---|---|
| `vehicle.notFound` | 404 | none | Not the caller's car (also another user's) |
| `serviceRecord.notFound` | 404 | none | No such record on this car |
| `serviceRecord.alreadyVoided` | 409 | none | The record was deleted |
| `serviceRecord.futureDate` | 400 | none | New date after UTC today + 1 day (only checked when date or odometer changed) |
| MVP3-B item, cost, shop and notes codes | 400 | as in MVP3-B | unchanged |
| `maintenanceTask.notFound` | 404 | none | A `taskIds` entry that is not one of this car's tasks (another car's or user's). The ticket says `task.notFound`; the code POST has always returned is `maintenanceTask.notFound`, kept for both. |
| `odometer.invalidValue` | 400 | none | New odometer below 0 or above 10,000,000 (only when date or odometer changed) |
| `odometer.lowerThanPrevious` | 400 | `previousKm` | Breaks date order (skipped with `confirmCorrection: true`; the record's own reading is ignored) |
| `odometer.higherThanNext` | 400 | `nextKm` | Breaks date order (same) |

Unchanged date and odometer (left out, or sent with the stored values) run none of the date/odometer checks, so an MVP3-B body always saves.

## Examples (from curl)

Car at 50,000 km today; Oil last done 40,000; Filter last done 30,000; record at 2026-07-07, 45,000 km linked to Oil.

```
PUT /api/vehicles/{id}/service-records/{recordId}
  {"shopName":"Garage","date":"2026-08-26","odometerKm":46000,"taskIds":["<filter id>"]}
→ 200 {"record":{"id":"93e5ab92-…","date":"2026-08-26","odometerKm":46000,"shopName":"Garage","totalCost":null,"notes":null,
        "tasks":[{"id":"21756a0a-…","name":"Filter","category":"Oil"}],"items":[],"vehicleId":"e23a079e-…"},
       "tasks":[{"id":"21756a0a-…","name":"Filter",…,"lastDoneOdometerKm":46000,"lastDoneDate":"2026-08-26","status":"Ok","remainingKm":1000.00,…},
                {"id":"fdff935c-…","name":"Oil",…,"lastDoneOdometerKm":40000.00,"lastDoneDate":"2025-09-10","status":"Overdue",…}]}
GET /api/vehicles/{id}            → "currentOdometerKm":50000.00,"avgKmPerDay":80.00
GET /api/vehicles/{id}/odometer   → […,{"valueKm":46000.00,"readingDate":"2026-08-26","source":"Service"}]

PUT … {"odometerKm":51000}
→ 400 {"title":"Validation failed","status":400,"detail":"New reading (51000 km) is higher than the reading after it (50000.00 km). …",
       "code":"odometer.higherThanNext","nextKm":50000.00}
PUT … {"odometerKm":51000,"confirmCorrection":true}         → 200
PUT … {"date":"2026-10-18"}                                  → 400 {…,"code":"serviceRecord.futureDate"}
PUT … {"taskIds":["00000000-0000-0000-0000-000000000001"]}   → 404 {…,"code":"maintenanceTask.notFound"}
PUT … {"shopName":"B","totalCost":10,"notes":null,"items":[]} → 200 (MVP3-B body; date, odometer, tasks unchanged)
PUT (another user's token) …                                  → 404 {…,"code":"vehicle.notFound"}
PUT after POST …/void                                         → 409 {…,"code":"serviceRecord.alreadyVoided"}
```
