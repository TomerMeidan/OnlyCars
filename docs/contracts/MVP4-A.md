# API contract: MVP4-A, dashboard

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB). All distances are km, amounts are in the user's currency, and every endpoint needs the bearer token (401 without it). No schema change, no migration.

## New: `GET /api/dashboard?today=YYYY-MM-DD`

| Query | Type | Meaning |
|---|---|---|
| `today` | date, optional | The client's local date (`localToday()`). Accepted within UTC today plus or minus 1 day; defaults to UTC today. It **only** picks the spend month; task statuses always use the server's UTC date, as `GET .../tasks` does. |

### Response 200

```
{
  "overdueCount": int,        // enabled tasks of the user's non-archived cars
  "dueSoonCount": int,
  "month": "YYYY-MM",         // month of `today`
  "monthTotalCost": decimal,  // sum of TotalCost (null counts as 0)
  "monthServiceCount": int,   // non-voided records of ALL the user's cars (archived included), Date from the 1st of the month to `today`
  "vehicles": [               // non-archived cars only
    {
      "id": guid, "nickname": string, "make": string|null, "model": string|null, "year": int|null,
      "currentOdometerKm": decimal,
      "overdueCount": int, "dueSoonCount": int,
      "tasks": MaintenanceTaskDto[]   // ALL its enabled tasks (the client shows the first 3; "All tasks (N)" is tasks.length)
    }
  ]
}
```

- `monthTotalCost` and `monthServiceCount` equal `totalCost` and `totalCount` of `GET /api/service-records?from=<month>-01&to=<today>`, so the `/history` link shows the same figures.
- `tasks` order: status Overdue, Due soon, OK; within a status by `progress` descending; then by name (server compare: invariant culture; the car page's `localeCompare` with `numeric` can differ on ties like "Oil 2" and "Oil 10").
- `vehicles` order: by the first task's status, then its `progress` (both descending), then by nickname; cars with no enabled tasks last (by nickname).
- `MaintenanceTaskDto` is the same shape as `GET .../tasks` (disabled tasks are never included, so `status`, `remainingKm`/`remainingDays` and `progress` are set).
- With no cars: zeros and `"vehicles": []`.
- Four database queries whatever the number of cars.

### Errors

| Code | Status | Extensions | When |
|---|---|---|---|
| `dashboard.invalidDate` | 400 | none | `today` more than 1 day from UTC today |
| `http.400` | 400 | `errors.today` | `today` not a valid date (model binding) |
| (none) | 401 | | No or bad token |

### Example (curl)

Corolla at 50,000 km with Oil (10,000 km / 365 days, last done 39,000) and Brakes (20,000 km, last done 31,000); Bike with no tasks; an archived van with an overdue task and a 100.00 record; a 250.50 record on the Corolla today.

```
GET /api/dashboard?today=2026-10-15
200
{"overdueCount":1,"dueSoonCount":1,"month":"2026-10","monthTotalCost":350.50,"monthServiceCount":2,"vehicles":[
 {"id":"939b…","nickname":"Corolla","make":"Toyota","model":"Corolla","year":2019,"currentOdometerKm":50000.00,"overdueCount":1,"dueSoonCount":1,"tasks":[
  {"id":"c2c7…","vehicleId":"939b…","templateId":null,"name":"Oil","category":"Oil","intervalKm":10000,"intervalDays":365,"dueSoonPercent":10,"isEnabled":true,"lastDoneOdometerKm":39000.00,"lastDoneDate":"2026-10-15","status":"Overdue","remainingKm":-1000.00,"remainingDays":365,"progress":1.1},
  {"id":"c471…","vehicleId":"939b…","templateId":null,"name":"Brakes","category":"Brakes","intervalKm":20000,"intervalDays":null,"dueSoonPercent":10,"isEnabled":true,"lastDoneOdometerKm":31000.00,"lastDoneDate":"2026-10-15","status":"DueSoon","remainingKm":1000.00,"remainingDays":null,"progress":0.95}]},
 {"id":"2c2a…","nickname":"Bike","make":null,"model":null,"year":null,"currentOdometerKm":1000.00,"overdueCount":0,"dueSoonCount":0,"tasks":[]}]}

GET /api/service-records?from=2026-10-01&to=2026-10-15  ->  …"totalCount":2,"totalCost":350.50}

GET /api/dashboard?today=2020-01-01
400 {"title":"Validation failed","status":400,"detail":"The date must be today.","code":"dashboard.invalidDate"}
```

## Unchanged: same-date odometer readings

B0 (ordering same-date readings by value) was reverted. Readings stay ordered by `(readingDate, save time)` as described in `MVP3-A.md` and `MVP3-D.md`, so a same-day reading lower than the latest one still returns 400 `odometer.lowerThanPrevious` (curl: car at 1,500 km today, `POST .../odometer {"valueKm":1200,"readingDate":"2026-10-15"}` -> 400 with `previousKm` 1500).
