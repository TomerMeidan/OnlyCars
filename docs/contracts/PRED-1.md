# API contract: PRED-1, predicted due date

Published by backend-engineer. No new endpoint, no new error code, no migration. One new read-only field on `MaintenanceTaskDto`.

## `MaintenanceTaskDto.predictedDueDate`

`"yyyy-MM-dd"` or `null`. Computed on read in `TaskStatusCalculator.PredictDueDate`, from the car's `avgKmPerDay` and the request's `today`.

Returned wherever a `MaintenanceTaskDto` is returned, so it is always consistent:
- `GET /api/vehicles/{vehicleId}/tasks?today=yyyy-MM-dd` (each task)
- `GET /api/dashboard?today=yyyy-MM-dd` (`vehicles[].tasks[]`)
- also on task create/update, reset (Mark done), service record create/edit/void responses. The UI only needs the first two.

Status, `remainingKm`, `remainingDays`, `progress` and the sort order are unchanged. Checklists, documents and `/api/reminders` have no such field.

Rules ("Predicted due date, PRED-1" in `docs/decisions.md`):
1. `null` unless the task is enabled, not `Overdue`, has `intervalKm`, and the car's `avgKmPerDay` is above 0.
2. km date = `today` + ceil(`remainingKm` / `avgKmPerDay`) days. `remainingKm` 0 gives `today`.
3. If the task also has `intervalDays`, the earlier of the km date and `today` + `remainingDays` wins.
4. More than 730 days after `today` gives `null`.
5. `today` is the client's local date, the same `?today=` as LOW-8 (`docs/contracts/LOW-8.md`); absent means UTC today, and more than a day from UTC is the existing 400 (`serviceRecord.invalidDate` on tasks, `dashboard.invalidDate` on the dashboard).

Always km/days server-side. For the "Based on N km a day" hint, use `avgKmPerDay` from `GET /api/vehicles/{id}` (already there) and convert it to miles in the client when the user uses miles. The date itself needs no unit conversion.

Errors: none new. Another user's car is the existing **404** `vehicle.notFound`.

## Example (curl against the dev API, 2026-10-24)

Car with readings 50,000 km (2026-07-16) and 53,000 km (2026-10-24), so `avgKmPerDay` 30; a 5,000 km task done at 49,000 km has 1,000 km left, ceil(1000 / 30) = 34 days.

```
GET /api/vehicles/04abacf5-.../tasks?today=2026-10-24   -> 200
[{"id":"43fbe367-...","vehicleId":"04abacf5-...","templateId":null,"name":"Oil","category":"Oil","intervalKm":5000,"intervalDays":null,
  "dueSoonPercent":10,"isEnabled":true,"lastDoneOdometerKm":49000.00,"lastDoneDate":"2026-07-16","status":"Ok","remainingKm":1000.00,
  "remainingDays":null,"progress":0.8,"predictedDueDate":"2026-11-27"}]

GET /api/dashboard?today=2026-10-25   -> 200
{ ..., "vehicles":[{ ..., "tasks":[{ ..., "remainingKm":1000.00, "predictedDueDate":"2026-11-28" }] }] }
```

With only one reading (`avgKmPerDay` null) the same task returns `"predictedDueDate":null`.
