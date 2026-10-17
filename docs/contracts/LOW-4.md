# API contract: LOW-4, the Low backlog (backend part)

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB) and by a plain `dotnet test` (500 passed). No new endpoints, no new error codes, no migration. Only the behavior below changes.

## Changed behavior

1. **`date.tooEarly` on two more dates (L67).** 400 `date.tooEarly`, extension `minDate: "1900-01-01"` (the same code and shape as in LOW-3), now also on:
   - `PUT /api/issues/{id}`: `resolvedAt` before 1900-01-01 when the status is (or stays) `Done`. Map it on the to-do **Done date** field. A date from 1900-01-01 to 1999-12-31 is still 400 `issue.invalidDate` (the to-do minimum stays 2000-01-01), and a missing date is still `issue.invalidDate`.
   - `POST /api/vehicles/{id}/tasks` and `PUT /api/vehicles/{id}/tasks/{taskId}`: `lastDoneDate` before 1900-01-01. Map it on the task **last done date** field. On PUT it is checked only when `lastDoneDate` changes, like `task.futureDate`.
2. **Simultaneous duplicates are 409, not 500 (L66).** Two simultaneous `POST /api/vehicles` with the same `vin` (or a `PUT /api/vehicles/{id}` racing a create of that VIN): one succeeds, the other is 409 `vehicle.vinTaken`. Two simultaneous `POST /api/auth/register` with the same email: one 200, the other 409 `auth.emailTaken`. These are the codes a non-simultaneous duplicate already returns, so the client needs no change.
3. **A service record edit that changes nothing does not save (L70).** `PUT /api/vehicles/{id}/service-records/{recordId}` whose shop, notes, total, items (same order, after trimming), tasks (as a set) and date/odometer all equal the stored record returns 200 with the usual body (`{record, tasks}`) and does not save, so a void right after it succeeds instead of 409 `concurrency.conflict`. Any real change saves as before.
4. **Accepted, no change (L86).** The 200-check and 100-rotation caps per mount can still be passed by one under simultaneous creates.

Internal only (no contract change): `FindMountAsync` no longer joins the car on the tire check and rotation list and delete paths (L81).

## Examples (from the curl checks)

```
PUT /api/issues/{id} {"title":"Wipers","status":"Done","resolvedAt":"1899-12-31"}
-> 400 {"title":"Validation failed","status":400,"detail":"The date can't be before 1900-01-01.","code":"date.tooEarly","minDate":"1900-01-01"}

POST /api/vehicles/{id}/tasks {"name":"Oil","category":"Oil","intervalKm":5000,"lastDoneOdometerKm":40000,"lastDoneDate":"1899-12-31"}
-> 400 {"title":"Validation failed","status":400,"detail":"The date can't be before 1900-01-01.","code":"date.tooEarly","minDate":"1900-01-01"}
(PUT /api/vehicles/{id}/tasks/{taskId} with the same body: the same 400)

Two POST /api/vehicles {"nickname":"Car1|Car2","vin":"LOW4VIN1792219559485","initialOdometerKm":50000} at once
-> 201 and 409 {"title":"Conflict","status":409,"detail":"A vehicle with this VIN already exists on your account.","code":"vehicle.vinTaken"}

Two POST /api/auth/register {"email":"low4b-...@onlycars.test","password":"Passw0rd!"} at once
-> 200 and 409 {"code":"auth.emailTaken", ...}

POST /api/vehicles/{id}/service-records {"date":"2026-10-17","odometerKm":50000,"shopName":"Shop","taskIds":[]}
PUT  /api/vehicles/{id}/service-records/{recordId} {"shopName":"Shop"}
-> 200 {"record":{"id":"984bdc96-...","date":"2026-10-17","odometerKm":50000.00,"shopName":"Shop","totalCost":null,"notes":null,"tasks":[],"items":[],"vehicleId":"35f97c2f-..."},"tasks":[...]}
   UpdatedAt in the database before and after: 2026-10-17T06:46:02.6023283Z (unchanged)
POST /api/vehicles/{id}/service-records/{recordId}/void -> 200
```
