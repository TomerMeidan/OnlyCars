# OnlyCars: Requirements Status

**Audit date:** 2026-10-15 (eighth audit, sign-off of SET-2: backend commit `d3abd15`, plus the frontend and all review and QA fixes, which are not committed yet on `main`)
**Overall:** MVP steps 1 and 2 are complete. With SET-2 every distance on screen follows the user's km or miles setting, so the settings work is finished. Step 1 still lacks only the car photo (blocked on R2). Next is step 3, service history (MVP3-A).

| Status | Count |
|---|---|
| Done | 16 |
| API only | 0 |
| Partial | 6 |
| Missing | 28 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (eighth audit):
- Both dev servers were already running (API PID 11708 on 5150, Vite PID 13124 on 5173), and I left them running. Nothing in `src/` is uncommitted, so the live API runs `d3abd15`.
- Live API with curl: `PUT /api/me/settings` with `{"distanceUnit":"Yards","theme":"Dark"}` returned 400 `settings.invalidDistanceUnit` and left the theme at System; `{"distanceUnit":"Mi"}` returned 200 with `distanceUnit` `Mi`.
- `node --test ui-tests/units.test.mjs`: 6 of 6. `tsc -b`: clean.
- `client/ui-tests/smoke.mjs`: exit code 0, 96 steps `ok` (48 per setup), including `settings-unit-miles` and `settings-unit-errors`.
- `client/ui-tests/qa-set2.mjs`: exit code 0. Its 5xx are the three mocked `PUT /me/settings` 500s; its 400s are deliberate bad inputs. It checks stored km through the API (a 5,000 mi interval stored as 8,047 km; the neighbouring readings 79,401 km kept exact).
- Screenshots I read (all from this run; the `qaset2-*-FAIL-*` files are from an earlier run at 09:00 and are stale):
  - `mobile-dark-he-unit-miles-car.png`: Hebrew RTL at 390px, "050100 מייל" on the drum, "באיחור של 361 מייל", "כל 5,000 מייל", history in מייל, no overflow.
  - `qaset2-mobile-dark-he-02-settings-mi.png`: the fourth group "יחידת מרחק" with קילומטרים / מיילים, saved.
  - `qaset2-mobile-dark-he-11-mocked-errors.png`: the reading cap "6,213,711 מייל" and the interval cap "621,371 מייל" shown in Hebrew.
  - `qaset2-mobile-dark-he-13-big-car-390-mi.png`: a 7-digit mile value fits the drum at 390px.
- Reviews and QA, which I did not re-run: code review approved (with the km-keeping fix in `toKm`, `client/src/units.ts:21-26`); the Hebrew review improved `lastDoneKm` and `errors.task.invalidLastDone`; UI QA passed, and its Medium (retyping a neighbour's shown value drifted 1 km) and its focus Low are fixed and re-verified.
- The notes from earlier audits are in git history.

---

## 1. Vehicles

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Add, edit and archive cars (archive on sale, keeping history) | **Done** | API: `VehiclesController.cs:28-54`, `VehicleService.cs:30-111`. UI: `CarFormPage.tsx`, `CarsPage.tsx:19-22,55-60`. Tests: `VehicleServiceTests.cs:12,65,84`. Browser: smoke steps `add-car`, `edit-car` and `archive-car` pass in both setups (`out/mobile-dark-he-08-archive-car.png`). | Nothing for the MVP. Unarchive works too. |
| Fields: nickname, make, model, year, VIN, plate, fuel type, purchase date, photo | **Partial** | All fields except photo are on the form (`CarFormPage.tsx:57-72`) and saved (`VehicleService.cs:41-55`). The form also has a purchase price field. | **Photo:** there is no upload. `PhotoUrl` is passed through unchanged (`CarFormPage.tsx:34`), there is no file endpoint, and the car card does not show a photo. Also, VIN uniqueness has no test for the edit path. |
| Current odometer, with a history of readings | **Done** | The car name links to a car page (`CarsPage.tsx:41`, route in `App.tsx`). `/cars/:id` shows the drum counter and the history, newest first, with value, source and date (`CarPage.tsx:45-63`). It has loading, empty, error and not-found states. API: `OdometerController.cs:14-35` (GET, POST, PUT, DELETE), `OdometerService.cs:20-87` with one shared `Recompute` (`OdometerService.cs:167`). Manual readings can be edited and deleted inline (`CarPage.tsx:145-178`); non-GUID ids show "not found" without an API call (`CarPage.tsx:16`). Tests: `OdometerServiceTests.cs` (50 tests). Browser: smoke steps `odometer-history`, `edit-reading`, `delete-reading` in both setups; QA criteria 8, 9, 11, 17-20. | Nothing for the MVP. MVP1-C added focus handling after Save and Delete, and 44px buttons. |
| Multiple cars per account | **Done** | The list endpoint and UI loop over all of the user's cars (`VehicleService.cs:12-22`, `CarsPage.tsx:45-62`). Tests: `VehicleServiceTests.cs:84`. | The browser tests add only one car per user, so a list of several cars has not been checked in a browser. |

## 2. Mileage / Odometer

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Manual odometer updates (quick-entry button on the dashboard) | **Partial** | The quick entry on each car card works, including the lower-reading check and the correction checkbox (`CarsPage.tsx:69-114`, `OdometerService.cs:30-65`). Tests: `OdometerServiceTests.cs`. Smoke steps `odometer-*` pass. The lower-reading error is now translated and shows the current reading (`odometer.lowerThanCurrent`, `i18n.ts:64-67`; Hebrew in `mobile-dark-he-05-odometer-lower-rejected.png`). | Quick entry is now also on the car page (`CarPage.tsx:50`), and the date-order rules apply (`odometer.lowerThanPrevious` / `higherThanNext`). Still missing: (1) there is no dashboard yet (see section 10); (2) quick entry always saves today; backdating goes through Edit, which is acceptable for now. |
| Auto-log the odometer whenever a service is recorded | **Partial** | Every reset logs a `Source = Service` reading linked to its record (`OdometerReading.ServiceRecordId`, `MaintenanceTaskService.cs:99`). Undo removes it (`:171`). Tests: `ServiceRecordTests.cs` (13 tests). Browser: smoke `reset-task` and `undo-reset` (`mobile-dark-he-30-reset-task.png`, which shows the "Service" reading in the history). | Covers only the one-tap reset. A full service record with its own date and odometer comes in step 3. |
| Optional: estimated average km/day, used to predict when tasks come due | **Partial** | `AvgKmPerDay` is computed (`OdometerService.cs:72-99`, test at `OdometerServiceTests.cs:91`) and shown on the card (`CarsPage.tsx:50-52`). | Nothing uses it for predictions yet. Tasks exist now, but a predicted due date is out of MVP2-B (decisions.md); it goes with the dashboard or later. |
| Unit setting (km/miles), with the currency set per user | **Done** | Currency: chosen at sign-up (`AuthPage.tsx`, `AuthService.cs`) and changeable on `/settings` (SET-1). Distance unit (SET-2): `PUT /api/me/settings` takes `distanceUnit` (`Km`/`Mi`), 400 `settings.invalidDistanceUnit` (`SettingsTests.cs`, contract `docs/contracts/SET-2.md`, verified live with curl). The client converts in one module, `client/src/units.ts` (1 mi = 1.609344 km, whole miles on display, whole km on input, caps rounded down, unchanged values send their stored km back), tested by `client/ui-tests/units.test.mjs` (6 tests). The car list, car form, car page, history, tasks, templates and error messages all use it. Settings has a fourth radio group. Browser: smoke `settings-unit-miles` and `settings-unit-errors` in both setups, `qa-set2.mjs` (`mobile-dark-he-unit-miles-car.png`, `qaset2-mobile-dark-he-02-settings-mi.png`). | Nothing. Remaining miles can be 1 off the shown numbers, and the Hebrew "קילומטראז׳" label stays in miles; both accepted (decisions.md, "SET-2 QA notes"). |

## 3. Maintenance Task Definitions

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Task name and category | **Done** | Entity `MaintenanceTask.cs` with the `TaskCategory` enum (9 values, decisions.md); migration `20261014191520_AddMaintenanceTasks.cs`. API: `MaintenanceTasksController.cs:14-30`, validation in `MaintenanceTaskService.cs:98-140` (`task.nameRequired`, `task.invalidCategory`). UI: the task form in `TasksSection.tsx:154-230`, with category names translated in `i18n.ts` (`categories`, en and he). Tests: `MaintenanceTaskServiceTests.cs` (16 tests). Browser: smoke steps `add-task-custom` and `edit-task` in both setups (`mobile-dark-he-20-edit-task.png`). | Nothing. |
| Interval by km, by time, or both (whichever comes first) | **Done** | `IntervalKm` and `IntervalDays` are nullable, with a database check that at least one is set (`MaintenanceTaskConfiguration.cs:27`, tested in `MaintenanceSchemaTests.cs:36`). The form takes km, and time as days, months or years (`TasksSection.tsx:9`). Rows show "Every 10,000 km or 1 year" (`TasksSection.tsx:17`). Smoke steps `add-task-template` and `edit-task`. | Nothing. Since MVP2-B the worse of the two intervals decides the status (`TaskStatusCalculator.cs:13`). |
| Starter template library, fully editable | **Done** | 12 templates seeded with stable keys (`TaskTemplateConfiguration.cs:37`), `GET /api/task-templates`, a picker with translated names (`TasksSection.tsx:104-125`). Picking one prefills a form that the user can change completely; the user's copy is fully editable, and the global library is read-only (decisions.md, MVP2-A). Smoke steps `tasks-empty-and-picker`, `task-form-prefill` and `add-task-template`. | The owner should review the 12 default intervals. |
| Per-car custom tasks | **Done** | "Custom task" in the picker saves with `templateId` null. Tasks belong to one car (`/api/vehicles/{id}/tasks`), and another user's car returns 404 (service tests). Smoke step `add-task-custom`. | Nothing. |
| Enable/disable a task without deleting it | **Done** | The Enabled checkbox saves immediately through PUT (`TasksSection.tsx:300-305`). Disabled tasks keep a "Disabled" label and sort after enabled ones (`TasksSection.tsx:60,280`). Smoke steps `disable-task` and `toggle-task-fails` (`desktop-light-en-21-disable-task.png`). Archived cars are read-only (`archived-tasks-read-only`). | Nothing. The stale-error Low (c) was fixed in MVP2-B: any new action on a row clears its old error (`TasksSection.tsx:308-316`). |

## 4. The "Roborock" Reset Behavior

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Remaining km/days, progress bar, status (OK, Due soon, Overdue) | **Done** | API: one pure function, `TaskStatusCalculator.Compute(task, currentOdometerKm, today)` (`src/OnlyCars.Application/Maintenance/TaskStatusCalculator.cs:13`), used for every task DTO (`MaintenanceTaskService.cs:156-158`); contract `docs/contracts/MVP2-B.md`. Tests: `TaskStatusCalculatorTests.cs` (10 tests with a fixed date, covering the boundaries) and `MaintenanceTaskServiceTests.cs`. UI: a text badge (`TasksSection.tsx:332`), `role="progressbar"` (`:340`), the remaining and overdue line (`Remaining`, `:31`), the urgency sort with a numeric name compare (`:16,89`), status colour tokens for light and dark (`index.css:14-16,40-42,212-214`), strings in en and he (`i18n.ts:94-98,258-262`). Browser: smoke steps `task-status-order`, `task-status-after-odometer` and `task-due-soon-percent` in both setups (`mobile-dark-he-27-task-status-order.png`). UI QA passed. | Nothing for this bullet. MVP2-B's two Lows are fixed in MVP2-C: a failed reload keeps the rows (smoke `tasks-reload-error-keeps-rows`), and the unit words are joined with non-breaking spaces. A predicted due date from km/day is a later ticket. |
| Reset / Mark as done (records odometer and date, restarts the countdown, creates a history entry with optional cost and notes) | **Done** | API: `POST .../tasks/{taskId}/reset` (`MaintenanceTasksController.cs:38-41`, `MaintenanceTaskService.cs:99`). It creates `ServiceRecord` (DIY, nullable cost) and `ServiceRecordTask` with an undo snapshot, sets `LastDone*` and logs a Service reading, all in one save. Schema: `ServiceRecordConfiguration.cs`, migration `20261015041218_AddServiceRecords.cs`. Contract: `docs/contracts/MVP2-C.md`. Tests: `ServiceRecordTests.cs` (13) and `MaintenanceSchemaTests.cs` (deleting a task keeps the record). UI: "Mark done" and "Add cost or notes" on enabled tasks of active cars; it sends the local date (`TasksSection.tsx:99-104`) and reloads the car and history (`CarPage.tsx:76`). Strings in en and he (`i18n.ts:101-108,282-289`). Browser: smoke `reset-task` and `reset-with-cost` in both setups, plus the QA script. | Nothing for the MVP. Backdated services and one record for several tasks come with step 3, per the ticket. |
| Undo for accidental resets | **Done** | API: `POST .../service-records/{recordId}/void` (`MaintenanceTasksController.cs:43-45`, `MaintenanceTaskService.cs:171`). Only the latest reset by creation time can be undone (`:184-188`); otherwise it returns 409 `serviceRecord.notLatest`. Tests: `ServiceRecordTests.cs`, including `Void_LatestIsByCreationOrder_EvenWhenTheLaterResetHasAnEarlierDate`. UI: a `role="status"` Undo bar with `aria-describedby` (`TasksSection.tsx:408-412`). It has no timer and closes on the next action in the section (`:143-145`). Browser: smoke `undo-reset` and `toggle-clears-undo` in both setups (`mobile-dark-he-31-undo-reset.png`). | Undo after leaving the page comes with step 3's service history, which uses the same endpoint. |
| Configurable "due soon" threshold | **Done** | `dueSoonPercent` on POST and PUT, 1 to 50, default 10, kept when PUT omits it, error `task.invalidDueSoonPercent` (`MaintenanceTaskService.cs:53,77,127-130`). Tests in `MaintenanceTaskServiceTests.cs`, including a toggle with the old body shape keeping 25. UI: the "Due soon when this much is left" field with client validation (`TasksSection.tsx:207,227,261-263`), sent from `bodyOf` (`:13-14`). Browser: smoke `task-due-soon-percent` (`desktop-light-en-29-task-due-soon-percent.png`). | Nothing. Percent only, as decisions.md says; no absolute "500 km" option. |

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
| Email/password auth, optional Google login | **Done** | Register and login work in the UI (`AuthPage.tsx`). The server now rejects a malformed email (`auth.invalidEmail`, `AuthService.cs:22-27`), a password under 8 characters (`auth.passwordTooShort`, `AuthService.cs:29-33`) and an empty login (`auth.credentialsRequired`, `AuthService.cs:52-55`), as decisions.md requires. Tests: `AuthServiceTests.cs:41-79`. Verified with curl and smoke step `api-register-short-password`. Auth errors are translated (`i18n.ts:53-59,117-123`). | Google login is optional and not started. |
| Mobile-first responsive UI, installable PWA | **Partial** | At 390px wide there is no horizontal overflow in any smoke step (`out/mobile-dark-he-*.png`). The PWA manifest and service worker are configured (`vite.config.ts:8-18`). | I did not verify that the app can be installed. The only icon is an SVG with `sizes: any`, with no 192 or 512 PNG. |
| Light and dark mode | **Done** | SET-1: System, Light or Dark on `/settings`, saved to `User.Theme` through `PUT /api/me/settings` (`SettingsTests.cs`). A `data-theme` attribute overrides the OS setting (`client/src/index.css`), and it is applied before first paint from the cached user (`client/index.html:11`). Smoke `settings-theme` passes in both setups; QA forced Dark with the OS light and Light with the OS dark (`qaset1-mobile-dark-he-07-*.png`) and saw no flash on a throttled production build. | Nothing. |
| Per-user data isolation, data export and delete-account | **Partial** | Isolation: every vehicle, odometer and task call checks ownership and returns 404 for other users' data (`VehicleService.cs:113-128`). Tests: `VehicleServiceTests.cs:52`, `OdometerServiceTests.cs:78`. | No data export and no delete-account. |
| Hebrew and English UI, including RTL | **Done** | Every UI string exists in `en` and `he`, and `he: typeof en` makes the compiler enforce it (`i18n.ts`). `dir` is set to rtl or ltr. Every API error now has a stable `code` (`AppException.cs`, `GlobalExceptionHandler.cs`, fallback `http.<status>` in `Program.cs`). The client translates the code, or shows a translated generic message for unknown codes (`i18n.ts:154-157`). Tests: `GlobalExceptionHandlerTests.cs`. Browser: the Hebrew error screenshots `mobile-dark-he-05-*` and `-08-*`. | Nothing. SET-1 saves the language to `User.Locale` from Settings and the header switch, applies it at login, and register saves the form's language (smoke `settings-language`; `qaset1-mobile-dark-he-17-after-login.png`). |
| Receipt image storage with size limits | **Missing** | none | Everything. Car photo upload needs the same storage. |
| Offline-tolerant odometer entry (sync later) | **Missing** | The service worker caches only the app shell. | Quick entry posts directly and fails when offline. There is no queue. |

### Data model checks (Part 2, tables for MVP steps 1 and 2 so far)
- Done: `User`, `Vehicle` and `OdometerReading` have all spec fields, plus Id, CreatedAt and UpdatedAt.
- Done: money is stored as decimal(12,2) (`VehicleConfiguration.cs:16-18`).
- Done: the unique index on Vehicle(UserId, Vin) where Vin is not null (`VehicleConfiguration.cs:26-28`).
- Done: the index on OdometerReading(VehicleId, ReadingDate DESC) (`OdometerReadingConfiguration.cs:19-20`).
- Done: readings must fit date order (lower than the previous or higher than the next is rejected) unless the user confirms. Future dates and values outside 0 to 10,000,000 km are rejected (`OdometerService.cs:113-160`). The 10,000,000 cap is `OdometerReading.MaxValueKm` (`OdometerReading.cs:10`), shared by readings (`OdometerService.cs:119`) and the starting odometer (`VehicleService.cs:32`).
- Fixed (MVP1-C): a car's starting odometer uses the same 0 to 10,000,000 range and returns `odometer.invalidValue` (`VehicleService.cs:32-34`).
- Done: `TaskTemplate` (plus a `Key`, a deviation recorded in decisions.md) and `MaintenanceTask` have all spec fields. The index on MaintenanceTask(VehicleId, IsEnabled) is at `MaintenanceTaskConfiguration.cs:25`. The interval check constraint is on both tables (`MaintenanceTaskConfiguration.cs:27`, `TaskTemplateConfiguration.cs:18`). Vehicle to task cascades on delete (`MaintenanceTaskConfiguration.cs:17`), and template to task is restricted (`:23`).
- MVP2-B added no schema; `DueSoonPercent` is now read and written through the API, and status is computed on read, never stored, as Part 2 requires.
- Done (MVP2-C): `ServiceRecord` and `ServiceRecordTask`, with the index on ServiceRecord(VehicleId, Date DESC). There are three recorded deviations: `ServiceRecordTask.PreviousLastDone*` (the Undo snapshot), `OdometerReading.ServiceRecordId`, and a nullable `TotalCost`. Deleting a task keeps its records and their readings (`MaintenanceSchemaTests.cs`, on SQL Server).
- Not started: `ServiceItem`, `Attachment` (step 3) and the rest of Part 2.
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Complete for the MVP. MVP1-A, MVP1-B, MVP1-C, SET-1 and SET-2 are signed off.** Working end to end in EN and HE: register (with currency) and login; add, edit, archive and unarchive cars; quick odometer entry; edit and delete readings with the date-order rules and recompute; focus and page titles on every route; Settings with language, theme, currency and km or miles. Remaining: the car photo (blocked until the R2 credentials exist). |
| 2. Tasks, templates, km/time intervals, Reset | **Complete. MVP2-A, MVP2-B and MVP2-C are signed off.** All of spec sections 3 and 4 is done: tasks and templates, status with remaining km and days and a progress bar, the due-soon threshold, one-tap Mark done with optional cost and notes, and Undo. |
| Deploy gate | **SEC-1 signed off.** Nothing else blocks a first deploy except the owner's Azure account. |
| 3. Service history with costs | **Next: MVP3-A** (history list, record a past service, undo from the history), then MVP3-B (line items, edit) and MVP3-C (filter and search). Attachments wait for R2. MVP2-C already created `ServiceRecord`, `ServiceRecordTask` and the void endpoint. |
| 4. Dashboard with due/overdue status | Not started. The per-task status and the reset endpoint it needs both exist. |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP3-A: Service history list, record a past service, undo from the history (spec 5.1, 2.2) | BE, then FE | **Next** (written below) |
| 2 | MVP3-B: Line items and editing records (spec 5.2, 5.5) | BE, then FE | Not written |
| 3 | MVP3-C: Filter and search (spec 5.4) | BE, then FE | Not written |

## Signed-off tickets

- **MVP1-A (commit `994a0c1`): signed off 2026-10-14.** Server-side auth validation, translated API errors, odometer history page.
- **MVP1-B (commit `c444fa6`): signed off 2026-10-14.** Edit and delete odometer readings with date-order rules and recompute; currency at sign-up. All 30 criteria met.
- **MVP1-C (commit `fde38dd`): signed off 2026-10-14.** Focus moves to the page `h1` and `document.title` is set on every route (`client/src/usePage.ts:9-11`). Focus after Save, Delete, Cancel and Escape follows decisions.md. History buttons are at least 44px tall, and the red `--danger` token is used on confirm Delete (`index.css:9,32,193`). The starting odometer is capped through the shared `OdometerReading.MaxValueKm` (`OdometerReading.cs:10`, `VehicleService.cs:32-34`). The smoke suite checks focus, titles and tap targets in both setups and passed in this audit.
- **SEC-1 (commits `8315cb7`, `e32b372`): signed off 2026-10-14.** The deploy gate is passed.
  - Code: rate limits and `ForwardedHeaders` (`src/OnlyCars.Api/Common/RequestLimits.cs:33-40`); a per-account failure counter that fails closed, with a `shortcut:` comment (`AuthService.cs:85`); a dummy-hash verify for unknown emails (`AuthService.cs:24-25,99`); an 8 KB auth body limit returning 413.
  - Evidence: the security re-review passed all five findings against a Production build; code review approved; 109 of 109 tests pass; and I got the 413 live with curl. UI QA passed the translated 429 in en and he with the 429 mocked, which I accept (decisions.md: the dev limits stay high).
- **MVP2-A (commits `760d2f6`, `7bdd057`, `f5e9591`): signed off 2026-10-14.** All 17 criteria met.
  - Evidence: the smoke suite has 11 task steps that pass in both setups; 16 service tests and a schema test (check constraint and seed) pass; UI QA passed at desktop and mobile widths, in en/he, RTL and dark mode.
  - QA's High bug (long unspaced names widening the page) is fixed and re-verified.
  - QA's four Lows are decided in decisions.md ("MVP2-A QA Lows"): (a), (c) and (d) are fixed in MVP2-B, and (b) is accepted.
- **MVP2-B (commits `2fc5531`, `68ea634`, `7728d51`): signed off 2026-10-15.** All 17 criteria met.
  - Evidence: 136 of 136 tests (10 new calculator tests, plus service tests for the DTO fields, `dueSoonPercent` validation and keep-on-PUT); smoke 37 of 37 in both setups, with new steps `task-status-order`, `task-status-after-odometer`, `task-due-soon-percent` and `templates-error`; code review approved, with all nits fixed; Hebrew review done; UI QA passed every criterion area, including the threshold boundaries, the sort, status following odometer add/edit/delete without a reload, contrast in both themes, the RTL fill and 390px.
  - MVP2-A Lows (a), (c) and (d) are fixed and verified here.
  - QA's three Lows are decided in decisions.md ("MVP2-B QA Lows"): 1 (rows vanish on a failed reload) and 2 (the "about 243 / months" wrap) are folded into MVP2-C, and 3 (`aria-valuetext` above 100%) is accepted.
- **MVP2-C (commits `7d9012d`, `6a41f70`): signed off 2026-10-15.** All 19 criteria met.
  - Evidence: 158 of 158 tests, 22 more than before, mostly in `ServiceRecordTests.cs` and `MaintenanceSchemaTests.cs`. Smoke passed 42 of 42 in both setups, with the new steps `reset-task`, `undo-reset`, `reset-with-cost`, `toggle-clears-undo` and `tasks-reload-error-keeps-rows`. `qa-mvp2c.mjs` passed in both setups. Code review fixes are in; the Hebrew review needed no changes; UI QA passed, and its Medium is fixed and covered by smoke.
  - MVP2-B Lows 1 and 2 are fixed here. QA's notes (a) to (c) are decided in decisions.md ("MVP2-C QA notes"): (a) is fixed in SET-1, and (b) and (c) are accepted.
  - The car list's quick-add now sends the local date (decision 2026-10-15).
- **SET-1 (backend commit `8a8dd1d`; the frontend, the review fixes and the `SettingsTests.cs` fix are not committed yet): signed off 2026-10-15.** All 14 criteria met.
  - Evidence: 181 of 181 tests, 23 more than before (`SettingsTests.cs`). Smoke passed 46 of 46 in both setups, with the new steps `settings-theme`, `settings-language`, `settings-currency` and `settings-save-fails`. `qa-set1.mjs` passed, including a throttled production build with no theme flash. Code review fixes are in, the Hebrew review improved two strings, and UI QA passed with no High or Medium.
  - MVP2-C QA note (a) is fixed: the 24px "Show archived" label is now a 44px row.
  - QA's three Lows and its question are decided in decisions.md ("SET-1 QA Lows" and "Where the 'amounts are not converted' hint goes"). Low 1 (focus moving to an unchecked radio during a save) and Low 2 (stale duplicate errors) are fixed in SET-2. Low 3 (a change on another device shows only after visiting Settings or logging in) is accepted. The hint stays only under the Settings currency field.
- **SET-2 (backend commit `d3abd15`; the frontend and all fixes are not committed yet): signed off 2026-10-15.** All 13 criteria met.
  - Evidence: 189 tests (8 new); smoke 48 of 48 in both setups, with the new steps `settings-unit-miles` and `settings-unit-errors`; `qa-set2.mjs` 17 of 17; `units.test.mjs` 6 of 6; the live API checked with curl. Code review approved, along with the five engineer deviations (unchanged fields send their stored km back; remaining miles round rather than round up; English km strings reworded; `{{distUnit}}`/`{{distUnits}}`; smoke cleanup). The Hebrew review improved two strings. UI QA passed; its Medium (a 1 km drift when retyping a neighbour's shown value) and its focus Low are fixed and re-verified.
  - SET-1 QA Lows 1 and 2 are fixed here.
  - QA's cosmetic Low (remaining miles 1 off the shown numbers) and the Hebrew "קילומטראז׳" label are accepted (decisions.md, "SET-2 QA notes").

## Next ticket

### MVP3-A: Service history and recording a past service

**Goal:** On a car's page, a user sees every service done on the car, newest first, and can record a service after the fact (with its own date, odometer, shop, cost, notes and the tasks it covered), or undo one from the list.

**Spec:** section 5, bullet 1 ("Date, odometer, shop (or DIY), total cost, notes"); section 2, bullet 2 ("Auto-log the odometer whenever a service is recorded"); section 4's Undo, from the history. Part 2: `ServiceRecord` (VehicleId, Date, OdometerKm, ShopName (null = DIY), TotalCost, Notes, IsVoided) and `ServiceRecordTask` ("one service can reset several tasks"). Both tables, the Service reading link and the void endpoint exist since MVP2-C.

**Binding decisions** (`docs/decisions.md`, 2026-10-15, "Service history scope and split, step 3" and "Backdated service records, MVP3-A"; earlier: MVP2-C's reset and cost rules, SET-2's units, MVP1-C's focus rules):
- A record's date is any day up to today (the client sends its local date; the server allows UTC today plus 1 day, as for resets). Its odometer reading follows the manual-reading date-order rules, with `confirmCorrection`.
- A linked task's `LastDone*` moves to the record only when the record is at least as recent as the task's current last done (by date, then odometer).
- Undo (void) works on any non-voided record in any order; `serviceRecord.notLatest` is retired. The recompute rule is in decisions.md.
- Voided records are hidden from the history. Cost: 0 to 1,000,000, 2 decimals, optional. Shop: up to 100 characters, empty means DIY. Notes: up to 1,000 characters.
- Distances are in km in the API and shown in the user's unit through `client/src/units.ts`.

**Scope**

*Backend (backend-engineer). Runs first. Publish the contract in `docs/contracts/MVP3-A.md`.*
- `GET /api/vehicles/{vehicleId}/service-records`: the car's non-voided records, ordered by `date` DESC, then `createdAt` DESC. Each item: `id`, `date`, `odometerKm`, `shopName` (null = DIY), `totalCost` (nullable), `notes`, and `tasks` (`id`, `name`, `category` of each linked task that still exists).
- `POST /api/vehicles/{vehicleId}/service-records`: body `date`, `odometerKm`, `shopName`, `totalCost`, `notes`, `taskIds` (0 or more of this car's tasks; duplicates ignored), `confirmCorrection`. In one save: the `ServiceRecord`, one `ServiceRecordTask` per task with the `PreviousLastDone*` snapshot, `LastDone*` moved per the rule above, and an `OdometerReading` with `Source = Service` and `ServiceRecordId` at the record's date and odometer, then the odometer recompute. Returns 201 with the record DTO and the updated `MaintenanceTaskDto[]` of the linked tasks.
- Validation codes: `vehicle.notFound`; `serviceRecord.futureDate`; `odometer.invalidValue`, `odometer.lowerThanPrevious`, `odometer.higherThanNext` (same extensions as readings, in km); cost, shop and notes limits (reuse the MVP2-C codes where they exist, add `serviceRecord.shopTooLong` if missing); `task.notFound` for a task id that isn't this car's. Nothing is saved on any error.
- `POST .../service-records/{recordId}/void`: drop the `notLatest` check and use the new recompute rule. Keep the response shape, the other codes, and MVP2-C's "only reading" rule.
- The one-tap reset is unchanged.
- Tests: create with 0, 1 and 2 tasks; a backdated record older than a task's last done leaves it alone; date-order errors and confirm; future date; every validation code; another user's car and task; list order with voided hidden; void in any order (void the newer then the older, ending at the original snapshot, and the reverse); a manual edit after a record is left alone by its void. Update the MVP2-C tests that expect `notLatest`.

*Frontend (frontend-engineer). Builds against `docs/contracts/MVP3-A.md`.*
- **Service history section** on `/cars/:id`, between the tasks and the odometer history. Each row: date, odometer (user's unit), shop or "DIY", cost with the user's currency (nothing when null), the names of the linked tasks, and notes (wrapped, not truncated). Loading, empty ("No services recorded yet") and error states, as in the other sections.
- **Record a service** button (active cars only) opens an inline form: date (default today, max today), odometer (default the car's current odometer in the user's unit, with `readingInput` limits and the date-order confirm checkbox as on the history edit form), shop with a "leave empty for DIY" hint, cost (labelled with the currency), notes, and a checkbox list of the car's enabled tasks. Save, Cancel and Escape follow the MVP1-C focus rules.
- After saving or undoing, reload the history, the tasks and the odometer history (as Mark done does), so status and readings update without a page reload. Mark done and its Undo bar also reload the history.
- **Undo** on each row (active cars only) with a confirm step, as for Delete. It calls the void endpoint and the row disappears.
- Strings in `en` and `he` for everything new, including the new error codes.

**Acceptance criteria**

*API*
1. [BE] `POST` with two task ids creates one record linked to both, sets both tasks' last done to the record, logs one Service reading at the record's date and odometer, and the car's current odometer follows it. `GET` then lists it first.
2. [BE] A record dated before a task's current last done links the task but leaves its `LastDone*` unchanged.
3. [BE] A backdated odometer that breaks date order returns `odometer.lowerThanPrevious` or `odometer.higherThanNext` with the neighbour in km, and succeeds with `confirmCorrection: true`. A future date returns `serviceRecord.futureDate`. Nothing is saved on any error.
4. [BE] Void works on any non-voided record in any order, and the tasks end where decisions.md says (both two-record orders and the manual-edit case are tested). `serviceRecord.notLatest` no longer exists in the code or the contract.
5. [BE] Voided records are not listed. Another user's car or task returns 404. `dotnet test` passes.

*UI*

6. [FE] Recording a service with a shop, a cost, notes and two tasks shows it at the top of the history; both task rows show it as last done with their status updated; and the odometer history shows a Service reading, all without a reload. A Mark done also appears in the history at once.
7. [FE] An empty shop shows "DIY", an empty cost shows no amount, and a long shop name or notes wrap without widening the page.
8. [FE] A date and odometer out of order show the translated error with the neighbour in the user's unit, and ticking the confirm checkbox saves it. A future date can't be picked, and if the server rejects one the error is translated.
9. [FE] Undo from the history, after confirming, removes the row, and the tasks and odometer update without a reload. A failed undo (mocked 500) keeps the row and shows the error on it.
10. [FE] In miles, the form's default odometer is the car's odometer in miles, and saving it unchanged stores the exact km (no 1 km drift, using `toKm`'s kept values). The history shows miles.
11. [FE] Archived cars show the history read-only (no Record or Undo).
12. [FE] Loading, empty and error states exist for the history, and a failed save keeps the form open with every typed value.
13. [FE] Hebrew and RTL: every new string is in `en` and `he`; dates, amounts and distances read correctly in RTL; the Hebrew reviewer approves.
14. [FE] Mobile: at 390px there is no horizontal overflow in the history or the form, in both languages, and every button and checkbox row is at least 44px tall.
15. [FE] Accessibility: every field has a label, the task checkboxes are a `fieldset` with a `legend`, errors are tied to their fields, focus follows the MVP1-C rules after Save, Cancel, Escape and Undo, and each Undo button names its record ("Undo service of 15 Oct 2026").
16. [BE+FE] Tests: `smoke.mjs` gains `service-history-empty`, `record-service`, `record-service-backdated` and `undo-service-from-history`, and every step passes in both setups.

**Out of scope**
- Line items (`ServiceItem`) and editing a record: MVP3-B.
- Filter and search: MVP3-C.
- Attachments and receipts: blocked on the R2 credentials.
- A history across all cars, and the dashboard (step 4).
- Garages (spec 11, optional).
- Showing voided records.

**Open questions:** none blocking; the rules are in decisions.md. For the owner to review: whether undone records should stay visible (greyed out) instead of hidden, and the backdated rule (an old service never moves a task's last done backwards).

---

### Later
- **MVP3-B:** line items (part, brand, part number, quantity, unit cost, labour) and editing and deleting records.
- **MVP3-C:** filter and search by car, task, date and shop.
- **Car photo upload and attachments:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3): with the dashboard (step 4) or later.

## Changed since last audit
- **Signed off:** SET-2. The backend is in `d3abd15`; the frontend and all fixes are not committed yet.
- **Section 2:** "Unit setting (km/miles), with the currency set per user" went from Partial to **Done**.
- **Counts:** Done went from 15 to 16, and Partial from 7 to 6.
- **SET-1 QA Lows 1 and 2** (focus on a busy radio group, duplicate stale errors) are fixed and verified by QA.
- **New decisions** (`docs/decisions.md`, 2026-10-15): the SET-2 QA notes (both accepted), the step 3 split (MVP3-A, B, C), and the backdated-record and Undo rule, which retires `serviceRecord.notLatest`.
- **Next ticket:** MVP3-A, written in full. The SET-2 ticket text is in git history up to `d3abd15`.
- **Tests:** `dotnet test` grew from 181 to 189 tests, the smoke suite from 46 to 48 steps per setup, plus `units.test.mjs` (6) and `qa-set2.mjs`.
