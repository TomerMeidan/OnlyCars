# OnlyCars: Requirements Status

**Audit date:** 2026-10-14 (first audit)
**Overall:** MVP step 1 (auth, cars, odometer) mostly works end to end in English and Hebrew, but has gaps. Steps 2 to 5 have not started.

| Status | Count |
|---|---|
| Done | 2 |
| API only | 0 |
| Partial | 9 |
| Missing | 39 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked:
- I read every file in `src/`, `tests/` and `client/src/`.
- `dotnet test`: 17 of 17 passed.
- `client/ui-tests/smoke.mjs` passed every step in both setups (desktop-light-en and mobile-dark-he). No horizontal overflow, no console errors. The only 4xx response was the expected 400 for a lower odometer reading.
- `client/ui-tests/register.mjs` passed all 6 cases.
- I sent direct API calls with `curl` to test server-side validation.
- Screenshots are in `client/ui-tests/out/`.

---

## 1. Vehicles

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Add, edit and archive cars (archive on sale, keeping history) | **Done** | API: `VehiclesController.cs:28-54`, `VehicleService.cs:30-111`. UI: `CarFormPage.tsx`, `CarsPage.tsx:19-22,55-60`. Tests: `VehicleServiceTests.cs:12,65,84`. Browser: smoke steps `add-car`, `edit-car` and `archive-car` pass in both setups (`out/mobile-dark-he-08-archive-car.png`). | Nothing for the MVP. Unarchive works too. |
| Fields: nickname, make, model, year, VIN, plate, fuel type, purchase date, photo | **Partial** | All fields except photo are on the form (`CarFormPage.tsx:57-72`) and saved (`VehicleService.cs:41-55`). The form also has a purchase price field. | **Photo:** there is no upload. `PhotoUrl` is passed through unchanged (`CarFormPage.tsx:34`), there is no file endpoint, and the car card does not show a photo. Also, VIN uniqueness has no test for the edit path. |
| Current odometer, with a history of readings | **Partial** | The current odometer appears on the car card as a drum counter (`CarsPage.tsx:47-53`). Readings are stored (`OdometerService.cs:42-50`), and the history endpoint `GET /api/vehicles/{id}/odometer` exists (`OdometerController.cs:14`). | **History is API only.** No screen lists past readings. |
| Multiple cars per account | **Done** | The list endpoint and UI loop over all of the user's cars (`VehicleService.cs:12-22`, `CarsPage.tsx:45-62`). Tests: `VehicleServiceTests.cs:84`. | The browser tests add only one car per user, so a list of several cars has not been checked in a browser. |

## 2. Mileage / Odometer

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Manual odometer updates (quick-entry button on the dashboard) | **Partial** | The quick entry on each car card works, including the lower-reading check and the correction checkbox (`CarsPage.tsx:68-114`, `OdometerService.cs:30-65`). Tests: `OdometerServiceTests.cs:20-78`. Smoke steps `odometer-*` pass. | (1) There is no dashboard yet (see section 10). (2) In Hebrew, the lower-reading error is the raw English API message, and it tells the user to "Resubmit with confirmCorrection=true" (`out/mobile-dark-he-05-odometer-lower-rejected.png`, `OdometerService.cs:36-38`). (3) You cannot pick a reading date in the UI, although the API accepts one. |
| Auto-log the odometer whenever a service is recorded | **Missing** | Only the `OdometerSource.Service` enum value exists (`Enums.cs:35`). | Depends on service records (MVP step 3). |
| Optional: estimated average km/day, used to predict when tasks come due | **Partial** | `AvgKmPerDay` is computed (`OdometerService.cs:72-99`, test at `OdometerServiceTests.cs:91`) and shown on the card (`CarsPage.tsx:50-52`). | Nothing uses it for predictions yet, because tasks don't exist. |
| Unit setting (km/miles), with the currency set per user | **Missing** | Only the `User.DistanceUnit` and `User.Currency` columns exist (`User.cs:9-10`). | There is no endpoint or screen to change them. The UI always shows "km" (`CarsPage.tsx:49`, `i18n.ts:34-40`) and never converts to miles. |

## 3. Maintenance Task Definitions

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Task name and category | **Missing** | none | `MaintenanceTask` entity, API and UI |
| Interval by km, by time, or both (whichever comes first) | **Missing** | none | Everything |
| Starter template library, fully editable | **Missing** | none | `TaskTemplate` seed data and UI |
| Per-car custom tasks | **Missing** | none | Everything |
| Enable/disable a task without deleting it | **Missing** | none | Everything |

## 4. The "Roborock" Reset Behavior

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Remaining km/days, progress bar, status (OK, Due soon, Overdue) | **Missing** | none | Everything |
| Reset / Mark as done (records odometer and date, restarts the countdown, creates a history entry with optional cost and notes) | **Missing** | none | Everything |
| Undo for accidental resets | **Missing** | none | Everything |
| Configurable "due soon" threshold | **Missing** | none | Everything |

## 5. Service Records

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Date, odometer, shop (or DIY), total cost, notes | **Missing** | none | Everything |
| Line items: part name, brand, part number, quantity, unit cost, labor | **Missing** | none | Everything |
| Attachments: receipt photos, PDFs, invoices | **Missing** | none | Everything |
| Filter and search by car, task, date or shop | **Missing** | none | Everything |
| Edit and delete past records | **Missing** | none | Everything |

## 6. Tires

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Tire sets: brand, model, size, season, purchase year, DOT code | **Missing** | none | Everything (MVP step 5) |
| Which set is mounted on which car, with mount and unmount dates | **Missing** | none | Everything |
| Km driven per set (auto-calculated) | **Missing** | none | Everything |
| Tire pressure log, tread depth log, rotation tracking | **Missing** | none | Everything |
| Storage notes for the off-season set | **Missing** | none | Everything |

## 7. Custom Inspection Checklists

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Checklist templates | **Missing** | none | Everything (MVP step 5) |
| Items: checkbox, numeric or text | **Missing** | none | Everything |
| Per-checklist schedule: by km, by time, or manual only | **Missing** | none | Everything |
| Run a checklist: tick items, add notes or photos, flag issues | **Missing** | none | Everything |
| Failed items can create a to-do or a maintenance task | **Missing** | none | Everything |
| Run history per car | **Missing** | none | Everything |

## 8. Costs and Reports

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Cost per car, per category, per month and per year | **Missing** | none | Everything (MVP step 5) |
| Cost per km and total cost of ownership | **Missing** | none | Everything. `PurchasePrice` is already stored, which helps with TCO later. |
| Charts: spending over time, cost by category | **Missing** | none | Everything |
| Export to CSV and PDF | **Missing** | none | Everything |

## 9. Reminders and Notifications

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Email (plus optional push/PWA) when a task is due soon or overdue | **Missing** | none | Everything (MVP step 5) |
| Non-mileage reminders: insurance, inspection, registration, license | **Missing** | none | `VehicleDocument`, everything |
| Snooze, plus a configurable lead time | **Missing** | none | Everything |

## 10. Dashboard

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| All cars at a glance, next due items sorted by urgency | **Missing** | The car list (`CarsPage.tsx`) shows every car, but there are no due items. | Everything except the car list (MVP step 4) |
| Overdue count and monthly spend summary | **Missing** | none | Everything |
| Quick actions: update odometer, reset a task, start a checklist | **Missing** | Odometer quick entry exists on the car list (see 2.1). | A dashboard, plus the reset and checklist actions |

## 11. Optional

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Fuel log and consumption tracking | **Deferred** | none | Optional |
| Issue / to-do list | **Deferred** | none | Optional. Note that section 7 needs `Issue` for flagged checklist items. |
| Shared access (partner or family) | **Deferred** | none | Optional |
| Garage directory | **Deferred** | none | Optional |
| Parts and warranty tracking | **Deferred** | none | Optional |
| Full data import/export | **Deferred** | none | Optional. Basic data export is still required by section 12. |
| OBD-II / manufacturer API odometer | **Deferred** | none | Future |

## 12. Non-Functional

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Email/password auth, optional Google login | **Partial** | Register and login work in the UI (`AuthPage.tsx`, `AuthService.cs`). Tests: `AuthServiceTests.cs`. `register.mjs` passes all 6 cases. | **The server does not validate input.** `POST /api/auth/register` accepted `{"email":"","password":""}` and `{"email":"x","password":"1"}` with 200 and issued a token, verified with curl. The 8-character minimum exists only in the browser (`AuthPage.tsx:39`). The auth error messages are English only. Google login is optional and not started. |
| Mobile-first responsive UI, installable PWA | **Partial** | At 390px wide there is no horizontal overflow in any smoke step (`out/mobile-dark-he-*.png`). The PWA manifest and service worker are configured (`vite.config.ts:8-18`). | I did not verify that the app can be installed. The only icon is an SVG with `sizes: any`, with no 192 or 512 PNG. |
| Light and dark mode | **Partial** | The app follows the system theme (`index.css:16,22`) and is checked in dark mode by the smoke test. | There is no in-app toggle. `User.Theme` is never read or written. |
| Per-user data isolation, data export and delete-account | **Partial** | Isolation: every vehicle and odometer call checks ownership and returns 404 for other users' data (`VehicleService.cs:113-128`). Tests: `VehicleServiceTests.cs:52`, `OdometerServiceTests.cs:78`. | No data export and no delete-account. |
| Hebrew and English UI, including RTL | **Partial** | Every UI string exists in `en` and `he` (`i18n.ts:5-85`). `dir` is set to rtl or ltr (`i18n.ts:98-103`). The smoke step `switch-language` passes. | API error messages are English and shown as-is in the Hebrew UI (`out/mobile-dark-he-05-odometer-lower-rejected.png`). The language choice is saved only in localStorage, not in `User.Locale`. |
| Receipt image storage with size limits | **Missing** | none | Everything. Car photo upload needs the same storage. |
| Offline-tolerant odometer entry (sync later) | **Missing** | The service worker caches only the app shell. | Quick entry posts directly and fails when offline. There is no queue. |

### Data model checks (Part 2, MVP step 1 tables only)
- Done: `User`, `Vehicle` and `OdometerReading` have all spec fields, plus Id, CreatedAt and UpdatedAt.
- Done: money is stored as decimal(12,2) (`VehicleConfiguration.cs:16-18`).
- Done: the unique index on Vehicle(UserId, Vin) where Vin is not null (`VehicleConfiguration.cs:26-28`).
- Done: the index on OdometerReading(VehicleId, ReadingDate DESC) (`OdometerReadingConfiguration.cs:19-20`).
- Done: lower readings are rejected unless the user confirms (`OdometerService.cs:34-39`).
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Mostly done, gaps remain.** Working end to end in EN and HE: register, login, add, edit, archive and unarchive cars, quick odometer entry, and confirming a correction. Gaps: no server-side auth validation, API errors not localized, no odometer history screen, no car photo, no km/mi or currency setting. |
| 2. Tasks, templates, km/time intervals, Reset | Not started |
| 3. Service history with costs | Not started |
| 4. Dashboard with due/overdue status | Not started |
| 5. Checklists, tires, reports, notifications | Not started |

## Current ticket

**MVP1-A: Close the auth and odometer gaps.** The full ticket is in the latest PM report. In short:
1. Validate the register and login input on the server.
2. Localize the known API errors in Hebrew and English.
3. Add an odometer history screen for each car.

## Changed since last audit
- This is the first audit, so there is nothing to compare.
