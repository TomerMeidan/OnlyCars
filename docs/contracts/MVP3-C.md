# API contract: MVP3-C, filter and search the service history

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB). Extends `MVP3-B.md`. All distances are km, amounts are in the user's currency, and the endpoint needs the bearer token (401 without it). No schema change, no migration, no new index.

## Changed: `ServiceRecordDto` gains `vehicleId`

Every endpoint that returns a `ServiceRecordDto` (the car's `GET`/`POST`/`PUT .../service-records`) now also carries `"vehicleId": guid`. Additive only; nothing else changed.

## New: `GET /api/service-records`

Lists the signed-in user's **non-voided** service records across **all their cars, archived cars included**. Read-only.

### Query parameters (all optional)

| Name | Type | Meaning |
|---|---|---|
| `vehicleId` | guid | Only this car's records |
| `taskId` | guid | Only records linked to this task (through the record's tasks) |
| `from` | date `yyyy-MM-dd` | Record date on or after (inclusive) |
| `to` | date `yyyy-MM-dd` | Record date on or before (inclusive) |
| `q` | string | Trimmed; case-insensitive "contains" on the shop name, notes, or any item's description, brand or part number. Empty or blank = no search. `%`, `_` and `[` match literally. |
| `skip` | int | Default 0 |
| `take` | int | Default 50, 1 to 100 |

Filters combine with AND. Order: newest first by date, then odometer, then creation time (all descending), then id, so pages are stable and never overlap.

A `vehicleId` or `taskId` that is not the user's, or a `taskId` of a car other than `vehicleId`, returns the empty result below (200), never 404.

### Response 200

```
{
  "items": ServiceRecordDto[],   // this page: id, vehicleId, date, odometerKm, shopName, totalCost, notes, tasks, items (as in MVP3-B)
  "totalCount": number,          // every match, not just this page
  "totalCost": number            // sum of totalCost over every match; null costs count as 0; 2 decimals
}
```

Show more while `skip + items.length < totalCount`.

### Errors (400, nothing returned)

Checked in this order; the first failure wins. No extensions.

| Code | When |
|---|---|
| `serviceRecord.invalidDateRange` | `from` is after `to` |
| `serviceRecord.searchTooLong` | `q` is over 100 characters after trimming |
| `serviceRecord.invalidPaging` | `skip` below 0, or `take` below 1 or over 100 |
| `http.400` | Malformed value (not a guid, date not `yyyy-MM-dd`, skip/take not an integer); `errors` names the field, e.g. `{"from":["Invalid value."]}` |

### Examples (from the curl checks)

```
GET /api/service-records?q=MANN&take=1
200
{"items":[{"id":"a5a12e8e-55fe-4207-a92e-cb4077f60a78","date":"2026-09-01","odometerKm":48000.00,"shopName":"Speedy Garage",
  "totalCost":45.50,"notes":"Fixed a rattle","tasks":[{"id":"19239190-bfb3-47b1-976e-dfdfd3e2473b","name":"Oil","category":"Oil"}],
  "items":[{"id":"51705ddb-8899-464e-b49d-f1ed392a2e10","description":"Oil filter","brand":"Mann","partNumber":"W 712/75",
  "quantity":1.00,"unitCost":45.50,"isLabor":false}],"vehicleId":"c014a102-754a-4f20-a9e6-9c6e2ce718a8"}],
  "totalCount":1,"totalCost":45.50}

GET /api/service-records?vehicleId=<another user's car>
200
{"items":[],"totalCount":0,"totalCost":0.00}

GET /api/service-records?from=2026-10-02&to=2026-10-01
400
{"title":"Validation failed","status":400,"detail":"The start date must not be after the end date.","code":"serviceRecord.invalidDateRange"}

GET /api/service-records?take=101
400
{"title":"Validation failed","status":400,"detail":"Skip must be 0 or more and take 1 to 100.","code":"serviceRecord.invalidPaging"}
```

### Notes for the frontend

- The archived flag is not on the record; get it from `GET /api/vehicles?includeArchived=true` and match on `vehicleId`.
- The car page's own list (`GET /api/vehicles/{id}/service-records`) still orders by date then creation time; `/history` adds odometer between them, so two same-day records can appear in a different order on the two pages.
