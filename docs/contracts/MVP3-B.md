# API contract: MVP3-B, line items and editing service records

Published by backend-engineer, verified with curl against the live API. Extends `MVP3-A.md`; everything there still holds unless changed below. All distances are km, amounts are in the user's currency, and all endpoints need the bearer token.

## Changed: `ServiceRecordDto` gains `items`

Returned by `GET .../service-records`, `POST .../service-records` (inside `record`) and the new `PUT`.

```
ServiceRecordDto = {
  ...as in MVP3-A (id, date, odometerKm, shopName, totalCost, notes, tasks),
  "items": ServiceItemDto[]          // in the user's order; [] when none
}

ServiceItemDto = {
  "id": guid,                        // new ids on every save that sends items (the list is replaced)
  "description": string,             // trimmed, 1 to 100 chars
  "brand": string | null,            // trimmed; blank = null
  "partNumber": string | null,       // trimmed; blank = null
  "quantity": number,                // > 0, up to 10,000, 2 decimals; hours on a labour row
  "unitCost": number,                // 0 to 1,000,000, 2 decimals; the hourly rate on a labour row
  "isLabor": boolean
}
```

When a record has items, `totalCost` is always their sum (see "Total" below).

## Item rules (POST and PUT)

```
ServiceItemRequest = {
  "description": string,             // required; 1 to 100 chars after trimming
  "brand": string | null,            // optional; up to 100 chars after trimming
  "partNumber": string | null,       // optional; up to 50 chars after trimming
  "quantity": number,                // required; > 0 and <= 10,000, at most 2 decimals
  "unitCost": number,                // required; 0 to 1,000,000, at most 2 decimals
  "isLabor": boolean                 // default false
}
```

- Up to **50** items per record.
- The server does not stop a labour row from having a brand or part number; the UI just doesn't offer those fields there.
- **Total:** with at least one item, `totalCost` = the sum of `quantity × unitCost` over all items, rounded once to 2 decimals **half away from zero** (0.005 becomes 0.01). The client's live sum must round the same way. Floats can misround here (`1.005 * 100` is `100.49999…`), so work in integers: `sum of Math.round(q * 100) * Math.round(u * 100)` is exact (at most 5e15, under `Number.MAX_SAFE_INTEGER`), then `Math.round(that / 100) / 100` gives the total (values are never negative, so half-up equals half away from zero). Any `totalCost` in the body is ignored and not validated. A sum over 1,000,000 is `serviceRecord.invalidCost`.
- Without items (`items` missing, `null` or `[]`), `totalCost` is the hand-entered value as in MVP3-A (null = skipped; 0 to 1,000,000, 2 decimals).

### Item error codes

All are **400** and carry an **`index`** extension: the 0-based position of the offending row in the `items` array (UI "Item 2" is `index: 1`). Items are checked in order, and within an item in this order, so the first failing row and rule wins.

| Code | When |
|---|---|
| `serviceItem.invalidDescription` | Description missing, blank, or over 100 chars after trimming (also a `null` entry in the array) |
| `serviceItem.brandTooLong` | Brand over 100 chars after trimming |
| `serviceItem.partNumberTooLong` | Part number over 50 chars after trimming |
| `serviceItem.invalidQuantity` | Quantity missing, 0 or less, over 10,000, or more than 2 decimals |
| `serviceItem.invalidUnitCost` | Unit cost missing, below 0, over 1,000,000, or more than 2 decimals |

Record-level codes for items, with no `index`: `serviceRecord.tooManyItems` (400, more than 50 items, checked before any row), and `serviceRecord.invalidCost` (400, item sum over 1,000,000).

Nothing is saved on any error.

## Changed: `POST /api/vehicles/{vehicleId}/service-records`

The body gains an optional `"items": ServiceItemRequest[] | null`. Everything else is unchanged (201, response shape, side effects).

Order of checks (the first failure wins). The item checks take the place of MVP3-A's `serviceRecord.invalidCost` step:
`vehicle.notFound` → `serviceRecord.futureDate` → `odometer.invalidValue` (missing) → `serviceRecord.tooManyItems` → item codes (by row) → `serviceRecord.invalidCost` (item sum, or the entered cost when there are no items) → `serviceRecord.shopTooLong` → `serviceRecord.notesTooLong` → `maintenanceTask.notFound` → odometer range and date-order codes, as in MVP3-A.

## New: `PUT /api/vehicles/{vehicleId}/service-records/{recordId}`

Edits shop, cost, notes and items. Send the full state of all four fields; anything left out is cleared to `null` / `[]`.

```
{
  "shopName": string | null,              // trimmed; blank = DIY (null); up to 100 chars
  "totalCost": number | null,             // used only when items is empty or missing
  "notes": string | null,                 // trimmed; blank = null; up to 1,000 chars
  "items": ServiceItemRequest[] | null    // replaces the whole list; null or [] clears it
}
```

**200** `ServiceRecordDto` (the updated record, with its tasks and the new items).

It does **not** change the date, odometer, linked tasks, the record's Service odometer reading, the car's current odometer, or any task's `lastDone*`, so there is no need to reload the tasks or the odometer history after an edit.

Order of checks (the first failure wins; nothing is saved on any error):

| Code | Status | Extensions | When |
|---|---|---|---|
| `vehicle.notFound` | 404 | none | Not the caller's car (also another user's car) |
| `serviceRecord.notFound` | 404 | none | No such record on this car (also another user's record, or a record of a different car) |
| `serviceRecord.alreadyVoided` | 409 | none | The record was deleted (voided) |
| `serviceRecord.tooManyItems` | 400 | none | More than 50 items |
| `serviceItem.*` | 400 | `index` | See "Item error codes" |
| `serviceRecord.invalidCost` | 400 | none | Item sum over 1,000,000, or (without items) the entered cost outside 0 to 1,000,000 or with more than 2 decimals |
| `serviceRecord.shopTooLong` | 400 | none | Over 100 chars after trimming |
| `serviceRecord.notesTooLong` | 400 | none | Over 1,000 chars after trimming |

The server does not block edits on archived cars (the UI hides Edit there), matching the other record endpoints.

## Unchanged

`POST .../service-records/{recordId}/void` is the Delete. Same request, response and codes as in MVP3-A. A voided record's items stay in the database with it, hidden like the record.

## Examples (from curl)

```
POST /api/vehicles/{id}/service-records
  {"date":"2026-10-14","odometerKm":49900,"shopName":"Garage Cohen","totalCost":5,
   "items":[{"description":"Oil filter","brand":"Mann","partNumber":"W 712/75","quantity":2,"unitCost":45.5},
            {"description":"Labour","quantity":1.5,"unitCost":200,"isLabor":true}]}
→ 201 {"record":{"id":"f8cf7056-…","date":"2026-10-14","odometerKm":49900,"shopName":"Garage Cohen","totalCost":391.0,"notes":null,"tasks":[],
        "items":[{"id":"9cc62a74-…","description":"Oil filter","brand":"Mann","partNumber":"W 712/75","quantity":2,"unitCost":45.5,"isLabor":false},
                 {"id":"ed86f610-…","description":"Labour","brand":null,"partNumber":null,"quantity":1.5,"unitCost":200,"isLabor":true}]},"tasks":[]}

PUT /api/vehicles/{id}/service-records/f8cf7056-…
  {"shopName":"New shop","totalCost":1,"notes":"Fixed","items":[{"description":"Labour","quantity":2,"unitCost":200,"isLabor":true},
                                                               {"description":"Air filter","quantity":1,"unitCost":60}]}
→ 200 {"id":"f8cf7056-…","date":"2026-10-14","odometerKm":49900.00,"shopName":"New shop","totalCost":460,"notes":"Fixed","tasks":[],
       "items":[{"id":"3483ee1a-…","description":"Labour",…,"quantity":2,"unitCost":200,"isLabor":true},
                {"id":"82cfaca9-…","description":"Air filter",…,"quantity":1,"unitCost":60,"isLabor":false}]}

PUT … {"shopName":null,"totalCost":80,"notes":null,"items":[]}
→ 200 {…,"shopName":null,"totalCost":80,"notes":null,"tasks":[],"items":[]}

PUT … {"items":[{"description":"Ok","quantity":1,"unitCost":1},{"description":"Bad","quantity":0,"unitCost":1}]}
→ 400 {"title":"Validation failed","status":400,"detail":"Item 2: The quantity must be above 0 and up to 10000 with at most 2 decimals.",
       "code":"serviceItem.invalidQuantity","index":1}

PUT … {"items":[{"description":"A","quantity":2,"unitCost":500000.01}]}
→ 400 {…,"code":"serviceRecord.invalidCost"}

PUT …/service-records/00000000-0000-0000-0000-000000000001 {}      → 404 {…,"code":"serviceRecord.notFound"}
PUT (another user's token) …                                       → 404 {…,"code":"vehicle.notFound"}
PUT after POST …/void                                              → 409 {…,"code":"serviceRecord.alreadyVoided"}
```

Numbers may come back as `391.0` or `391.00` depending on the endpoint (JSON numbers; parse, don't string-compare).
