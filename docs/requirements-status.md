# OnlyCars: Requirements Status

**Audit date:** 2026-10-17 (twenty-fifth audit, short sign-off of RPT-3, report export; nothing committed yet)
**Overall:** MVP steps 1 to 4 are complete apart from the car photo and attachments (both blocked on R2). Step 5: checklists are done apart from photos on runs (R2); tires are done; reports are done (RPT-1 to RPT-3, all of spec 8). Next is LOW-5 (the Low backlog), then notifications, which are not started. No deployment tickets until the owner asks.

| Status | Count |
|---|---|
| Done | 39 |
| API only | 0 |
| Partial | 6 |
| Missing | 6 |
| Deferred | 6 |
| **Total** | **57** |

How this was checked (twenty-fifth audit, short sign-off of RPT-3 per decisions.md "Faster pipeline (owner)"; I re-ran no test suites and no browser scripts):
- Reported by other agents, not re-run by me: client build clean; lint 0 warnings; smoke with `SMOKE_ALL=1` 108 steps per setup, all pass after the fix round; `dotnet test` 517 of 517 (code reviewer). Code review and security review: no High or Medium; their Lows fixed (see Signed-off tickets). Hebrew review: the print line changed to "שנת …". Frontend only: no API change, no new dependency.
- **No browser QA.** The ui-tester is still stopped by the owner (decisions.md, "No ui-tester jobs (owner)"). RPT-3 is the eighth ticket shipped without a QA pass. Nobody has opened the CSV in real Excel or used the real print dialog.
- I checked in code (uncommitted diff): `client/src/csv.ts:1-11`: BOM, CRLF, quoting of `"`, `,`, `;`, CR and LF with doubled quotes, and the `'` formula guard (also after leading whitespace or control characters, and full-width forms). `client/src/pages/ReportsPage.tsx:78-109`: paging with `take=100` until `totalCount` (an empty page ends the loop), the year and car from the shown report, oldest first, header row in the UI language with the unit in the odometer header, odometer through `useDistance`, cost with 2 decimals or empty, the user's currency code, the DIY label for an empty shop, nothing downloaded after a failure or after leaving the page, a filename-safe car name. `:204-239`: the print-only line (year, car or All cars, date); both buttons `aria-disabled` while loading or after an error, hidden in the empty state; busy label; error with Retry. `client/src/index.css:347-359`: `@media print` forces the light palette on white (`color-scheme: light`, so the `--muted` bars and text use the light values), hides the header, filters and buttons, keeps cards whole, prints links as plain text, `print-color-adjust: exact` on the bars. `client/package.json` unchanged.
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
| Tire sets: brand, model, size, season, purchase year, DOT code | **Done** | MVP5-D (backend `5940442`, contract `docs/contracts/MVP5-D.md`; frontend not committed). `TireSet` with every Part 2 field, `/api/tire-sets` CRUD with coded validation and a 50-set cap (`TireService.cs`, `TireTests.cs`). UI: `/tires` from the header (`App.tsx:43,59`), New set, Edit and Delete with a confirm (`TiresPage.tsx`); Latin values in `dir="auto"`. Smoke `tires-empty`, `tires-create`, `tires-edit`, `tires-delete`. Smoke 88 of 88 in 4 setups (reported). **No browser QA** (ui-tester stopped). | Purchase is a full date, not a year (decided). Lows L74, L76, L77. |
| Which set is mounted on which car, with mount and unmount dates | **Done** | MVP5-D (backend `5940442`, contract `docs/contracts/MVP5-D.md`; frontend not committed). `TireMount` with one open mount per car and per set (filtered unique indexes, migration `AddTires`); mount, swap in one step, unmount (allowed on archived cars), delete a mount; 409 `tireMount.setMounted`, `concurrency.conflict` on a race (`TireService.cs:72,109`). UI: the Tires section on `/cars/:id` (`TiresSection.tsx`), "On <car> since <date>" or "In storage" on `/tires`, mount history per set. Smoke `tires-mount`, `tires-swap`, `tires-unmount`, `tires-delete-mount`, `tires-archived`. Smoke 88 of 88 in 4 setups (reported). **No browser QA** (ui-tester stopped). | Mounts add no odometer reading (decided shortcut). Lows L73, L75, L78. |
| Km driven per set (auto-calculated) | **Done** | MVP5-D (backend `5940442`, contract `docs/contracts/MVP5-D.md`; frontend not committed). Computed on read: closed mounts plus `max(0, current - mount)` for the open one (`TireService.cs:233,246`), tested. UI: km driven on `/tires` and on the car's mount rows in the user's unit (`TiresPage.tsx:136`, `TiresSection.tsx:43`); smoke `tires-miles` checks miles and the exact km sent back. Smoke 88 of 88 in 4 setups (reported). **No browser QA** (ui-tester stopped). | Nothing for this bullet. |
| Tire pressure log, tread depth log, rotation tracking | **Done** | MVP5-E (not committed; contract `docs/contracts/MVP5-E.md`). `TireCheck` (one per mount per date) owning a `TireMeasurement` per wheel, and `TireRotation`; migration `20261017054806_AddTireMeasurements` (`TireConfiguration.cs:52-96`). `/api/tire-mounts/{id}/checks` and `/rotations` with create, list and delete; `lastCheck` and `lastRotation` with `kmSince` on the car's tires (`TiresController.cs:56-79`, `TireService.cs`, `TireTests.cs`). UI: Last check, Last rotation ... ago, Log a check, Log a rotation, Checks and Rotations history with Delete, in the car page's Tires section (`TiresSection.tsx`). Smoke `tires-check`, `tires-check-duplicate`, `tires-check-delete`, `tires-rotation` (miles included); 368 of 368 (reported). **No browser QA** (ui-tester stopped). | Pressure in bar only, no low-tread warning (decided). The mount and date sit on a `TireCheck` header, not on each measurement (decided deviation). Lows L80 to L86. |
| Storage notes for the off-season set | **Done** | MVP5-D (backend `5940442`, contract `docs/contracts/MVP5-D.md`; frontend not committed). `TireSet.Notes` (up to 1,000) as a labelled storage-notes textarea on the set form, shown on the row (`TiresPage.tsx:137,264`). Smoke 88 of 88 in 4 setups (reported). **No browser QA** (ui-tester stopped). | Nothing for this bullet. |

## 7. Custom Inspection Checklists

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Checklist templates | **Done** | MVP5-A: `ChecklistTemplatesController.cs:11` (CRUD scoped to the caller), `ChecklistTemplateService.cs`, migration `AddChecklistTemplates`, `tests/OnlyCars.Tests/ChecklistTemplateTests.cs`; the `/checklists` page (`ChecklistsPage.tsx:29`) with a header link; smoke `checklists-empty`, `checklist-create`, `checklist-delete` (`smoke.mjs:2399,2418,2538`) in 4 setups | No starter checklists (decided: none for now) |
| Items: checkbox, numeric or text | **Done** | MVP5-A: Check, Number (unit, min, max) and Text items, reorder with up and down buttons, in-place update keeping item ids (`ChecklistTemplateService.cs:32,62`); smoke `checklist-create`, `checklist-edit` (`smoke.mjs:2418,2498`); Hebrew strings (`i18n.ts:609`) | none |
| Per-checklist schedule: by km, by time, or manual only | **Done** | MVP5-B: `VehicleChecklist` with optional `IntervalKm`/`IntervalDays` (both empty is manual only), status as tasks with 10% due soon (`VehicleChecklistsController.cs`, `ChecklistRunTests.cs`); the Checklists section on `/cars/:id` with Add, Edit (intervals, on/off) and Remove (`ChecklistsSection.tsx:18,138`); smoke `checklist-attach` (`smoke.mjs:2610`) in 4 setups | none |
| Run a checklist: tick items, add notes or photos, flag issues | **Partial** | MVP5-B: the run page (`RunPage.tsx:32`) with OK / Not OK, numbers, text, hand flags, live auto flags with the reason, notes, and an odometer under the date-order rules; flags computed on the server; smoke `checklist-run` (`smoke.mjs:2672`) | Photos (wait for R2) |
| Failed items can create a to-do or a maintenance task | **Done** (no browser QA) | MVP5-C: a flagged item in the run history gets Create to-do, prefilled and editable (`client/src/pages/ChecklistsSection.tsx:429-442`); one to-do per run item, also under a race (409 `issue.duplicate`); run delete keeps the to-do and clears its source (`IssueService.cs`, `IssueTests.cs`). Smoke step `issue-from-flag` (`smoke.mjs:2796`). A to-do, not a maintenance task, as decided (decisions.md, "Flagged checklist items, MVP5-C"). | Verified from code and reported tests only; no browser QA (owner stopped the ui-tester). The stale "To-do created" after its to-do is deleted (L60) was fixed in LOW-3. |
| Run history per car | **Done** | MVP5-B: collapsed history per checklist on `/cars/:id`, newest first; each run expands to its label snapshots, values and flags; Delete with confirm and recompute (`ChecklistsSection.tsx:287,343`); smoke `checklist-run-history` (`smoke.mjs:2771`) | none |

## 8. Costs and Reports

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Cost per car, per category, per month and per year | **Done** (no browser QA) | RPT-1 (not committed; contract `docs/contracts/RPT-1.md`): `GET /api/reports/costs?year=&vehicleId=` (`ReportsController.cs:16`, `ReportService.cs:16-75`), no migration; `CostReportTests.cs`. UI: `/reports` from the header (`App.tsx:43,60`) with Year and Car in the URL, the year summary with the unpriced count, By month (12 rows), By category (equal split, "No task"), By car, each total with records linking to `/history` (`ReportsPage.tsx:78-118`). Smoke `SMOKE_ALL=1` 103 per setup (reported). | Not checked in a browser (ui-tester stopped). Lows L92 to L98. |
| Cost per km and total cost of ownership | **Done** (no browser QA) | RPT-1: per car, all time: service total, km driven (from the first reading, clamped at 0), cost per km (4 decimals, null at 0 km) and TCO = purchase price + service total (null without a price) (`ReportService.cs:62-70`, tested). UI: the All time section with cost per km or per mile in the user's unit, "Not enough odometer readings", and "Add a purchase price" linking to the car's edit page (`ReportsPage.tsx:119-137`). | Fuel and tire purchases are not included (decided). The Hebrew term for TCO is open for the owner. Not checked in a browser. |
| Charts: spending over time, cost by category | **Done** (no browser QA) | RPT-2 (not committed; frontend only): on `/reports`, 12 vertical month bars over the By month rows and a horizontal bar per category over the By category rows, scaled to the highest value, `aria-hidden` over the unchanged rows, following the page direction in Hebrew (`ReportsPage.tsx:88-123`, `index.css:333-346`); no chart library. Smoke `reports-charts` (bar heights and lengths, RTL, the 2px minimum, label overlap and edges at 390px including a 20px root font), `SMOKE_ALL=1` 104 per setup (reported). | Not checked in a browser (ui-tester stopped). Lows L99 to L102. |
| Export to CSV and PDF | **Done** (no browser QA) | RPT-3 (not committed; frontend only): Export CSV on `/reports` downloads `onlycars-{year}[-{car}].csv`, one row per service record of the chosen year and car, built in the browser from the paged `/api/service-records` (`ReportsPage.tsx:78-109`, `client/src/csv.ts`); "Print or save as PDF" calls `window.print()` with a `@media print` stylesheet and a print-only line with year, car and date (`index.css:347-359`). Smoke `SMOKE_ALL=1` 108 per setup with CSV content, Hebrew header, print-media screenshots and `page.pdf()` steps (reported). | Not checked in a browser (ui-tester stopped); the CSV not opened in real Excel, the real print dialog not used (L105, owner). Lows L103, L104, L106. |

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
- Done (MVP5-D): `TireSet` and `TireMount` with the Part 2 fields, one open mount per vehicle and per set (filtered unique indexes), an index on `(TireSetId, MountedAt)`, cascade from `TireSet` (`TireConfiguration.cs`, migration `20261016083205_AddTires`). 
- Done (MVP5-E): `TireMeasurement` and `TireRotation` with the Part 2 fields, except that a measurement's `TireMountId` and `MeasuredAt` live on a new header `TireCheck` (unique `(TireMountId, MeasuredAt)`) that owns the measurements (unique `(TireCheckId, Position)`); deviation recorded in decisions.md, "MVP5-E sign-off". Migration `20261017054806_AddTireMeasurements`.
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
| 5. Checklists, tires, reports, notifications | **Started. Checklists are done apart from photos on runs (R2): MVP5-A, MVP5-B and MVP5-C are signed off. Tires are done: MVP5-D (sets, mounts, swap, km per set, storage notes) and MVP5-E (pressure, tread depth, rotations) are signed off. LOW-3 and LOW-4 are signed off. Reports are done: RPT-1 (cost per car, category, month and year, cost per km, TCO), RPT-2 (charts) and RPT-3 (CSV and PDF export) are signed off. MVP5-C, LOW-3, MVP5-D, MVP5-E, LOW-4, RPT-1, RPT-2 and RPT-3 shipped without browser QA.** Remaining: notifications (spec 9) and photos on runs (R2). Next: LOW-5, then notifications. |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | LOW-5: L87 to L106 (not L72, L98, L105) | BE, then FE | **Next** (written below) |
| 2 | Notifications (spec 9) | BE, then FE | After LOW-5; needs the owner's email provider choice (decisions.md, "Ticket after RPT-3") |

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

- **LOW-3 (backend commit `5326e14`; the frontend and fixes are not committed yet): signed off 2026-10-16, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites. Closes L27 to L65 (L43 and L49 were closed earlier).
  - Reported evidence: `dotnet test` 440 of 440; client build clean; lint 0 errors and 0 warnings; smoke 78 of 78 (the engineer's own run; it now asserts the number-then-unit order of run values); code review with no High and every row L27 to L65 addressed; the Hebrew reviewer reworded `concurrency.conflict`.
  - Fix round, 2 Mediums and 1 Low fixed: (1) the service record concurrency token is now `UpdatedAt` (`src/OnlyCars.Infrastructure/Persistence/Configurations/ServiceRecordConfiguration.cs:16`), so an edit racing a void is a 409 `concurrency.conflict` and void racing void stays `serviceRecord.alreadyVoided`; empty migration `20261016081611_ServiceRecordUpdatedAtToken`, a new test. (2) The run value's number and unit order in RTL is restored with separate `bdi`s (`client/src/pages/ChecklistsSection.tsx:469-476`). (3) `date.tooEarly` is mapped to the date field on the run page (`client/src/pages/RunPage.tsx:15`) and in the service form (`client/src/pages/ServiceHistory.tsx:13`).
  - I checked in code: the three fixes above; the new car form always sends the local date (`client/src/pages/CarFormPage.tsx:45`, `readingDate: localToday()`), so it can't hit `date.tooEarly` and needs no field mapping (answers part of the new L68).
  - **Not verified in a browser:** the owner stopped the ui-tester. AC7 to AC12 (focus, layout at 390px, 44px text links, Hebrew/RTL) are signed off from code, review and smoke.
  - Accepted without code (decisions.md, "LOW-3 sign-off"): the contract's 413 example has a stale title; `client/.oxlintrc.json` lists `useAuth` and `useDistance` in `allowExportNames` for two pre-existing warnings instead of moving them; a no-op service record edit bumps `UpdatedAt` (L70).
  - The new Lows are L66 to L72.

- **MVP5-D (backend commit `5940442`; the frontend and fixes are not committed yet): signed off 2026-10-17, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: `dotnet test` 468 of 468 (plain run before the commit); build clean; lint 0 errors and 0 warnings; smoke `SMOKE_ALL=1` 88 of 88 in all 4 setups, twice; code review with no High; the Hebrew reviewer changed `onCarSince`, `confirmDeleteTireSet`, `bought`, `confirmDeleteMount` and `errors.tireMount.odometerBeforeMount`.
  - Fix round: 2 Mediums fixed with the new smoke steps `tires-miles` (the miles path and the exact km sent back) and `tires-archived`. 3 Lows fixed: `tireMount.notFound` reloads the section and closes the form; the desktop Mount real click is restored; the flaky `history-page` step (a StrictMode double request).
  - AC1 to AC5 [BE] are signed off from tests and the code checks above; AC6 to AC11 [FE] from code, review and smoke. **Not verified in a browser:** the layout at 390px, 44px targets, focus and the Hebrew/RTL reading order.
  - Decided (decisions.md, "MVP5-D sign-off" and "Hebrew form of address"). The new Lows are L73 to L79.

- **MVP5-E (not committed yet): signed off 2026-10-17, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites.
  - Reported evidence: a plain `dotnet test` 493 of 493 (orchestrator); build clean; lint 0 warnings; smoke `SMOKE_ALL=1` 368 of 368 (92 steps per setup), 0 console errors; the engineer read the 390px screenshots in he and en.
  - Fix round: M1 (two simultaneous checks on one date naming different wheels were merged into one check) fixed with the `TireCheck` header and its unique `(TireMountId, MeasuredAt)`; L1 (the save catch now rethrows when no check exists); the smoke `at390` blur before resize.
  - AC1 to AC4 [BE] are signed off from tests and the code checks above; AC5 to AC10 [FE] from code, review and smoke. **Not verified in a browser:** the layout at 390px (screenshots read by the engineer only), 44px targets, focus and the Hebrew/RTL reading order.
  - Accepted (decisions.md, "MVP5-E sign-off"): the `TireCheck` header (a Part 2 deviation); the new codes `tireMeasurement.invalidPosition` and `tireRotation.invalidNotes`; extra decimals rejected, not rounded; `lastCheck` and `lastRotation` on every `TireMountDto`, filled only on the current mount. The new Lows are L80 to L86.

- **LOW-4 (not committed yet): signed off 2026-10-17, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites. Closes L66 to L86. Contract `docs/contracts/LOW-4.md`.
  - Reported evidence: a plain `dotnet test` 500 of 500 (orchestrator, after the fix round); build clean; lint 0 warnings; smoke `SMOKE_ALL=1` 97 steps per setup, all pass (frontend engineer), and 97 of 97 in 2 setups after the Hebrew pass (Hebrew reviewer); code review with no High.
  - Fix round: the Medium (the cleanup script) fixed: one tight LIKE per generated prefix, self-checks that THROW on the owner's accounts and near misses, the LocalDB guard on `SERVERPROPERTY('InstanceName')`. Lows fixed: the `FindMountAsync` parameter order, sorted usings.
  - AC1, AC3, AC4 [BE] signed off from tests and the code checks above. AC2 [BE+FE] signed off for the task last-done date; for the to-do Done date the backend rejects it but the UI can't send it (there is no Done date field; Done always sends today), accepted (decisions.md, "LOW-4 sign-off"). AC5 to AC8 [FE] from code, review and smoke. AC7: the Hebrew reviewer reports no plural form of address left in `he` (impersonal יש ל… or אפשר ל… where possible, otherwise the singular), and L84 is done in en and he. AC9 from the reported runs.
  - **Not verified in a browser:** the layout at 390px (including the long new Hebrew strings, L90), 44px targets, focus and the RTL reading order.
  - **L72 not done:** the script exists but was never run (the permission check blocked even the dry run); it stays with the owner (CHECKLIST.md, "Waiting on the owner").
  - Accepted (decisions.md, "LOW-4 sign-off"): L86 (the caps can be passed by one under a race); the to-do's own 2000-01-01 minimum stays. The new Lows are L87 to L91.

- **RPT-1 (not committed yet): signed off 2026-10-17, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites. Contract `docs/contracts/RPT-1.md`; no migration.
  - Reported evidence: a plain `dotnet test` 517 of 517 (engineer and reviewer); build clean; lint 0 warnings; smoke `SMOKE_ALL=1` 103 steps per setup, all pass after the fix round; code review with no High; the Hebrew reviewer changed nothing.
  - Fix round: M1 (cost per km or mile showed only 2 decimals, often 0.00) fixed: up to 4 decimals through `money()`'s new `maxDigits`. M2 (while a new filter loaded, the old figures got the new filter's links and By car) fixed: the stored report keeps the `vehicleId` it was asked for. Lows fixed: a non-guid `vehicleId` offers All cars; with a car chosen there is no empty state (its All time block shows, the year sections at 0); refocus is cleared on any answer.
  - AC1 to AC3 [BE] signed off from tests and the code checks above; AC4 [BE+FE] from the split test and the code; AC5 to AC9 [FE] from code, review and smoke; AC10 from the reported runs. AC7 is met as amended in the fix round: the "no service costs yet" state shows only for All cars. **Not verified in a browser:** the layout at 390px, 44px targets, focus and the RTL reading order of amounts and month names.
  - Accepted (decisions.md, "RPT-1 sign-off"): the year allows the current UTC year plus a day of slack; a car whose records that year are all unpriced is left out of By car; `kmDriven` is clamped at 0; `costPerKm` is rounded to 4 decimals; the All time cars are ordered active first, then by nickname; a record whose tasks were deleted counts as "No task". The new Lows are L92 to L98.

- **RPT-2 (not committed yet): signed off 2026-10-17, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites. Frontend only: no contract, no migration, no new dependency, no new strings.
  - Reported evidence: build clean; lint 0 warnings; smoke `SMOKE_ALL=1` 104 steps per setup, all pass after the fix round; code review with no High.
  - Fix round: M (month labels at 390px had 0.67px to spare) fixed: below 40em every other month label is hidden, and smoke checks label overlap and the chart edges at 390px, including a 20px root font. L (no test of the 2px minimum bar) fixed in smoke.
  - AC1 and AC2 (bar heights and lengths) signed off from code (`ReportsPage.tsx:91-93`) and the reported smoke step; AC3 from code (both charts are drawn from the shown report; the month chart hides when every month is 0; the category section stays hidden with no categories); AC4 (RTL) from the CSS (grid columns and `inline-size` follow `dir`) and smoke; AC5 from the engineer's hand-computed contrast of `--muted` (about 6.0:1 light, 6.3:1 dark), not tool-checked; AC6 from the fix and smoke (the charts hold nothing focusable); AC7 from code; AC8 from the reported runs and the unchanged `package.json`. **Not verified in a browser:** how the bars look in both themes, the 390px layout in he and en, and that the RTL order reads right.
  - Accepted (decisions.md, "RPT-2 sign-off"): below 40em only every other month name shows under the bars. The new Lows are L99 to L102.

- **RPT-3 (not committed yet): signed off 2026-10-17, without browser QA.** Short sign-off under "Faster pipeline (owner)"; I re-ran no suites. Frontend only: no contract, no migration, no new dependency.
  - Reported evidence: build clean; lint 0 warnings; smoke `SMOKE_ALL=1` 108 steps per setup, all pass after the fix round; `dotnet test` 517 of 517 (reviewer); code and security reviews with no High or Medium; the Hebrew review changed the print line to "שנת …".
  - Lows fixed in the round: security: `;` is quoted; the formula guard runs after leading whitespace and control characters and covers the full-width = + - @; the file name strips bidi, zero-width and C1 characters and trims - and . at the ends. Code review: no download after leaving the page mid-export; the busy state is keyed to the filters; the car name comes from `report.cars`.
  - AC1 to AC4 signed off from `csv.ts`, `ReportsPage.tsx:78-109` and the reported smoke steps; AC5 from `index.css:347-359`, the print line and the reported print-media screenshots and `page.pdf()`; AC6 from code (`aria-disabled` rather than `disabled`, accepted); AC7 from smoke (390px, 44px) and code (real buttons after the filters); AC8 from the reported runs and the unchanged `package.json`. **Not verified:** the CSV in real Excel, the real print dialog and "Save as PDF", and the printed page in a real browser.
  - Accepted (decisions.md, "RPT-3 sign-off"): the print stylesheet is global; `aria-disabled` buttons; `;` quoting and the wider formula guard. The new Lows are L103 to L106.

## Low issues backlog

Every Low finding from QA and review lands here (decisions.md, "Faster pipeline (owner)"). They are fixed together in a batch ticket LOW-n about every 3 tickets. LOW-1 closed L1 to L12, LOW-2 closed L13 to L26, LOW-3 closed L27 to L65, LOW-4 closed L66 to L86 (L86 accepted; L72, the dev DB cleanup, waits on the owner); those rows are in git history. Open (for LOW-5: L87 to L106 except L98, a watch item, and L105; L72 and L105 are the owner's):

| # | From | Issue | Area |
|---|---|---|---|
| L87 | LOW-4 review | After a failed task save, focus drops to `body`, so Escape no longer closes the form (existing behaviour). Keep focus in the form (on the field the error is tied to, or the first field). | FE, car page tasks |
| L88 | LOW-4 review | L71 (the "Run saved" note cleared when the car page fails to load after a run Save) has no smoke step. | Smoke |
| L89 | LOW-4 review | The LocalDB L69 test asserts `DbUpdateConcurrencyException`, not the 409 `concurrency.conflict` (the mapping is tested elsewhere, on InMemory). Assert the code, or say so in the test name. | Tests |
| L90 | LOW-4 review | Nobody has checked the long new Hebrew strings (L79, L84) for wrapping at 390px. Read the 390px screenshots, or leave it to browser QA when the owner restarts it. | FE, he strings |
| L91 | LOW-4 review | `client/ui-tests/smoke.mjs` `SV.editHint` still holds an old plural Hebrew string. It is only used in a "not shown" assertion, so that assertion always passes. Update it to the current string. | Smoke |
| L92 | RPT-1 review | Missing tests: the All time cars order, the `byCategory` and `byVehicle` tie order, the `kmDriven` clamp at 0, and the `CreatedAt` tie-break of the first reading. | Tests |
| L93 | RPT-1 review | `ReportService.cs:70` `Math.Round(serviceTotal / kmDriven, 4)` uses the default ToEven; the codebase uses `MidpointRounding.AwayFromZero`. | BE |
| L94 | RPT-1 review | The `.report a` 44px rule duplicates `index.css:226`. Remove the duplicate. | FE, CSS |
| L95 | RPT-1 review | `/reports?year=02025` shows a second, duplicate-looking year option. Normalise the year from the URL (or treat a non-canonical one as invalid). | FE, reports |
| L96 | RPT-1 review | The M2 fix (old figures keep their own `vehicleId` while a new filter loads) has no smoke step. | Smoke |
| L97 | RPT-1 housekeeping | More test users in the dev DB: `rpt1-a-*` and `rpt1-b-*@example.com`, `ui-rpt-*`, `probe-rpt-*`, `ui-rptdbg-*`. Check that `scripts/cleanup-test-users.sql` matches them (add tight prefixes if not); running it stays with the owner (L72). | Scripts |
| L98 | RPT-1 smoke run | One flaky desktop-light-en failure of `dashboard-mark-done` and `dashboard-quick-odometer` in one run, not reproduced. Watch for it; investigate if it recurs. | Smoke |
| L99 | RPT-2 review | Dead guards in `ReportsPage.tsx`: `topCategory > 0` (`:117`) and the `Math.max(0, …)` seed (`:92`); the backend never sends a zero category, and the section already hides when there are none. Remove them. | FE, reports |
| L100 | RPT-2 review | The comment at `ReportsPage.tsx:103` is broader than what it covers. Make it say what is decorative and why. | FE, reports |
| L101 | RPT-2 review | Only a 20px root font was tested at 390px; a blocked web font (a wider fallback font) was reasoned about, not tested. Add a smoke variant, or accept it in writing. | Smoke |
| L102 | RPT-2 review | No automated contrast check: the 6.0:1 and 6.3:1 for `--muted` on the card were computed by hand. Add a small contrast assertion from the computed colours to `reports-charts`. | Smoke |
| L103 | RPT-3 | The print line's date is fixed at page load (a documented shortcut), so a page left open past midnight prints yesterday's date. Set it on `beforeprint`. | FE, reports |
| L104 | RPT-3 review | Changing a filter while a CSV export runs re-enables the button for the new filters, so a second export can run at the same time. Allow one export at a time. | FE, reports |
| L105 | RPT-3 | Nobody has opened the exported CSV in real Excel (Hebrew, the BOM, `;` locales) or used the real print dialog and "Save as PDF". No agent can; the owner checks once (CHECKLIST.md, "Waiting on the owner"). | Owner |
| L106 | RPT-3 review | No smoke step for leaving `/reports` mid-export (no download must follow). | Smoke |
| L72 | LOW-3 housekeeping | The local dev DB has leftover test users. `scripts/cleanup-test-users.sql` was written in LOW-4 but never run; the owner decides (CHECKLIST.md, "Waiting on the owner"). | Dev DB (owner) |

## Next ticket

### LOW-5: Low backlog batch (L87 to L106)

**Goal:** As a user, the task form, the Reports page and its export behave better in the corners (focus after a failed save, a clean year list, the right print date, one export at a time), and the pipeline's checks cover what the last five tickets added.

**Spec:** no new requirement; fixes to sections 3, 8 and the test suite. The backlog rows L87 to L106 in this file are the source; each item below names its row.

**Binding decisions:** "Faster pipeline (owner)", "No ui-tester jobs (owner)", "RPT-1 sign-off", "RPT-2 sign-off", "RPT-3 sign-off", "Hebrew form of address".

**Scope**

*Backend (backend-engineer, runs first; no API change, no migration, no contract):*
- L93: `ReportService.cs:70` rounds cost per km with `MidpointRounding.AwayFromZero`, as the rest of the codebase.
- L92: tests for the All time cars order (active first, then nickname), the `byCategory` and `byVehicle` tie order, the `kmDriven` clamp at 0, and the `CreatedAt` tie-break of the first reading.
- L89: the LocalDB concurrency test asserts the 409 `concurrency.conflict` code, or its name says it checks the EF exception and points to the test of the mapping.
- L97: `scripts/cleanup-test-users.sql` matches the RPT test users (`rpt1-a-*`, `rpt1-b-*@example.com`, `ui-rpt-*`, `probe-rpt-*`, `ui-rptdbg-*`) and any RPT-2 or RPT-3 smoke prefixes, with tight patterns and its self-checks kept. Do not run it in delete mode (L72 is the owner's).

*Frontend (frontend-engineer, `client/src`, `client/ui-tests/smoke.mjs`):*
- L87: after a failed task save on the car page, focus stays in the form (on the field the error is tied to, else the first field), so Escape still closes it.
- L94: remove the duplicate `.report a` 44px rule (keep `index.css:226`).
- L95: the year from the URL is normalised (`02025` shows and requests 2025, one option); a non-number stays invalid as now.
- L99, L100: remove the dead `topCategory > 0` guard and the `Math.max(0, …)` seed in `ReportsPage.tsx`; make the chart comment say exactly what is decorative and why.
- L103: the print line's date is set when printing starts (`beforeprint`), not at page load; remove the shortcut comment.
- L104: one CSV export at a time: while one runs, the button stays busy for any filters, and a new export can start only after it ends.
- Smoke: L88 (the "Run saved" note cleared when the car page fails to load after a run Save), L91 (`SV.editHint` holds the current Hebrew string, so its "not shown" assertion can fail), L96 (old figures keep their own `vehicleId` links while a new filter loads), L101 (`reports-charts` at 390px with web fonts blocked, so the fallback font is tested), L102 (a contrast assertion for `--muted` on the card from the computed colours, at least 4.5:1, both themes), L106 (leave `/reports` mid-export: no download follows).
- L90: the engineer reads the 390px Hebrew smoke screenshots of the L79 and L84 strings and reports whether any wraps badly; a shorter string only if one does (the Hebrew reviewer approves it).

**Acceptance criteria**
1. [BE] Cost per km exactly halfway at the 5th decimal rounds away from zero (test).
2. [BE] The L92 tests exist and pass; the L89 test's name or assertion matches what it checks.
3. [BE] The cleanup script's patterns match every RPT test-user prefix and none of the owner's accounts (its self-checks still pass); it is not run in delete mode.
4. [FE] After a failed task save (for example a 400 on the name), `document.activeElement` is inside the form and Escape closes it (smoke, he and en).
5. [FE] `/reports?year=02025` shows one 2025 option and the 2025 figures (smoke).
6. [FE] The print line shows the date at the moment printing starts (a smoke check that changes the clock, then dispatches `beforeprint`, or an equivalent).
7. [FE] Starting an export and then changing a filter leaves the CSV button busy until the first export ends; exactly one download follows (smoke).
8. [FE] The smoke steps for L88, L91, L96, L101, L102 and L106 exist and pass; L102 asserts at least 4.5:1 in light and dark.
9. [FE] L94, L99 and L100 change no rendering: `reports-charts` and the other reports steps pass unchanged, including 44px links at 390px.
10. [FE] L90 is reported (screenshots named; fine or fixed).
11. [BE+FE] No regressions: `dotnet test` all pass, build clean, lint 0 warnings, no new dependency, smoke `SMOKE_ALL=1` passes in all 4 setups.

**Out of scope:** L72 (running the cleanup, the owner's); L98 (a flaky dashboard step seen once; look into it only if it shows up again in this ticket's runs, and say so); L105 (Excel and the real print dialog, the owner's); any new feature; any API or schema change.

**Open questions:** none.

---

### Later
- **After LOW-5:** notifications (spec 9): email when a task is due soon or overdue, non-mileage reminders (insurance, inspection, registration, licence), snooze and lead time (`NotificationRule`, `Notification` in Part 2). The ticket will ask the owner which email provider to use and for its credentials; the in-app parts (reminders, lead time, snooze) can start before them.
- **Car photo upload, attachments and run photos:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3, optional).
- **Data export and delete-account** (spec 12): must include checklists, runs, to-dos and tires.

## Changed since last audit
- **Signed off:** RPT-3 (not committed yet), **without browser QA** (the ui-tester is still stopped by the owner).
- **Status changes:** spec 8 "Export to CSV and PDF" goes from Missing to Done (no browser QA). All of spec 8 is now Done. Counts: Done 39 (was 38), Partial 6, Missing 6 (was 7), Deferred 6.
- **Backlog:** L103 to L106 added (RPT-3); L105 is the owner's (open the CSV in Excel, try the print dialog once).
- **New decisions** (`docs/decisions.md`, 2026-10-17): "RPT-3 sign-off", "Ticket after RPT-3" (LOW-5 before notifications).
- **Next ticket:** LOW-5 (L87 to L106), written in full. The RPT-3 ticket text is in git history once this sign-off is committed.
