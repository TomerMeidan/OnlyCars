# API contract: MVP5-D, tire sets, mounts and km per set

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB). Every endpoint needs the bearer token (401 without it) and only sees the caller's data: another user's set, mount or car is a 404 (`tireSet.notFound`, `tireMount.notFound`, `vehicle.notFound`). Migration `AddTires` adds the tables `TireSets` and `TireMounts` (additive only). Bodies over 64 KB are 413 `http.413`. Enums bind by name only: `"season": 1` is a 400 `http.400` with `errors.season`.

Dates are `YYYY-MM-DD`; `createdAt` is an ISO timestamp. Every km value is in **km** (convert to the user's unit for display and back on input).

## Shapes

```
TireSetDto {
  "id": guid,
  "brand": string,                 // 1 to 50, trimmed
  "model": string|null,            // up to 50, trimmed; blank becomes null
  "size": string|null,             // up to 30, free text such as "205/55 R16"
  "season": "Summer"|"Winter"|"AllSeason",
  "purchaseDate": date|null,
  "dotCode": string|null,          // up to 20, free text
  "notes": string|null,            // up to 1,000; the storage notes
  "createdAt": datetime,
  "kmDriven": number,              // km: closed mounts + max(0, car's current odometer - mount odometer) for the open one
  "openMount": { "vehicleId": guid, "vehicleNickname": string, "mountedAt": date, "mountOdometerKm": number } | null,  // null = in storage
  "mountCount": int
}
TireMountDto {
  "id": guid,
  "tireSetId": guid, "brand": string, "model": string|null, "size": string|null, "season": string,   // the set
  "vehicleId": guid, "vehicleNickname": string,                                                      // the car
  "mountedAt": date, "mountOdometerKm": number,
  "unmountedAt": date|null, "unmountOdometerKm": number|null,   // null while the set is on the car
  "kmDriven": number                                            // km for this mount (open: up to the car's current odometer, never negative)
}
VehicleTiresDto {
  "current": TireMountDto|null,    // the set on the car now
  "past": TireMountDto[]           // closed mounts, newest first (mountedAt, then created), at most the newest 100
}
```

## Endpoints

| Method and path | Body | Success |
|---|---|---|
| `GET /api/tire-sets` | | 200 `TireSetDto[]`, sorted by brand, then model, then creation time. `[]` when none. |
| `POST /api/tire-sets` | `{ brand, model, size, season, purchaseDate, dotCode, notes }` | 201 `TireSetDto` |
| `PUT /api/tire-sets/{id}` | same as POST (every field; omitted optional fields become null) | 200 `TireSetDto` |
| `DELETE /api/tire-sets/{id}` | | 204; hard delete with all its mounts (a set on a car comes off it) |
| `GET /api/tire-sets/{id}/mounts` | | 200 `TireMountDto[]`, newest first (open one first if any) |
| `GET /api/vehicles/{vehicleId}/tires` | | 200 `VehicleTiresDto`. Archived cars work too. |
| `POST /api/vehicles/{vehicleId}/tires/mount` | `{ tireSetId, mountedAt, odometerKm }` | 200 `VehicleTiresDto` (the car's new state) |
| `POST /api/vehicles/{vehicleId}/tires/unmount` | `{ unmountedAt, odometerKm }` | 200 `VehicleTiresDto` |
| `DELETE /api/tire-mounts/{id}` | | 204; deleting the open mount leaves the car with no set |

**Mount**: `mountedAt` defaults to today (UTC) when omitted; send the user's local date. `odometerKm` is required. If the car has a set on, that mount is closed at the same date and odometer in the same save (a **swap**); both changes or neither. Mount and unmount **do not** add an odometer reading and don't change the car's odometer.

**Unmount**: allowed on an archived car. Same date and odometer rules.

## Errors

All are ProblemDetails with `code`; 400 unless noted.

| Code | When | Extensions | Show on |
|---|---|---|---|
| `tireSet.invalidBrand` | brand empty after trim or over 50 | | brand |
| `tireSet.invalidModel` | model over 50 | | model |
| `tireSet.invalidSize` | size over 30 | | size |
| `tireSet.invalidDotCode` | DOT code over 20 | | DOT code |
| `tireSet.invalidNotes` | notes over 1,000 | | notes |
| `tireSet.invalidSeason` | season missing or null | | season |
| `tireSet.futureDate` | purchase date after tomorrow (UTC; one day of slack for the local date) | | purchase date |
| `date.tooEarly` | purchase, mount or unmount date before 1900-01-01 | `minDate` | the date |
| `tireSet.limitReached` | a 51st set | | form |
| `tireSet.notFound` (404) | set id unknown or another user's (also as `tireSetId` on mount) | | page |
| `vehicle.notFound` (404) | car unknown or another user's | | page |
| `tireMount.vehicleArchived` | mount on an archived car | | form |
| `tireMount.setMounted` (409) | the set is on a car (this one or another); unmount it there first | | set picker |
| `tireMount.overlap` | mount date before the car's open mount's `mountedAt`, or before the latest `unmountedAt` of the set or the car; unmount date before the open mount's `mountedAt` (the same day is fine) | | date |
| `tireMount.futureDate` | mount or unmount date after tomorrow (UTC) | | date |
| `odometer.invalidValue` | odometer missing, below 0 or over 10,000,000 km | | odometer |
| `tireMount.odometerBeforeMount` | swap or unmount odometer below the closing mount's odometer | `mountOdometerKm` (km) | odometer |
| `tireMount.limitReached` | a 501st mount of a set | | form |
| `tireMount.notFound` (404) | unmount with no set on the car; delete of an unknown or another user's mount | | form / row |
| `concurrency.conflict` (409) | a simultaneous mount of the same car or set saved first | | form (reload) |

## Examples (from curl)

```
POST /api/tire-sets  {"brand":"Nokian","model":"Hakka R5","size":"205/55 R16","season":"Winter","purchaseDate":"2024-10-01","dotCode":"DOT 4523","notes":"Garage loft"}
201 {"id":"04c28be9-…","brand":"Nokian","model":"Hakka R5","size":"205/55 R16","season":"Winter","purchaseDate":"2024-10-01","dotCode":"DOT 4523","notes":"Garage loft","createdAt":"2026-10-16T08:33:19.366049+00:00","kmDriven":0.00,"openMount":null,"mountCount":0}

POST /api/vehicles/{car}/tires/mount  {"tireSetId":"04c28be9-…","mountedAt":"2026-10-01","odometerKm":49000}   (Michelin was on since 2026-04-01 at 45,000)
200 {"current":{"id":"7c2e1a96-…","tireSetId":"04c28be9-…","brand":"Nokian","model":"Hakka R5","size":"205/55 R16","season":"Winter","vehicleId":"85799646-…","vehicleNickname":"Mazda","mountedAt":"2026-10-01","mountOdometerKm":49000.00,"unmountedAt":null,"unmountOdometerKm":null,"kmDriven":1000.00},
     "past":[{"id":"a82adaa7-…","tireSetId":"1db36673-…","brand":"Michelin","model":null,"size":null,"season":"Summer","vehicleId":"85799646-…","vehicleNickname":"Mazda","mountedAt":"2026-04-01","mountOdometerKm":45000.00,"unmountedAt":"2026-10-01","unmountOdometerKm":49000.00,"kmDriven":4000.00}]}

POST /api/vehicles/{car}/tires/mount  {"tireSetId":"04c28be9-…","mountedAt":"2026-10-01","odometerKm":44000}
400 {"title":"Validation failed","status":400,"detail":"The odometer is below the odometer at mount.","code":"tireMount.odometerBeforeMount","mountOdometerKm":45000.00}

POST /api/vehicles/{car}/tires/unmount  {"unmountedAt":"2026-10-10","odometerKm":49500}
200 {"current":null,"past":[{…Nokian, "unmountedAt":"2026-10-10","unmountOdometerKm":49500.00,"kmDriven":500.00}, {…Michelin}]}
```
