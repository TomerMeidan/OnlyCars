# Product decisions

Answers from the product owner to questions the spec leaves open. These are binding for planning and building.

| Date | Question | Decision |
|---|---|---|
| 2026-10-14 | Password policy | Minimum 8 characters. No complexity rules and no breached-password check. |
| 2026-10-14 | Can users fix bad odometer readings? | Yes. Users can edit and delete individual readings from the odometer history. The vehicle's current odometer and average km/day must be recomputed afterwards. |
| 2026-10-14 | Where to store photos and receipts | Cloudflare R2, accessed through the S3-compatible API (AWSSDK.S3), so the provider stays a config change. Credentials go in user-secrets or environment variables, never in the repo. |
| 2026-10-14 | Hosting | Web app on Cloudflare Pages, files on Cloudflare R2, API on Azure App Service (free tier), database on Azure SQL Database (free offer). Stay on SQL Server and EF Core SqlServer; no switch to Postgres. |
| 2026-10-14 | Default currency | Asked at sign-up. The register form includes a currency picker. |
| 2026-10-14 | Where odometer history lives | On a per-car page (`/cars/:id`) that will later also hold the car's tasks and service history. |
| 2026-10-14 | Odometer reading dates (delegated: owner asked the team to decide; review on return) | Reject readings dated in the future. A reading must fit date order: at least the reading before its date and at most the reading after it, unless the user confirms a correction. The vehicle's current odometer is the latest-dated reading. |
| 2026-10-14 | Initial odometer cap (delegated) | A car's starting odometer uses the same 0 to 10,000,000 km range and `odometer.invalidValue` code as readings. |
| 2026-10-14 | Keyboard focus and Escape (delegated) | Focus after Save goes to the saved row's Edit button. After Delete it goes to the next older row's Edit button, then the newest remaining row, then the section heading. After Cancel or Escape it returns to the opener. Escape closes inline forms. On route change, focus moves to the page's h1. |
| 2026-10-14 | Destructive actions and page titles (delegated) | A red `--danger` token is used only on confirm-Delete buttons. Page titles are `<page> · OnlyCars`. |
| 2026-10-14 | Auth hardening, SEC-1 (delegated) | A deploy gate. Limits: 10 auth requests per 15 minutes per IP; 10 failed logins per 15 minutes per email (accepting a possible 15-minute lockout of a victim); 300 requests per minute per IP globally. Over the limit returns 429 `auth.tooManyAttempts` with `Retry-After`. Counters are in memory, on a single instance. `ForwardedHeaders` is configured for Azure. Login takes constant time through a dummy-hash verify. Model-binding 400s hide .NET type names. |
| 2026-10-14 | Maintenance tasks, MVP2-A (delegated) | Tasks live on `/cars/:id` above the odometer history. Categories are an enum: Oil, Filters, Brakes, Tires, Fluids, Battery, Belts, Ignition, Other. `TaskTemplate` gets a stable `Key` (a deviation from spec Part 2) and its names are translated on the client. Templates are read-only; a user's copy is fully editable. The starter library has 12 generic templates, which the owner should review. Last done is required (no "never done"). Time intervals are entered as days, months (30 days) or years (365 days) and stored as days. Duplicate tasks are allowed. Delete is a hard delete. |
| 2026-10-14 | Due-soon threshold, MVP2-B (delegated) | Percent only, 1 to 50, default 10, using `DueSoonPercent`. No absolute "500 km" option. |
| 2026-10-14 | Ticket order (delegated) | MVP1-C, then MVP2-A, then SEC-1 (backend, built alongside MVP2-A's frontend), then MVP2-B (status), then MVP2-C (Reset and Undo). The settings screen (km/mi, currency, theme, locale) comes after step 2. |
