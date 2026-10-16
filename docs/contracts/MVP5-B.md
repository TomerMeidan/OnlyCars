# API contract: MVP5-B, run a checklist on a car

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB). Every endpoint needs the bearer token (401 without it) and only sees the caller's data: another user's car, template, attachment or run is a 404 (`vehicle.notFound`, `checklistTemplate.notFound`, `vehicleChecklist.notFound`, `checklistRun.notFound`). Migration `AddChecklistRuns` adds the tables `VehicleChecklists`, `ChecklistRuns` and `ChecklistRunItems` (additive only).

Distances are km, as everywhere in the API. Dates are `YYYY-MM-DD`. Status uses the server's UTC date, as for tasks.

## Shapes

```
VehicleChecklistDto {
  "id": guid, "vehicleId": guid, "templateId": guid,
  "name": string,                       // the template's current name
  "itemCount": int,                     // the template's current item count
  "intervalKm": int|null, "intervalDays": int|null,   // both null = manual only
  "isEnabled": bool,
  "lastRunDate": date, "lastRunOdometerKm": decimal,  // the attach values until a run is saved
  "runCount": int,                      // for "History (N)" without loading the runs
  "status": "Ok"|"DueSoon"|"Overdue"|null,            // null when off or manual only
  "remainingKm": decimal|null, "remainingDays": int|null, "progress": number|null   // as tasks have them; null when off or manual only
}
ChecklistRunDto {
  "id": guid, "vehicleChecklistId": guid,
  "runAt": date, "odometerKm": decimal,
  "odometerReadingId": guid|null,       // the Checklist reading it logged; null when no odometer was entered
  "notes": string|null,
  "flaggedCount": int,
  "items": ChecklistRunItemDto[]        // in the template's order at run time
}
ChecklistRunItemDto {
  "id": guid,
  "templateItemId": guid|null,          // null once the template item was deleted
  "label": string,                      // snapshot: the label at run time
  "type": "Check"|"Number"|"Text", "unit": string|null, "minValue": decimal|null, "maxValue": decimal|null,   // snapshots
  "boolValue": bool|null,               // Check: true = OK, false = Not OK, null = unanswered
  "numberValue": decimal|null, "textValue": string|null,
  "isFlagged": bool
}
```

Status follows the task rules (decisions.md, MVP2-B) with a fixed 10% due-soon threshold: Overdue when either remaining value is below 0, Due soon when either is at or below 10% of its interval (0 left is Due soon), the worse interval decides. A never-run checklist counts from its attach values.

## Endpoints

| Method and path | Body | Success |
|---|---|---|
| `GET /api/vehicles/{vehicleId}/checklists` | | 200 `VehicleChecklistDto[]`, most urgent first: Overdue, Due soon, OK, then manual only (enabled), then off; ties by name. `[]` when none. Archived cars work too. |
| `POST /api/vehicles/{vehicleId}/checklists` | `{ templateId, intervalKm, intervalDays, date }` | 201 `VehicleChecklistDto` |
| `PUT /api/vehicle-checklists/{id}` | `{ intervalKm, intervalDays, isEnabled }` | 200 `VehicleChecklistDto` |
| `DELETE /api/vehicle-checklists/{id}` | | 204 |
| `GET /api/vehicle-checklists/{id}/runs` | | 200 `ChecklistRunDto[]`, newest first (`runAt` DESC, then save time DESC) |
| `POST /api/vehicle-checklists/{id}/runs` | see below | 201 `{ "run": ChecklistRunDto, "checklist": VehicleChecklistDto }` (the checklist after the run: last run, status, runCount) |
| `DELETE /api/checklist-runs/{id}` | | 204 |
| `DELETE /api/checklist-templates/{id}` (changed) | | 204, or 409 `checklistTemplate.inUse` while the template is attached to any car |
| `GET /api/dashboard` (changed) | | each car in `vehicles` gains `checklists: VehicleChecklistDto[]` (see below) |

**Attach** (`POST .../checklists`): `date` is the client's local date (`localToday()`), stored as the start date; null means UTC today. `lastRunDate` = `date`, `lastRunOdometerKm` = the car's current odometer. `intervalKm` and `intervalDays` are each optional; both null or missing is manual only.

**Edit** (`PUT`): the intervals are replaced as sent (null clears one; both null is manual only). `isEnabled` null or missing keeps the current value. Allowed on archived cars.

**Remove** (`DELETE /api/vehicle-checklists/{id}`): only when it has no runs.

**Run** (`POST .../runs`):
```
{ "runAt": date|null,             // client local date; null = UTC today
  "odometerKm": decimal|null,     // null = no reading; the run stores the car's current odometer
  "confirmCorrection": bool,      // default false
  "notes": string|null,
  "items": [ { "templateItemId": guid, "boolValue": bool|null, "numberValue": decimal|null, "textValue": string|null, "isFlagged": bool } ] }
```
- `items` must name every current item of the template exactly once, in any order; otherwise 400 `checklistRun.itemsChanged` (the form is stale: reload the template). A template with no items takes `items: []`.
- Every value may be left empty (null). Only the value for the item's type may be set: `boolValue` on Check, `numberValue` on Number, `textValue` on Text.
- `notes` and `textValue` are trimmed; blank becomes null.
- **Flags are computed on the server:** a Check with `boolValue: false`, or a Number below `minValue` or above `maxValue` (the bounds themselves are inside), is always flagged. `isFlagged: true` adds a flag to any item; `isFlagged: false` can't clear an automatic one. `flaggedCount` counts the flagged items.
- With `odometerKm`, an odometer reading with `source: "Checklist"` is logged on `runAt` under the same date-order rules and `confirmCorrection` as manual readings and service records, and the car's current odometer and average are recomputed. That reading shows in the odometer history but can't be edited or deleted there (409 `odometer.notManual`, as for service readings); it goes when the run is deleted.
- The checklist's last run moves to (`runAt`, `odometerKm`) only when that is at least as recent as the current last run (by date, then km). An older run is saved to the history but doesn't change the status.
- Runs can't be edited.

**Delete a run** (`DELETE /api/checklist-runs/{id}`): hard delete with its items. The last run becomes the later (by date, then km) of the attach values and the latest remaining run. Its Checklist reading is deleted and the car's odometer recomputed (if it is the car's only reading it is kept as a manual reading, as for service records). Allowed on archived cars.

**Dashboard**: `vehicles[].checklists` is the car's **enabled** checklists in the list order above (manual only ones last, with `status: null`); off checklists are not included. Only active cars are in `vehicles`, so archived cars never show any. `overdueCount` and `dueSoonCount` (top level and per car) still count tasks only.

## Errors

All use the existing ProblemDetails shape with `code`. Checks run in the order listed per endpoint and the first failure is returned; a failed request saves nothing.

| Code | Status | Extensions | When |
|---|---|---|---|
| `vehicle.notFound` | 404 | | GET/POST `.../vehicles/{vehicleId}/checklists`: unknown or another user's car |
| `vehicleChecklist.notFound` | 404 | | PUT, DELETE, runs GET and POST: unknown or another user's attachment |
| `checklistRun.notFound` | 404 | | DELETE run: unknown or another user's run |
| `checklistTemplate.notFound` | 404 | | Attach: `templateId` unknown, missing or another user's |
| `vehicleChecklist.vehicleArchived` | 400 | | Attach or run on an archived car (checked before everything else after the 404) |
| `vehicleChecklist.invalidInterval` | 400 | | Attach or PUT: `intervalKm` outside 1 to 1,000,000 or `intervalDays` outside 1 to 3,650 |
| `vehicleChecklist.invalidDate` | 400 | | Attach: `date` more than 1 day away from the server's UTC today (it must be the client's today) |
| `vehicleChecklist.duplicate` | 409 | | Attach: this template is already on this car |
| `vehicleChecklist.hasRuns` | 409 | | DELETE attachment that has runs (turn it off instead) |
| `checklistTemplate.inUse` | 409 | | DELETE template that is attached to any car |
| `checklistRun.futureDate` | 400 | | Run: `runAt` after the server's UTC today + 1 day |
| `checklistRun.invalidOdometer` | 400 | | Run: `odometerKm` below 0 or above 10,000,000 |
| `checklistRun.invalidNotes` | 400 | | Run: notes over 1,000 characters after trim |
| `checklistRun.itemsChanged` | 400 | | Run: `items` missing a current template item, naming another template's item or a deleted one, naming one twice, a null entry, or `items` null while the template has items |
| `checklistItem.invalidValue` | 400 | `index` (0-based position in the request's `items`) | Run: a value set that doesn't fit the item's type; a number outside -1,000,000 to 1,000,000 or with more than 2 decimals; text over 500 characters after trim |
| `odometer.lowerThanPrevious` | 400 | `previousKm` | Run with `odometerKm` lower than the reading before `runAt`, without `confirmCorrection` |
| `odometer.higherThanNext` | 400 | `nextKm` | Run with `odometerKm` higher than the reading after `runAt`, without `confirmCorrection` |
| `http.400` | 400 | `errors` | Malformed JSON or a non-guid/non-number value (model binding) |

## Examples (curl, live API)

```
POST /api/vehicles/f4b41d44-…/checklists
{"templateId":"1743e7ef-…","intervalKm":5000,"intervalDays":30,"date":"2026-10-16"}
201
{"id":"2de5900d-…","vehicleId":"f4b41d44-…","templateId":"1743e7ef-…","name":"Monthly quick check","itemCount":3,
 "intervalKm":5000,"intervalDays":30,"isEnabled":true,"lastRunDate":"2026-10-16","lastRunOdometerKm":50000.00,"runCount":0,
 "status":"Ok","remainingKm":5000,"remainingDays":30,"progress":0}

POST /api/vehicles/f4b41d44-…/checklists   (same template again)
409 {"title":"Conflict","status":409,"detail":"This checklist is already on this car.","code":"vehicleChecklist.duplicate"}

PUT /api/vehicle-checklists/2de5900d-…
{"intervalKm":null,"intervalDays":null,"isEnabled":false}
200 {…,"intervalKm":null,"intervalDays":null,"isEnabled":false,…,"status":null,"remainingKm":null,"remainingDays":null,"progress":null}

POST /api/vehicle-checklists/4ed53d96-…/runs
{"runAt":"2026-10-16","odometerKm":51000,"confirmCorrection":false,"notes":"Before the trip","items":[
 {"templateItemId":"14997db1-…","boolValue":false},
 {"templateItemId":"b6ae9e5e-…","numberValue":1.8},
 {"templateItemId":"291765c4-…","textValue":"Scratch","isFlagged":true}]}
201
{"run":{"id":"2b4e537d-…","vehicleChecklistId":"4ed53d96-…","runAt":"2026-10-16","odometerKm":51000,"odometerReadingId":"0ebdd654-…",
  "notes":"Before the trip","flaggedCount":3,"items":[
  {"id":"6d695bb5-…","templateItemId":"14997db1-…","label":"Lights","type":"Check","unit":null,"minValue":null,"maxValue":null,"boolValue":false,"numberValue":null,"textValue":null,"isFlagged":true},
  {"id":"df02d062-…","templateItemId":"b6ae9e5e-…","label":"Tire pressure","type":"Number","unit":"bar","minValue":2.00,"maxValue":2.60,"boolValue":null,"numberValue":1.8,"textValue":null,"isFlagged":true},
  {"id":"ec43b350-…","templateItemId":"291765c4-…","label":"Notes","type":"Text","unit":null,"minValue":null,"maxValue":null,"boolValue":null,"numberValue":null,"textValue":"Scratch","isFlagged":true}]},
 "checklist":{"id":"4ed53d96-…",…,"lastRunDate":"2026-10-16","lastRunOdometerKm":51000,"runCount":1,"status":"Ok","remainingKm":5000,"remainingDays":30,"progress":0}}

POST /api/vehicle-checklists/4ed53d96-…/runs   {"odometerKm":40000,"items":[…all three, unanswered…]}
400 {"title":"Validation failed","status":400,"detail":"New reading (40000 km) is lower than the reading before it (51000.00 km). …","code":"odometer.lowerThanPrevious","previousKm":51000.00}

POST /api/vehicle-checklists/4ed53d96-…/runs   {"items":[{"templateItemId":"14997db1-…"}]}
400 {"title":"Validation failed","status":400,"detail":"The checklist has changed. Reload it and run it again.","code":"checklistRun.itemsChanged"}

POST /api/vehicle-checklists/4ed53d96-…/runs   (numberValue on the Check item at index 0)
400 {"title":"Validation failed","status":400,"detail":"Item 1: The value doesn't fit this item (…).","code":"checklistItem.invalidValue","index":0}

GET /api/dashboard?today=2026-10-16
200 {"overdueCount":0,"dueSoonCount":0,…,"vehicles":[{"id":"ff9f9f1a-…","nickname":"Mazda",…,"tasks":[],
 "checklists":[{"id":"4ed53d96-…","name":"Monthly quick check",…,"status":"Ok",…},
               {"id":"0442b575-…","name":"Pre-road-trip",…,"intervalKm":null,"intervalDays":null,"status":null,…}]}]}

DELETE /api/checklist-templates/af6fbcb1-…   (attached)
409 {"title":"Conflict","status":409,"detail":"This checklist is attached to a car. Remove it from the car first.","code":"checklistTemplate.inUse"}

DELETE /api/vehicle-checklists/4ed53d96-…    (has a run)
409 {"title":"Conflict","status":409,"detail":"This checklist has runs. Turn it off instead.","code":"vehicleChecklist.hasRuns"}

GET /api/vehicle-checklists/4ed53d96-…/runs  (as another user)
404 {"title":"Not found","status":404,"detail":"VehicleChecklist '4ed53d96-…' was not found.","code":"vehicleChecklist.notFound"}

DELETE /api/checklist-runs/2b4e537d-…
204   (then GET /api/vehicles/ff9f9f1a-… shows currentOdometerKm 50000.00 again, and the checklist lastRunOdometerKm 50000.00, runCount 0)

POST /api/vehicle-checklists/a1aeee80-…/runs   (archived car)
400 {"title":"Validation failed","status":400,"detail":"This car is archived.","code":"vehicleChecklist.vehicleArchived"}
```

## Notes for the frontend

- Decimals read back from the database have 2 decimals (`51000.00`); a POST response echoes what was sent (`51000`). Same number.
- The run form needs the template's items: `GET /api/checklist-templates/{templateId}` (MVP5-A) gives them in order with `id`, type, unit and range. Send `templateItemId` = that `id`.
- The live auto-flag on the client must match the server: `boolValue === false`, or `numberValue < minValue`, or `numberValue > maxValue` (each bound optional).
- After a run, the response's `checklist` has the new last run and status; the car's odometer may have changed, so reload the car (and tasks, whose status depends on it) when `odometerKm` was sent.
- After deleting a run, reload the checklist list and the car (odometer may have gone back).
- `vehicleChecklist.invalidDate` is new (the attach `date` must be the client's today); the ticket did not list it.
