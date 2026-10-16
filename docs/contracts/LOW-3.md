# API contract: LOW-3, the Low backlog (backend part)

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB) and by `dotnet test` (all pass). No new endpoints. Migration `LowThreeConcurrency` is empty (it only records two concurrency tokens in the model snapshot; no schema change); `ServiceRecordUpdatedAtToken` is also empty (the service-record token moves from IsVoided to UpdatedAt).

## New error codes (the client must translate both, `en` and `he`)

| Code | Status | When | Extensions |
|---|---|---|---|
| `date.tooEarly` | 400 | A date before 1900-01-01 on: `POST /api/vehicle-checklists/{id}/runs` (`runAt`), `POST /api/vehicles/{id}/service-records` and `PUT .../service-records/{recordId}` (`date`, on edit only when date or odometer changes), `POST` and `PUT /api/vehicles/{id}/odometer` (`readingDate`), `POST /api/vehicles` (`readingDate`, only with `initialOdometerKm`). 1900-01-01 itself is accepted. | `minDate`: `"1900-01-01"` |
| `concurrency.conflict` | 409 | Another request changed or deleted the same thing at the same moment (for example two tabs saving one checklist template). Suggested text (decisions.md): "This was changed at the same time somewhere else. Reload and try again." | none |

## Removed error code

| Code | Was | Now |
|---|---|---|
| `issue.invalidStatus` | 400 on `PUT /api/issues/{id}` with a numeric undefined `status` | Unreachable: numbers are rejected at binding (below) as 400 `http.400`. Remove `errors.issue.invalidStatus` from `client/src/i18n.ts` (en line ~401, he line ~808); the backend does not edit `client/`. |

## Changed behavior

1. **Enums by name only (L65).** On every endpoint, an enum field sent as a number (`"fuelType": 99`, `"fuelType": 0`, `"status": 2`) or a numeric string (`"99"`) is 400 `http.400` with `errors.<field>`. Names (`"Petrol"`, `"Done"`) work as before. The client sends names only (checked `client/src/api.ts`).
2. **Request body limit (L37).** Every endpoint rejects a body over 65,536 bytes with 413 `http.413` (auth keeps its 8 KB limit).
3. **Runs list cap (L37).** `GET /api/vehicle-checklists/{id}/runs` returns at most the newest 200 runs (RunAt, then creation time, newest first). No paging. A checklist's `runCount` still counts every run.
4. **Concurrency (L34, L38, L51).**
   - Two simultaneous `POST /api/vehicles/{id}/service-records/{recordId}/void` of one record: one succeeds, the other is 409 `serviceRecord.alreadyVoided` (existing code).
   - Two simultaneous attaches of one template to one car: one 201, the other 409 `vehicleChecklist.duplicate` (existing code).
   - Two simultaneous `PUT /api/checklist-templates/{id}` (or a PUT and a DELETE): one succeeds, the other is 409 `concurrency.conflict`. Same for an edit and a void of one service record, whichever saves second (a void that loses to another void is still `serviceRecord.alreadyVoided`).
   - Any other database concurrency failure is also 409 `concurrency.conflict` instead of a 500.
5. **A new car's first reading date (L36).** `POST /api/vehicles` takes an optional `readingDate` (`YYYY-MM-DD`), the same field name and rules as quick-add (`POST /api/vehicles/{id}/odometer`): send the client's local today. Missing means the server's UTC today (old behavior). More than one day past the server's UTC today is 400 `odometer.futureDate`; before 1900-01-01 is 400 `date.tooEarly`. Ignored when `initialOdometerKm` is null (no reading is created).

## Examples (from the curl checks)

```
POST /api/vehicles {"nickname":"Low3","initialOdometerKm":1000,"readingDate":"2026-10-17"}
-> 201; GET /api/vehicles/{id}/odometer -> [{"valueKm":1000.00,"readingDate":"2026-10-17","source":"Manual",...}]

POST /api/vehicles {"nickname":"X","initialOdometerKm":1000,"readingDate":"2026-10-18"}   (server UTC date 2026-10-16)
-> 400 {"title":"Validation failed","status":400,"detail":"The reading date can't be in the future.","code":"odometer.futureDate"}

POST /api/vehicles/{id}/odometer {"valueKm":2000,"readingDate":"1899-12-31"}
-> 400 {"title":"Validation failed","status":400,"detail":"The date can't be before 1900-01-01.","code":"date.tooEarly","minDate":"1900-01-01"}

POST /api/vehicle-checklists/{id}/runs {"runAt":"1899-12-31","items":[...]}
-> 400 {..."code":"date.tooEarly","minDate":"1900-01-01"}

POST /api/vehicles {"nickname":"X","fuelType":99}
-> 400 {"title":"One or more validation errors occurred.","status":400,"errors":{"request":["Invalid value."],"fuelType":["Invalid value."]},"code":"http.400",...}

PUT /api/issues/{id} {"title":"t","status":2}
-> 400 {...,"errors":{"status":["Invalid value."],"request":["Invalid value."]},"code":"http.400"}

POST /api/vehicles with a 70,000-byte body
-> 413 {"title":"Bad request","status":413,"detail":"Request body too large. The max request body size is 65536 bytes.","code":"http.413"}
```

`concurrency.conflict` was not reproduced with curl (it needs two requests inside one save); it is covered by `tests/OnlyCars.Tests/LowThreeTests.cs` and `GlobalExceptionHandlerTests.ConcurrencyException_Returns409_ConcurrencyConflict_WithoutEfDetails`, body `{"title":"Conflict","status":409,"detail":"This was changed at the same time somewhere else. Reload and try again.","code":"concurrency.conflict"}`.
