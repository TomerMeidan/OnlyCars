# API contract: RPT-1, cost reports

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB). Read-only, no schema change, no migration. Needs the bearer token (401 without it). Amounts are in the user's one currency (never converted); distances are km (the client converts for miles users).

## New: `GET /api/reports/costs?year=YYYY&vehicleId=<guid, optional>`

| Query | Type | Meaning |
|---|---|---|
| `year` | integer, required | The year for `total`, `recordCount`, `unpricedCount`, `byMonth`, `byCategory` and `byVehicle`. 1900 to the server's current UTC year, plus one day of slack (on Dec 31 UTC next year is accepted, so a client east of UTC can ask for its new local year). Digits only. |
| `vehicleId` | guid, optional | Limits **every** block (including `years` and `cars`) to that car. Must be the caller's car, archived or not. |

### Response 200

```
{
  "years": [ { "year": int, "total": decimal, "recordCount": int } ],   // every year with a non-voided record, newest first; [] when none
  "year": int,                // the requested year
  "total": decimal,           // sum of TotalCost for the year (no cost counts as 0)
  "recordCount": int,         // non-voided records in the year
  "unpricedCount": int,       // of those, records with no TotalCost
  "byMonth": [ { "month": 1..12, "total": decimal, "recordCount": int } ],  // always 12 rows, Jan first, zeros included
  "byCategory": [ { "category": "Oil"|"Filters"|"Brakes"|"Tires"|"Fluids"|"Battery"|"Belts"|"Ignition"|"Other"|null, "total": decimal } ],
  "byVehicle": [ { "vehicleId": guid, "nickname": string, "isArchived": bool, "total": decimal, "recordCount": int } ],
  "cars": [ {                 // ALL TIME, not limited by year; every car of the caller (or the one car), even with no records
      "vehicleId": guid, "nickname": string, "isArchived": bool,
      "serviceTotal": decimal,              // all-time non-voided TotalCost sum
      "kmDriven": decimal,                  // CurrentOdometerKm minus the first odometer reading (by date, then save time); never below 0
      "costPerKm": decimal|null,            // serviceTotal / kmDriven, rounded to 4 decimals; null when kmDriven is 0
      "purchasePrice": decimal|null,
      "totalCostOfOwnership": decimal|null  // purchasePrice + serviceTotal; null when purchasePrice is null
  } ]
}
```

Rules:
- Only non-voided records count; archived cars count; month and year are the record's `date`.
- `byMonth`, `byCategory` and `byVehicle` each sum to `total`; `byMonth` record counts sum to `recordCount`.
- `byCategory`: a record's cost is split equally over the **distinct** categories of its tasks, at 2 decimals rounded down, with the remainder cents on the first category by name (alphabetical English enum name: Battery, Belts, Brakes, Filters, Fluids, Ignition, Oil, Other, Tires). 100 over Tires, Oil and Battery is Battery 33.34, Oil 33.33, Tires 33.33. A record with no tasks goes to `category: null` ("No task"). Rows with total 0 are left out (so an unpriced record never makes a row). Highest total first, ties by category name.
- `byVehicle`: rows with total 0 are left out (a car with only unpriced records in the year is not listed). Highest total first, ties by nickname.
- `cars` order: active cars first, then archived; each by nickname.
- The `years` totals and counts match `total`/`recordCount` for that year, and `GET /api/service-records?from=YYYY-01-01&to=YYYY-12-31` (plus `vehicleId`) gives the same `totalCount`/`totalCost`; a month's figures match `from=YYYY-MM-01&to=<last day>`.
- Decimals may serialize as `0` or `0.00`; treat them as numbers.

### Errors

| Code | Status | Extensions | When |
|---|---|---|---|
| `report.invalidYear` | 400 | none | `year` missing, empty, not all digits (`abc`, `2025.5`, `-2025`, ` 2025`), before 1900, or after the server's current year (with the 1-day slack) |
| `vehicle.notFound` | 404 | none | `vehicleId` is another user's car or does not exist |
| `http.400` | 400 | `errors.vehicleId` | `vehicleId` is not a guid (model binding) |
| (none) | 401 | | No or bad token |

### Example (curl)

Corolla (purchase price 20,000, first reading 40,000 km) with a 300 record on Oil and Brakes in March 2025, now at 50,000 km; Van (no purchase price, first reading 10,000 km) with a 100.50 record with no tasks in March and an unpriced one in July, now at 13,000 km.

```
GET /api/reports/costs?year=2025
200
{"years":[{"year":2025,"total":400.50,"recordCount":3}],"year":2025,"total":400.50,"recordCount":3,"unpricedCount":1,
 "byMonth":[{"month":1,"total":0,"recordCount":0},{"month":2,"total":0,"recordCount":0},{"month":3,"total":400.50,"recordCount":2},{"month":4,"total":0,"recordCount":0},{"month":5,"total":0,"recordCount":0},{"month":6,"total":0,"recordCount":0},{"month":7,"total":0.00,"recordCount":1},{"month":8,"total":0,"recordCount":0},{"month":9,"total":0,"recordCount":0},{"month":10,"total":0,"recordCount":0},{"month":11,"total":0,"recordCount":0},{"month":12,"total":0,"recordCount":0}],
 "byCategory":[{"category":"Brakes","total":150.00},{"category":"Oil","total":150.00},{"category":null,"total":100.50}],
 "byVehicle":[{"vehicleId":"af22…","nickname":"Corolla","isArchived":false,"total":300.00,"recordCount":1},{"vehicleId":"707c…","nickname":"Van","isArchived":false,"total":100.50,"recordCount":2}],
 "cars":[{"vehicleId":"af22…","nickname":"Corolla","isArchived":false,"serviceTotal":300.00,"kmDriven":10000.00,"costPerKm":0.03,"purchasePrice":20000.00,"totalCostOfOwnership":20300.00},
         {"vehicleId":"707c…","nickname":"Van","isArchived":false,"serviceTotal":100.50,"kmDriven":3000.00,"costPerKm":0.0335,"purchasePrice":null,"totalCostOfOwnership":null}]}

GET /api/reports/costs?year=2025&vehicleId=<another user's car>
404 {"title":"Not found","status":404,"detail":"Vehicle '8654…' was not found.","code":"vehicle.notFound"}

GET /api/reports/costs?year=abc
400 {"title":"Validation failed","status":400,"detail":"The year must be a number from 1900 to 2026.","code":"report.invalidYear"}
```
