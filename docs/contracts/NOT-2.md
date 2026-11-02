# API contract: NOT-2, daily reminder email

Published by backend-engineer. Errors are problem+json with `code`.

## The setting: `emailReminders` (for the Settings toggle)

`UserDto` (returned by `GET /api/me`, `PUT /api/me/settings`, login, register and Google sign-in) has a new field:
```
{ ..., "reminderLeadDays": 30, "hasPassword": true, "emailReminders": true }
```
`emailReminders` is `true` by default (no row stored yet), `false` once the user turns the daily email off.

`PUT /api/me/settings` body takes an optional `"emailReminders": true | false`; left out or `null` keeps the current value, like the other fields.
A non-boolean value is the framework's 400 `http.400` (errors under `emailReminders`). 200 returns the `UserDto`.

Example (from the curl check):
```
PUT /api/me/settings   {"emailReminders":false}
200 {"id":"…","email":"…","distanceUnit":"Km","currency":"ILS","locale":"En","theme":"System","reminderLeadDays":30,"hasPassword":true,"emailReminders":false}
```

Suggested UI (frontend's choice): a checkbox "Email me a daily reminder" / "לשלוח לי תזכורת יומית במייל" in Settings near the lead-days field. The
email's footer links to `<Email:SiteUrl>/settings` to turn it off.

## What the email holds

Once a day per user, only when something needs attention: the same items as `GET /api/reminders` for Israel's today (Due soon or Overdue tasks
and checklists, Expiring or Expired documents, minus snoozed ones) plus the open to-dos, grouped by car. In the user's language (Hebrew is
right to left) and distance unit. Never twice on one Israel-time day; a failed send is retried on the next run.

## Job endpoint (for the external cron, not for the web app)

### `POST /api/jobs/daily-digest`
- No JWT. Header `X-Job-Key: <Email:JobKey>`. No body.
- 204: ran (sends what is due and not sent today; with no Resend key it sends nothing). Returns no user data.
- 401 `job.invalidKey`: header missing or wrong (compared in constant time).
- 404 `http.404`: `Email:JobKey` is not set on the server (the endpoint is off).
- 429 `auth.tooManyAttempts`: the per-IP auth rate limit (`RateLimiting:AuthPermitLimit` per `AuthWindowSeconds`), shared with login.

Example (curl check):
```
POST /api/jobs/daily-digest  (no header)      -> 401 {"title":"Unauthorized","status":401,"detail":"Missing or wrong job key.","code":"job.invalidKey"}
POST /api/jobs/daily-digest  X-Job-Key: right -> 204
```

## Configuration (server)

| Key | Meaning |
| --- | --- |
| `Email:ResendApiKey` | Resend API key. Unset: nothing is sent and the daily timer is off; the app runs normally. Secret. |
| `Email:SmtpUser`, `Email:SmtpPassword` | Used when there is no Resend key (owner's choice, 2026-11-02): an SMTP login, by default a Gmail address and its app password. Both set: email goes through SMTP. Secret (the password). |
| `Email:SmtpHost`, `Email:SmtpPort` | Default `smtp.gmail.com` and `587` (STARTTLS). |
| `Email:From` | Sender, e.g. `OnlyCars <reminders@your-domain>`; required with a Resend key (start-up fails otherwise); with SMTP it defaults to `OnlyCars <SmtpUser>`. |
| `Email:SiteUrl` | Link in the email, e.g. `https://onlycars-ev28.onrender.com`. Unset: no links. |
| `Email:JobKey` | Shared secret for the job endpoint. Unset: the endpoint is a 404. Secret. |
| `Email:DigestHourLocal` | Hour (0 to 23, Israel time) of the in-app timer; default 8. |

On Render use double underscores: `Email__ResendApiKey` and so on.
