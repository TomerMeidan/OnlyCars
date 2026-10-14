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
