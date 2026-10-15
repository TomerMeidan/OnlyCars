# OnlyCars: Requirements Status

**Audit date:** 2026-10-15 (tenth audit, sign-off of MVP3-B: backend commit `bcfc683`, plus the backend review fixes, the frontend and all review and QA fixes, which are not committed yet on `main`)
**Overall:** MVP steps 1 and 2 are complete, and step 3 is well along: a user can record a service with parts and labour, edit its shop, cost, notes and items, and delete it from the history. Step 3 still lacks filter and search, editing a record's date, odometer and tasks, and attachments. Next is MVP3-C (filter and search). No deployment tickets until the owner asks (decisions.md, "When to deploy").

| Status | Count |
|---|---|
| Done | 19 |
| API only | 0 |
| Partial | 6 |
| Missing | 25 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (tenth audit):
- Both dev servers were already running (API PID 5596 on 5150, started 17:57:30; Vite PID 12136 on 5173), and I left them running. The API started after the last backend edit (`MaintenanceTaskService.cs`, 17:56:08), so it runs the uncommitted review fixes.
- `dotnet test`: 252 of 252 pass (I ran it).
- `node ui-tests/smoke.mjs`: 54 of 54 steps pass in both setups (I ran it). The 15 console errors per setup are the 400 and 404 responses the error steps provoke on purpose.
- Screenshots I read: `mobile-dark-he-38-record-service-items.png` (390px, Hebrew, dark: a record with a part and a labour row, a long unspaced description and part number wrapping, the labour tag, the total 391.00) and `mobile-dark-he-39-edit-service.png` (the edited row and the "already deleted" note).
- Code read: `client/src/pages/ServiceHistory.tsx` (live total `:234`, item add and remove with focus `:237-239`, the Edit and Delete names with `aria-describedby` on tasks and cost `:388,430-432`, the void call `:443`), `MaintenanceTasksController.cs:51-55` (PUT and void), `MaintenanceTaskService.cs:187,259,378` (items validated on POST and PUT), `ServiceRecordConfiguration.cs:50` (`ServiceItem`), `i18n.ts:129-130,369-370`.
- Reported by other agents, not re-run by me: QA in 4 setups passed every [FE] criterion (its Medium and two Lows are fixed and covered by smoke); code review fixes are in; the Hebrew review approved with no changes; build and lint pass. Not tested by anyone: the 50-item cap in the UI, a real screen reader.
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
| Line items: part name, brand, part number, quantity, unit cost, labor | **Done** | API (MVP3-B, contract `docs/contracts/MVP3-B.md`): `ServiceItem` entity (`src/OnlyCars.Domain/Entities/ServiceItem.cs:6`) and configuration (`ServiceRecordConfiguration.cs:50`); items on POST and the new PUT, validated by `ValidateItems` (`MaintenanceTaskService.cs:187,259,378`), the total computed as the item sum, `serviceItem.*` codes with the row `index`, `serviceRecord.tooManyItems` over 50. Tests: `ServiceItemTests.cs` (252 of 252 pass, run by me). UI: Add part and Add labour rows in the Record and Edit forms, labour rows labelled Hours and Rate per hour, a live read-only total (`ServiceHistory.tsx:234-239,278-325`); items on history rows with a Labour tag (`:413-425`). Strings in en and he. Browser: smoke `record-service-items`, 54 of 54 in both setups (run by me); `mobile-dark-he-38-record-service-items.png`; QA `qa-mvp3b.mjs` in 4 setups. | Nothing. The 50-item cap is covered by backend tests only, not in the UI. |
| Attachments: receipt photos, PDFs, invoices | **Missing** | none | Everything |
| Filter and search by car, task, date or shop | **Missing** | none | Everything |
| Edit and delete past records | **Partial** | MVP3-B: `PUT .../service-records/{recordId}` edits shop, total cost, notes and items without touching the date, odometer, readings or tasks (`MaintenanceTasksController.cs:51`, `MaintenanceTaskService.cs:250-273`; 409 on voided, 404 on another user's). UI: Edit opens the row inline with date, odometer and tasks read-only and the "delete and record again" hint; Delete (the void, `ServiceHistory.tsx:430-443`) replaces the history's Undo; a 409 or 404 reloads the list with a translated note (`mobile-dark-he-39-edit-service.png`). Smoke `edit-service` and `delete-service` pass in both setups (run by me). | Editing a record's date, odometer and linked tasks (MVP3-D). Today the user deletes and records again. |

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
| 3. Service history with costs | **In progress. MVP3-A and MVP3-B are signed off.** Working end to end in EN and HE: the service history on `/cars/:id`, recording a past service (date, odometer, shop or DIY, cost, notes, several tasks, parts and labour) with the date-order rules, editing shop, cost, notes and items, and deleting any record. **Next: MVP3-C** (filter and search on a new `/history` page), then MVP3-D (editing date, odometer and tasks). Attachments wait for R2. |
| 4. Dashboard with due/overdue status | Not started. The per-task status and the reset endpoint it needs both exist. |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP3-C: Filter and search on `/history` (spec 5.4) | BE, then FE | **Next** (written below) |
| 2 | MVP3-D: Edit a record's date, odometer and tasks (spec 5.5) | BE, then FE | Not written |
| 3 | MVP4-A: Dashboard (spec 10) | BE, then FE | Not written |

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

## Next ticket

### MVP3-C: Filter and search the service history

**Goal:** A user can find any past service across all their cars by car, task, date range or a word from the shop, notes or parts, and see how many services match and what they cost in total.

**Spec:** section 5, bullet 4 ("Filter and search by car, task, date or shop"). Part 2: `ServiceRecord` (VehicleId, Date, OdometerKm, ShopName, TotalCost, Notes, IsVoided), `ServiceRecordTask`, `ServiceItem` (Description, Brand, PartNumber); the index on ServiceRecord(VehicleId, Date DESC).

**Binding decisions** (`docs/decisions.md`, 2026-10-15, "Filter and search, MVP3-C"; earlier: MVP3-A's "voided records are hidden", SET-2's units, MVP1-C's focus and page titles):
- A new `/history` page, linked from the header, lists non-voided records of all the user's cars, archived cars included (with an "Archived" tag), newest first by (date, odometer, creation time).
- Filters combine with AND: car (all or one); task (offered once a car is chosen, listing that car's tasks, disabled ones included); date from and to (inclusive; from must not be after to); one search box matching shop name, notes, and item description, brand and part number (case-insensitive "contains", 1 to 100 characters after trimming).
- Filters live in the URL query string (`vehicleId`, `taskId`, `from`, `to`, `q`), so reload, Back and shared links keep them.
- Search applies 300 ms after typing stops, or on Enter.
- Pages of 50 with "Show more". The response carries the matching count and the sum of their `TotalCost` (null counts as 0).
- Read-only: rows link to their car page, where Edit and Delete live. The car page's history gets a "Search all history" link to `/history?vehicleId=…`.
- No separate DIY filter. No deployment work (owner, "When to deploy").

**Scope**

*Backend (backend-engineer). Runs first. Publish the contract in `docs/contracts/MVP3-C.md`.*
- New `GET /api/service-records` with optional query parameters `vehicleId`, `taskId`, `from`, `to` (dates, `yyyy-MM-dd`), `q`, `skip` (default 0), `take` (default 50, 1 to 100). Only the signed-in user's cars; voided records excluded; archived cars included.
- Response: `{ items: [...], totalCount, totalCost }`. Each item is the existing record DTO (with `tasks` and `items`) plus `vehicleId`. `totalCount` and `totalCost` cover every match, not just the page. `totalCost` is decimal, 2 places.
- `q` matches `ShopName`, `Notes`, and any of the record's `ServiceItem.Description`, `Brand` or `PartNumber`, case-insensitive contains. Trim it; empty after trimming means no search. A `shortcut:` comment is fine for an unindexed `LIKE`, at personal-app scale.
- `taskId` matches records linked to that task through `ServiceRecordTask`.
- Errors (400, nothing returned): `serviceRecord.invalidDateRange` (from after to), `serviceRecord.searchTooLong` (over 100 characters), `serviceRecord.invalidPaging` (skip below 0, take outside 1 to 100). A `vehicleId` or `taskId` that isn't the user's returns an empty result with `totalCount` 0, not 404, so the endpoint never confirms another user's ids. A `taskId` belonging to a car other than `vehicleId` also returns an empty result.
- No schema change and no migration. If a test shows the query is slow, an index is allowed but must be named in the contract.
- Tests: each filter alone and combined; search hits in shop, notes, item description, brand and part number, case-insensitive; voided records excluded; archived cars included; another user's records never returned (including with their `vehicleId` or `taskId`); paging (`skip`/`take`, stable order with equal dates); `totalCount` and `totalCost` over all matches with null costs; each 400 code; inclusive `from` and `to`.

*Frontend (frontend-engineer). Builds against `docs/contracts/MVP3-C.md`.*
- **Header link** "Service history" (he: "היסטוריית טיפולים") to `/history`, next to Settings. Page title "Service history · OnlyCars"; focus to the `h1` on arrival (MVP1-C).
- **Filter bar:** a car select ("All cars" plus every car, archived ones marked), a task select (disabled with a hint until a car is chosen; reset when the car changes), date from and to (native date inputs), a search box with a visible label, and a "Clear filters" button shown when any filter is set. Every filter change updates the URL with `replace` for typing and `push` for the selects and dates, then reloads from page 1.
- **Summary line** above the list, announced politely (`role="status"`): "3 services, total ₪1,250.00", in the user's currency; "No services match these filters." when the count is 0, with the Clear filters button; "No services recorded yet." when there are no filters and no records.
- **Rows** reuse the car page's row display (date, odometer in the user's unit, shop or DIY, cost, tasks, notes, items) plus the car's nickname as a link to `/cars/:id`, and an "Archived" tag for archived cars. No Edit, Delete or Record buttons here.
- **Show more** loads the next 50 and appends; focus goes to the first new row's car link. Hidden when all matches are shown.
- **Loading and errors:** a loading line on the first load; while reloading after a filter change the old rows stay with `aria-busy`; a failed load shows the translated error with a Retry button, keeping any rows already shown. A 400 code shows its translated message next to the filter it is about (dates or search).
- **Client validation** matching the server: from after to and a search over 100 characters are blocked with a message on the field, without a request.
- **Car page:** a "Search all history" link in the Service history section, to `/history?vehicleId=<id>`.
- Strings in `en` and `he` for everything new, including the three new error codes.

**Acceptance criteria**

*API*
1. [BE] `GET /api/service-records` with no filters returns the user's non-voided records of all cars, archived included, newest first, with `vehicleId`, `tasks` and `items`, and correct `totalCount` and `totalCost`.
2. [BE] Each filter (`vehicleId`, `taskId`, `from`, `to`, `q`) narrows the result alone and combined; `from` and `to` are inclusive; `q` finds a word in the shop, notes, an item description, a brand and a part number, in any case.
3. [BE] Paging with `skip` and `take` returns stable, non-overlapping pages; `totalCount` and `totalCost` cover all matches.
4. [BE] Another user's `vehicleId` or `taskId` returns an empty result; another user's records never appear. Each 400 code is returned as specified. `dotnet test` passes.

*UI*

5. [FE] The header has a Service history link; `/history` lists records from all cars with the car name linking to its page, newest first, and the summary line shows the count and total in the user's currency.
6. [FE] Choosing a car narrows the list and enables the task select with that car's tasks; choosing a task narrows it further; changing the car resets the task.
7. [FE] Date from and to narrow the list inclusively; from after to shows a message on the dates and sends no request.
8. [FE] Typing in the search box filters after a pause (or on Enter) by shop, notes or part; a search over 100 characters is blocked with a message.
9. [FE] Filters are in the URL: reloading the page or pressing Back restores them and their results; "Search all history" on a car page opens `/history` with that car selected.
10. [FE] With more than 50 matches, Show more appends the next page and focus moves to the first new row; the button disappears when all are shown.
11. [FE] Empty states: no records at all, and no matches (with Clear filters, which resets every filter and the URL). Loading state on first load. A failed load (mocked 500) shows the translated error and Retry, keeping rows already shown.
12. [FE] Archived cars' records show an "Archived" tag; no row on `/history` has Edit, Delete or Record.
13. [FE] Distances follow the user's km or miles setting, and amounts their currency.
14. [FE] Hebrew and RTL: every new string is in `en` and `he`; the filter bar, dates, amounts and free text (shop, part numbers) read correctly in RTL; the Hebrew reviewer approves.
15. [FE] Mobile: at 390px the filter bar stacks with no horizontal overflow in either language, with a long shop name and part number; every control is at least 44px tall.
16. [FE] Accessibility: every filter has a visible label; the summary is a polite live region; the page has its title and focuses its `h1` on arrival.
17. [BE+FE] Tests: `smoke.mjs` gains `history-page`, `history-filter` (car, task, dates, search, URL restore after reload) and `history-empty`, and every step passes in both setups.

**Out of scope**
- Editing or deleting from `/history` (stays on the car page).
- Editing a record's date, odometer or tasks: MVP3-D.
- Cost reports, charts and CSV or PDF export (step 5, spec 8). The summary total is the only aggregate.
- Showing voided records.
- Sorting other than newest first; saved searches; full-text indexing.
- Attachments (blocked on the R2 credentials). Any deployment work.

**Open questions:** none blocking; the rules are in decisions.md. For the owner to review: whether the search should also cover task names (today the task select does that), and whether `/history` should later allow Edit and Delete.

---

### Later
- **MVP3-D:** editing a record's date, odometer and linked tasks (moves its Service reading and recomputes the tasks' last done).
- **Car photo upload and attachments:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3): with the dashboard (step 4) or later.

## Changed since last audit
- **Signed off:** MVP3-B. The backend is in `bcfc683`; the backend review fixes, the frontend and all fixes are not committed yet.
- **Section 5:** "Line items" went from Missing to **Done**. "Edit and delete past records" stays **Partial**: edit (shop, cost, notes, items) and Delete now work; editing date, odometer and tasks is MVP3-D.
- **Counts:** Done went from 18 to 19, Partial stayed at 6, and Missing went from 26 to 25.
- **New decisions** (`docs/decisions.md`, 2026-10-15): the MVP3-B QA Low (identical names for identical DIY rows, accepted) and the MVP3-C rules (a `/history` page, the filters, search scope, URL query, paging by 50, count and total). The owner's "When to deploy" decision is noted under the deploy gate: no deployment tickets until the owner asks.
- **Next ticket:** MVP3-C, written in full. The MVP3-B ticket text is in git history up to `bcfc683`.
- **Tests:** `dotnet test` grew from 221 to 252 tests, and the smoke suite from 52 to 54 steps per setup.
