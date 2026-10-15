# API contract: MVP2-C, Reset / Mark as done and Undo

Published by backend-engineer, verified with curl against the live API. Extends `MVP2-A.md` and `MVP2-B.md`; everything there still holds unless changed below.

## New endpoints

### `POST /api/vehicles/{vehicleId}/tasks/{taskId}/reset`
Marks the task done at the car's **current odometer**. Body is optional: no body (with or without `Content-Type`), `{}`, or

```
{ "date"?: "YYYY-MM-DD" | null, "cost"?: number | null, "notes"?: string | null }
```

- `date`: send the client's local date (`localToday()`). Missing or null means UTC today. Must be within 1 day of UTC today.
- `cost`: 0 to 1,000,000, at most 2 decimals. Missing or null saves no cost.
- `notes`: trimmed; up to 1,000 characters after trimming; blank saves null.

**201** `{ "serviceRecordId": guid, "task": MaintenanceTaskDto }`. `task` already has its new `lastDoneOdometerKm` (the current odometer), `lastDoneDate` (the date), `status`, `remainingKm`, `remainingDays` and `progress`.

Side effects: a new odometer reading with `source: "Service"` and the current odometer value, dated `date`, shows up in `GET .../odometer`. It does not change the car's current odometer. Like every non-manual reading, PUT and DELETE on it return 409 `odometer.notManual`. The server doesn't block disabled tasks or archived cars; the UI must not offer Reset there.

Validation order: `vehicle.notFound`, `maintenanceTask.notFound`, `serviceRecord.invalidDate`, `serviceRecord.invalidCost`, `serviceRecord.notesTooLong`. A failure saves nothing.

### `POST /api/vehicles/{vehicleId}/service-records/{recordId}/void`
Undo. No body.

**200** `MaintenanceTaskDto[]`: the tasks the record reset, with `lastDone*` restored to their values before the reset and their status recomputed. An empty array if the task was deleted since (the record is still voided and its reading still removed).

Side effects: the record's `Service` reading is deleted and the car's current odometer and average are recomputed, so re-fetch the car and the history. If that reading is the car's only reading, it stays, as a `Manual` reading.

Order of checks: `vehicle.notFound`, `serviceRecord.notFound`, `serviceRecord.alreadyVoided`, `serviceRecord.notLatest`.

## Changed
- `DELETE /api/vehicles/{vehicleId}/tasks/{taskId}`: still 204 when the task has resets. The resets' records and readings stay.
- `GET /api/vehicles/{vehicleId}/odometer` now includes `"source": "Service"` readings.
- There is no GET for service records yet.

## New error codes

| Code | Status | Extensions | When |
|---|---|---|---|
| `serviceRecord.invalidDate` | 400 | none | `date` is more than 1 day before or after UTC today |
| `serviceRecord.invalidCost` | 400 | none | `cost` below 0, above 1,000,000, or more than 2 decimals |
| `serviceRecord.notesTooLong` | 400 | none | `notes` over 1,000 characters after trimming |
| `serviceRecord.notFound` | 404 | none | The record isn't on this car (also another user's record). Another user's car is `vehicle.notFound` |
| `serviceRecord.alreadyVoided` | 409 | none | The record was already undone |
| `serviceRecord.notLatest` | 409 | none | A non-voided reset created later (by creation time, not `date`) exists for a task this record reset |

## Examples
```
POST /api/vehicles/{id}/tasks/{taskId}/reset      (no body; car at 50000, task last done 40000 every 5000 km / 730 days)
→ 201 {"serviceRecordId":"1ba2826e-…","task":{"id":"93e790e5-…","vehicleId":"fc1c9e8f-…","templateId":null,"name":"Oil","category":"Oil","intervalKm":5000,"intervalDays":730,"dueSoonPercent":10,"isEnabled":true,"lastDoneOdometerKm":50000.00,"lastDoneDate":"2026-10-15","status":"Ok","remainingKm":5000,"remainingDays":730,"progress":0}}

POST …/reset  {"date":"2026-10-15","cost":120.5,"notes":"  Castrol 5W-30 "}
→ 201 {"serviceRecordId":"8cda041d-…","task":{…}}

POST …/reset  {"date":"2020-01-01"}
→ 400 {"title":"Validation failed","status":400,"detail":"The date must be today.","code":"serviceRecord.invalidDate"}

POST …/reset  {"cost":1.234}
→ 400 {"title":"Validation failed","status":400,"detail":"The cost must be 0 to 1000000 with at most 2 decimals.","code":"serviceRecord.invalidCost"}

POST /api/vehicles/{id}/service-records/{recordId}/void   (the latest of three same-day resets, so it restores the previous reset's values)
→ 200 [{"id":"93e790e5-…",…,"lastDoneOdometerKm":50000.00,"lastDoneDate":"2026-10-15","status":"Ok",…}]

POST same again
→ 409 {"title":"Conflict","status":409,"detail":"This service record is already undone.","code":"serviceRecord.alreadyVoided"}

POST …/void on an earlier reset of the same task
→ 409 {"title":"Conflict","status":409,"detail":"A later reset of this task must be undone first.","code":"serviceRecord.notLatest"}
```
