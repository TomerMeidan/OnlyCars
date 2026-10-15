# API contract: SET-1, settings (language, theme, currency)

Published by backend-engineer, verified with curl against the live API. Extends `MVP2-A.md` to `MVP2-C.md`; everything there still holds unless changed below.

## `UserDto` (unchanged shape)

```
{ "id": guid, "email": string, "distanceUnit": "Km" | "Mi", "currency": "ILS" | "USD" | "EUR" | "GBP",
  "locale": "En" | "He", "theme": "System" | "Light" | "Dark" }
```

Enum values are **PascalCase**, exactly as above, in both responses and requests. Requests are case-sensitive: `"dark"`, `"he"` or `"usd"` are rejected.

## New endpoints

Both require `Authorization: Bearer <token>`. A missing or invalid token returns **401** (empty body), as every other endpoint.

### `GET /api/me`
**200** `UserDto` for the caller.

### `PUT /api/me/settings`
```
{ "locale"?: "En" | "He" | null, "theme"?: "System" | "Light" | "Dark" | null, "currency"?: "ILS" | "USD" | "EUR" | "GBP" | null }
```
A missing or null field is left unchanged; `{}` changes nothing. **200** the updated `UserDto`.

Every field is validated before anything is saved, so one invalid field saves nothing, even when the others are valid. Check order: locale, theme, currency. `distanceUnit` is not accepted here yet (SET-2); it is ignored if sent.

## Changed

### `POST /api/auth/register`
Body gains an optional `locale`: `{ "email", "password", "currency"?, "locale"?: "En" | "He" }`. Send the language the form is shown in. Missing or null saves `En`. Invalid returns 400 `settings.invalidLocale` and creates no user. Check order: `auth.invalidEmail`, `auth.passwordTooShort`, `auth.invalidCurrency`, `settings.invalidLocale`, `auth.emailTaken`.

Login already returns `user` with the saved `locale`, `theme` and `currency`.

## Error codes

| Code | Status | Extensions | When |
|---|---|---|---|
| `settings.invalidLocale` | 400 | none | `locale` is not `En` or `He` (settings and register) |
| `settings.invalidTheme` | 400 | none | `theme` is not `System`, `Light` or `Dark` |
| `auth.invalidCurrency` | 400 | none | `currency` is not one of the four codes. Same code as register; not new |
| `user.notFound` | 404 | none | Valid token for an account that no longer exists |
| `http.400` | 400 | `errors` | A field is not a string (e.g. `"locale": 1`) or the JSON is malformed: the existing generic model-binding error |

## Examples
```
GET /api/me                                  (no token)
→ 401

POST /api/auth/register  {"email":"set1-31434@example.com","password":"Passw0rd!","locale":"He"}
→ 200 {"token":"…","expiresAt":"…","user":{"id":"6df64794-…","email":"set1-31434@example.com","distanceUnit":"Km","currency":"ILS","locale":"He","theme":"System"}}

POST /api/auth/register  {…,"locale":"Fr"}
→ 400 {"title":"Validation failed","status":400,"detail":"Locale must be one of En, He.","code":"settings.invalidLocale"}

GET /api/me
→ 200 {"id":"6df64794-…","email":"set1-31434@example.com","distanceUnit":"Km","currency":"ILS","locale":"He","theme":"System"}

PUT /api/me/settings  {"theme":"Dark"}
→ 200 {"id":"6df64794-…","email":"set1-31434@example.com","distanceUnit":"Km","currency":"ILS","locale":"He","theme":"Dark"}

PUT /api/me/settings  {"locale":"En","theme":"Light","currency":"USD"}
→ 200 {"id":"6df64794-…","email":"set1-31434@example.com","distanceUnit":"Km","currency":"USD","locale":"En","theme":"Light"}

PUT /api/me/settings  {"locale":"He","theme":"dark"}
→ 400 {"title":"Validation failed","status":400,"detail":"Theme must be one of Light, Dark, System.","code":"settings.invalidTheme"}   (locale not saved)

PUT /api/me/settings  {"theme":"Dark","currency":"JPY"}
→ 400 {"title":"Validation failed","status":400,"detail":"Currency must be one of ILS, USD, EUR, GBP.","code":"auth.invalidCurrency"}   (theme not saved)
```
