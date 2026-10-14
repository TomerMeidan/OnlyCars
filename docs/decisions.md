# Product decisions

Answers from the product owner to questions the spec leaves open. These are binding for planning and building.

| Date | Question | Decision |
|---|---|---|
| 2026-10-14 | Password policy | Minimum 8 characters. No complexity rules and no breached-password check. |
| 2026-10-14 | Can users fix bad odometer readings? | Yes. Users can edit and delete individual readings from the odometer history. The vehicle's current odometer and average km/day must be recomputed afterwards. |
| 2026-10-14 | Where to store photos and receipts | In cloud object storage, not on the server's disk. Provider not yet chosen (Cloudflare R2 recommended; Supabase Storage is the alternative). Build against the S3-compatible API so the provider is a config change. |
| 2026-10-14 | Default currency | Asked at sign-up. The register form includes a currency picker. |
| 2026-10-14 | Where odometer history lives | On a per-car page (`/cars/:id`) that will later also hold the car's tasks and service history. |
