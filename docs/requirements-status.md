# OnlyCars: Requirements Status

**Audit date:** 2026-10-15 (ninth audit, sign-off of MVP3-A: backend commit `8c82c1c`, plus the void-recompute fix, the frontend and all review and QA fixes, which are not committed yet on `main`)
**Overall:** MVP steps 1 and 2 are complete, and step 3 has started: a user can see a car's service history, record a past service covering several tasks, and undo any record. Step 3 still lacks line items, editing, filter and search, and attachments. Next is MVP3-B (line items, edit and delete).

| Status | Count |
|---|---|
| Done | 18 |
| API only | 0 |
| Partial | 6 |
| Missing | 26 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (ninth audit):
- Both dev servers were already running (API PID 6172 on 5150, started 17:09; Vite PID 12136 on 5173), and I left them running. The API started after the last edit to `MaintenanceTaskService.cs` (17:08), so it runs the uncommitted void-recompute fix.
- `dotnet test`: 221 of 221 pass (I ran it).
- Code read: `client/src/pages/ServiceHistory.tsx` (the list, the record form with a `fieldset`/`legend` for tasks at `:184-192`, the Undo confirm at `:246-257`), `CarPage.tsx:83` (the section and its reload), `MaintenanceTaskService.cs:148,167,248` (list, create, void), `MaintenanceTasksController.cs:43-53`.
- Screenshot I read: `qamvp3a-mobile-light-en-mi-10-order-error.png` (390px, miles, the backdated-order error, long shop and notes wrapping, the history and its Service readings).
- Reported by other agents, not re-run by me: smoke 52 of 52 in both setups (with `service-history-empty`, `record-service`, `record-service-backdated`, `undo-service-from-history`); `qa-mvp3a.mjs` and `qa-mvp3a-extra.mjs` in 4 setups, criteria 6 to 15 passed with no High or Medium; code review fixes in; Hebrew review approved with one wording fix.
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
| Auto-log the odometer whenever a service is recorded | **Done** | Every reset logs a `Source = Service` reading linked to its record (`MaintenanceTaskService.cs:99`). A recorded service (MVP3-A, `CreateRecordAsync`, `:167`) logs one at its own date and odometer, with the date-order rules and `confirmCorrection`; voiding removes it (`:248`). Tests: `ServiceRecordTests.cs`, `ServiceHistoryTests.cs` (221 total). Browser: smoke `record-service`, `record-service-backdated` and `undo-service-from-history` in both setups; `qamvp3a-mobile-light-en-mi-10-order-error.png` shows the Service readings in the odometer history. | Nothing. |
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
| Reset / Mark as done (records odometer and date, restarts the countdown, creates a history entry with optional cost and notes) | **Done** | API: `POST .../tasks/{taskId}/reset` (`MaintenanceTasksController.cs:38-41`, `MaintenanceTaskService.cs:99`). It creates `ServiceRecord` (DIY, nullable cost) and `ServiceRecordTask` with an undo snapshot, sets `LastDone*` and logs a Service reading, all in one save. Schema: `ServiceRecordConfiguration.cs`, migration `20261015041218_AddServiceRecords.cs`. Contract: `docs/contracts/MVP2-C.md`. Tests: `ServiceRecordTests.cs` (13) and `MaintenanceSchemaTests.cs` (deleting a task keeps the record). UI: "Mark done" and "Add cost or notes" on enabled tasks of active cars; it sends the local date (`TasksSection.tsx:99-104`) and reloads the car and history (`CarPage.tsx:76`). Strings in en and he (`i18n.ts:101-108,282-289`). Browser: smoke `reset-task` and `reset-with-cost` in both setups, plus the QA script. | Nothing. Backdated services and one record for several tasks shipped in MVP3-A. |
| Undo for accidental resets | **Done** | API: `POST .../service-records/{recordId}/void` (`MaintenanceTasksController.cs:51-53`, `MaintenanceTaskService.cs:248`). Since MVP3-A any non-voided record can be undone in any order (`serviceRecord.notLatest` is retired), with the recompute rule in decisions.md ("Void recompute, corrected"). Tests: `ServiceRecordTests.cs` and `ServiceHistoryTests.cs`. Undo from the history after leaving the page: `ServiceHistory.tsx:241-257`, smoke `undo-service-from-history`. UI: a `role="status"` Undo bar with `aria-describedby` (`TasksSection.tsx:408-412`). It has no timer and closes on the next action in the section (`:143-145`). Browser: smoke `undo-reset` and `toggle-clears-undo` in both setups (`mobile-dark-he-31-undo-reset.png`). | Nothing. Undo from the history shipped in MVP3-A. |
| Configurable "due soon" threshold | **Done** | `dueSoonPercent` on POST and PUT, 1 to 50, default 10, kept when PUT omits it, error `task.invalidDueSoonPercent` (`MaintenanceTaskService.cs:53,77,127-130`). Tests in `MaintenanceTaskServiceTests.cs`, including a toggle with the old body shape keeping 25. UI: the "Due soon when this much is left" field with client validation (`TasksSection.tsx:207,227,261-263`), sent from `bodyOf` (`:13-14`). Browser: smoke `task-due-soon-percent` (`desktop-light-en-29-task-due-soon-percent.png`). | Nothing. Percent only, as decisions.md says; no absolute "500 km" option. |

## 5. Service Records

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Date, odometer, shop (or DIY), total cost, notes | **Done** | API (MVP3-A, contract `docs/contracts/MVP3-A.md`): `GET` and `POST /api/vehicles/{vehicleId}/service-records` (`MaintenanceTasksController.cs:43-49`, `MaintenanceTaskService.cs:148,167`): one record can cover several tasks; a task's last done moves only when the record is at least as recent; the date-order rules with `confirmCorrection`; `serviceRecord.futureDate`, `shopTooLong`, `invalidCost`, `notesTooLong`, `task.notFound`. Tests: `ServiceHistoryTests.cs` (221 of 221 pass, run by me). UI: a Service history section on `/cars/:id` (`CarPage.tsx:83`, `ServiceHistory.tsx`): rows with date, odometer in the user's unit, shop or DIY, cost in the user's currency, task names and wrapped notes (`:226-239`); a Record a service form (`:149-205`); read-only on archived cars. Strings in en and he. Browser: smoke `service-history-empty`, `record-service`, `record-service-backdated`, `undo-service-from-history`, 52 of 52 in both setups; `qa-mvp3a.mjs` in 4 setups; `qamvp3a-mobile-light-en-mi-10-order-error.png`. | Nothing for this bullet. Three QA Lows are fixed in MVP3-B (decisions.md, "MVP3-A QA Lows"). |
| Line items: part name, brand, part number, quantity, unit cost, labor | **Missing** | none | Everything |
| Attachments: receipt photos, PDFs, invoices | **Missing** | none | Everything |
| Filter and search by car, task, date or shop | **Missing** | none | Everything |
| Edit and delete past records | **Partial** | Delete exists as Undo (void) from the history since MVP3-A (`ServiceHistory.tsx:241-257`, smoke `undo-service-from-history`). | Editing is missing (MVP3-B: shop, cost, notes, line items; MVP3-D: date, odometer, tasks). The history button is renamed Delete in MVP3-B. |

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

### Data model checks (Part 2, tables for MVP steps 1 to 3 so far)
- Done: `User`, `Vehicle` and `OdometerReading` have all spec fields, plus Id, CreatedAt and UpdatedAt.
- Done: money is stored as decimal(12,2) (`VehicleConfiguration.cs:16-18`).
- Done: the unique index on Vehicle(UserId, Vin) where Vin is not null (`VehicleConfiguration.cs:26-28`).
- Done: the index on OdometerReading(VehicleId, ReadingDate DESC) (`OdometerReadingConfiguration.cs:19-20`).
- Done: readings must fit date order (lower than the previous or higher than the next is rejected) unless the user confirms. Future dates and values outside 0 to 10,000,000 km are rejected (`OdometerService.cs:113-160`). The 10,000,000 cap is `OdometerReading.MaxValueKm` (`OdometerReading.cs:10`), shared by readings (`OdometerService.cs:119`) and the starting odometer (`VehicleService.cs:32`).
- Fixed (MVP1-C): a car's starting odometer uses the same 0 to 10,000,000 range and returns `odometer.invalidValue` (`VehicleService.cs:32-34`).
- Done: `TaskTemplate` (plus a `Key`, a deviation recorded in decisions.md) and `MaintenanceTask` have all spec fields. The index on MaintenanceTask(VehicleId, IsEnabled) is at `MaintenanceTaskConfiguration.cs:25`. The interval check constraint is on both tables (`MaintenanceTaskConfiguration.cs:27`, `TaskTemplateConfiguration.cs:18`). Vehicle to task cascades on delete (`MaintenanceTaskConfiguration.cs:17`), and template to task is restricted (`:23`).
- MVP2-B added no schema; `DueSoonPercent` is now read and written through the API, and status is computed on read, never stored, as Part 2 requires.
- Done (MVP2-C): `ServiceRecord` and `ServiceRecordTask`, with the index on ServiceRecord(VehicleId, Date DESC). There are three recorded deviations: `ServiceRecordTask.PreviousLastDone*` (the Undo snapshot), `OdometerReading.ServiceRecordId`, and a nullable `TotalCost`. Deleting a task keeps its records and their readings (`MaintenanceSchemaTests.cs`, on SQL Server).
- MVP3-A added no schema: records with their own date and odometer use the MVP2-C tables, and `serviceRecord.notLatest` is retired.
- Not started: `ServiceItem` (MVP3-B), `Attachment` (blocked on R2) and the rest of Part 2.
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Complete for the MVP. MVP1-A, MVP1-B, MVP1-C, SET-1 and SET-2 are signed off.** Working end to end in EN and HE: register (with currency) and login; add, edit, archive and unarchive cars; quick odometer entry; edit and delete readings with the date-order rules and recompute; focus and page titles on every route; Settings with language, theme, currency and km or miles. Remaining: the car photo (blocked until the R2 credentials exist). |
| 2. Tasks, templates, km/time intervals, Reset | **Complete. MVP2-A, MVP2-B and MVP2-C are signed off.** All of spec sections 3 and 4 is done: tasks and templates, status with remaining km and days and a progress bar, the due-soon threshold, one-tap Mark done with optional cost and notes, and Undo. |
| Deploy gate | **SEC-1 signed off.** Nothing else blocks a first deploy except the owner's Azure account. |
| 3. Service history with costs | **In progress. MVP3-A is signed off.** Working end to end in EN and HE: the service history on `/cars/:id`, recording a past service (date, odometer, shop or DIY, cost, notes, several tasks) with the date-order rules, and Undo of any record from the history. **Next: MVP3-B** (line items, edit, Delete replacing the history's Undo, and the three MVP3-A QA Lows), then MVP3-C (filter and search) and MVP3-D (editing date, odometer and tasks). Attachments wait for R2. |
| 4. Dashboard with due/overdue status | Not started. The per-task status and the reset endpoint it needs both exist. |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP3-B: Line items, edit shop/cost/notes, Delete (spec 5.2, 5.5), plus the MVP3-A QA Lows | BE, then FE | **Next** (written below) |
| 2 | MVP3-C: Filter and search (spec 5.4) | BE, then FE | Not written |
| 3 | MVP3-D: Edit a record's date, odometer and tasks (spec 5.5) | BE, then FE | Not written |

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
- **MVP3-A (backend commit `8c82c1c`; the void-recompute fix, the frontend and all review fixes are not committed yet): signed off 2026-10-15.** All 16 criteria met.
  - Evidence: 221 of 221 tests (I ran them), including the corrected void recompute (decisions.md, "Void recompute, corrected") and its manual-edit and backdated cases. Smoke 52 of 52 in both setups, with the new steps `service-history-empty`, `record-service`, `record-service-backdated` and `undo-service-from-history`. UI QA (`qa-mvp3a.mjs`, `qa-mvp3a-extra.mjs`, 4 setups) passed criteria 6 to 15 with no High or Medium. Code review fixes are in; the Hebrew review approved with one wording fix.
  - QA's three Lows are decided in decisions.md ("MVP3-A QA Lows"): all three are fixed in MVP3-B (row action names, the date-order error placed under the odometer field, and a 409 or 404 on a row reloading the list). The flagged later-date, lower-odometer case is accepted as the binding rule. The reviewer's English aria-label wording is adopted in MVP3-B.

## Next ticket

### MVP3-B: Line items, editing and deleting service records

**Goal:** A user can list the parts and labour of a service, fix a record's shop, cost or notes after saving it, and delete a record from the history.

**Spec:** section 5, bullet 2 ("Line items: part name, brand, part number, quantity, unit cost, labor") and bullet 5 ("Edit and delete past records"). Part 2: `ServiceItem` (ServiceRecordId, Description, Brand, PartNumber, Quantity, UnitCost, IsLabor); "ServiceRecord 1-N ServiceItem".

**Binding decisions** (`docs/decisions.md`, 2026-10-15, "Line items and editing, MVP3-B" and "MVP3-A QA Lows"; earlier: MVP3-A's backdated and void rules, MVP2-C's cost rules, SET-2's units, MVP1-C's focus rules):
- Delete is the existing void (soft delete with the task recompute). The history's "Undo service" button becomes "Delete"; the Undo bar right after Mark done keeps its name and behaviour.
- Edit changes shop, total cost, notes and line items only. Date, odometer and linked tasks are shown but not editable; the form says "To change the date, odometer or tasks, delete this service and record it again." (MVP3-D).
- Item limits: `description` required, 1 to 100 characters (trimmed); `brand` up to 100; `partNumber` up to 50; `quantity` above 0 and up to 10,000, 2 decimals; `unitCost` 0 to 1,000,000, 2 decimals; `isLabor` (quantity is hours for labour). Up to 50 items per record. Saving replaces the whole list.
- With items, `totalCost` is the server-computed sum of quantity times unit cost, rounded to 2 decimals, and any `totalCost` in the body is ignored; a sum over 1,000,000 is `serviceRecord.invalidCost`. Without items, `totalCost` is entered by hand as in MVP3-A.
- Voided records can't be edited (409 `serviceRecord.alreadyVoided`).

**Scope**

*Backend (backend-engineer). Runs first. Publish the contract in `docs/contracts/MVP3-B.md`.*
- `ServiceItem` entity, EF configuration and migration: `Id`, `ServiceRecordId` (cascade on delete), `Description` nvarchar(100), `Brand` nvarchar(100) null, `PartNumber` nvarchar(50) null, `Quantity` decimal(9,2), `UnitCost` decimal(12,2), `IsLabor`, `SortOrder` (keeps the user's order), `CreatedAt`. Check constraints: `Quantity > 0`, `UnitCost >= 0`.
- The record DTO (GET list, POST, PUT) gains `items`: `id`, `description`, `brand`, `partNumber`, `quantity`, `unitCost`, `isLabor`, in `SortOrder`.
- `POST .../service-records` accepts an optional `items` array (same rules). Everything else about POST is unchanged.
- New `PUT /api/vehicles/{vehicleId}/service-records/{recordId}`: body `shopName`, `totalCost`, `notes`, `items`. It does not touch the date, odometer, tasks, the Service reading or any task's `LastDone*`. Returns 200 with the record DTO. Codes: `vehicle.notFound`, `serviceRecord.notFound` (404, also another user's record), `serviceRecord.alreadyVoided` (409), `serviceRecord.shopTooLong`, `serviceRecord.notesTooLong`, `serviceRecord.invalidCost`, and new codes `serviceItem.invalidDescription`, `serviceItem.brandTooLong`, `serviceItem.partNumberTooLong`, `serviceItem.invalidQuantity`, `serviceItem.invalidUnitCost`, `serviceRecord.tooManyItems`. Item errors carry an `index` extension (0-based) naming the row. Nothing is saved on any error.
- The void endpoint is unchanged (it is the Delete).
- Tests: create with items and the computed total; a total entered by hand without items; PUT replaces items, reorders them, and clears them (the total then comes from the body); PUT leaves the date, odometer, Service reading and tasks' `LastDone*` untouched; every validation code with its `index`; the 1,000,000 sum cap; 50 versus 51 items; PUT on a voided record (409) and on another user's record (404); the item cascade in `MaintenanceSchemaTests.cs`.

*Frontend (frontend-engineer). Builds against `docs/contracts/MVP3-B.md`.*
- **Line items** in the Record a service form and in the new Edit form: "Add part" and "Add labour" buttons each add a row with description, brand and part number (parts only), quantity (labelled "Hours" on labour rows), unit cost (labelled with the currency; "Rate per hour" on labour rows), and a Remove button. When at least one row exists, the total cost field becomes read-only and shows the live sum in the user's currency.
- **History rows** show their items under the notes: description, brand and part number, quantity times unit cost, and a "Labour" tag on labour rows, wrapping on mobile.
- **Edit** on each row (active cars only) opens the form inline on that row, filled with the record's values. Date, odometer and tasks are shown as text with the "delete and record again" hint. Save, Cancel and Escape follow the MVP1-C focus rules (they return to the row's Edit button).
- **Delete** replaces "Undo service" in the history, with the same confirm step and the same void call. Focus after Delete follows the MVP1-C rule (the next older row's Delete, then the newest row's, then the section heading). After Delete, reload the history, the tasks and the odometer history, as today.
- **MVP3-A QA fixes:** (1) Edit and Delete are named "Edit the service from {{date}} at {{value}} {{distUnit}}, {{shop}}" and "Delete the service from ..." (shop is the shop name or "DIY"), with `aria-describedby` pointing at the row's tasks and cost. (2) The date-order error and its confirm checkbox appear right under the odometer field; other errors stay above Save. (3) A 409 `serviceRecord.alreadyVoided` or a 404 `serviceRecord.notFound` on Edit or Delete reloads the history and shows a short translated note in the section ("This service was already deleted."), instead of an error on a row that no longer exists.
- Strings in `en` and `he` for everything new, including every new error code (item errors name the row: "Item 2: ...").

**Acceptance criteria**

*API*
1. [BE] `POST` with two items (a part, 2 at 45.50, and labour, 1.5 hours at 200) returns `totalCost` 391.00 and both items in order; `GET` lists them.
2. [BE] `PUT` changes the shop, notes and items and recomputes the total; with empty `items` the body's `totalCost` is used. The date, odometer, linked tasks, Service reading and every task's `LastDone*` are unchanged.
3. [BE] Each item rule returns its code with the row `index`; 51 items return `serviceRecord.tooManyItems`; a sum over 1,000,000 returns `serviceRecord.invalidCost`. Nothing is saved on any error.
4. [BE] `PUT` on a voided record returns 409 `serviceRecord.alreadyVoided`; on another user's record or car, 404. The migration applies cleanly and `dotnet test` passes.

*UI*

5. [FE] Recording a service with one part and one labour row shows the live total while typing, saves, and the history row shows both items and the total in the user's currency, without a reload.
6. [FE] Edit on a row opens it filled in; changing the shop, notes and items and saving updates the row in place. Date, odometer and tasks are shown read-only with the "delete and record again" hint. Cancel and Escape discard the changes.
7. [FE] Removing every item makes the total field editable again, and the typed total is saved.
8. [FE] Delete, after confirming, removes the row, and the tasks and odometer history update without a reload. A failed delete (mocked 500) keeps the row and shows the error on it.
9. [FE] A 409 `alreadyVoided` or a 404 on Edit or Delete (mocked) reloads the history and shows the translated note; the row disappears.
10. [FE] An item error from the server shows next to its row, translated and naming the row; a failed save keeps the form open with every typed value, including all item rows.
11. [FE] The date-order error and its confirm checkbox appear directly under the odometer field, at 390px and on desktop, and stay tied to it with `aria-describedby`.
12. [FE] Two records with the same date and odometer but different shops have different Edit and Delete names; every row action is tied to its row's tasks and cost with `aria-describedby`.
13. [FE] Archived cars show items read-only (no Record, Edit or Delete).
14. [FE] Hebrew and RTL: every new string is in `en` and `he`; quantities, amounts and part numbers read correctly in RTL (`bdi` or `dir="auto"` for part numbers and free text); the Hebrew reviewer approves.
15. [FE] Mobile: at 390px there is no horizontal overflow in the item rows, the form or the history, in both languages, with a long description and part number; every button is at least 44px tall.
16. [FE] Accessibility: each item row's fields have labels that include the row number ("Item 2, quantity"); after Add part or Add labour, focus goes to the new row's description; after Remove, to the next row's description, then the previous row's, then the Add part button.
17. [BE+FE] Tests: `smoke.mjs` gains `record-service-items`, `edit-service` and `delete-service` (replacing `undo-service-from-history`), and every step passes in both setups.

**Out of scope**
- Editing a record's date, odometer or linked tasks: MVP3-D.
- Filter and search: MVP3-C.
- Attachments and receipts: blocked on the R2 credentials.
- Items on the one-tap Mark done.
- A parts catalogue, reusing items from earlier records, or parts and warranty tracking (spec 11, optional).
- Showing deleted (voided) records.
- Cost reports by category (step 5).

**Open questions:** none blocking; the rules are in decisions.md. For the owner to review: the total becoming the item sum whenever items exist (no "items plus extra" amount), and whether date, odometer and task edits (MVP3-D) are worth building or delete-and-record-again is enough.

---

### Later
- **MVP3-C:** filter and search by car, task, date and shop.
- **MVP3-D:** editing a record's date, odometer and linked tasks (moves its Service reading and recomputes the tasks' last done).
- **Car photo upload and attachments:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3): with the dashboard (step 4) or later.

## Changed since last audit
- **Signed off:** MVP3-A. The backend is in `8c82c1c`; the void-recompute fix, the frontend and all fixes are not committed yet.
- **Section 2:** "Auto-log the odometer whenever a service is recorded" went from Partial to **Done**.
- **Section 5:** "Date, odometer, shop (or DIY), total cost, notes" went from Missing to **Done**; "Edit and delete past records" went from Missing to **Partial** (delete exists as Undo; edit is missing).
- **Section 4:** Undo now works on any record, in any order, from the history.
- **Counts:** Done went from 16 to 18, Partial stayed at 6 (one out, one in), and Missing went from 28 to 26.
- **New decisions** (`docs/decisions.md`, 2026-10-15): the MVP3-A QA Lows (all three fixed in MVP3-B), the later-date, lower-odometer case (accepted), and the MVP3-B rules (line items, `TotalCost` as the item sum, Delete replacing the history's Undo, and date, odometer and tasks not editable until MVP3-D).
- **Next ticket:** MVP3-B, written in full. The MVP3-A ticket text is in git history up to `8c82c1c`.
- **Tests:** `dotnet test` grew from 189 to 221 tests, and the smoke suite from 48 to 52 steps per setup.
