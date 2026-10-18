# API contract: LOW-7, true "Last run on" date (L110)

Published by backend-engineer. Only L110 touches the API; L107, L109, L111 to L113 are client-only.

## Changed

### `VehicleChecklistDto` gains `latestRunDate`
Every endpoint that returns a vehicle checklist now includes it:
- `GET /api/vehicles/{vehicleId}/checklists` (list)
- `POST /api/vehicles/{vehicleId}/checklists` (attach), `PUT /api/vehicle-checklists/{id}` (update)
- `POST /api/vehicle-checklists/{id}/runs` (the `checklist` part of the response)
- the dashboard's checklist entries (same DTO)

```
"latestRunDate": "2026-09-18" | null
```
- `latestRunDate`: the `runAt` of the checklist's latest run (date only, `yyyy-MM-dd`); **null when the checklist has no runs**. Use it for "Last run on <date>".
- `lastRunDate` / `lastRunOdometerKm` are unchanged: the countdown start the status uses, the later of the attach values and the latest run. When `lastRunDate > latestRunDate` (or `latestRunDate` is null), the countdown is counting from the attach date.
- Status, `remainingKm`, `remainingDays`, `progress` maths unchanged. No request changes, no new error codes.

## Example
A checklist attached on 2026-10-18 with one run dated 2026-09-18:
```
{ "lastRunDate": "2026-10-18", "lastRunOdometerKm": 1000, "runCount": 1, "latestRunDate": "2026-09-18", ... }
```

Verified with curl on the live API (attached 2026-10-18, intervalDays 30, then `POST /api/vehicle-checklists/{id}/runs` with `"runAt":"2026-09-18"`); `GET /api/vehicles/{vehicleId}/checklists` returns:
```
[{"id":"a09a0e15-...","vehicleId":"992493bf-...","templateId":"30cd3456-...","name":"Quick","itemCount":1,"intervalKm":null,"intervalDays":30,
  "isEnabled":true,"lastRunDate":"2026-10-18","lastRunOdometerKm":1000.00,"runCount":1,"status":"Ok","remainingKm":null,"remainingDays":30,
  "progress":0,"latestRunDate":"2026-09-18"}]
```
Straight after attach (no runs) the same entry has `"latestRunDate":null`.
