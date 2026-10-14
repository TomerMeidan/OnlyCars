# API contract: MVP2-A, maintenance tasks

Published by backend-engineer, verified with curl against the live API.

## General rules
- Every endpoint requires `Authorization: Bearer <token>`. Without it the response is 401 with an empty body.
- JSON is camelCase. Enums are strings, for example `"category":"Belts"`. Dates are `"YYYY-MM-DD"`.
- Decimals can come back with the column's scale: `52300` from POST/PUT, `52300.00` from GET. Parse them as numbers.
- Errors are ProblemDetails: `{title, status, detail, code, ...extensions}`.
- Path ids must be GUIDs. A non-GUID id returns 404 with no body.

**TaskCategory values** (exact and case-sensitive): `Oil`, `Filters`, `Brakes`, `Tires`, `Fluids`, `Battery`, `Belts`, `Ignition`, `Other`.

## Endpoints
1. **`GET /api/task-templates`** returns 200 with `TaskTemplateDto[]`, ordered by category (enum order), then by key.
   - Shape: `{ id, key, name, category, defaultIntervalKm: number|null, defaultIntervalDays: number|null }`
2. **`GET /api/vehicles/{vehicleId}/tasks`** returns 200 with `MaintenanceTaskDto[]`.
   - Order: enabled tasks first, then by name in the database collation (not ordinal). The UI re-sorts by name with a culture-aware compare.
   - Shape: `{ id, vehicleId, templateId: string|null, name, category, intervalKm: number|null, intervalDays: number|null, dueSoonPercent, isEnabled, lastDoneOdometerKm, lastDoneDate }`
3. **`POST /api/vehicles/{vehicleId}/tasks`** returns 201 with `MaintenanceTaskDto`.
   - Body: `{ templateId?: string|null, name, category, intervalKm?: int|null, intervalDays?: int|null, lastDoneOdometerKm: number, lastDoneDate: "YYYY-MM-DD" }`
   - The name is trimmed. `templateId` only links the task to a template; the server stores the values sent.
4. **`PUT /api/vehicles/{vehicleId}/tasks/{taskId}`** returns 200 with `MaintenanceTaskDto`.
   - Body: `{ name, category, intervalKm?, intervalDays?, lastDoneOdometerKm, lastDoneDate, isEnabled?: bool|null }`
   - A full replace of those fields. `isEnabled` null or missing keeps the current value. `templateId` can't be changed.
   - **The enabled toggle must send the whole body.**
5. **`DELETE /api/vehicles/{vehicleId}/tasks/{taskId}`** returns 204.

## Error codes
Validation runs in the order listed, so only the first error is returned.

| Code | Status | Extensions | When |
|---|---|---|---|
| `task.nameRequired` | 400 | none | Name empty or whitespace, or over 100 characters after trimming |
| `task.invalidCategory` | 400 | none | Category missing or not an exact enum name |
| `task.intervalRequired` | 400 | none | Both intervals null |
| `task.invalidInterval` | 400 | none | `intervalKm` outside 1 to 1,000,000, or `intervalDays` outside 1 to 7,300 |
| `task.invalidLastDone` | 400 | `currentKm` | `lastDoneOdometerKm` missing, below 0 or above the car's current odometer, **or `lastDoneDate` missing** |
| `task.futureDate` | 400 | none | `lastDoneDate` later than UTC today + 1 day |
| `task.invalidTemplate` | 400 | none | POST only: unknown `templateId` |
| `vehicle.notFound` | 404 | none | The car doesn't exist or isn't the caller's (all task endpoints) |
| `maintenanceTask.notFound` | 404 | none | The task isn't on this car (PUT, DELETE) |
| `http.400` | 400 | `errors` | JSON that can't bind (for example `intervalKm: 1.5`). Validate integers on the client. |

## Templates
Ids are `7a5c0000-0000-4000-8000-0000000000NN`, where NN is 01 to 12 in this order:

| NN | Key | Category | Km | Days |
|---|---|---|---|---|
| 01 | `oilChange` | Oil | 10000 | 365 |
| 02 | `airFilter` | Filters | 20000 | 730 |
| 03 | `cabinFilter` | Filters | 15000 | 365 |
| 04 | `brakePads` | Brakes | 20000 | 365 |
| 05 | `brakeFluid` | Fluids | none | 730 |
| 06 | `coolant` | Fluids | 60000 | 1825 |
| 07 | `transmissionFluid` | Fluids | 60000 | none |
| 08 | `sparkPlugs` | Ignition | 60000 | none |
| 09 | `timingBelt` | Belts | 100000 | 1825 |
| 10 | `tireRotation` | Tires | 10000 | none |
| 11 | `battery` | Battery | none | 365 |
| 12 | `wiperBlades` | Other | none | 365 |

## Examples
```
POST /api/vehicles/{id}/tasks
{"templateId":"7a5c0000-0000-4000-8000-000000000009","name":"Timing belt","category":"Belts","intervalKm":100000,"intervalDays":1825,"lastDoneOdometerKm":52300,"lastDoneDate":"2026-03-03"}
→ 201 {"id":"e8ed…","vehicleId":"604f…","templateId":"7a5c…0009","name":"Timing belt","category":"Belts","intervalKm":100000,"intervalDays":1825,"dueSoonPercent":10,"isEnabled":true,"lastDoneOdometerKm":52300,"lastDoneDate":"2026-03-03"}

400 {"title":"Validation failed","status":400,"detail":"…","code":"task.invalidLastDone","currentKm":52300.00}
```
