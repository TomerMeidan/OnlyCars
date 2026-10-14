# API contract: MVP2-B, task status and due-soon threshold

Published by backend-engineer, verified with curl against the live API. Extends `MVP2-A.md`; everything there still holds unless changed below.

## Changes

### `MaintenanceTaskDto` gains four computed fields
Returned by `GET /api/vehicles/{vehicleId}/tasks`, `POST .../tasks` (201) and `PUT .../tasks/{taskId}` (200).

| Field | Type | Meaning |
|---|---|---|
| `status` | `"Ok" \| "DueSoon" \| "Overdue" \| null` | The worse of the km and time statuses |
| `remainingKm` | `number \| null` | `intervalKm - max(0, currentOdometerKm - lastDoneOdometerKm)`. Can be negative. Null when `intervalKm` is null. Decimal, may come back as `1500.00` |
| `remainingDays` | `integer \| null` | `intervalDays - max(0, todayUtc - lastDoneDate)`. Can be negative. Null when `intervalDays` is null |
| `progress` | `number \| null` | `max(usedKm / intervalKm, usedDays / intervalDays)` over the set intervals. At least 0, above 1 when overdue. Not rounded (e.g. `1.393150684931507`) |

- **All four are null for a disabled task.**
- Per interval: Overdue if `remaining < 0`; else Due soon if `remaining * 100 <= interval * dueSoonPercent`; else Ok. 0 remaining is Due soon.
- "Today" is the server's UTC date. Status is computed on every read, so after an odometer reading is added, edited or deleted, re-fetch the task list.
- Server order is unchanged (enabled first, then name). Sort by urgency on the client.

### `POST /api/vehicles/{vehicleId}/tasks` body gains
`dueSoonPercent?: int | null`. Null or missing saves 10.

### `PUT /api/vehicles/{vehicleId}/tasks/{taskId}` body gains
`dueSoonPercent?: int | null`. Null or missing **keeps the stored value** (like `isEnabled`). Still send it from `bodyOf` so the form's value round-trips.

## New error code
Validation order is now: `task.nameRequired`, `task.invalidCategory`, `task.intervalRequired`, `task.invalidInterval`, **`task.invalidDueSoonPercent`**, `task.invalidLastDone`, `task.futureDate`, `task.invalidTemplate`.

| Code | Status | Extensions | When |
|---|---|---|---|
| `task.invalidDueSoonPercent` | 400 | none | `dueSoonPercent` is set and outside 1 to 50 (POST and PUT). Nothing is saved |

A non-integer such as `2.5` fails JSON binding with `http.400` (see MVP2-A), so validate on the client.

## Examples
```
POST /api/vehicles/{id}/tasks           (car odometer 50000)
{"name":"Oil","category":"Oil","intervalKm":10000,"intervalDays":365,"lastDoneOdometerKm":41500,"lastDoneDate":"2026-09-14"}
→ 201 {"id":"4f95…","vehicleId":"05f5…","templateId":null,"name":"Oil","category":"Oil","intervalKm":10000,"intervalDays":365,"dueSoonPercent":10,"isEnabled":true,"lastDoneOdometerKm":41500,"lastDoneDate":"2026-09-14","status":"Ok","remainingKm":1500.00,"remainingDays":335,"progress":0.85}

PUT /api/vehicles/{id}/tasks/{taskId}   same body + "dueSoonPercent":20
→ 200 {…,"dueSoonPercent":20,"isEnabled":true,…,"status":"DueSoon","remainingKm":1500.00,"remainingDays":335,"progress":0.85}

PUT same body + "isEnabled":false, no dueSoonPercent
→ 200 {…,"dueSoonPercent":20,"isEnabled":false,…,"status":null,"remainingKm":null,"remainingDays":null,"progress":null}

POST days-only task, last done 2024-01-01, intervalDays 730
→ 201 {…,"intervalKm":null,"intervalDays":730,…,"status":"Overdue","remainingKm":null,"remainingDays":-287,"progress":1.393150684931507}

POST with "dueSoonPercent":51
→ 400 {"title":"Validation failed","status":400,"detail":"Due soon must start at 1 to 50 percent of the interval.","code":"task.invalidDueSoonPercent"}
```

After `POST /api/vehicles/{id}/odometer {"valueKm":52000}` the Oil task (km only) reads `"status":"Overdue","remainingKm":-500.00,"progress":1.05`; after deleting that reading it reads `"status":"Ok","remainingKm":1500.00,"progress":0.85` again.
