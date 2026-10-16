# API contract: MVP5-C, a flagged checklist item becomes a to-do

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB). Every endpoint needs the bearer token (401 without it) and only sees the caller's data: another user's car, to-do or run item is a 404 (`vehicle.notFound`, `issue.notFound`, `checklistRunItem.notFound`). Migration `AddIssues` adds the table `Issues` (additive only). Request bodies on the new endpoints are limited to 64 KB (413 `http.413`).

Dates are `YYYY-MM-DD`; `createdAt` is an ISO timestamp.

## Shapes

```
IssueDto {
  "id": guid, "vehicleId": guid,
  "title": string,                 // 1 to 100 characters, trimmed
  "description": string|null,      // up to 1,000, trimmed; blank becomes null
  "status": "Open"|"Done",
  "resolvedAt": date|null,         // set only when Done
  "createdAt": datetime,
  "source": IssueSourceDto|null    // null for a to-do added by hand, and once its run was deleted
}
IssueSourceDto {
  "runItemId": guid, "runId": guid,
  "runAt": date,                   // the run date
  "checklistName": string,         // the checklist's current name
  "label": string                  // the item's label at run time (snapshot)
}
```

## Endpoints

| Method and path | Body | Success |
|---|---|---|
| `GET /api/vehicles/{vehicleId}/issues` | | 200 `IssueDto[]`: open first (newest created first), then done (newest `resolvedAt` first, then newest created). `[]` when none. Archived cars work too. |
| `POST /api/vehicles/{vehicleId}/issues` | `{ title, description, sourceRunItemId }` | 201 `IssueDto` (starts Open) |
| `PUT /api/issues/{id}` | `{ title, description, status, resolvedAt }` | 200 `IssueDto` |
| `DELETE /api/issues/{id}` | | 204 (hard delete) |
| `GET /api/vehicle-checklists/{id}/runs` (changed) | | each item in `items` gains `issueId: guid|null`, the to-do created from it |
| `POST /api/vehicle-checklists/{id}/runs` (changed) | | its `run.items` carry `issueId: null` |
| `GET /api/dashboard` (changed) | | each car in `vehicles` gains `openIssueCount: int` |

**Create**: `sourceRunItemId` is optional (omit or null for a to-do added by hand). When set it must be a **flagged** item of a run of **this car**; one to-do per run item.

**Edit** (`PUT`) replaces `title` and `description` as sent (send both every time; a missing `description` clears it). `status`:
- `"Done"` needs `resolvedAt` = the client's local date (`localToday()`); it is stored as sent. Re-sending Done on a Done to-do (for example when editing its title) needs `resolvedAt` again: send the current one.
- `"Open"` clears `resolvedAt` (any sent value is ignored).
- null or missing keeps the current status (Done still needs `resolvedAt`).

Edit and Delete work on archived cars (the screen is read-only there); Create is rejected.

**Deleting a run** keeps its to-dos: their `source` becomes null and nothing else visible changes (`updatedAt` is bumped, not exposed). Deleting a template item leaves to-dos alone.

**Dashboard**: `openIssueCount` counts the car's Open to-dos (Done ones are not counted). Only active cars are in `vehicles`. The top-level and per-car `overdueCount` and `dueSoonCount` still count tasks only.

## Errors

All use the existing ProblemDetails shape with `code`. Checks run in the order listed per endpoint; a failed request saves nothing. No new extensions.

| Code | Status | When |
|---|---|---|
| `vehicle.notFound` | 404 | GET/POST `.../vehicles/{vehicleId}/issues`: unknown or another user's car |
| `issue.notFound` | 404 | PUT, DELETE: unknown or another user's to-do (also a to-do deleted in another tab) |
| `issue.vehicleArchived` | 400 | Create on an archived car (first check after the 404) |
| `issue.invalidTitle` | 400 | Create, PUT: title missing, blank or over 100 after trim |
| `issue.invalidDescription` | 400 | Create, PUT: description over 1,000 after trim |
| `checklistRunItem.notFound` | 404 | Create: `sourceRunItemId` unknown or another user's |
| `issue.invalidSource` | 400 | Create: the run item is the caller's but not flagged, or on another of their cars |
| `issue.duplicate` | 409 | Create: the run item already has a to-do (also when two creates race: one gets 201, the other 409) |
| `issue.limitReached` | 400 | Create: the car already has 500 to-dos (open and done) |
| `issue.invalidStatus` | 400 | PUT: `status` is a number that isn't Open (0) or Done (1), such as `2` (checked before the date) |
| `issue.invalidDate` | 400 | PUT: Done without `resolvedAt`, or `resolvedAt` before 2000-01-01 |
| `issue.futureDate` | 400 | PUT: Done with `resolvedAt` after the server's UTC today + 1 day |
| `http.400` | 400 | Malformed JSON, a non-guid id or an unknown `status` name (model binding, `errors` has field names) |
| `http.413` | 413 | Body over 64 KB |

## Examples (curl, live API)

```
POST /api/vehicles/277ccec6-…/issues
{"title":"Tire pressure","description":"1.8 bar, Monthly quick check, 2026-10-16","sourceRunItemId":"55b3d529-…"}
201
{"id":"230a8c65-…","vehicleId":"277ccec6-…","title":"Tire pressure","description":"1.8 bar, Monthly quick check, 2026-10-16",
 "status":"Open","resolvedAt":null,"createdAt":"2026-10-16T03:15:20.9538901+00:00",
 "source":{"runItemId":"55b3d529-…","runId":"eb23f1e7-…","runAt":"2026-10-16","checklistName":"Monthly quick check","label":"Tire pressure"}}

Two simultaneous POSTs with the same sourceRunItemId: 201 and 409.

POST /api/vehicles/277ccec6-…/issues   (same run item again)
409 {"title":"Conflict","status":409,"detail":"This item already has a to-do.","code":"issue.duplicate"}

POST /api/vehicles/277ccec6-…/issues   (the run's unflagged "Notes" item)
400 {"title":"Validation failed","status":400,"detail":"This item isn't a flagged item of this car's checklist runs.","code":"issue.invalidSource"}

PUT /api/issues/91a05189-…
{"title":"Wash the car","description":"Inside too","status":"Done","resolvedAt":"2026-10-16"}
200 {"id":"91a05189-…","vehicleId":"277ccec6-…","title":"Wash the car","description":"Inside too","status":"Done",
     "resolvedAt":"2026-10-16","createdAt":"2026-10-16T03:15:21.4180865+00:00","source":null}

PUT /api/issues/91a05189-…   {"title":"Wash the car","status":"Done"}
400 {"title":"Validation failed","status":400,"detail":"A done to-do needs a date from 2000-01-01.","code":"issue.invalidDate"}

PUT /api/issues/91a05189-…   {"title":"Wash the car","status":"Done","resolvedAt":"2099-01-01"}
400 {"title":"Validation failed","status":400,"detail":"The done date can't be in the future.","code":"issue.futureDate"}

PUT /api/issues/91a05189-…   {"title":"Wash the car","status":"Open","resolvedAt":"2026-01-01"}
200 {…,"status":"Open","resolvedAt":null,…}

GET /api/vehicle-checklists/27349be6-…/runs
200 [{"id":"eb23f1e7-…",…,"flaggedCount":2,"items":[
  {"id":"a5f6a7dd-…","label":"Lights",…,"isFlagged":true,"issueId":"87e40e6b-…"},
  {"id":"55b3d529-…","label":"Tire pressure",…,"isFlagged":true,"issueId":"230a8c65-…"},
  {"id":"509e802d-…","label":"Notes",…,"isFlagged":false,"issueId":null}]}]

GET /api/dashboard?today=2026-10-16
200 {"overdueCount":0,"dueSoonCount":0,…,"vehicles":[{"id":"277ccec6-…","nickname":"Mazda",…,"checklists":[…],"openIssueCount":2}]}

DELETE /api/checklist-runs/eb23f1e7-…   204; then GET …/issues shows the two to-dos with "source":null.

DELETE /api/issues/91a05189-…   204; again: 404 {"code":"issue.notFound",…}

POST /api/vehicles/{archived car}/issues   400 {"code":"issue.vehicleArchived",…}
POST with a 70 KB body   413 {"title":"Bad request","status":413,"code":"http.413",…}
```

## Notes for the frontend

- After Create from a run item, the run history's `issueId` for that item is the new to-do's `id` (or reload the runs).
- On `issue.duplicate`, reload the run history: the item then has its `issueId`.
- `checklistRunItem.notFound` on Create means the run (or its item) was deleted in another tab; reload the run history.
- `source.checklistName` is the checklist's current name; the prefilled description is built on the client.
