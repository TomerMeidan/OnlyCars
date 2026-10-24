# API contract: LOW-8a, the client's today on every status (L155, L157) and backend Lows

Published by backend-engineer. Only L155 changes requests; L165, L173 and L177 change no shapes and add no codes.

## `today` query parameter
- Name: `today`, in the query string, format `YYYY-MM-DD` (the client's local date, e.g. `localToday()`): `?today=2026-10-24`.
- Optional. Without it the server's UTC date is used, so old clients keep working.
- Must be within one day of the server's UTC date (yesterday, today or tomorrow in UTC); otherwise **400** with the endpoint's code below,
  `detail` "The date must be today.", no extensions.
- A value that isn't a date (`?today=abc`) is a model-binding **400** with `code` `http.400` and `errors.today`, as for any bad query value.
- It changes only `status`, `remainingDays` and `progress` (and the dashboard's `overdueCount` / `dueSoonCount`), never what is saved,
  except where a body date defaults to it (below).

## Endpoints that take `today`

| Method and path | Code when `today` is off | Notes |
|---|---|---|
| `GET /api/vehicles/{vehicleId}/tasks` | `serviceRecord.invalidDate` | |
| `POST /api/vehicles/{vehicleId}/tasks` | `serviceRecord.invalidDate` | returned task's status |
| `PUT /api/vehicles/{vehicleId}/tasks/{taskId}` | `serviceRecord.invalidDate` | returned task's status |
| `POST /api/vehicles/{vehicleId}/tasks/{taskId}/reset` | `serviceRecord.invalidDate` | body `date` defaults to `today` (was UTC); both checked |
| `POST /api/vehicles/{vehicleId}/service-records` | `serviceRecord.invalidDate` | `tasks` statuses; body `date` defaults to `today` |
| `PUT /api/vehicles/{vehicleId}/service-records/{recordId}` | `serviceRecord.invalidDate` | `tasks` statuses |
| `POST /api/vehicles/{vehicleId}/service-records/{recordId}/void` | `serviceRecord.invalidDate` | returned tasks' statuses |
| `GET /api/vehicles/{vehicleId}/checklists` | `vehicleChecklist.invalidDate` | |
| `POST /api/vehicles/{vehicleId}/checklists` | `vehicleChecklist.invalidDate` | body `date` defaults to `today` |
| `PUT /api/vehicle-checklists/{id}` | `vehicleChecklist.invalidDate` | |
| `POST /api/vehicle-checklists/{id}/runs` | `vehicleChecklist.invalidDate` | the `checklist` part; body `runAt` defaults to `today` |
| `GET /api/dashboard` | `dashboard.invalidDate` | already took `today` (spend month); now task and checklist statuses use it too |
| `GET /api/reminders` | `reminder.invalidDate` | already took `today` (documents, snoozes); now tasks and checklists use it too |

Unchanged and already taking `today`: the documents endpoints (`vehicleDocument.invalidDate`) and `POST /api/reminders/snooze` (body `today`).
Every code above already has an en and he message in the client. The future-date checks on body dates (`serviceRecord.futureDate`,
`checklistRun.futureDate`) still compare with the server's UTC date plus one day, as before.

Ownership is checked before `today` on every endpoint: another user's car or checklist is 404 (`vehicle.notFound`, `vehicleChecklist.notFound`)
with any `today`, valid or not.

## Examples (curl on the live API, server UTC date 2026-10-24, a 30-day task last done 2026-09-24)
```
GET /api/vehicles/{carId}/tasks?today=2026-10-25 → 200
[{"id":"6757a6dd-...","name":"Oil","intervalDays":30,"lastDoneDate":"2026-09-24","status":"Overdue","remainingKm":null,"remainingDays":-1,"progress":1.0333333333333334, ...}]
GET /api/vehicles/{carId}/tasks            → "status":"DueSoon","remainingDays":0   (UTC)
GET /api/vehicles/{carId}/tasks?today=2026-10-23 → "status":"DueSoon","remainingDays":1
GET /api/vehicles/{carId}/tasks?today=2026-10-26 → 400
{"title":"Validation failed","status":400,"detail":"The date must be today.","code":"serviceRecord.invalidDate"}
GET /api/vehicles/{carId}/checklists?today=2026-10-26 → 400 {"code":"vehicleChecklist.invalidDate", ...}
GET /api/vehicles/{carId}/tasks?today=abc → 400 {"errors":{"today":["Invalid value."]},"code":"http.400", ...}
GET /api/dashboard?today=2026-10-25 → "overdueCount":1,"dueSoonCount":0, the task "Overdue -1"
GET /api/reminders?today=2026-10-25 → {"leadDays":30,"snoozedCount":0,"items":[{"kind":"Task","name":"Oil","status":"Overdue","remainingDays":-1, ...}]}
POST /api/vehicles/{carId}/tasks/{taskId}/reset?today=2026-10-25 {"date":"2026-10-25"} → 201 {"task":{"lastDoneDate":"2026-10-25","status":"Ok","remainingDays":30, ...}}
```

## No contract change
- L165: `PUT .../service-records/{id}` that moves a record without its Service reading (old data) is refused at 5,000 readings with the
  existing 400 `odometer.tooMany` (`max: 5000`).
- L173: `DELETE /api/me` racing a run-photo upload no longer returns 500. The racing upload either gets deleted with the account or is refused
  with 404 (the run is already gone when the upload starts) or the existing 409 `concurrency.conflict` (it went during the upload), as for a
  run deleted during an upload.
- L177: `DELETE /api/me` stays 1 at a time per user (now tested); a second one while the first is in flight is 429 `http.429`.
