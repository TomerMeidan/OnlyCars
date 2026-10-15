# API contract: SET-2, distance unit (km or miles)

Published by backend-engineer, verified with curl against the live API. Extends `SET-1.md`; everything there still holds unless changed below.

## Changed

### `PUT /api/me/settings`
```
{ "locale"?: "En" | "He" | null, "theme"?: "System" | "Light" | "Dark" | null,
  "currency"?: "ILS" | "USD" | "EUR" | "GBP" | null, "distanceUnit"?: "Km" | "Mi" | null }
```
`distanceUnit` is new. Same rules as the other fields: PascalCase and case-sensitive (`"mi"`, `"KM"`, `"Miles"`, `"1"` are rejected), a missing or null field is left unchanged, **200** returns the updated `UserDto`.

Every field is validated before anything is saved, so one invalid field saves nothing. Check order: locale, theme, currency, **distanceUnit**.

`GET /api/me` and login return the saved `distanceUnit` (the `UserDto` shape is unchanged; new users default to `Km`, and register does not accept it).

### Distances stay in km
No other endpoint changes. Every distance in requests, responses and error extensions (`previousKm`, `nextKm`, `currentKm`, interval and odometer caps) is still in **km**. The client converts with 1 mi = 1.609344 km (see `docs/decisions.md`, "Distance unit rules, SET-2").

## Error codes (new)

| Code | Status | Extensions | When |
|---|---|---|---|
| `settings.invalidDistanceUnit` | 400 | none | `distanceUnit` is a string other than `Km` or `Mi` |

A non-string `distanceUnit` (e.g. `1`) returns the generic `http.400` model-binding error, as for the other fields.

## Examples
```
PUT /api/me/settings  {"distanceUnit":"Mi"}
→ 200 {"id":"9d4cc375-…","email":"set2-24543@example.com","distanceUnit":"Mi","currency":"ILS","locale":"En","theme":"System"}

GET /api/me
→ 200 {"id":"9d4cc375-…","email":"set2-24543@example.com","distanceUnit":"Mi","currency":"ILS","locale":"En","theme":"System"}

POST /api/auth/login  {"email":"set2-24543@example.com","password":"…"}
→ 200 {…,"user":{"id":"9d4cc375-…","email":"set2-24543@example.com","distanceUnit":"Mi","currency":"ILS","locale":"En","theme":"System"}}

PUT /api/me/settings  {"theme":"Dark","currency":"USD","distanceUnit":"mi"}
→ 400 {"title":"Validation failed","status":400,"detail":"DistanceUnit must be one of Km, Mi.","code":"settings.invalidDistanceUnit"}   (theme and currency not saved)

PUT /api/me/settings  {"currency":"JPY","distanceUnit":"Miles"}
→ 400 {…,"code":"auth.invalidCurrency"}   (currency is checked first)

PUT /api/me/settings  {"distanceUnit":"Km"}
→ 200 {…,"distanceUnit":"Km",…}
```
