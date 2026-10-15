# OnlyCars: Requirements Status

**Audit date:** 2026-10-16 (fifteenth audit, short sign-off of LOW-2, the second Low batch; not committed yet)
**Overall:** MVP steps 1 to 4 are complete apart from the car photo and attachments (both blocked on R2) and the dashboard's "Start a checklist" (waits for step 5). Next: step 5, starting with MVP5-A (checklist templates). No deployment tickets until the owner asks.

| Status | Count |
|---|---|
| Done | 24 |
| API only | 0 |
| Partial | 5 |
| Missing | 21 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (fifteenth audit, short sign-off of LOW-2 per decisions.md "Faster pipeline (owner)"; I re-ran no test suites and no browser scripts):
- Reported by other agents, not re-run by me: LOW-2 is frontend and smoke only; build and lint clean; smoke 64 of 64 in all 4 setups under both `UI_TZ=UTC` and `UI_TZ=Pacific/Kiritimati`; QA verified every item (L13 to L26) in 4 setups; the Hebrew reviewer approved `taskGone`. Fix round: code review's Medium (a stale Undo bar when Show archived is toggled during an in-flight Undo) is fixed with a smoke check, and `taskGone` now ends with "Check your selection and save again." (`client/src/i18n.ts:132,409`); QA confirmed saving again works.
- No status changes: LOW-2 polished Done bullets in spec 5 and 10.
- The notes from earlier audits are in git history.

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
| Manual odometer updates (quick-entry button on the dashboard) | **Done** | Quick entry on the car page (`CarPage.tsx:50`) and on every active dashboard card (`CarsPage.tsx:136-139`), with the date-order rules and the correction checkbox (`OdometerService.cs`, `OdometerServiceTests.cs`). After a save the card's odometer, statuses and the summary counts reload (smoke `dashboard-quick-odometer`). | Nothing. Quick entry always saves today; backdating goes through Edit, accepted. |
| Auto-log the odometer whenever a service is recorded | **Done** | Every reset logs a `Source = Service` reading linked to its record (`MaintenanceTaskService.cs:99`). A recorded service (MVP3-A, `CreateRecordAsync`, `:167`) logs one at its own date and odometer, with the date-order rules and `confirmCorrection`; voiding removes it (`:248`). Tests: `ServiceRecordTests.cs`, `ServiceHistoryTests.cs` (221 total). Browser: smoke `record-service`, `record-service-backdated` and `undo-service-from-history` in both setups; `qamvp3a-mobile-light-en-mi-10-order-error.png` shows the Service readings in the odometer history. | Nothing. |
| Optional: estimated average km/day, used to predict when tasks come due | **Partial** | `AvgKmPerDay` is computed (`OdometerService.cs:72-99`, test at `OdometerServiceTests.cs:91`) and shown on the card (`CarsPage.tsx:50-52`). | Nothing uses it for predictions yet. Tasks exist now, but a predicted due date is out of MVP2-B (decisions.md); it comes later (optional, after MVP4-A). |
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
| Line items: part name, brand, part number, quantity, unit cost, labor | **Done** | API (MVP3-B, contract `docs/contracts/MVP3-B.md`): `ServiceItem` entity (`src/OnlyCars.Domain/Entities/ServiceItem.cs:6`) and configuration (`ServiceRecordConfiguration.cs:50`); items on POST and the new PUT, validated by `ValidateItems` (`MaintenanceTaskService.cs:187,259,378`), the total computed as the item sum, `serviceItem.*` codes with the row `index`, `serviceRecord.tooManyItems` over 50. Tests: `ServiceItemTests.cs` (252 of 252 pass, run by me). UI: Add part and Add labour rows in the Record and Edit forms, labour rows labelled Hours and Rate per hour, a live read-only total (`ServiceHistory.tsx:234-239,278-325`); items on history rows with a Labour tag (`:413-425`). Strings in en and he. Browser: smoke `record-service-items`, 54 of 54 in both setups (run by me); `mobile-dark-he-38-record-service-items.png`; QA `qa-mvp3b.mjs` in 4 setups. | Nothing. The 50-item cap is covered by backend tests only, not in the UI. |
| Attachments: receipt photos, PDFs, invoices | **Missing** | none | Everything |
| Filter and search by car, task, date or shop | **Done** | MVP3-C: `GET /api/service-records` with `vehicleId`, `taskId`, `from`, `to`, `q`, `skip`, `take`, returning `items`, `totalCount`, `totalCost` (`MaintenanceTasksController.cs:47`, `MaintenanceTaskService.cs:176`; contract `docs/contracts/MVP3-C.md`). Tests: `ServiceRecordSearchTests.cs` (279 of 279, reported). UI: a `/history` page linked from the header (`App.tsx:38,51`, `HistoryPage.tsx`) with car, task, date range and search filters kept in the URL, a count and total summary, and Show more; a "Search all history" link on the car page (`ServiceHistory.tsx:93`). Strings in en and he. Browser: smoke `history-page`, `history-filter`, `history-empty` (57 of 57 in both setups, reported); QA `qa-mvp3c.mjs` and `qa-mvp3c-more500.mjs` in 4 setups. | Nothing for this bullet. Five Lows are in the backlog (L1 to L5). The search does not cover task names (the task select does). |
| Edit and delete past records | **Done** | MVP3-D (`571f89d`, `74284b5`; contract `docs/contracts/MVP3-D.md`): the same PUT now also takes optional `date`, `odometerKm`, `taskIds` and `confirmCorrection`, moves the record's Service reading, recomputes the car's odometer and average and the tasks' last done, and returns `{record, tasks}` (302 of 302 tests, reported). UI: the Edit form's date, odometer and task checkboxes are editable with the Record form's validation (`ServiceHistory.tsx:256,260`); smoke 59 of 59 in both setups (reported) with `edit-service-date-odometer` and `edit-service-tasks`; QA in 4 setups. Earlier, MVP3-B: `PUT .../service-records/{recordId}` edits shop, total cost, notes and items without touching the date, odometer, readings or tasks (`MaintenanceTasksController.cs:51`, `MaintenanceTaskService.cs:250-273`; 409 on voided, 404 on another user's). UI: Edit opens the row inline with date, odometer and tasks read-only and the "delete and record again" hint; Delete (the void, `ServiceHistory.tsx:430-443`) replaces the history's Undo; a 409 or 404 reloads the list with a translated note (`mobile-dark-he-39-edit-service.png`). Smoke `edit-service` and `delete-service` pass in both setups. | Nothing for this bullet. Moving a record to another car is not allowed (decisions.md). Lows L7 to L12 are in the backlog. |

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
| Checklist templates | **Missing** | none | Everything. Next: MVP5-A |
| Items: checkbox, numeric or text | **Missing** | none | Everything. Next: MVP5-A |
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
| All cars at a glance, next due items sorted by urgency | **Done** | The dashboard on `/` shows one card per active car in the server's urgency order, each with its Overdue and Due soon counts and its next 3 enabled tasks with status and remaining km or days (`CarsPage.tsx:116-165`; API `MaintenanceTasksController.cs:52`; `DashboardTests.cs`). Smoke `dashboard-summary` in 4 setups. | Nothing. |
| Overdue count and monthly spend summary | **Done** | The summary shows the Overdue and Due soon counts and this month's spend with the record count, linking to `/history` for the same dates so the totals match (`CarsPage.tsx:99-105`; `DashboardTests.cs`). Smoke `dashboard-summary`. | Nothing. |
| Quick actions: update odometer, reset a task, start a checklist | **Partial** | Quick odometer entry and one-tap Mark done with Undo on each card (`CarsPage.tsx:136-160`); smoke `dashboard-quick-odometer` and `dashboard-mark-done`. | "Start a checklist", which needs checklists (spec 7, step 5). |

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
- Done (MVP3-B): `ServiceItem` with all spec fields plus `SortOrder` and `CreatedAt`, cascading from `ServiceRecord` (`ServiceRecordConfiguration.cs:50`).
- Not started: `Attachment` (blocked on R2) and the rest of Part 2.
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Complete for the MVP. MVP1-A, MVP1-B, MVP1-C, SET-1 and SET-2 are signed off.** Working end to end in EN and HE: register (with currency) and login; add, edit, archive and unarchive cars; quick odometer entry; edit and delete readings with the date-order rules and recompute; focus and page titles on every route; Settings with language, theme, currency and km or miles. Remaining: the car photo (blocked until the R2 credentials exist). |
| 2. Tasks, templates, km/time intervals, Reset | **Complete. MVP2-A, MVP2-B and MVP2-C are signed off.** All of spec sections 3 and 4 is done: tasks and templates, status with remaining km and days and a progress bar, the due-soon threshold, one-tap Mark done with optional cost and notes, and Undo. |
| Deploy gate | **SEC-1 signed off.** Nothing else blocks a first deploy except the owner's Azure account. The owner said not to deploy yet (decisions.md, 2026-10-15, "When to deploy"), so no deployment tickets are queued. |
| 3. Service history with costs | **Complete apart from attachments (blocked on R2). MVP3-A, MVP3-B, MVP3-C and MVP3-D are signed off.** Working end to end in EN and HE: the service history on `/cars/:id`, recording a past service (date, odometer, shop or DIY, cost, notes, several tasks, parts and labour) with the date-order rules, editing everything on a record (shop, cost, notes, items, date, odometer and tasks, with the car's odometer and the tasks' last done following), deleting any record, and a `/history` page that filters and searches all cars. LOW-1 (the first Low batch) is signed off too. |
| 4. Dashboard with due/overdue status | **Complete apart from "Start a checklist" (waits for step 5). MVP4-A and LOW-2 are signed off.** The dashboard on `/`: overdue and due-soon counts, this month's spend linking to `/history`, and per-car cards with the next 3 tasks, one-tap Mark done with Undo, and quick odometer entry, in EN and HE. |
| 5. Checklists, tires, reports, notifications | Not started. Checklists are split into MVP5-A (templates and items, next), MVP5-B (attach to a car with a schedule, run, run history, the dashboard's "Start a checklist") and MVP5-C (a flagged item creates a maintenance task) (decisions.md, "Checklists scope and split, step 5"). |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP5-A: checklist templates and items (spec 7 bullets 1 and 2) | BE, then FE | **Next** (written below) |
| 2 | MVP5-B: attach to a car with a schedule, run a checklist, run history, the dashboard's "Start a checklist" | BE, then FE | After MVP5-A |
| 3 | MVP5-C: a flagged item creates a maintenance task | BE, then FE | After MVP5-B |
| 4 | LOW-3: the Low backlog (L27 onwards) | BE and FE | After MVP5-C |

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
- **MVP3-B (backend commit `bcfc683`; the backend review fixes, the frontend and all review and QA fixes are not committed yet): signed off 2026-10-15.** All 17 criteria met.
  - Evidence: 252 of 252 tests (I ran them), 31 more than before, mostly in `ServiceItemTests.cs`, including the check order and the ignored body total when items exist. Smoke 54 of 54 in both setups (I ran it), with the new steps `record-service-items`, `edit-service` and `delete-service` (replacing `undo-service-from-history`). UI QA in 4 setups passed every [FE] criterion; its Medium (Hebrew item amounts laid out LTR) and two Lows (a stale item number after removing a row; the edit form left open after a gone response) are fixed and covered by smoke. Code review fixes are in (`AsSplitQuery`, which added a `Microsoft.EntityFrameworkCore.Relational` reference to `OnlyCars.Application` at Infrastructure's version; accepted). The Hebrew review approved with no changes.
  - The three MVP3-A QA Lows are fixed here (row action names, the date-order error under the odometer field, a 409 or 404 reloading the list).
  - QA's remaining Low (several identical DIY services on one day get the same Edit and Delete names) is accepted (decisions.md, "MVP3-B QA Low").
  - Not tested: the 50-item cap in the UI, and a real screen reader (a pre-launch check, per decisions.md "MVP2-C QA notes").

- **MVP3-C (backend commit `65c74e1`; the backend review fix and the frontend are not committed yet): signed off 2026-10-15, on condition QA's Medium fix lands** (a failed Show more must show its error next to the button). Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: 279 of 279 tests (the review fix shares one order helper between the car page and `/history`, +2 tests); smoke 57 of 57 in both setups with the new `history-page`, `history-filter` and `history-empty` steps; code review approved; the Hebrew review approved with one wording fix; UI QA in 4 setups passed every [FE] criterion.
  - QA's five Lows are in the Low issues backlog (L1 to L5). The condition (QA's Medium) is met: the fix landed in `0ce8048`.
- **MVP3-D (commits `571f89d`, `74284b5`): signed off 2026-10-15.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: 302 of 302 tests; smoke 59 of 59 in both setups with the new `edit-service-date-odometer` and `edit-service-tasks` steps; UI QA in 4 setups passed every [FE] criterion with no High or Medium. No new UI strings, so no Hebrew review.
  - Code review's one High (editing a record broke the snapshot chain, so a later void restored a value no record holds) is fixed in `74284b5` with 6 tests, 4 of which fail on the old code.
  - The ticket's `task.notFound` is `maintenanceTask.notFound` in the API, as on POST; accepted as a decision, not a fix (decisions.md, "MVP3-D review and QA Lows").
  - QA's and the engineers' Lows are in the backlog (L7 to L12).

- **LOW-1 (not committed yet): signed off 2026-10-15.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Fixed, all on the frontend: L1 (stale summary after a failed filter change), L2 ("To date" wrap at 1280px), L3 (Hebrew summary amount format), L4 (archived car name cut at 390px), L5 (tasks request racing the car list), L6 (Hebrew quantity wording, approved by the Hebrew reviewer), L7 (translated future-date message), L8 (task list reloaded after `maintenanceTask.notFound` on Edit), L9 ("Record a service" during Edit), L11 (`qa-mvp3b.mjs` reads `{record, tasks}`). L10 is documented in the MVP3-A and MVP3-D contracts. L12 was decided earlier and is closed.
  - Reported evidence: smoke 59 of 59 in both setups; QA in 4 setups passed every item plus the MVP3-B, C and D regression scripts; code review approved, with its one Medium fixed at `HistoryPage.tsx:220`.
  - L10's finding (same-date readings ordered by save time) was decided as a change to order by value, built in MVP4-A (B0) and later reverted. The leftover Lows are L13 to L16 in the backlog; one review nit is accepted (decisions.md, "LOW-1 leftover Lows").

- **MVP4-A (backend commit `05f17c0`; the frontend is not committed yet): signed off 2026-10-16.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: 312 of 312 tests; build and lint clean; smoke 62 of 62 in all 4 setups (UTC browser timezone) with the new `dashboard-summary`, `dashboard-mark-done` and `dashboard-quick-odometer` steps; the Hebrew reviewer approved every string unchanged; UI QA passed with Lows only; code review's one Medium (a failed Retry moved focus to the `h1`) is fixed with a smoke check.
  - AC1 is signed off as changed: B0 (same-date readings by value) was reverted and the save-time order stays (decisions.md, "Same-date odometer readings, revised").
  - Decided (decisions.md, "MVP4-A sign-off"): a card's tasks re-sort by urgency after Mark done and focus follows (kept); "No tasks yet" links to `/cars/:id` (accepted).
  - The review and QA Lows are L17 to L26 in the backlog.

- **LOW-2 (not committed yet): signed off 2026-10-16.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Fixed, frontend and smoke only: L13 to L26 (the rows are in this file's git history up to `1de85aa`).
  - Reported evidence: build and lint clean; smoke 64 of 64 in all 4 setups under `UI_TZ=UTC` and `UI_TZ=Pacific/Kiritimati`; QA verified every item in 4 setups (`client/ui-tests/qa-low2.mjs`, `qa-low2-offline.mjs`); the Hebrew reviewer approved `taskGone`.
  - Fix round: code review's Medium M1 (a stale Undo bar when Show archived is toggled during an in-flight Undo) is fixed with a smoke check; `taskGone` now tells the user to check the selection and save again, and QA confirmed that works.
  - Accepted (decisions.md, "LOW-2 sign-off"): L23 reuses the existing translated error strings. The new Lows are L27 to L36.

## Low issues backlog

Every Low finding from QA and review lands here (decisions.md, "Faster pipeline (owner)"). They are fixed together in a batch ticket LOW-n about every 3 tickets. LOW-1 closed L1 to L12; LOW-2 closed L13 to L26 (all fixed). LOW-3 takes what is below.

| # | From | Issue | Area |
|---|---|---|---|
| L27 | LOW-2 review | A failed dashboard reload after a successful Undo drops focus to `body`: the error branch still runs the `then` (`client/src/pages/CarsPage.tsx:36`). | FE, `/` |
| L28 | LOW-2 review | After `taskGone`, a failed car reload replaces the whole page, including the open edit form (`ServiceHistory` `onTaskGone` calls the `CarPage` load). Keep the form, or at least add a `shortcut:` comment. | FE, `/cars/:id` |
| L29 | LOW-2 review | A dashboard card's archive error is not cleared on reload, unlike the L24 row errors. | FE, `/` |
| L30 | LOW-2 review | Archive can be sent twice: `onArchived` is not awaited, so the button is enabled again too early. | FE, `/` |
| L31 | LOW-2 review (pre-existing) | Focus goes to `body` after a successful archive while Show archived is off (the card disappears). | FE, `/` |
| L32 | LOW-2 review | (a) `CarsPage.tsx:30` needs a one-line comment saying why the `then` exists (N2). (b) Any other load that starts during an in-flight Undo can still bring back a stale Undo bar; only Show archived is handled (M1). Fix once, for every load path. | FE, `/` |
| L33 | LOW-2 QA | Car page Undo leaves focus on `body` for one frame: `TasksSection.tsx` (~109) moves focus in `useEffect`, the dashboard in `useLayoutEffect`. Use `useLayoutEffect` there too. | FE, `/cars/:id` |
| L34 | LOW-2 QA | Two simultaneous void requests on one service record give one 500 instead of a 409 `serviceRecord.alreadyVoided` (concurrency; no data damage). | BE |
| L35 | LOW-2 QA | Stale QA scripts: `qa-mvp3a.mjs` clicks the removed `button.undo-service` (update or retire it); `qa-mvp4a.mjs`'s offline check aborts only one request, but StrictMode sends two (`qa-low2-offline.mjs` shows the app is fine); `qa-low2.mjs` still has a debug log. | QA scripts |
| L36 | LOW-2 engineer | A new car's first reading is dated with the server's UTC date (`src/OnlyCars.Application/Vehicles/VehicleService.cs:71`), other readings with the client's local date, so avg km/day can be one day off near midnight (smoke works around it). Use the client's local date, as decided for quick-add (2026-10-15). | BE + FE |

## Next ticket

### MVP5-A: Checklist templates and items

**Goal:** As a user, I can create my own inspection checklists (for example "Monthly quick check" or "Pre-road-trip"), each a named, ordered list of items that are a checkbox, a number with an optional unit and range, or a text note, and edit, reorder or delete them, so they are ready to run on my cars.

**Spec:** section 7 bullets 1 ("Checklist templates") and 2 ("Items: checkbox, numeric or text"); Part 2 "Checklists" (`ChecklistTemplate`, `ChecklistTemplateItem`); section 12 (Hebrew and English, mobile).

**Binding decisions:** decisions.md "Checklists scope and split, step 5", "Checklist template rules, MVP5-A", "Faster pipeline (owner)", the MVP1-C focus and Escape rules, "Destructive actions and page titles".

**Scope**

*Backend (backend-engineer, runs first and publishes `docs/contracts/MVP5-A.md`):*
- Entities `ChecklistTemplate` (`UserId`, `Name`) and `ChecklistTemplateItem` (`TemplateId`, `Label`, `Type` Check/Number/Text, `Unit` nullable, `MinValue` nullable, `MaxValue` nullable, `SortOrder`), each with `Id`, `CreatedAt`, `UpdatedAt`. Items cascade from their template. `MinValue`/`MaxValue` as `decimal(12,2)`. An EF configuration and a migration. No `VehicleChecklist`, runs or seed data yet.
- Endpoints, all scoped to the signed-in user (another user's template is a 404):
  - `GET /api/checklist-templates`: the user's templates, ordered by name then creation time, each with its id, name, item count and items.
  - `GET /api/checklist-templates/{id}`: one template with its items in `SortOrder`.
  - `POST /api/checklist-templates`: `{ name, items: [{ label, type, unit, minValue, maxValue }] }`; returns the created template (201).
  - `PUT /api/checklist-templates/{id}`: same body; each item may carry `id`. An item with an `id` of this template is updated in place, one without an `id` is created, and items of the template missing from the list are deleted. `SortOrder` is the array position. An `id` that belongs to another template is a 400.
  - `DELETE /api/checklist-templates/{id}`: hard delete (204).
- Validation (translated error codes, the existing error shape): name 1 to 100 after trim (`checklistTemplate.invalidName`); at most 100 templates per user (`checklistTemplate.tooMany`); 0 to 50 items (`checklistTemplate.tooManyItems`); label 1 to 100 after trim (`checklistItem.invalidLabel`); type one of Check, Number, Text (`checklistItem.invalidType`); unit up to 20 after trim, empty becomes null (`checklistItem.invalidUnit`); min and max each -1,000,000 to 1,000,000 with at most 2 decimals, min not above max (`checklistItem.invalidRange`); unit, min and max on a Check or Text item are a 400 (`checklistItem.numberOnly`).
- Tests in `tests/OnlyCars.Tests`: CRUD, ownership (another user's template is a 404 on every endpoint), each validation code with its boundary, the in-place update keeping item ids, reorder, delete-missing, a foreign item id rejected, and cascade delete.

*Frontend (frontend-engineer, builds against the contract):*
- A **Checklists** link in the header and a `/checklists` page (page `h1` and `document.title` as on every route) listing the templates by name, each with its item count and **Edit** and **Delete** buttons, plus **New checklist**.
- A template form (inline or on `/checklists/new` and `/checklists/:id`, the engineer's choice, following the existing car form or edit patterns): the name, and an item list where each row has a label, a type select (Checkbox (OK / Not OK), Number, Text), and for Number only the unit, min and max fields. Rows can be added, removed, and moved up and down with buttons (no drag and drop). Save sends the whole list; Cancel and Escape discard.
- Delete asks for confirmation with the red `--danger` confirm button, as on other deletes.
- All new text in `en` and `he` in `client/src/i18n.ts`, with every new error code translated.
- Smoke steps in `client/ui-tests/smoke.mjs`: `checklists-empty`, `checklist-create` (three items, one of each type, Number with unit and range), `checklist-edit` (reorder, rename an item, remove one, add one), `checklist-delete`.

**Acceptance criteria**
1. [BE] The five endpoints work as in the contract; another user's template is a 404 on GET, PUT and DELETE; every validation rule returns its code with a 400, and the limits are tested at their boundaries.
2. [BE] PUT updates items in place: an item kept in the list keeps its `id`, a new one gets a new `id`, a missing one is deleted, and the order follows the array. A foreign item `id` is a 400 and changes nothing.
3. [BE] Deleting a template deletes its items; `dotnet test` passes in full.
4. [FE] From the header, a user opens Checklists, creates "Monthly quick check" with a Checkbox item, a Number item "Tire pressure" with unit "bar", min 2.0 and max 2.6, and a Text item; after a reload the template and its items are there in the same order.
5. [FE] Editing a template can rename it, change an item's label or type, reorder items with the up and down buttons, remove an item and add one; Save keeps the result after a reload. Changing a Number item to Checkbox or Text clears and hides its unit, min and max.
6. [FE] Unit, min and max are shown only for Number items; min above max, a value out of range and an empty name or label show a translated message next to the field, and nothing is saved.
7. [FE] Delete asks for confirmation; after it the template is gone from the list and focus follows the MVP1-C rules (next row's Edit, else New checklist).
8. [FE] Empty state: with no templates the page says so and offers New checklist. Loading shows the existing loading pattern; a failed load shows a translated error with Retry; a failed save keeps the form and what was typed and shows a translated error.
9. [FE] Hebrew and RTL: every new string is in `he`, the Hebrew reviewer approves them, the layout mirrors, and numbers (2.6) and units read correctly in RTL.
10. [FE] Mobile: at 390px there is no horizontal overflow, item rows stack cleanly, and every button (including move up and down and remove) is at least 44px; each item's controls have accessible names that include the item number or label. Dark mode works.
11. [FE] Focus: on open, focus goes to the name field; after adding an item, to its label; after Save, to the template's Edit button in the list; Escape cancels the form like Cancel.
12. [BE+FE] No regressions: build and lint clean; smoke passes in all 4 setups with the four new steps; QA covers 4 setups.

**Out of scope:** attaching a template to a car, schedules, `VehicleChecklist`, running a checklist, run history and flags (MVP5-B); creating tasks from flagged items (MVP5-C); photos (R2); starter checklists (decisions.md: none seeded for now); the dashboard's "Start a checklist" (MVP5-B); drag-and-drop reordering; any change to the Low backlog items.

**Open questions:** none. The choices are recorded in decisions.md ("Checklists scope and split, step 5" and "Checklist template rules, MVP5-A"). The owner may want starter checklists later; that is noted in the decision, not asked now.

---

### Later
- **MVP5-B:** attach a checklist template to a car with a schedule (km, days or manual only), its due status, run a checklist (tick, values, notes, flags; Number items auto-flag outside Min/Max, Check items flag on Not OK), run history per car, and the dashboard's "Start a checklist". A run's reading uses `OdometerReading.Source = Checklist`.
- **MVP5-C:** a flagged item creates a maintenance task. Then tires, reports and notifications.
- **Car photo upload, attachments and run photos:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3, optional).

## Changed since last audit
- **Signed off:** LOW-2 (not committed yet). L13 to L26 fixed; L23's reuse of existing error strings accepted.
- **Counts:** unchanged (Done 24, Partial 5, Missing 21, Deferred 7).
- **Backlog:** L27 to L36 added (LOW-2 review, QA and engineer). Two touch the backend (L34, L36).
- **New decisions** (`docs/decisions.md`, 2026-10-16): "LOW-2 sign-off", "Checklists scope and split, step 5", "Checklist template rules, MVP5-A", "'Manual only' checklist schedule vs the spec's check constraint".
- **Next ticket:** MVP5-A, written in full. The LOW-2 ticket text is in git history up to `1de85aa`.
