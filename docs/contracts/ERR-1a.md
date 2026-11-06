# ERR-1a contract: the API reports its 5xx to Sentry

For `frontend-engineer` (ERR-1b). No API response shape changes: every endpoint answers as before. The only new endpoint is a
Development-only test trigger.

## Configuration names

| Name | Where | What |
|---|---|---|
| `Sentry__Dsn` (`Sentry:Dsn`) | Render env var (`sync: false` in `render.yaml`); locally the API's user-secrets | The `onlycars-api` DSN. Empty or missing: Sentry is not registered at all, nothing is sent. |
| `VITE_SENTRY_DSN` | Render env var (`sync: false`), a build arg of the Dockerfile `client` stage; locally `client/.env.local` | The `onlycars-web` DSN, read by Vite at build time. Empty or missing: the client must not load Sentry. |
| `RENDER_GIT_COMMIT` | Set by Render; at runtime for the API, and a build arg of the `client` stage | The release on both sides. Missing (local): no release tag. |
| `ASPNETCORE_ENVIRONMENT` / Vite `mode` | Existing | Environment tag in lower case: `production` on Render, `development` locally. |

- **How Render passes them to the build:** a Docker service on Render gets its environment variables (the ones set in the dashboard,
  and Render's own such as `RENDER_GIT_COMMIT`) as Docker build args. A build arg is visible only to a stage that declares it, so the
  `client` stage declares `ARG VITE_SENTRY_DSN` and `ARG RENDER_GIT_COMMIT` right before `RUN npm run build`. Inside that `RUN` they are
  plain environment variables: Vite picks up `VITE_SENTRY_DSN` into `import.meta.env`, and `vite.config` can read
  `process.env.RENDER_GIT_COMMIT` (for example into `define`). Not checked on a real Render build yet; check the first deploy's bundle.
- `client/.env.local` is git-ignored (`client/.gitignore`: `*.local`; checked with `git check-ignore`). Never commit a DSN.

## CSP

`connect-src` in `src/OnlyCars.Api/Common/NoSniff.cs` now ends with exactly one Sentry host, `NoSniff.SentryIngest`:

```
connect-src 'self' https://accounts.google.com/gsi/ https://fonts.googleapis.com https://fonts.gstatic.com https://o4512371247677440.ingest.de.sentry.io
```

No wildcard and no other Sentry host (tested in `ClientAppTests`). The web DSN must use this ingest host (both projects do). No tunnel.

## What the API reports

- **Reported, once each:** an unhandled exception (500); `ServiceUnavailableException` (503, e.g. `file.storageUnavailable`); the
  Error-level logs: the daily digest (`DailyDigestTimer`, `DigestService`), the account delete's storage failure (`AccountService`), the
  start-up database update (`Program.cs`).
- **Not reported:** every expected 4xx: validation and model-binding 400, 401, 404 (incl. `LinkExpiredException`), 409 (incl. the
  concurrency conflict), 413 (incl. the body size limit), 429. Also not: unobserved background task exceptions, EF Core's own logs.
- Breadcrumbs: Warning-level logs and up only (no SQL). No tracing (`TracesSampleRate` 0), profiling or Sentry Logs.
- Tags: `environment` (`production` / `development`), `release` (the commit, or none).

## Privacy (the scrub, `ErrorReporting.Scrub`)

- `SendDefaultPii` false; request body never read (`MaxRequestBodySize` none); cookies, query string and server env removed.
- Request headers: only `User-Agent` is kept (so `Authorization`, `Cookie`, `X-Job-Key`, `Referer` never leave).
- Request URL: the query part is cut (`https://host/api/x`).
- User: only `{ "id": "<user id GUID from the token>" }`. Never email, name or IP. Use the same id on the web side.
- Exception messages, log messages, extras, tags and breadcrumbs: email addresses become `[scrubbed]`, and the query of any URL
  becomes `?[scrubbed]` (e.g. `https://x.r2.cloudflarestorage.com/k?[scrubbed]`).

## Dev trigger

`GET /api/dev/throw`, mapped only when the environment is Development (404 everywhere else, tested). No auth. It throws, so the
API answers the usual 500:

```
$ curl -i http://localhost:5161/api/dev/throw
HTTP/1.1 500 Internal Server Error
{"title":"Unexpected error","status":500,"detail":"An unexpected error occurred.","code":"http.500"}
```

With `Sentry:Dsn` in the API's user-secrets, that 500 becomes one `onlycars-api` event (environment `development`).
Issue: ONLYCARS-API-2 (https://onlycars-jf.sentry.io/issues/ONLYCARS-API-2).
