# API contract: ACC-2, delete my account

Published by backend-engineer. Needs the JWT. Errors are problem+json with `code`.

## `DELETE /api/me`

Body (`Content-Type: application/json`):

```
{ "password": "the current password" }
```

Rate limit per signed-in user (policy `account-delete`): 1 at a time and 5 tries per 10 minutes, counted whether the password was
right or not. Authentication runs before the limiter. Wrong passwords here also count toward the login lockout (the same per-user
counter as `POST /api/auth/login`, 10 failures per 15 minutes); once locked out, delete and login both answer 429 `auth.tooManyAttempts`
until the window ends, even with the right password.

**204** no body. The account and everything under it is gone: cars (archived too), readings, tasks, service records with items and
files, checklists and runs with photos, to-dos, documents, checklist templates, tire sets, reminder settings and snoozes. Task
templates are global and stay. Files and photos are deleted from storage after the database commit; if that fails, or storage is not
configured, the answer is still 204 (the server logs it for a later sweep). The client clears the token and cached user.

After a 204, every request with that user's token (on any device) is **401** (empty body, as for an expired token). The same email can
register again at once with `POST /api/auth/register`.

### Errors
| Status | code | When | Extensions |
|---|---|---|---|
| 400 | `auth.credentialsRequired` | `password` missing, null or empty | |
| 400 | `auth.invalidCredentials` | wrong password (400, not 401, so the client does not sign out) | |
| 400 | `http.400` (framework) | `Content-Type: application/json` with an empty or invalid body | |
| 415 | `http.415` (framework) | no body and no `Content-Type: application/json` (always send the JSON body) | |
| 401 | (empty body) | no token, invalid or expired token, or the token's user was deleted | |
| 429 | `http.429` | a 6th try in 10 minutes, or a second delete while one is running | `Retry-After` header (seconds) |
| 429 | `auth.tooManyAttempts` | the user is locked out by failed passwords (here or at login), as login answers | `Retry-After` header (seconds) |

### Example

```
DELETE /api/me
Authorization: Bearer <token>
Content-Type: application/json

{ "password": "wrong-password" }

400 {"title":"Validation failed","status":400,"detail":"The password is not correct.","code":"auth.invalidCredentials"}
```

```
DELETE /api/me   { "password": "the right one" }   ->  204
GET /api/me      (same token)                        ->  401
```

From the curl checks on the dev API (2026-10-18):

```
DELETE /api/me  {"password":""}             -> 400 {"title":"Validation failed","status":400,"detail":"Password is required.","code":"auth.credentialsRequired"}
DELETE /api/me  (6th try in 10 minutes)     -> 429 {"title":"Too many requests","status":429,"detail":"Too many requests. Try again later.","code":"http.429"}, Retry-After: 600
POST /api/auth/login (deleted account)      -> 401 auth.invalidCredentials (the normal wrong-login answer)
POST /api/auth/register (same email again)  -> 200
```
