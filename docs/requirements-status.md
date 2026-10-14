# OnlyCars: Requirements Status

**Audit date:** 2026-10-14 (fourth audit, sign-off of MVP1-C, SEC-1 and MVP2-A, commit `f5e9591`)
**Overall:** MVP step 1 is complete apart from car photos (blocked on R2) and the settings screen. MVP step 2 is about a third done: tasks can be added from templates or from scratch, edited, turned off and deleted, in English and Hebrew (MVP2-A). Status and the due-soon threshold (MVP2-B), then Reset and Undo (MVP2-C), come next. The SEC-1 deploy gate is passed.

| Status | Count |
|---|---|
| Done | 10 |
| API only | 0 |
| Partial | 7 |
| Missing | 33 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (fourth audit):
- Both dev servers were already running. The API process started after the last `src/` edit, and a 9 KB login body returned 413, so the live API runs SEC-1's final code.
- `dotnet test`, built into a scratch artifacts folder because the running API locks `src/*/bin`: 109 of 109 passed.
- `client/ui-tests/smoke.mjs`: all 33 steps passed in both setups (desktop-light-en and mobile-dark-he), exit code 0. This includes 11 task steps (`tasks-empty-and-picker` through `archived-tasks-read-only`) and MVP1-C's focus and title checks. The only 4xx responses were the expected ones: 400s for a lower odometer reading (add and edit) and for an invalid task, and 404s for another user's car (doubled by StrictMode). Screenshots went to a scratch folder. I read `mobile-dark-he-20-edit-task.png` and `desktop-light-en-21-disable-task.png`; the names match those in `client/ui-tests/out/`.
- Reviews and QA, which I did not re-run: the SEC-1 security re-review passed all five findings and the follow-ups in `e32b372`, and code review approved. MVP2-A UI QA passed at desktop and mobile widths, in en and he, and in dark mode. Its one High bug (long unspaced names widening the page) was fixed in `f5e9591` and re-verified.
- The notes from earlier audits (MVP1-A, MVP1-B) are in git history.

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
| Interval by km, by time, or both (whichever comes first) | **Done** | `IntervalKm` and `IntervalDays` are nullable, with a database check that at least one is set (`MaintenanceTaskConfiguration.cs:27`, tested in `MaintenanceSchemaTests.cs:36`). The form takes km, and time as days, months or years (`TasksSection.tsx:9`). Rows show "Every 10,000 km or 1 year" (`TasksSection.tsx:17`). Smoke steps `add-task-template` and `edit-task`. | "Whichever comes first" only matters once status exists, which MVP2-B adds. |
| Starter template library, fully editable | **Done** | 12 templates seeded with stable keys (`TaskTemplateConfiguration.cs:37`), `GET /api/task-templates`, a picker with translated names (`TasksSection.tsx:104-125`). Picking one prefills a form that the user can change completely; the user's copy is fully editable, and the global library is read-only (decisions.md, MVP2-A). Smoke steps `tasks-empty-and-picker`, `task-form-prefill` and `add-task-template`. | The owner should review the 12 default intervals. |
| Per-car custom tasks | **Done** | "Custom task" in the picker saves with `templateId` null. Tasks belong to one car (`/api/vehicles/{id}/tasks`), and another user's car returns 404 (service tests). Smoke step `add-task-custom`. | Nothing. |
| Enable/disable a task without deleting it | **Done** | The Enabled checkbox saves immediately through PUT (`TasksSection.tsx:300-305`). Disabled tasks keep a "Disabled" label and sort after enabled ones (`TasksSection.tsx:60,280`). Smoke steps `disable-task` and `toggle-task-fails` (`desktop-light-en-21-disable-task.png`). Archived cars are read-only (`archived-tasks-read-only`). | A failed-toggle error stays visible after the next action (QA Low c); fixed in MVP2-B. |

## 4. The "Roborock" Reset Behavior

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Remaining km/days, progress bar, status (OK, Due soon, Overdue) | **Missing** | Only the inputs exist: intervals, last done and `DueSoonPercent` (`MaintenanceTask.cs:22-25`). | Everything. **MVP2-B (next ticket).** The rules are in decisions.md ("Task status rules"). |
| Reset / Mark as done (records odometer and date, restarts the countdown, creates a history entry with optional cost and notes) | **Missing** | none | Everything. MVP2-C, outlined. |
| Undo for accidental resets | **Missing** | none | Everything. MVP2-C, outlined. |
| Configurable "due soon" threshold | **Missing** | The `DueSoonPercent` column exists with a default of 10, but there is no API field or UI for it. | **MVP2-B.** Percent only, 1 to 50 (decisions.md). |

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
- Not started: `ServiceRecord`, `ServiceRecordTask` (MVP2-C) and the rest of Part 2.
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Complete for the MVP; MVP1-A, MVP1-B and MVP1-C signed off.** Working end to end in EN and HE: register (with currency) and login; add, edit, archive and unarchive cars, with the starting odometer capped at 0 to 10,000,000 km; quick odometer entry on the list and the car page; edit and delete readings with date-order rules and recompute; focus and page titles on every route. Remaining: car photo (blocked until the R2 credentials exist) and the settings screen for km/mi and currency (after step 2; it blocks nothing). |
| 2. Tasks, templates, km/time intervals, Reset | **In progress: MVP2-A signed off.** Spec section 3 is done. Next is MVP2-B (status, remaining km and days, due-soon threshold: spec 4.1 and 4.4), then MVP2-C (Reset and Undo: spec 4.2 and 4.3). |
| Deploy gate | **SEC-1 signed off.** Auth rate limits, account lockout, constant-time login, the 8 KB auth body limit and clean 400s are in. Nothing else blocks a first deploy except the owner's Azure account. |
| 3. Service history with costs | Not started. MVP2-C creates a minimal `ServiceRecord`; step 3 builds the full history on it. |
| 4. Dashboard with due/overdue status | Not started. Needs MVP2-B's status. |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP2-B: task status, remaining km and days, due-soon threshold | BE, then FE | **Next** (written below) |
| 2 | MVP2-C: Reset / Mark as done, and Undo | BE, then FE | Outlined |
| 3 | Settings screen (km/mi, currency, theme, locale) | BE, then FE | Not written. After step 2, per decisions.md. |

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

## Next ticket

### MVP2-B: Task status, remaining km and days, and the due-soon threshold

**Goal:** On a car's page, a user sees for each task how much is left until it's due (km, days, or both), a progress bar, and whether it's OK, Due soon or Overdue, with the most urgent tasks first. They can set per task how early "Due soon" starts.

**Spec:** section 4, bullets 1 ("remaining km / days, progress bar, status") and 4 ("configurable due soon threshold"); Part 2 "How Reset works": "Status is never stored. Compute it on read". Section 3's "whichever comes first" becomes visible here.

**Binding decisions** (`docs/decisions.md`):
- Due-soon threshold: percent only, 1 to 50, default 10, stored in `DueSoonPercent`. There is no absolute "500 km" option.
- Task status rules (MVP2-B): UTC today; used km and days are never below 0; Overdue when either remaining value is below 0; Due soon when either remaining value is at or below `DueSoonPercent` of its interval; the worse interval decides; disabled tasks have no status. Sort order: Overdue, Due soon, OK, Disabled, then most used first. No predicted due date.
- MVP2-A QA Lows (a), (c) and (d) are fixed in this ticket.

**Status rules, worked out** (for both engineers):
- `usedKm = max(0, CurrentOdometerKm - LastDoneOdometerKm)`, `remainingKm = IntervalKm - usedKm`. Null when `IntervalKm` is null.
- `usedDays = max(0, todayUtc - LastDoneDate)` in whole days, `remainingDays = IntervalDays - usedDays`. Null when `IntervalDays` is null.
- For each interval that is set: Overdue if `remaining < 0`; otherwise Due soon if `remaining * 100 <= interval * DueSoonPercent`; otherwise OK. The task's status is the worse of the two (Overdue > DueSoon > Ok).
- `progress = max(usedKm / IntervalKm, usedDays / IntervalDays)` over the intervals that are set. It is at least 0 and can go above 1 when overdue.
- Disabled task: `status`, `remainingKm`, `remainingDays` and `progress` are all null.
- Examples with the default 10%. Interval 10,000 km: 1,001 km left is OK, 1,000 left is Due soon, 0 left is Due soon, -1 is Overdue. Interval 365 days: 37 left is OK and 36 is Due soon (36 × 100 ≤ 3,650). A task 500 km past its km interval but with 200 days of its time interval left is Overdue.

**Scope**

*Backend (backend-engineer). Publish the contract in `docs/contracts/MVP2-B.md`, extending `MVP2-A.md`.*
- Compute the status in one pure function that takes the task, the car's current odometer and today as parameters. Unit tests pass a fixed date into it; there is no clock in the logic. Use it in `ListAsync`, `CreateAsync` and `UpdateAsync` (`MaintenanceTaskService.cs`), which already load the vehicle.
- No schema change and no migration: `DueSoonPercent` exists with default 10 (`MaintenanceTask.cs:22`).
- API contract outline:

  | Change | Detail |
  |---|---|
  | `MaintenanceTaskDto` gains | `status: "Ok" \| "DueSoon" \| "Overdue" \| null`, `remainingKm: number \| null` (can be negative), `remainingDays: number \| null` (integer, can be negative), `progress: number \| null` (at least 0, may exceed 1). All null for a disabled task. Returned by GET list, POST and PUT. |
  | `POST /api/vehicles/{vehicleId}/tasks` body gains | `dueSoonPercent?: int \| null`. Null or missing saves 10. |
  | `PUT /api/vehicles/{vehicleId}/tasks/{taskId}` body gains | `dueSoonPercent?: int \| null`. Null or missing keeps the current value, like `isEnabled`, so an older client's toggle can't reset it. |
  | New error | `task.invalidDueSoonPercent`, 400, no extensions, when `dueSoonPercent` is outside 1 to 50. Checked right after `task.invalidInterval` in the existing validation order. |
  | Unchanged | The server's list order (enabled, then name). The client sorts by urgency. Enum values are serialized as strings, like `category`. |

*Frontend (frontend-engineer)*
- **Task row** (`TasksSection.tsx`, `TaskRow`), for enabled tasks:
  - A status badge with text, not only colour: "OK", "Due soon", "Overdue" ("תקין", "בקרוב", "באיחור"; the Hebrew reviewer may adjust these).
  - A progress bar filled to `min(progress, 1)`. Use `<progress>` or `role="progressbar"`, with `aria-valuenow` as a whole percent and an accessible name like "Timing belt: 82% used". In Hebrew it fills from the right.
  - A remaining line. "1,200 km or 40 days left"; "1,200 km left" or "40 days left" for tasks with one interval; "Overdue by 300 km", "Overdue by 12 days" or "Overdue by 300 km and 12 days". When only one interval is overdue, show only the overdue part. Show 60 days or more as whole months ("about 4 months left": `floor(days / 30)`), and anything shorter as days. Numbers go in `<bdi>`.
  - Disabled tasks keep the "Disabled" label and show no badge, bar or remaining line.
  - Archived cars show the status read-only, like the rest of the row.
- **Colours:** new tokens for the three statuses in light and dark themes, for example `--status-ok`, `--status-soon` and `--status-overdue`. Badge text needs at least 4.5:1 contrast and the bar fill at least 3:1 against its track. Don't use `--danger`, which decisions.md reserves for confirm-Delete buttons.
- **Sort:** Overdue, Due soon, OK, then Disabled. Within a status, sort by higher `progress` first, then by name with `localeCompare(…, lang, { numeric: true })` (Low a).
- **Task form** (add and edit): a "Due soon when this much is left" field, a whole number from 1 to 50 with a "%" suffix, prefilled with 10 on add and with the task's value on edit. Validate it on the client before sending. Send `dueSoonPercent` in POST and PUT, and include it in `bodyOf` so the Enabled toggle keeps it.
- **Field-specific interval limits** (Low d): the client blocks a km interval above 1,000,000 and a time interval above 20 years (7,300 days, 243 months or 20 years, depending on the unit). Each gets its own translated message on its own field, before any request. The server's combined `task.invalidInterval` message stays as the fallback.
- **Row errors** (Low c): any new action on a row (Edit, toggle, Delete, Cancel) clears that row's old error first.
- **Status refresh:** after a reading is added, edited or deleted on `/cars/:id`, the task list reloads so remaining km and status follow the new odometer. No page reload.
- **Strings** in `en` and `he`: three status names, the remaining and overdue formats (with plurals), "about N months", the threshold field label and its error, the two new interval-limit errors, and `errors.task.invalidDueSoonPercent`.

**Acceptance criteria**

*Status computation*
1. [BE] Unit tests on the pure function, with a fixed today, cover: km only; days only; both; the threshold boundary (exactly `DueSoonPercent` left is Due soon, one more km or day is OK); 0 remaining is Due soon; -1 is Overdue; both intervals in different states, where the worse wins; the car's odometer below `LastDoneOdometerKm`, where used is 0 and `remainingKm` equals `IntervalKm`; a `LastDoneDate` of tomorrow, where used is 0; `DueSoonPercent` 1 and 50; and `progress` above 1 when overdue.
2. [BE] GET, POST and PUT return `status`, `remainingKm`, `remainingDays` and `progress` as in the contract, and a disabled task returns all four as null. A service test checks one enabled and one disabled task through `ListAsync`.
3. [BE] `dueSoonPercent` 0, 51 or -5 returns 400 `task.invalidDueSoonPercent` on POST and PUT, and nothing is saved. POST without it saves 10. PUT without it keeps the stored value: set it to 25, then toggle Enabled with the old body shape, and it is still 25.
4. [BE] Changing `dueSoonPercent` changes the returned status without any other edit (for example, a task with 15% of its km left goes from OK at 10 to Due soon at 20).

*Car page*

5. [FE] Each enabled task shows a status badge with text, a progress bar and the remaining line in the formats in Scope. A disabled task shows none of them.
6. [BE+FE] Tasks set up to be OK, Due soon and Overdue (for example by backdating last done) appear in the order Overdue, Due soon, OK, then Disabled, with the right badge on each.
7. [FE] Two tasks with the same status and progress, named "9k service" and "10k service", sort with "9k service" first (Low a).
8. [BE+FE] Adding an odometer reading on `/cars/:id` that pushes a task past its km interval changes that row to Overdue without a page reload. Deleting that reading brings the row back.
9. [BE+FE] The task form shows the due-soon field (10 on add, the stored value on edit). Saving 20 changes the status where criterion 4 says it should. Values 0, 51 and 2.5 are blocked on the client with a translated message, and no request is sent.
10. [FE] A time interval of 21 years, 244 months or 7,301 days, or a km interval of 1,000,001, is blocked on the client with a message on that field that names the limit (Low d).
11. [FE] After a failed toggle shows its error, the next action on that row (Edit, toggle again, Delete) clears the error (Low c).

*Every screen*

12. [FE] Hebrew and RTL: every new string exists in `en` and `he`; the bar fills from the right in Hebrew; numbers stay left-to-right in `<bdi>`; badge and bar lay out correctly in RTL.
13. [FE] Mobile: at 390px wide there is no horizontal overflow with badges, bars and the longest remaining line ("Overdue by 1,000,000 km and about 243 months", since 60 days and up show in months) in either language. Tap targets stay at least 44px tall.
14. [FE] Colours: badge text is at least 4.5:1 and the bar fill at least 3:1 in light and dark mode. Status is never shown by colour alone. Take screenshots of all three statuses in both themes.
15. [FE] Loading and error: while tasks reload after an odometer change, the existing rows stay visible (no flash of the empty state). A failed reload shows the existing translated load error, and the rest of the page stays usable. The Save button stays disabled while a request is in flight.
16. [FE] Accessibility: the progress bar has an accessible name and value as in Scope. Focus rules from MVP2-A are unchanged.
17. [BE+FE] Tests: `dotnet test` passes with the new tests for criteria 1 to 4. `smoke.mjs` gains steps `task-status-order` (criterion 6), `task-status-after-odometer` (criterion 8) and `task-due-soon-percent` (criterion 9), and they pass in both setups along with every existing step.

**Out of scope**
- Reset / Mark as done, and Undo (MVP2-C).
- A predicted due date from `AvgKmPerDay` (spec 2.3; decisions.md). It goes with the dashboard or later.
- An absolute km threshold, and a user-wide default threshold.
- Tasks or status on the car list or a dashboard (MVP step 4), and notifications (step 5).
- Server-side urgency sorting. The dashboard ticket adds it when the server needs it.
- Miles: everything is km until the settings screen exists.
- Low (b), the picker and an edit form open together: accepted.

**Open questions:** none. Every rule comes from decisions.md. The owner may want to review the status names in Hebrew and the 60-day cut-over to months.

---

### MVP2-C (outline): Reset / Mark as done, and Undo

- **Goal:** one tap marks a task done and restarts its countdown, and a mistaken tap can be undone (spec 4, bullets 2 and 3).
- [BE] A minimal `ServiceRecord` (`VehicleId, Date, OdometerKm, ShopName, TotalCost, Notes, IsVoided`) and `ServiceRecordTask`, following Part 2 "How Reset works": create the record, link the task, set `LastDone*`, and log an `OdometerReading` with `Source = Service`. Add a nullable `ServiceRecordId` to `OdometerReading` so voiding removes that reading and recomputes the odometer (the MVP1-B recompute).
- [BE] `POST /api/vehicles/{id}/tasks/{taskId}/reset` with optional `odometerKm` (default: current), `date` (default: today), `cost` and `notes`. `POST /api/vehicles/{id}/service-records/{recordId}/void` for Undo: it sets `IsVoided` and restores each linked task's `LastDone*` from its previous non-voided record. If there is none, it restores the values the task had before its first reset; these need storing, for example as `InitialLastDone*` on the task. Decide in the ticket.
- [FE] A one-tap Reset on each task row, with an optional "add cost and notes" expansion. An Undo toast for about 10 seconds after each reset, plus Undo on the task's most recent reset entry.
- Decide in the ticket: deleting a task that has service records.

### Later (not scheduled before step 2 ends)
- **Settings screen:** km/mi with conversion on display, currency change, a theme toggle (`User.Theme`), and saving `User.Locale`.
- **Car photo upload:** blocked until the owner creates the Cloudflare R2 credentials.

## Changed since last audit
- **Signed off:** MVP1-C, SEC-1 and MVP2-A. The tracker had MVP1-C still listed as "Next"; that's fixed.
- **Section 3, all five items:** Missing to **Done**. Evidence is in the section 3 table.
- **Counts:** Done went from 5 to 10, and Missing from 38 to 33.
- **Data model checks:** the `InitialOdometerKm` bug is fixed (MVP1-C). The stale `OdometerService.cs:18` `MaxValueKm` reference now points to `OdometerReading.MaxValueKm` (`OdometerReading.cs:10`). The Maintenance tables are checked.
- **Section 4:** the threshold and status rows now point to MVP2-B, and the decisions on status rules are recorded.
- **New decisions:** MVP2-A QA Lows, the SEC-1 mocked 429, and the MVP2-B status rules (`docs/decisions.md`).
- **MVP2-B** is written in full. The full texts of signed-off tickets (MVP1-B, MVP1-C, SEC-1 and MVP2-A) were removed from this file to keep it short; they are in git history up to `f5e9591`.
- **Tests:** `dotnet test` grew from 54 to 109 tests, and the smoke suite from 16 to 33 steps per setup.
