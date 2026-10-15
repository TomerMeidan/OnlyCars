# OnlyCars: Requirements Status

**Audit date:** 2026-10-15 (sixth audit, sign-off of MVP2-C: backend commit `7d9012d`, plus the frontend and review fixes, which are not committed yet on `main`)
**Overall:** MVP steps 1 and 2 are complete for the MVP. Step 1 still lacks car photos (blocked on R2) and the settings screen. Step 2 closed with MVP2-C: one tap marks a task as done, with optional cost and notes. That restarts its countdown, creates a service record and logs a "Service" odometer reading, and the user can undo it straight away. Next is the settings screen (SET-1, then SET-2), then step 3, service history.

| Status | Count |
|---|---|
| Done | 14 |
| API only | 0 |
| Partial | 8 |
| Missing | 28 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (sixth audit):
- Both dev servers were already running. The API process started at 07:30:39 on 2026-10-15, after the last `src/` change at 07:28:50, so the live API runs the latest code, including the uncommitted `notLatest` fix. I didn't restart anything.
- `dotnet test`, built into a scratch artifacts folder because the running API locks `src/*/bin`: 158 of 158 passed (136 before MVP2-C).
- `client/ui-tests/smoke.mjs`: exit code 0, and all 42 steps `ok` in each setup (desktop-light-en and mobile-dark-he). The only 4xx responses were the expected ones: 400s for a lower odometer reading and an invalid task, and 404s for another user's car. I read two screenshots:
  - `mobile-dark-he-30-reset-task.png` (Hebrew, RTL, dark): Oil went from Overdue to OK with "עוד 10,000 ק״מ" and an empty bar. The Undo bar "סומן כבוצע. ביטול הסימון" shows on that row, and the history has a "טיפול" (Service) reading with no Edit or Delete.
  - `desktop-light-en-32-reset-with-cost.png`: both buttons are on every enabled row, and neither is on the disabled Timing belt.
- `client/ui-tests/qa-mvp2c.mjs`: exit code 0 in both setups, with no console errors and no unexpected responses (12 resets and 8 voids per setup). It confirms that disabled tasks and archived cars have no Mark done or cost buttons, and that the car list's quick-add sends the local date. Its only finding is the existing 24px "Show archived" label, decided in decisions.md ("MVP2-C QA notes").
- Reviews and QA, which I did not re-run:
  - Code review fixes: focus after a failed cost-form reset; `aria-describedby` on Undo; `notLatest` ranked by creation time only (decision of 2026-10-15).
  - Hebrew review: no changes.
  - UI QA: passed. Its Medium (the first Enabled-checkbox tap was swallowed while the Undo bar showed) is fixed, and the smoke step `toggle-clears-undo` covers it.
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
- Done (MVP2-C): `ServiceRecord` and `ServiceRecordTask`, with the index on ServiceRecord(VehicleId, Date DESC). There are three recorded deviations: `ServiceRecordTask.PreviousLastDone*` (the Undo snapshot), `OdometerReading.ServiceRecordId`, and a nullable `TotalCost`. Deleting a task keeps its records and their readings (`MaintenanceSchemaTests.cs`, on SQL Server).
- Not started: `ServiceItem`, `Attachment` (step 3) and the rest of Part 2.
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Complete for the MVP. MVP1-A, MVP1-B and MVP1-C are signed off.** Working end to end in EN and HE: register (with currency) and login; add, edit, archive and unarchive cars; quick odometer entry on the list and the car page (both now send the local date); edit and delete readings with the date-order rules and recompute; focus and page titles on every route. Remaining: the car photo (blocked until the R2 credentials exist) and the settings screen, which is next (SET-1, then SET-2). |
| 2. Tasks, templates, km/time intervals, Reset | **Complete. MVP2-A, MVP2-B and MVP2-C are signed off.** All of spec sections 3 and 4 is done: tasks and templates, status with remaining km and days and a progress bar, the due-soon threshold, one-tap Mark done with optional cost and notes, and Undo. |
| Deploy gate | **SEC-1 signed off.** Nothing else blocks a first deploy except the owner's Azure account. |
| 3. Service history with costs | Not started. MVP2-C created `ServiceRecord` and `ServiceRecordTask` and the void endpoint; step 3 adds the history list, the full record form (date, odometer, shop, line items) and edit and delete. |
| 4. Dashboard with due/overdue status | Not started. The per-task status and the reset endpoint it needs both exist. |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | SET-1: Settings screen, part 1: language, theme, currency (plus MVP2-C QA note (a)) | BE, then FE | **Next** (written below) |
| 2 | SET-2: Distance unit (km/mi), converted on display and input | BE, then FE | Not written |
| 3 | MVP3-A: Service history list and the full service record form (spec section 5) | BE, then FE | Not written |

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
- **MVP2-C (backend commit `7d9012d`; the frontend and review fixes are not committed yet): signed off 2026-10-15.** All 19 criteria met.
  - Evidence: 158 of 158 tests, 22 more than before, mostly in `ServiceRecordTests.cs` and `MaintenanceSchemaTests.cs`. Smoke passed 42 of 42 in both setups, with the new steps `reset-task`, `undo-reset`, `reset-with-cost`, `toggle-clears-undo` and `tasks-reload-error-keeps-rows`. `qa-mvp2c.mjs` passed in both setups. Code review fixes are in; the Hebrew review needed no changes; UI QA passed, and its Medium is fixed and covered by smoke.
  - MVP2-B Lows 1 and 2 are fixed here. QA's notes (a) to (c) are decided in decisions.md ("MVP2-C QA notes"): (a) is fixed in SET-1, and (b) and (c) are accepted.
  - The car list's quick-add now sends the local date (decision 2026-10-15).

## Next ticket

### SET-1: Settings screen, part 1 (language, theme, currency)

**Goal:** A signed-in user opens Settings from the header and changes their language, light or dark theme, and currency. Each change applies at once and is still there after logging in on another device.

**Spec:** section 2, bullet 4 ("currency set per user"; the km/mi half is SET-2); section 12, "Light and dark mode" (the in-app switch) and "Hebrew and English UI" (saving `User.Locale`). Part 2: `User.Currency`, `User.Locale`, `User.Theme`. All three columns already exist and are returned in `UserDto` (`AuthDtos.cs:10`), but nothing writes them after sign-up.

**Binding decisions** (`docs/decisions.md`, 2026-10-15, "Settings screen scope and split" and "Settings rules, SET-1"):
- The page is `/settings`, linked from the header. Each control saves when it changes; there is no Save button.
- Theme is System, Light or Dark, and defaults to System. It is applied before first paint from the cached user.
- Currency is one of ILS, USD, EUR or GBP. Changing it only relabels amounts; stored costs are not converted, and the page says so.
- Language: when signed in, `User.Locale` wins. It is applied at login, and the header switch also saves it. Signed out, the app behaves as today. Register saves the language the form was shown in.
- A failed save puts the control back to its old value and shows a translated error.
- MVP2-C QA note (a): the car list's "Show archived" label becomes at least 44px tall.

**Scope**

*Backend (backend-engineer). Runs first. Publish the contract in `docs/contracts/SET-1.md`.*
- `GET /api/me` returns **200** `UserDto` for the caller.
- `PUT /api/me/settings` takes `{ locale?, theme?, currency? }`, with locale En or He, theme System, Light or Dark, and currency ILS, USD, EUR or GBP. A missing field is left unchanged. It returns **200** `UserDto`. Use the same enum casing as the current `UserDto` JSON, and write that casing in the contract.
- Errors, each 400 with no extensions: `settings.invalidLocale` and `settings.invalidTheme`. An invalid currency reuses the code and the currency list that register already uses; don't add a second list.
- Register: an optional `locale` in the body, saved to `User.Locale`. An invalid value returns `settings.invalidLocale`. When it's missing, the default stays En.
- Both endpoints require auth. A missing or invalid token returns 401, as for every other endpoint.
- Leave `DistanceUnit` alone. It is in `UserDto` already, and SET-2 adds it to settings.

*Frontend (frontend-engineer). Builds against `docs/contracts/SET-1.md`.*
- **Header** (`App.tsx:16-24`): a "Settings" link for signed-in users. The language switch, when signed in, changes the language and saves `locale`, and if the save fails it shows a translated error and switches back.
- **`/settings` page** (`client/src/pages/SettingsPage.tsx`), with its title "Settings · OnlyCars" and focus on the `h1` (the MVP1-C rules):
  - Language: a radio group, Hebrew or English. It switches the UI at once.
  - Theme: a radio group, System, Light or Dark.
  - Currency: a select of the four codes, with a hint under it: "Changing the currency doesn't convert amounts you've already entered."
  - Each control saves on change and is disabled while saving. On success the cached user in `auth.tsx` (localStorage `USER_KEY`) is updated, and a short `role="status"` message "Saved" appears. On failure the control goes back to its old value, and a translated error shows next to it.
  - Loading: the page reads from the cached user, so there is no spinner. It also calls `GET /api/me` once and updates the cache if anything differs, for example after a change on another device.
- **Theme:** the CSS today is `@media (prefers-color-scheme: dark)` on `:root` (`index.css:21,27-28`). Add a `data-theme` attribute (light or dark) on `<html>` that wins over the media query, with `color-scheme` to match. System removes the attribute. Set it in `main.tsx` from the cached user before React renders, so there is no flash.
- **Locale on login:** after login, if `user.locale` differs from the UI language, switch to it. Register sends the current UI language as `locale`.
- **Cost label:** the cost field in `TasksSection` already reads `user.currency`, so it follows the new value without a reload.
- **QA note (a):** the "Show archived" checkbox label on the car list (`CarsPage.tsx:34-35`) is at least 44px tall.
- **Strings** in `en` and `he`: Settings, Language, Theme, System, Light, Dark, Currency, the currency hint, Saved, and `errors.settings.*`.

**Acceptance criteria**

*API*
1. [BE] `GET /api/me` returns the caller's `UserDto`, and 401 without a token.
2. [BE] `PUT /api/me/settings` with only `theme` Dark changes the theme and leaves locale and currency unchanged. With all three fields it changes all three. Both return the updated `UserDto`.
3. [BE] An invalid locale, theme or currency returns 400 with its code and saves nothing, even when the other fields in the body are valid.
4. [BE] Register with locale He saves He; without `locale` it saves En; with an invalid locale it returns 400 `settings.invalidLocale` and creates no user. Login returns the saved locale, theme and currency.
5. [BE] Service tests cover criteria 1 to 4, and one user's change does not affect another user's settings.

*Settings page*

6. [BE+FE] Changing the theme to Dark makes the app dark at once, with the OS in light mode. After a reload it is still dark, with no light flash (screenshot right after load). Light forces light with the OS in dark mode. System follows the OS again.
7. [BE+FE] Changing the language on the settings page or with the header switch flips the UI and `dir` at once. After logging out, switching the signed-out UI to the other language and logging in again, the saved language is applied.
8. [BE+FE] Changing the currency to USD saves it, and the "Add cost or notes" form on a car page then shows "Cost (USD)" with no reload. The hint about not converting amounts is visible under the field.
9. [FE] A failed save (mocked 500) puts the control back to its previous value and shows the translated error next to it, and the page stays usable. While a save is in flight, that control is disabled.
10. [FE] The Settings link appears only when signed in. `/settings` when signed out goes to `/login`, as other routes do.

*Every screen*

11. [FE] Hebrew and RTL: every new string exists in `en` and `he`; the radio groups and the select lay out correctly in RTL; currency codes are in `<bdi>`.
12. [FE] Mobile: at 390px wide there is no horizontal overflow on `/settings`, in both languages and both forced themes. Every radio, select and link, and the car list's "Show archived" label, is at least 44px tall (QA note (a)).
13. [FE] Accessibility: each group is a `fieldset` with a `legend`; "Saved" and errors are announced (`role="status"` and `role="alert"`); the forced dark and light themes keep text contrast at least 4.5:1 (the existing tokens).
14. [BE+FE] Tests: `dotnet test` passes, with new tests for criteria 1 to 5. `smoke.mjs` gains the steps `settings-theme` (6), `settings-language` (7), `settings-currency` (8) and `settings-save-fails` (9, mocked). They pass in both setups, along with every existing step.

**Out of scope**
- Km/mi (SET-2): the unit setting, and converting distances on display and input.
- Converting stored amounts when the currency changes.
- Changing the email or password, and delete-account and data export (section 12; a later ticket).
- Currencies beyond the four at sign-up.

**Open questions:** none blocking. Every rule is in decisions.md. For the owner to review: whether changing the currency should eventually offer to convert old amounts, and whether more currencies are wanted.

---

### Later
- **SET-2, distance unit:** km/mi, with conversion on display and input (odometer, readings, task intervals, remaining). Values are still stored in km.
- **MVP3-A, service history:** a list per car, the full record form (date, odometer, shop or DIY, cost, notes), and void or edit from the history.
- **Car photo upload:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3): with the dashboard (step 4) or later.

## Changed since last audit
- **Signed off:** MVP2-C. The backend is in `7d9012d`; the frontend and review fixes are not committed yet.
- **Section 4:** "Reset / Mark as done" and "Undo" went from Missing to **Done**. All of section 4 is now done.
- **Section 2:** "Auto-log the odometer whenever a service is recorded" went from Missing to **Partial**: resets log a Service reading, and the full service record comes in step 3.
- **Counts:** Done went from 12 to 14, Partial from 7 to 8, and Missing from 31 to 28.
- **MVP step 2 is complete.**
- **New decisions** (`docs/decisions.md`, 2026-10-15): MVP2-C QA notes ((a) is fixed in SET-1; (b) and (c) are accepted), the settings screen scope and split, and the settings rules for SET-1.
- **Next ticket:** SET-1, written in full. The MVP2-C ticket text is in git history up to `7d9012d`.
- **Tests:** `dotnet test` grew from 136 to 158 tests, and the smoke suite from 37 to 42 steps per setup.
