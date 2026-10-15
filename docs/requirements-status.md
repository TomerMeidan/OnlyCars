# OnlyCars: Requirements Status

**Audit date:** 2026-10-15 (fifth audit, sign-off of MVP2-B, commits `2fc5531`, `68ea634`, `7728d51`)
**Overall:** MVP step 1 is complete apart from car photos (blocked on R2) and the settings screen. MVP step 2 is two-thirds done: tasks can be added, edited, turned off and deleted (MVP2-A), and each one now shows its status, remaining km and days and a progress bar, sorted by urgency, with a per-task due-soon threshold (MVP2-B). Reset and Undo (MVP2-C) are the last part of step 2. The SEC-1 deploy gate is passed.

| Status | Count |
|---|---|
| Done | 12 |
| API only | 0 |
| Partial | 7 |
| Missing | 31 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (fifth audit):
- Both dev servers were already running. The API process started at 23:10:14 on 2026-10-14 and no `src/` file changed after that, so the live API runs MVP2-B's code. I didn't restart anything.
- `dotnet test`, built into a scratch artifacts folder because the running API locks `src/*/bin`: 136 of 136 passed (109 before MVP2-B).
- `client/ui-tests/smoke.mjs`: exit code 0, 37 steps with screenshots in each setup (desktop-light-en and mobile-dark-he), plus the `templates-error` shot. The only 4xx responses were the expected ones: 400s for a lower odometer reading (add and edit) and an invalid task, and 404s for another user's car. I read `mobile-dark-he-27-task-status-order.png` (Hebrew, RTL, dark: Overdue, Due soon, OK, then Disabled; bars fill from the right; "9k service" before "10k service"; the longest overdue line fits at 390px) and `desktop-light-en-29-task-due-soon-percent.png` (Brakes with 1,500 of 10,000 km left shows Due soon after its threshold went to 20%).
- Reviews and QA, which I did not re-run: code review approved with nits, all fixed (the should-fix, a templates error cleared by a tasks load, now has the smoke step `templates-error`); the Hebrew review changed one string; UI QA passed every criterion area, including the 1,000 / 1,001 / 0 / -1 km boundaries, contrast in both themes and 390px. Its three Lows are decided in decisions.md ("MVP2-B QA Lows").
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
| Auto-log the odometer whenever a service is recorded | **Missing** | Only the `OdometerSource.Service` enum value exists (`Enums.cs:35`). | Depends on service records (MVP step 3). |
| Optional: estimated average km/day, used to predict when tasks come due | **Partial** | `AvgKmPerDay` is computed (`OdometerService.cs:72-99`, test at `OdometerServiceTests.cs:91`) and shown on the card (`CarsPage.tsx:50-52`). | Nothing uses it for predictions yet. Tasks exist now, but a predicted due date is out of MVP2-B (decisions.md); it goes with the dashboard or later. |
| Unit setting (km/miles), with the currency set per user | **Partial** | Currency is chosen at sign-up from ILS/USD/EUR/GBP, defaulting by UI language (`AuthPage.tsx:12-13,52`), validated and saved (`AuthService.cs:17,36-49`), and returned in `user.currency`. Smoke step `register-currency`; QA criteria 21-23. | No way to change the currency after sign-up. No km/mi setting: the UI always shows "km" and never converts. Both need a settings screen. |

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
| Remaining km/days, progress bar, status (OK, Due soon, Overdue) | **Done** | API: one pure function, `TaskStatusCalculator.Compute(task, currentOdometerKm, today)` (`src/OnlyCars.Application/Maintenance/TaskStatusCalculator.cs:13`), used for every task DTO (`MaintenanceTaskService.cs:156-158`); contract `docs/contracts/MVP2-B.md`. Tests: `TaskStatusCalculatorTests.cs` (10 tests with a fixed date, covering the boundaries) and `MaintenanceTaskServiceTests.cs`. UI: a text badge (`TasksSection.tsx:332`), `role="progressbar"` (`:340`), the remaining and overdue line (`Remaining`, `:31`), the urgency sort with a numeric name compare (`:16,89`), status colour tokens for light and dark (`index.css:14-16,40-42,212-214`), strings in en and he (`i18n.ts:94-98,258-262`). Browser: smoke steps `task-status-order`, `task-status-after-odometer` and `task-due-soon-percent` in both setups (`mobile-dark-he-27-task-status-order.png`). UI QA passed. | Nothing for this bullet. Two known Lows are fixed in MVP2-C: a failed reload hides the rows, and "about 243 / months" can wrap on English mobile. A predicted due date from km/day is a later ticket. |
| Reset / Mark as done (records odometer and date, restarts the countdown, creates a history entry with optional cost and notes) | **Missing** | none | Everything. **MVP2-C (next ticket).** |
| Undo for accidental resets | **Missing** | none | Everything. **MVP2-C.** |
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
| Light and dark mode | **Partial** | The app follows the system theme (`index.css:16,22`) and is checked in dark mode by the smoke test. | There is no in-app toggle. `User.Theme` is never read or written. |
| Per-user data isolation, data export and delete-account | **Partial** | Isolation: every vehicle, odometer and task call checks ownership and returns 404 for other users' data (`VehicleService.cs:113-128`). Tests: `VehicleServiceTests.cs:52`, `OdometerServiceTests.cs:78`. | No data export and no delete-account. |
| Hebrew and English UI, including RTL | **Done** | Every UI string exists in `en` and `he`, and `he: typeof en` makes the compiler enforce it (`i18n.ts`). `dir` is set to rtl or ltr. Every API error now has a stable `code` (`AppException.cs`, `GlobalExceptionHandler.cs`, fallback `http.<status>` in `Program.cs`). The client translates the code, or shows a translated generic message for unknown codes (`i18n.ts:154-157`). Tests: `GlobalExceptionHandlerTests.cs`. Browser: the Hebrew error screenshots `mobile-dark-he-05-*` and `-08-*`. | The language choice is saved only in localStorage, not in `User.Locale`. This is a settings gap, not a UI-language gap. |
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
- Not started: `ServiceRecord`, `ServiceRecordTask` (MVP2-C) and the rest of Part 2.
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Complete for the MVP; MVP1-A, MVP1-B and MVP1-C signed off.** Working end to end in EN and HE: register (with currency) and login; add, edit, archive and unarchive cars, with the starting odometer capped at 0 to 10,000,000 km; quick odometer entry on the list and the car page; edit and delete readings with date-order rules and recompute; focus and page titles on every route. Remaining: car photo (blocked until the R2 credentials exist) and the settings screen for km/mi and currency (after step 2; it blocks nothing). |
| 2. Tasks, templates, km/time intervals, Reset | **In progress: MVP2-A and MVP2-B signed off.** Spec section 3 is done, and so are spec 4.1 (status, remaining, progress bar) and 4.4 (due-soon threshold). Left: MVP2-C, Reset and Undo (spec 4.2 and 4.3), which closes step 2. |
| Deploy gate | **SEC-1 signed off.** Auth rate limits, account lockout, constant-time login, the 8 KB auth body limit and clean 400s are in. Nothing else blocks a first deploy except the owner's Azure account. |
| 3. Service history with costs | Not started. MVP2-C creates a minimal `ServiceRecord`; step 3 builds the full history on it. |
| 4. Dashboard with due/overdue status | Not started. The per-task status it needs exists now (MVP2-B). |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP2-C: Reset / Mark as done, and Undo (plus MVP2-B QA Lows 1 and 2) | BE, then FE | **Next** (written below) |
| 2 | Settings screen (km/mi, currency, theme, locale) | BE, then FE | Not written. After step 2, per decisions.md. |

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

## Next ticket

### MVP2-C: Reset / Mark as done, and Undo

**Goal:** On a car's page, a user taps "Mark done" on a task to record that it was done today at the car's current odometer, which restarts its countdown. They can add a cost and notes if they want, and undo a mistaken tap straight away.

**Spec:** section 4, bullets 2 ("Reset / Mark as done": records odometer and date, restarts the countdown, creates a history entry with optional cost and notes, skippable) and 3 ("Undo for accidental resets"). Part 2: "How Reset works", the Undo paragraph, `ServiceRecord`, `ServiceRecordTask`, and the index on ServiceRecord(VehicleId, Date DESC). Spec 2.2 ("auto-log the odometer whenever a service is recorded") starts here: a reset logs a `Service` reading.

**Binding decisions** (`docs/decisions.md`, 2026-10-15):
- Reset / Mark as done: current odometer and today only, with no odometer or date field. The client sends its local date, and the server accepts UTC today ±1 day. Cost (0 to 1,000,000, 2 decimals) and notes (up to 1,000 characters) are optional. `ShopName` is null (DIY), and `TotalCost` is null when skipped. The service reading skips the date-order checks. The server does not block disabled tasks or archived cars; the UI doesn't offer Reset there.
- Undo: restores `LastDone*` from a snapshot on `ServiceRecordTask`. Only the most recent non-voided reset of each linked task can be undone. The linked reading is deleted, or turned into a manual reading if it's the car's only reading. In the UI, Undo stays on the row until the next action in the tasks section or leaving the page, with no timer.
- Deleting a task with resets: allowed. The join rows go; the records and readings stay.
- MVP2-B QA Lows 1 and 2 are fixed in this ticket.

**Deviations from spec Part 2** (covered by the decisions above): `ServiceRecordTask` gains `PreviousLastDoneOdometerKm` and `PreviousLastDoneDate` (the snapshot for Undo). `OdometerReading` gains a nullable `ServiceRecordId`, so Undo can find and remove the reading its reset logged. `ServiceRecord.TotalCost` is nullable.

**Scope**

*Backend (backend-engineer). Runs first. Publish the contract in `docs/contracts/MVP2-C.md`, extending `MVP2-A.md` and `MVP2-B.md`.*
- **Entities and migration:**
  - `ServiceRecord`: `VehicleId`, `Date` (DateOnly), `OdometerKm` (decimal(12,2), like readings), `ShopName` (nullable, max 100), `TotalCost` (decimal(12,2), nullable), `Notes` (nullable, max 1,000), `IsVoided` (default false), plus `Id`, `CreatedAt` and `UpdatedAt`. Index on (VehicleId, Date DESC).
  - `ServiceRecordTask`: `ServiceRecordId`, `MaintenanceTaskId`, `PreviousLastDoneOdometerKm`, `PreviousLastDoneDate`. Unique on (ServiceRecordId, MaintenanceTaskId), indexed on MaintenanceTaskId.
  - `OdometerReading.ServiceRecordId` (nullable FK).
  - **Watch SQL Server's "multiple cascade paths" error.** Vehicle cascades to both tasks and records, so only one path into `ServiceRecordTask` and into `OdometerReading.ServiceRecordId` may cascade. Suggestion: ServiceRecord to ServiceRecordTask cascades; MaintenanceTask to ServiceRecordTask is `NoAction`, with the join rows removed in `MaintenanceTaskService.DeleteAsync`; ServiceRecord to OdometerReading is `NoAction` (records are never hard-deleted in this ticket). Add a schema test like `MaintenanceSchemaTests.cs` that deleting a task with a reset keeps the record.
- **Reset**, in one `SaveChanges`: load the owned car and the task (404s as today); validate; create the record (`Date` = the request date or UTC today, `OdometerKm` = `vehicle.CurrentOdometerKm`, `TotalCost`, `Notes` trimmed with empty saved as null, `ShopName` null); create the join row with the task's current `LastDone*` as the snapshot; set the task's `LastDoneOdometerKm` to the current odometer and `LastDoneDate` to the date; add the reading (`Source = Service`, linked to the record); run the existing odometer recompute (it is `private static` in `OdometerService.cs:165`, so share it rather than copy it).
- **Undo (void):** load the owned car and the record on that car (otherwise 404 `serviceRecord.notFound`, which also covers another user's record). 409 `serviceRecord.alreadyVoided` if it's already voided. For each linked task, 409 `serviceRecord.notLatest` if another non-voided record for that task is later by (Date, CreatedAt). Otherwise set `IsVoided`, restore each linked task's `LastDone*` from the snapshot, delete the linked reading (or, if it's the car's only reading, set it to `Manual` and clear `ServiceRecordId`), and recompute. One `SaveChanges`.
- **API contract outline:**

  | Endpoint / change | Detail |
  |---|---|
  | `POST /api/vehicles/{vehicleId}/tasks/{taskId}/reset` | Body, all optional (an empty body or `{}` is a one-tap reset): `{ date?: "YYYY-MM-DD" \| null, cost?: number \| null, notes?: string \| null }`. Returns **201** `{ serviceRecordId, task: MaintenanceTaskDto }`. The task already has its new `lastDone*`, `status`, `remaining*` and `progress`. |
  | `POST /api/vehicles/{vehicleId}/service-records/{recordId}/void` | No body. Returns **200** `MaintenanceTaskDto[]`: the linked tasks after the restore (an empty array if the task was deleted since). |
  | `serviceRecord.invalidDate` | 400, no extensions: `date` is more than 1 day away from UTC today, before or after. |
  | `serviceRecord.invalidCost` | 400, no extensions: `cost` is below 0, above 1,000,000, or has more than 2 decimals. |
  | `serviceRecord.notesTooLong` | 400, no extensions: `notes` is over 1,000 characters after trimming. |
  | `serviceRecord.notFound` | 404: the record isn't on this car, or the car isn't the caller's. |
  | `serviceRecord.alreadyVoided` | 409, no extensions. |
  | `serviceRecord.notLatest` | 409, no extensions: a later non-voided reset exists for a linked task. |
  | Unchanged | `MaintenanceTaskDto`. There is no GET for service records yet (step 3). The odometer history now includes `Source = "Service"` readings, which already return 409 `odometer.notManual` on PUT and DELETE. |

  Validation order for reset: `vehicle.notFound`, `maintenanceTask.notFound`, `serviceRecord.invalidDate`, `serviceRecord.invalidCost`, `serviceRecord.notesTooLong`.

*Frontend (frontend-engineer). Builds against `docs/contracts/MVP2-C.md`.*
- **Task row** (`TasksSection.tsx`, `TaskRow`), for enabled tasks on active cars only:
  - A **"Mark done"** button ("סמן כבוצע"; the Hebrew reviewer may adjust it). One tap posts `{ date: localToday() }`. The button is disabled while the request is in flight, so a double tap makes one record.
  - An **"Add cost or notes"** button that opens an inline form with Cost (number, step 0.01, labelled with the user's currency code from `user.currency`) and Notes (textarea, `maxLength` 1,000), plus "Mark done" and Cancel. Escape and Cancel close it and return focus to the opener (MVP1-C rule). Both fields are optional. Cost is checked on the client (0 to 1,000,000, at most 2 decimals), with a translated message on the field, before any request.
- **After a reset:** replace the row with `task` from the response (the list re-sorts, so the row usually moves down), and call a new `onOdometerChanged` prop from `CarPage` that runs its existing `load()`. That reloads the car and the history (a new "Service" reading appears, without Edit or Delete) and, through the existing `[path, car]` effect, the task list.
- **Undo bar** on that row: "Marked as done." with an **Undo** button, in a `role="status"` region so screen readers announce it. Focus moves to the Undo button in the row's new position. The bar stays until the next action anywhere in the tasks section (another Mark done, Edit, toggle, Delete, Add task) or leaving the page. Only one bar shows at a time. Undo posts the void, replaces the rows from the response, calls `onOdometerChanged`, removes the bar, and moves focus to that row's "Mark done" button. An Undo error shows translated on the row, and the bar stays so the user can retry.
- **Low 1:** when a task reload fails and rows are already showing, keep the rows and show the translated load error above them. Only a first load with no rows shows the error alone.
- **Low 2:** a non-breaking space between the number and the unit word in the remaining and overdue strings (`aboutMonths_*` and the km and days forms), in `en` and `he`, so "about 243 months" never breaks inside.
- **Strings** in `en` and `he`: Mark done, Add cost or notes, Cost, Notes, Marked as done, Undo, the cost error, and `errors.serviceRecord.*` for all six new codes.

**Acceptance criteria**

*Reset*
1. [BE] Service tests: a one-tap reset creates one non-voided record with the car's current odometer, UTC today, and null cost, notes and shop; one join row whose snapshot equals the task's old `LastDone*`; the task's `LastDone*` set to the current odometer and the date; and one `Service` reading with that value and date, linked to the record. The returned task has a restarted `status`, `remaining*` and `progress` (for example, Overdue becomes Ok with `remainingKm` equal to `IntervalKm`).
2. [BE] A reset with `cost` 120.5 and `notes` "  Castrol 5W-30 " saves 120.50 and the trimmed notes; notes of only spaces save null.
3. [BE] A `date` of UTC today -2 or +2 returns 400 `serviceRecord.invalidDate`; -1 and +1 are accepted. Cost -1, 1,000,000.01 and 1.234 return 400 `serviceRecord.invalidCost`. Notes of 1,001 characters return 400 `serviceRecord.notesTooLong`. Each failure saves nothing (no record, no reading, task unchanged).
4. [BE] Another user's car or task, or a task on a different car, returns 404 and saves nothing.
5. [BE] The service reading doesn't trip the date-order checks: reset works when the car's latest reading is dated tomorrow (the UTC slack), and the car's current odometer is unchanged afterwards.

*Undo*
6. [BE] Void restores the task's `LastDone*` from the snapshot, sets `IsVoided`, deletes the linked reading, recomputes the car's odometer and average, and returns the linked tasks with their restored status.
7. [BE] Two resets, A then B, on one task: voiding A returns 409 `serviceRecord.notLatest` and changes nothing; voiding B restores A's values; then voiding A restores the original values. Voiding twice returns 409 `serviceRecord.alreadyVoided`. Another user's record returns 404.
8. [BE] If the reset's reading has become the car's only reading, void keeps it as a `Manual` reading with no `ServiceRecordId`, and the car's odometer is unchanged.
9. [BE] Deleting a task that has a reset returns 204, removes the join row, and keeps the record and its reading (schema test on SQL Server).

*Car page*

10. [BE+FE] Tapping "Mark done" on an Overdue task turns its row OK with a full "N km left" line and an empty bar, re-sorts the list, shows the Undo bar with focus on Undo, and adds a "Service" reading to the odometer history (with no Edit or Delete), all without a page reload.
11. [BE+FE] "Add cost or notes" with cost 120.50 and notes saves the reset (the smoke step checks it through the API response). Cost -1, 1,000,000.01 and 1.234 are blocked on the client with a translated message on the field, and no request is sent. Escape and Cancel close the form with focus back on its opener.
12. [BE+FE] Undo returns the row to its previous status, last-done line and position, removes the "Service" reading from the history, removes the bar, and puts focus on that row's "Mark done". Any other action in the tasks section removes the bar without undoing.
13. [FE] "Mark done" and "Add cost or notes" don't appear on disabled tasks or on archived cars.
14. [FE] Double-tapping "Mark done" creates exactly one reset (the button is disabled while in flight).
15. [FE] Errors: a failed reset or undo shows the translated error on that row and keeps the rows; a failed undo also keeps the bar. A failed task reload with rows showing keeps the rows and shows the load error above them (Low 1).

*Every screen*

16. [FE] Hebrew and RTL: every new string exists in `en` and `he`; the Undo bar, the buttons and the cost field lay out correctly in RTL; amounts and dates stay left-to-right in `<bdi>`.
17. [FE] Mobile: at 390px wide there is no horizontal overflow with the two buttons, the inline form and the Undo bar, in both languages. Tap targets are at least 44px tall. "about 243 months" doesn't break inside on English or Hebrew mobile (Low 2).
18. [FE] Accessibility: the Undo bar is announced (`role="status"`); every button has a visible text label; focus follows criteria 10 to 12; the MVP1-C focus rules are unchanged elsewhere.
19. [BE+FE] Tests: `dotnet test` passes with new tests for criteria 1 to 9. `smoke.mjs` gains steps `reset-task` (criterion 10), `reset-with-cost` (11), `undo-reset` (12) and `tasks-reload-error-keeps-rows` (Low 1, with the reload failure mocked), and they pass in both setups along with every existing step.

**Out of scope**
- A service history list, viewing or editing records, line items, attachments and shop names (step 3, spec section 5).
- Backdated resets or a different odometer value: these come with step 3's service record form.
- One record resetting several tasks (the model allows it; the UI comes in step 3).
- Undo after leaving the page: in step 3, from the service history, using the same void endpoint.
- Reset from the car list or a dashboard (step 4).
- Server-side blocking of writes on archived cars (the UI is read-only, as for every other write today).
- Miles and changing the currency (settings screen).

**Open questions:** none blocking; every rule is in decisions.md. For the owner to review: the Hebrew button labels, and whether a one-tap reset should count as DIY (`ShopName` null) in later cost reports.

---

### Later (not scheduled before step 2 ends)
- **Settings screen:** km/mi with conversion on display, currency change, a theme toggle (`User.Theme`), and saving `User.Locale`.
- **Car photo upload:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3): with the dashboard (step 4) or later.

## Changed since last audit
- **Signed off:** MVP2-B (commits `2fc5531`, `68ea634`, `7728d51`).
- **Section 4:** "Remaining km/days, progress bar, status" and "Configurable due-soon threshold" went from Missing to **Done**. Reset and Undo now point to MVP2-C.
- **Section 3:** the "whichever comes first" and enable/disable notes are closed (MVP2-B made status visible and fixed the stale-error Low).
- **Counts:** Done went from 10 to 12, and Missing from 33 to 31.
- **New decisions** (`docs/decisions.md`, 2026-10-15): MVP2-B QA Lows (1 and 2 fixed in MVP2-C, 3 accepted), Reset rules, Undo rules, and deleting a task with resets.
- **MVP2-C** is written in full, replacing the outline. The MVP2-B ticket text was removed from this file; it is in git history up to `7728d51`.
- **Tests:** `dotnet test` grew from 109 to 136 tests, and the smoke suite from 33 to 37 steps per setup.
