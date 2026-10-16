# OnlyCars: Requirements Status

**Audit date:** 2026-10-16 (eighteenth audit, short sign-off of MVP5-C, a flagged checklist item becomes a to-do; backend committed in `c232d4f`, frontend and fixes not committed yet)
**Overall:** MVP steps 1 to 4 are complete apart from the car photo and attachments (both blocked on R2). Step 5: checklists are done apart from photos on runs (R2), including flagged items becoming per-car to-dos. Tires, reports and notifications are not started. Next: LOW-3 (the Low backlog). No deployment tickets until the owner asks.

| Status | Count |
|---|---|
| Done | 30 |
| API only | 0 |
| Partial | 6 |
| Missing | 15 |
| Deferred | 6 |
| **Total** | **57** |

How this was checked (eighteenth audit, short sign-off of MVP5-C per decisions.md "Faster pipeline (owner)"; I re-ran no test suites and no browser scripts):
- Reported by other agents, not re-run by me: `dotnet test` 422 of 422; client build clean; lint 0 errors (one new warning, L63); code review with no High, user scoping verified on every issue endpoint; one Medium fixed (a numeric undefined `status` on `PUT /api/issues/{id}` now returns 400 `issue.invalidStatus`, `src/OnlyCars.Application/Issues/IssueService.cs:85-88`, with a test, an en/he string and a contract row); the Hebrew reviewer reworded `errors.issue.limitReached`.
- **No browser QA.** The owner stopped the ui-tester and said no ui-tester jobs until they say otherwise (decisions.md, "No ui-tester jobs (owner)"). MVP5-C shipped without a QA pass. The smoke steps were written (`client/ui-tests/smoke.mjs:2796` `issue-from-flag`, `:2850` `issue-manual`, `:2999` `dashboard-open-issues`), but no smoke result was reported to me.
- I checked in code: the endpoints (`src/OnlyCars.Api/Controllers/IssuesController.cs:15-27`, `[RequestSizeLimit(65_536)]` at `:12`), the service (`src/OnlyCars.Application/Issues/IssueService.cs`), the migration (`src/OnlyCars.Infrastructure/Persistence/Migrations/20261016031303_AddIssues.cs`), the tests (`tests/OnlyCars.Tests/IssueTests.cs`), the To-dos section (`client/src/pages/IssuesSection.tsx`, on the car page at `client/src/pages/CarPage.tsx:87`), Create to-do in the run history (`client/src/pages/ChecklistsSection.tsx:429-442`) and the dashboard count (`client/src/pages/CarsPage.tsx:161-162`).
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
| Checklist templates | **Done** | MVP5-A: `ChecklistTemplatesController.cs:11` (CRUD scoped to the caller), `ChecklistTemplateService.cs`, migration `AddChecklistTemplates`, `tests/OnlyCars.Tests/ChecklistTemplateTests.cs`; the `/checklists` page (`ChecklistsPage.tsx:29`) with a header link; smoke `checklists-empty`, `checklist-create`, `checklist-delete` (`smoke.mjs:2399,2418,2538`) in 4 setups | No starter checklists (decided: none for now) |
| Items: checkbox, numeric or text | **Done** | MVP5-A: Check, Number (unit, min, max) and Text items, reorder with up and down buttons, in-place update keeping item ids (`ChecklistTemplateService.cs:32,62`); smoke `checklist-create`, `checklist-edit` (`smoke.mjs:2418,2498`); Hebrew strings (`i18n.ts:609`) | none |
| Per-checklist schedule: by km, by time, or manual only | **Done** | MVP5-B: `VehicleChecklist` with optional `IntervalKm`/`IntervalDays` (both empty is manual only), status as tasks with 10% due soon (`VehicleChecklistsController.cs`, `ChecklistRunTests.cs`); the Checklists section on `/cars/:id` with Add, Edit (intervals, on/off) and Remove (`ChecklistsSection.tsx:18,138`); smoke `checklist-attach` (`smoke.mjs:2610`) in 4 setups | none |
| Run a checklist: tick items, add notes or photos, flag issues | **Partial** | MVP5-B: the run page (`RunPage.tsx:32`) with OK / Not OK, numbers, text, hand flags, live auto flags with the reason, notes, and an odometer under the date-order rules; flags computed on the server; smoke `checklist-run` (`smoke.mjs:2672`) | Photos (wait for R2) |
| Failed items can create a to-do or a maintenance task | **Done** (no browser QA) | MVP5-C: a flagged item in the run history gets Create to-do, prefilled and editable (`client/src/pages/ChecklistsSection.tsx:429-442`); one to-do per run item, also under a race (409 `issue.duplicate`); run delete keeps the to-do and clears its source (`IssueService.cs`, `IssueTests.cs`). Smoke step `issue-from-flag` (`smoke.mjs:2796`). A to-do, not a maintenance task, as decided (decisions.md, "Flagged checklist items, MVP5-C"). | Verified from code and reported tests only; no browser QA (owner stopped the ui-tester). A stale "To-do created" after its to-do is deleted on the same page (L60). |
| Run history per car | **Done** | MVP5-B: collapsed history per checklist on `/cars/:id`, newest first; each run expands to its label snapshots, values and flags; Delete with confirm and recompute (`ChecklistsSection.tsx:287,343`); smoke `checklist-run-history` (`smoke.mjs:2771`) | none |

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
| Quick actions: update odometer, reset a task, start a checklist | **Done** | Quick odometer entry and one-tap Mark done with Undo on each card (`CarsPage.tsx:136-160`); Start a checklist (MVP5-B, `CarsPage.tsx:160,203`: one checklist opens its run page, several open a list, most urgent first); smoke `dashboard-quick-odometer`, `dashboard-mark-done`, `dashboard-start-checklist`. | Nothing. |

## 11. Optional

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Fuel log and consumption tracking | **Deferred** | none | Optional |
| Issue / to-do list | **Partial** | MVP5-C: a per-car To-dos section on `/cars/:id` (add, edit, Done, Reopen, delete; `client/src/pages/IssuesSection.tsx`), "N open to-dos" on each dashboard card (`CarsPage.tsx:161-162`), API `IssuesController.cs:15-27`. No browser QA. | Optional. No to-do page across all cars; no due date, priority or cost on a to-do. Not planned. |
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
- Done (MVP5-C): `Issue` with the Part 2 fields, a filtered unique index on `SourceRunItemId`, and the source cleared (not cascaded) when a run is deleted (`20261016031303_AddIssues.cs`).
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
| 4. Dashboard with due/overdue status | **Complete. MVP4-A and LOW-2 are signed off; "Start a checklist" came with MVP5-B.** The dashboard on `/`: overdue and due-soon counts, this month's spend linking to `/history`, and per-car cards with the next 3 tasks, one-tap Mark done with Undo, quick odometer entry and Start a checklist, in EN and HE. |
| 5. Checklists, tires, reports, notifications | **Started. Checklists are done apart from photos on runs (R2): MVP5-A (templates and items), MVP5-B (schedules on cars, runs with flags, run history, Start a checklist) and MVP5-C (a flagged item becomes a per-car to-do; shipped without browser QA) are signed off.** Next: LOW-3, then tires (MVP5-D), reports and notifications. |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | LOW-3: the Low backlog (L27 to L65) | BE, then FE | **Next** (written below) |
| 2 | MVP5-D: tires (spec 6), split when written | BE, then FE | After LOW-3 |

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

- **MVP5-A (backend commit `75e46ea`; the frontend is not committed yet): signed off 2026-10-16.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: 345 of 345 tests; build and lint clean; smoke 68 of 68 in all 4 setups with the four new checklist steps; security review with no High or Medium; code review approved with Lows only; the Hebrew reviewer changed two strings; QA passed, and its Medium (the minus of a negative Min or Max on the wrong side in Hebrew) is fixed with a smoke assertion.
  - AC7 is signed off with a known gap: deleting the last row while others remain focuses New checklist, not the first remaining row's Edit as now decided (decisions.md, "MVP5-A sign-off"); fixed in LOW-3 (L39).
  - Accepted: `checklistItem.invalidId`, the code the backend named itself. Data export and delete-account must include checklists.
  - The security, review and QA Lows are L37 to L49 in the backlog.

- **MVP5-B (backend commit `baeac80`; the frontend is not committed yet): signed off 2026-10-16.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: 400 of 400 tests; build and lint clean; `items.test.mjs` 4 of 4; smoke 73 of 73 in all 4 setups with the five new steps; security review with no High or Medium; code review approved; the Hebrew reviewer changed `vehicleChecklist.notFound` and `hasRuns`; QA passed in 4 setups, miles included.
  - Fix round, 4 Mediums fixed: Back after Save reopened a blank run form (replace navigation); the run form's item errors, `itemsChanged` and future date added to smoke (mocked); a long template name overflowed the attach select at 390px (full-width selects in inline forms; smoke overflow check now uses the viewport width); logout during an in-flight settings save (`auth.tsx` `saveSettings`), which also explains the L49 flake.
  - AC12 signed off with a known gap: on the run page Date and Odometer sit side by side, misaligned, even at 390px (L55).
  - Accepted (decisions.md, "MVP5-B sign-off"): actions hidden on archived cars and Run hidden on a turned-off checklist; no way back to unanswered on a Check item; a same-day lower odometer doesn't move the last run; manual-only before turned-off; `ChecklistRunItem.SortOrder` and `runCount`; `vehicleChecklist.invalidDate`; "Every 1 month" for 30 days.
  - L43 done; L49 closed. The new Lows are L50 to L59; L37 and L48 were widened.

- **MVP5-C (backend commit `c232d4f`; the frontend and fixes are not committed yet): signed off 2026-10-16, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: 422 of 422 tests; client build clean; lint 0 errors; code review with no High, user scoping verified on all issue endpoints; the Hebrew reviewer reworded `errors.issue.limitReached`.
  - Fix round, 1 Medium fixed: `PUT /api/issues/{id}` with a numeric undefined `status` (such as `2`) reached the database; it now returns 400 `issue.invalidStatus` (`IssueService.cs:85-88`, test, en/he string, contract row). The same gap probably exists on every enum field (L65); LOW-3 fixes it at the root.
  - **Not verified in a browser:** the owner stopped the ui-tester (decisions.md, "No ui-tester jobs (owner)"). AC5 to AC11 (flows, errors, Hebrew/RTL layout, 390px, 44px targets, focus) are signed off from code, review and the smoke steps the engineer wrote; no smoke result was reported to me.
  - Accepted (decisions.md, "MVP5-C sign-off"): the new code `issue.invalidStatus`, until L65 replaces it. The new Lows are L60 to L65.

## Low issues backlog

Every Low finding from QA and review lands here (decisions.md, "Faster pipeline (owner)"). They are fixed together in a batch ticket LOW-n about every 3 tickets. LOW-1 closed L1 to L12; LOW-2 closed L13 to L26 (all fixed). L43 was done inside MVP5-B and L49 closed by its fix round. LOW-3 takes what is below (L27 to L65, apart from L43 and L49).

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
| L37 | MVP5-A + MVP5-B security | No request body size limit on the checklist endpoints; add `[RequestSizeLimit(65_536)]` as on `AuthController`. The other controllers have the same gap, and there is no app-wide `MaxRequestBodySize`: set one in Kestrel and fix them all at once. Also cap or page `GET /api/vehicle-checklists/{id}/runs` (unpaged, uncapped). | BE |
| L38 | MVP5-A security | Concurrency on checklist templates: (a) the 100-template cap can be exceeded by simultaneous POSTs; (b) simultaneous PUTs on one template can give a 500 (`DbUpdateConcurrencyException` unmapped). Map it to a 409 with a translated code; fix together with L34. | BE |
| L39 | MVP5-A review + decision | Focus after deleting a checklist (`ChecklistsPage.tsx:92`): (a) when the deleted row was the last one and others remain, focus the first row's Edit (decisions.md, "MVP5-A sign-off"); (b) with the New form open, `main button.add` is not there and focus drops to `body`; add `main h1` as the last fallback. | FE, `/checklists` |
| L40 | MVP5-A review | The client's re-sort after Save may differ from the server's order (name, then creation time). Match it, or add a `shortcut:` comment. | FE, `/checklists` |
| L41 | MVP5-A review | The browser's min/max validity message keeps an old item number after an item is moved. | FE, `/checklists` |
| L42 | MVP5-A review | Edit-save on a template deleted elsewhere leaves a dead row: on `notFound`, close the form and call `onDeleted`. | FE, `/checklists` |
| L43 | MVP5-A review | Shared item-row error and focus hook: **done** in MVP5-B (`client/src/useItemErrors.ts`). | FE |
| L44 | MVP5-A review | Test gaps: backend, a Check item with a whitespace-only unit; smoke, an item-index error after a reorder, and the browser message for an empty label. | Tests |
| L45 | MVP5-A review | Nits: a CSS comment above the wrong rule (`index.css` ~276); `limit()` pulls a React type into `api.ts` (leave unless a forms module appears). | FE |
| L46 | MVP5-A QA | A Latin checklist name in Hebrew puts the name and count on the left; add `dir="auto"` to `.name` in `ChecklistsPage.tsx`. | FE, `/checklists` |
| L47 | MVP5-A QA | The New and Edit forms can be open together with nothing telling them apart; give each form a heading ("New checklist" or "Edit <name>"). | FE, `/checklists` |
| L48 | MVP5-A + MVP5-B QA (app-wide) | Text-link buttons are 44px tall but 28 to 40px wide, including the new checklist and run-history buttons; give the shared text-button style a 44px minimum width. | FE, all pages |
| L49 | MVP5-A QA | **Closed** in MVP5-B: the flaky Hebrew logout was the `saveSettings` race in `auth.tsx`, fixed in the fix round. QA scripts added: `qa-mvp5a.mjs`, `qa-mvp5a-logout.mjs`, `qa-mvp5a-zoom.mjs`. | Smoke |
| L50 | MVP5-B security | A run date has no lower bound: 0001-01-01 is accepted and also adds an odometer reading on that date. Add a lower bound (for example 1900-01-01, or the car's purchase year) to runs, and check the same on service records and readings. | BE |
| L51 | MVP5-B security | Two simultaneous attaches of one template to one car give a 500 instead of 409 `vehicleChecklist.duplicate` (the unique index holds; a `shortcut:` comment exists). Map the unique-key violation to the 409; fix together with L34 and L38. | BE |
| L52 | MVP5-B review | No test for deleting a run whose odometer reading is the car's only reading (the code keeps it as Manual). | Tests |
| L53 | MVP5-B review | The run form's live flags use the Min/Max loaded when the form opened, while the server flags with the template at save time. Add a `shortcut:` comment (the `itemsChanged` check covers added and removed items, not changed limits). | FE, run page |
| L54 | MVP5-B review | Nits: blank lines at `TasksSection.tsx:8-9`; a mid-file import at `items.test.mjs:25`; a redundant `HasIndex(TemplateId)` at `VehicleChecklistConfiguration.cs:26`. | FE, BE |
| L55 | MVP5-B QA | On the run page, Date and Odometer sit side by side and misaligned even at 390px; AC12 asked for one column. Stack them on narrow screens and align them on wide ones. | FE, run page |
| L56 | MVP5-B QA | The `qa-*.mjs` scripts still check overflow with `innerWidth`; smoke now uses the viewport width (it caught the attach-select overflow). Update them or retire the old ones (with L35). | QA scripts |
| L57 | MVP5-B QA | Test gaps: no real (unmocked) `itemsChanged` test (edit the template while the run form is open, then save); no test that a past run older than the last run leaves the last run and status alone in the UI. | Tests |
| L58 | MVP5-B frontend | There is no `GET /api/vehicle-checklists/{id}`; the run page loads the car's whole checklist list. Fine at today's sizes; add a `shortcut:` comment, and the endpoint if the list grows. | BE + FE |
| L59 | MVP5-B frontend | After Save and then Back, the car page appears twice in the browser history (a side effect of the replace navigation that fixed the blank form). Make Save return with `navigate(-1)` when the run page was opened from the car page, or accept it. | FE, run page |
| L60 | MVP5-C review | "To-do created" in the run history goes stale when that to-do is deleted on the same page: clicking it fails `focusIssue` and silently reloads (`client/src/pages/ChecklistsSection.tsx:437-438`). Show the `issueGone` note and turn the button back into Create to-do. | FE, `/cars/:id` |
| L61 | MVP5-C review | The RunHistory note is not cleared when a run is deleted (`client/src/pages/ChecklistsSection.tsx:301`, `:351-356`). | FE, `/cars/:id` |
| L62 | MVP5-C review | The request-size test asserts nothing (`tests/OnlyCars.Tests/IssueTests.cs:363-364`). Make it assert a 413, or delete it. | Tests |
| L63 | MVP5-C review | New lint warning `react(only-export-components)`: `focusIssue` is exported from `client/src/pages/IssuesSection.tsx:16`. Move it to a plain module. | FE |
| L64 | MVP5-C review | The answer-text formatting at `client/src/pages/ChecklistsSection.tsx:444-447` duplicates `RunValue`; share one helper. | FE |
| L65 | MVP5-C review | `JsonStringEnumConverter` (`src/OnlyCars.Api/Program.cs:16`) also binds numbers, so an undefined numeric value (such as `fuelType: 99`) can reach the database on any enum field: `FuelType`, `TaskCategory`, `ChecklistItemType`, `DistanceUnit`, `Locale`, `Theme`. Only `IssueStatus` has a service check (`issue.invalidStatus`). | BE |

## Next ticket

### LOW-3: The Low backlog (L27 to L65)

**Goal:** As a user, the app behaves the same way everywhere: concurrent and malformed requests get a clear message instead of a server error, dates and enum values are checked, focus never drops to the page body, and the last rough edges on the dashboard, car page, checklists and run page are gone.

**Spec:** section 12 (privacy and security, Hebrew and English, mobile-first), plus the polish of sections 7 and 10. No new feature.

**Binding decisions:** decisions.md "Faster pipeline (owner)", "No ui-tester jobs (owner)", "LOW-3 choices" (every choice below), "MVP5-A sign-off" (focus after Delete), the MVP1-C focus and Escape rules, "Same-date odometer readings, revised", the quick-add local date (2026-10-15).

Every row below is in the "Low issues backlog" table; read its full text there. L43 and L49 are already closed.

**Scope**

*Backend (backend-engineer, runs first; publishes `docs/contracts/LOW-3.md` listing every changed status code and the new codes):*
- **L65 (root fix):** `new JsonStringEnumConverter(allowIntegerValues: false)` in `src/OnlyCars.Api/Program.cs:16`, so a numeric enum value anywhere is a 400 `http.400`. Remove the now-unreachable `issue.invalidStatus` check (`IssueService.cs:85-88`) and its en/he string; its test asserts `http.400` instead; update the MVP5-C contract row. First confirm the client never sends an enum as a number (grep `client/src/api.ts`).
- **L37:** an app-wide Kestrel `MaxRequestBodySize` of 64 KB (413 `http.413`); the per-controller attributes can stay. Cap `GET /api/vehicle-checklists/{id}/runs` at the newest 200 runs, with a `shortcut:` comment (no paging).
- **L34, L38, L51 (concurrency):** map `DbUpdateConcurrencyException` and unique-key violations to 409 in one place: L34 to `serviceRecord.alreadyVoided`, L51 to `vehicleChecklist.duplicate`, L38(b) to a new `concurrency.conflict` ("This was changed at the same time somewhere else. Reload and try again."). L38(a) (the 100-template cap passed by simultaneous creates) is accepted with a `shortcut:` comment.
- **L50:** dates before 1900-01-01 are rejected on checklist runs, service records (create and edit) and odometer readings (create and edit), with one new shared code `date.tooEarly` (400).
- **L36:** a new car's first reading takes the client's local date, the way quick-add does (same field name and the same future-date check), instead of the server's UTC date. The client sends it (FE part).
- **L58:** a `shortcut:` comment only (no new endpoint).
- **Tests:** L44 (backend half: a Check item with a whitespace-only unit), L52 (deleting a run whose reading is the car's only one), L62 (the request-size test asserts a 413), and one test per row above.
- **Nits:** L54 (backend half: the redundant `HasIndex(TemplateId)`, which needs a migration only if EF produces one; if it does, leave the index and drop the nit).

*Frontend (frontend-engineer, builds against `docs/contracts/LOW-3.md`):*
- **Dashboard `/`:** L27, L29, L30, L31, L32 (a and b: one guard for every load path during an in-flight Undo).
- **Car page `/cars/:id`:** L28 (a `shortcut:` comment, keep as is), L33 (`useLayoutEffect`), L60 (stale "To-do created": show the `issueGone` note and turn the button back into Create to-do), L61 (clear the note on run delete), L63 (move `focusIssue` out of `IssuesSection.tsx`), L64 (one shared answer-text helper).
- **`/checklists`:** L39 (a and b), L40 (match the server order: name, then creation time), L41, L42, L46 (`dir="auto"`), L47 (form headings "New checklist" and "Edit <name>").
- **Run page:** L53 (a `shortcut:` comment), L55 (Date and Odometer stacked under 600px, aligned above), L59 (Save returns with `navigate(-1)` when the run page was opened from the car page; a replace navigation otherwise).
- **App-wide:** L48 (text-link buttons at least 44px wide), L45 (the misplaced CSS comment; leave `limit()`), L54 (frontend nits), L36 (send the local date when adding a car), the new `concurrency.conflict` and `date.tooEarly` strings in `en` and `he`.
- **Scripts and tests:** L35 and L56: delete every `client/ui-tests/qa-*.mjs` (they are in git history; smoke is the regression check while the ui-tester is stopped). L44 (smoke half) and L57 (smoke tests listed there).

**Acceptance criteria**
1. [BE] A numeric enum value (for example `fuelType: 99`, `status: 2`) on any endpoint returns 400 `http.400`; names still work; nothing in the client sends numbers.
2. [BE] A body over 64 KB on any endpoint returns 413; the runs list returns at most 200 runs, newest first.
3. [BE] Two simultaneous voids, two simultaneous attaches and two simultaneous template edits each give one success and one 409 with the codes above; no 500 in any of them (tests).
4. [BE] A date before 1900-01-01 on a run, a service record or a reading returns 400 `date.tooEarly`; 1900-01-01 itself is accepted.
5. [BE+FE] A car added at 00:30 local time in UTC+3 gets a first reading dated with the local date (test on the server; smoke no longer works around it).
6. [BE] `dotnet test` passes in full, with tests for L44, L52, L62 and each row above; the L62 test asserts a 413.
7. [FE] On the dashboard, after any action (Undo with a failed reload, archive with Show archived off, a failed archive), focus lands on a visible control, never `body`; archive can't be sent twice; a reload clears the old archive error; no stale Undo bar comes back from any load path.
8. [FE] On the car page, clicking "To-do created" after that to-do was deleted shows the translated `issueGone` note and the item shows Create to-do again; deleting a run clears the run-history note; Undo moves focus in the same frame.
9. [FE] On `/checklists`, deleting the last row while others remain focuses the first row's Edit; with the New form open, focus falls back to `main h1`; the order after Save matches a reload; each open form has its heading; a Latin name reads correctly in Hebrew; Edit-save on a template deleted elsewhere closes the form and removes the row.
10. [FE] On the run page at 390px, Date and Odometer are stacked in one column; on wide screens they are aligned; after Save, a single Back returns to where the user was before the car page.
11. [FE] Every text-link button is at least 44 by 44px (smoke checks it on each page).
12. [FE] Hebrew and RTL: the two new error strings are in `he` and approved by the Hebrew reviewer; no layout change breaks RTL.
13. [BE+FE] No regressions: build clean, lint 0 errors and 0 warnings, `dotnet test` passes, smoke passes in all 4 setups, and the `qa-*.mjs` files are gone.

**Out of scope:** new features; paging the runs list; a to-do page across all cars; any L-row not listed (none left); browser QA by the ui-tester (stopped by the owner).

**Open questions:** none blocking. One for the owner, with a default in the meantime: does "no ui-tester jobs" also cover the engineers running `smoke.mjs` as their own check? Until the owner says otherwise, engineers keep running it (it is their build check, not a ui-tester job).

---

### Later
- **Tires (spec 6), MVP5-D,** split when written; then reports (spec 8), then notifications (spec 9).
- **Car photo upload, attachments and run photos:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3, optional).
- **Data export and delete-account** (spec 12): must include checklists, their attachments to cars, runs and to-dos.

## Changed since last audit
- **Signed off:** MVP5-C (backend `c232d4f`; frontend and fixes not committed yet), **without browser QA**: the owner stopped the ui-tester until further notice (decisions.md, "No ui-tester jobs (owner)").
- **Status changes:** spec 7 "Failed items can create a to-do or a maintenance task" is Done (was Missing); spec 11 "Issue / to-do list" is Partial (was Deferred; per car only). Counts: Done 30 (was 29), Partial 6 (was 5), Missing 15 (was 16), Deferred 6 (was 7).
- **Backlog:** L60 to L65 added.
- **New decisions** (`docs/decisions.md`, 2026-10-16): "No ui-tester jobs (owner)", "MVP5-C sign-off", "LOW-3 choices".
- **Next ticket:** LOW-3, written in full. The MVP5-C ticket text is in git history up to `c232d4f`.
- **Data note:** the test users left by the security reviewer (`sec-*@example.test`) stay in the local dev DB until delete-account exists.
