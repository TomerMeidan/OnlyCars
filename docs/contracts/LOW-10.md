# LOW-10 contract (backend)

## L201: odometer order errors without trailing zeros

`POST /api/vehicles/{vehicleId}/odometer` and `PUT /api/vehicles/{vehicleId}/odometer/{readingId}` (and every path that runs the same order check: service records, checklist runs). Request and success response unchanged.

| code | status | extensions |
|---|---|---|
| `odometer.lowerThanPrevious` | 400 | `previousKm`: number, km, no trailing zeros (`12345`, `12345.5`) |
| `odometer.higherThanNext` | 400 | `nextKm`: number, km, no trailing zeros |

Before: `12345.00` could arrive as `12345` or `12345.00` depending on how the value was stored; now it is always the shortest form, the same shape as `valueKm` in reading DTOs (L193). The `detail` text uses the same form.

Example (from curl):

```
POST /api/vehicles/63e0fd43-.../odometer   {"valueKm":100}
400 {"title":"Validation failed","status":400,"detail":"New reading (100 km) is lower than the reading before it (12345.5 km). ...","code":"odometer.lowerThanPrevious","previousKm":12345.5}
```

## Orphan R2 sweep

No HTTP endpoint. Owner-only command, in `src/OnlyCars.Api`:

```
dotnet run --launch-profile http -- sweep-orphans [--delete] [--force]
```

Prints the bucket name and the SQL database and server names first (never credentials), then each orphan `users/{guid}/` prefix with its object count and a totals line; exit code 0. Without `--delete` it deletes nothing. On any stop before deleting (unknown option, storage not configured or failing, database unreachable, 0 users, more than half orphans without `--force`) it prints `sweep-orphans stopped, nothing deleted: <reason>` and exits 1. If a delete fails it prints `sweep-orphans stopped after deleting N of M prefixes: ...` and exits 1; running again retries the rest. Nothing for the client.
