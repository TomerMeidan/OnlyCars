# OnlyCars: Requirements Status

**Audit date:** 2026-10-15 (thirteenth audit, short sign-off of LOW-1, the first Low batch; not committed yet)
**Overall:** MVP steps 1 to 3 are complete apart from the car photo and attachments (both blocked on R2), and the first Low batch (L1 to L12) is closed. Next: MVP4-A (dashboard), which also orders same-date readings by value. No deployment tickets until the owner asks.

| Status | Count |
|---|---|
| Done | 21 |
| API only | 0 |
| Partial | 5 |
| Missing | 24 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (thirteenth audit, short sign-off per decisions.md "Faster pipeline (owner)"; I re-ran no test suites and no browser scripts):
- Reported by other agents, not re-run by me: smoke 59 of 59 in both setups (re-run after the last fix); UI QA in 4 setups passed every LOW-1 item plus the regression scripts `qa-mvp3b.mjs`, `qa-mvp3c*.mjs` and `qa-mvp3d.mjs`; the Hebrew reviewer approved L6; code review approved, and its one Medium (Show more still offered while rows are stale after a failed filter change, which would mix two filters) is fixed (`client/src/pages/HistoryPage.tsx:220`, `!stale &&`). No backend code changed, so `dotnet test` was not needed.
- L10 found that the date-order check orders same-date readings by save time, not by value as the ticket assumed. The contracts now describe the code (`docs/contracts/MVP3-A.md:59`, `docs/contracts/MVP3-D.md:56`). Decided: order by value (decisions.md, "Same-date odometer readings"), built in MVP4-A's backend part B0.
- No requirement changed status: LOW-1 polishes bullets that were already Done.
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
| All cars at a glance, next due items sorted by urgency | **Missing** | The car list (`CarsPage.tsx`) shows every car, but there are no due items. | Everything except the car list. MVP4-A is next. |
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
| 4. Dashboard with due/overdue status | Not started. **Next: MVP4-A** (written below): a dashboard on `/` with overdue and due-soon counts, this month's spend, and per-car next tasks with Mark done and quick odometer entry. "Start a checklist" waits for step 5. |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP4-A: Dashboard (spec 10), plus B0 same-date reading order | BE, then FE | **Next** (written below) |
| 2 | LOW-2: the Low issues backlog (L13 onward) | FE | About 3 tickets after LOW-1 |

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
  - L10's finding (same-date readings ordered by save time) is decided as a change to order by value, built in MVP4-A (B0). The leftover Lows are L13 to L16 in the backlog; one review nit is accepted (decisions.md, "LOW-1 leftover Lows").

## Low issues backlog

Every Low finding from QA and review lands here (decisions.md, "Faster pipeline (owner)"). They are fixed together in a batch ticket LOW-n about every 3 tickets. LOW-1 closed L1 to L12; LOW-2 takes what is below.

| # | From | Issue | Area |
|---|---|---|---|
| L13 | LOW-1 QA | After a `maintenanceTask.notFound` on Edit, the car page's Maintenance list still shows the deleted task until reload (the Edit form's checkboxes are already reloaded by L8). | FE, `/cars/:id` |
| L14 | LOW-1 QA | "This task was not found." is vague. Say the task was deleted and the list has been updated, in en and he. | FE, en and he |
| L15 | LOW-1 QA | If the first `/history` load fails with a valid `vehicleId` in the URL, the Task select stays empty until Retry (an L5 side effect). | FE, `/history` |
| L16 | LOW-1 review | `ServiceHistory.tsx` ~253-256: the `future` handler sits between a comment and the code the comment describes. | FE, code tidy |

## Next ticket

### MVP4-A: Dashboard with due and overdue status (spec 10), plus same-date reading order

**Goal:** When I open the app I see, for all my cars at once, what is overdue or due soon and what I spent this month, and I can update an odometer or mark a task done right there.

**Spec:** section 10 (Dashboard), section 2 ("quick-entry button on the dashboard"), section 4 (status, Reset), Part 2 "How Reset works" and "Status is never stored". MVP step 4.

**Binding decisions:** decisions.md "Dashboard, MVP4-A", "Same-date odometer readings", "Task status rules, MVP2-B", "Reset / Mark as done, MVP2-C", "Quick-add reading date", "Backdated service records, MVP3-A", "Filter and search, MVP3-C", the SET-1 and SET-2 settings rules (currency, km or miles), the MVP1-C focus rules.

**Scope**

*Backend (backend-engineer). Runs first and publishes `docs/contracts/MVP4-A.md`.*
- **B0, same-date reading order:** every date-order check (`POST` and `PUT .../odometer`, service record `POST` and `PUT`) orders readings by (`ReadingDate`, `OdometerKm`, save time) instead of (`ReadingDate`, save time). The vehicle's `CurrentOdometerKm` is the highest reading on the latest date; recompute it (and `AvgKmPerDay`) by the same order wherever it is recomputed today. Update the "Date order on the same date" paragraphs in `docs/contracts/MVP3-A.md:59` and `docs/contracts/MVP3-D.md:56` to the new rule and remove their "Mismatch" notes. No schema change.
- **B1, `GET /api/dashboard?today=YYYY-MM-DD`:** `today` is the client's local date, optional, accepted within UTC today plus or minus 1 day (as on reset), otherwise 400 `dashboard.invalidDate`; it defaults to UTC today and only sets the spend month. Returns:
  - `overdueCount`, `dueSoonCount`: enabled tasks of the user's non-archived vehicles, by `TaskStatusCalculator` with the server's UTC date (the same as `GET .../tasks`).
  - `month` (`"YYYY-MM"`), `monthTotalCost` (sum of `ServiceRecord.TotalCost`, null counts as 0), `monthServiceCount`: non-voided records of all the user's vehicles, archived included, with `Date` from the first of that month to `today`; these must equal `GET /api/service-records?from=<first of month>&to=<today>`'s `totalCount` and `totalCost`.
  - `vehicles`: the user's non-archived vehicles, each with `id`, `nickname`, `make`, `model`, `year`, `currentOdometerKm`, `overdueCount`, `dueSoonCount`, and `tasks`: its enabled tasks as `MaintenanceTaskDto`, in urgency order (Overdue, Due soon, OK; within a status by `progress` descending; then by name). Vehicles are ordered by their first task's urgency, then by nickname; vehicles with no enabled tasks come last.
  - Only the caller's data; 401 without a token. A fixed number of queries, not one per vehicle.
- Tests: B0 (two same-date readings where the higher one was saved first: a reading between them is accepted; a record edited onto that date is checked against the lower and the higher by value; the current odometer is the highest on the latest date) and B1 (counts, order, an archived car left out of counts and `vehicles` but in the spend, voided records left out, month edges, `today` out of range, another user's data never appears).

*Frontend (frontend-engineer). Builds against the contract.*
- `/` (today `CarsPage.tsx`) becomes the dashboard, with the page title "Dashboard" in en and he.
- A summary block: "N overdue", "N due soon" and "This month: X (N services)" using the rows' currency formatter; the month figure links to `/history?from=…&to=…`. Zero states read naturally ("Nothing overdue").
- One card per active car, in the server's order: nickname (links to `/cars/:id`), current odometer in the user's unit, the existing quick odometer entry (local date, as now), the car's Overdue and Due soon counts, and its first 3 tasks with name, status badge, remaining km (in the user's unit) or days, and a one-tap **Mark done** using the existing `POST .../tasks/{taskId}/reset` (no cost or notes on the dashboard). After it, the row shows Undo, as on the car page. "All tasks (N)" links to the car page. A car with no enabled tasks shows "No tasks yet" with a link to its task section.
- After a quick odometer entry, a Mark done or an Undo, reload the dashboard data so the counts, order and statuses follow.
- "Show archived" and the archived car list work as now (no tasks on archived cars). With no cars, the empty state stays "Add your first car".
- Reuse the car page's status badge, remaining text and urgency sort (`TasksSection.tsx:100`) rather than copying them.

**Acceptance criteria**
1. [BE] B0: same-date readings are ordered by value, then save time, in every date-order check; the current odometer is the highest reading on the latest date; the two contracts state the new rule with no "Mismatch" note; tests cover it.
2. [BE] B1: `GET /api/dashboard` returns the fields above; counts and spend match `GET .../tasks` and `GET /api/service-records` for the same data; archived vehicles are left out of counts and `vehicles` but their records are in the spend; voided records and disabled tasks never count; `today` outside UTC plus or minus 1 day returns 400 `dashboard.invalidDate`; another user's data never appears; 401 without a token.
3. [FE] Opening `/` shows the summary and one card per active car in the server's order, each with up to 3 tasks showing status and remaining value, in en and he.
4. [FE] The month spend uses the same format as `/history` amounts (including the Hebrew format from L3), and its link opens `/history` with this month's dates showing the same count and total.
5. [FE] Mark done on a dashboard task resets it (its remaining value restarts and the counts drop); Undo restores it; focus follows MVP1-C (it moves to the row's Undo, then back to Mark done).
6. [FE] A quick odometer entry on a card updates that card's odometer and statuses and the summary counts without a full page reload.
7. [FE] With miles selected, odometers and remaining distances show in miles; with km, in km.
8. [FE] States: loading shows a placeholder without layout jumps; a failed dashboard load shows a translated error with Retry; a failed Mark done or quick entry shows its error on that card and keeps the rest of the page; no cars shows the existing "Add your first car"; a car with no tasks shows "No tasks yet".
9. [FE] Hebrew and RTL: every new string is in `en` and `he` in `i18n.ts` and approved by the Hebrew reviewer; badges, numbers and links read correctly right to left.
10. [FE] Mobile: at 390px the summary and cards stack, there is no horizontal overflow, and Mark done, Undo and the quick entry controls are at least 44px tall; it also works in dark mode.
11. [BE+FE] No regressions: `dotnet test` passes; smoke passes in both setups with the new steps `dashboard-summary`, `dashboard-mark-done` and `dashboard-quick-odometer`; the car page and `/history` behave as before.

**Out of scope:** "Start a checklist" (needs checklists, step 5; the spec 10 quick-actions bullet stays Partial until then); cost or notes on a dashboard Mark done (use the car page); the predicted due date from `AvgKmPerDay` (spec 2.3); charts and reports (spec 8); notifications (spec 9); the LOW-2 backlog; deployment.

**Open questions:** none. The choices are recorded in decisions.md ("Dashboard, MVP4-A" and "Same-date odometer readings") for the owner to review on return.

---

### Later
- **LOW-2:** the Low backlog (L13 onward), about 3 tickets after LOW-1.
- **Step 5:** checklists first (spec 7), which also completes the dashboard's "Start a checklist" quick action; then tires, reports and notifications.
- **Car photo upload and attachments:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3, optional): after MVP4-A.

## Changed since last audit
- **Signed off:** LOW-1 (not committed yet): L1 to L11 fixed or documented, L12 closed.
- **Counts:** unchanged (Done 21, Partial 5, Missing 24, Deferred 7); LOW-1 polished bullets that were already Done.
- **Backlog:** L1 to L12 cleared; L13 to L16 added from LOW-1.
- **New decisions** (`docs/decisions.md`, 2026-10-15): "Same-date odometer readings" (order by value, built in MVP4-A B0), "LOW-1 leftover Lows", "Dashboard, MVP4-A".
- **Next ticket:** MVP4-A, written in full. The LOW-1 ticket text is in git history up to `ceb41e2`.
