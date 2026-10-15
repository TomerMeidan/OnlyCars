# OnlyCars: Requirements Status

**Audit date:** 2026-10-15 (seventh audit, sign-off of SET-1: backend commit `8a8dd1d`, plus the frontend, the review fixes and a test fix, which are not committed yet on `main`)
**Overall:** MVP steps 1 and 2 are complete for the MVP. SET-1 added a Settings page where language, light or dark theme, and currency each save to the account as soon as they change. Step 1 still lacks car photos (blocked on R2) and the km/mi unit, which is next (SET-2). Then comes step 3, service history.

| Status | Count |
|---|---|
| Done | 15 |
| API only | 0 |
| Partial | 7 |
| Missing | 28 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (seventh audit):
- Both dev servers were already running, and I left them as they were. The only uncommitted change outside `client/` is in `tests/` (`SettingsTests.cs`), so the live API already runs the SET-1 backend from `8a8dd1d`.
- `dotnet test`, built into a scratch artifacts folder because the running API locks `src/*/bin`: 181 of 181 passed (158 before SET-1).
- `client/ui-tests/smoke.mjs`: exit code 0, and all 46 steps `ok` in each setup (desktop-light-en and mobile-dark-he), including the new `settings-theme`, `settings-language`, `settings-currency` and `settings-save-fails`. The only 4xx responses were the expected 400s and 404s.
- `client/ui-tests/qa-set1.mjs`: exit code 0. Its only 5xx and network failures are the mocked ones (three 500s on `PUT /api/me/settings` and one offline save). Its 400s come from deliberate bad inputs. Its contrast check reads 15.59:1 for text and 5.98:1 for the legends and the hint in dark Hebrew.
- Screenshots I read:
  - `mobile-dark-he-41-settings-save-fails.png`: the Hebrew RTL page at 390px, showing the three groups (שפה, ערכת נושא, מטבע), "USD – דולר אמריקאי", and the no-conversion hint under the select. Nothing overflows, and the header shows the הגדרות link.
  - `desktop-light-en-40-settings-currency.png`: the car page in the forced dark theme from the earlier step, with every task row intact.
  - `qaset1-mobile-dark-he-02-list.png`: the Hebrew car list, where "הצגת רכבים בארכיון" is a full-height row (`label.inline`, `min-height: 2.75rem`, `client/src/index.css:126`).
- Reviews and QA, which I did not re-run:
  - Code review fixes: focus on save (`aria-disabled` and a busy guard), the rollback race, the theme flash (an inline script in `client/index.html:11`), the sticky header error, and the late `GET /me`. No `light-dark()` fallback is needed, because Lightning CSS compiles it.
  - Hebrew review: two strings improved.
  - UI QA: passed with no High or Medium, plus a throttled production-build check that showed no theme flash. Its three Lows and its question are decided in decisions.md ("SET-1 QA Lows", "Where the 'amounts are not converted' hint goes").
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
| Unit setting (km/miles), with the currency set per user | **Partial** | Currency is chosen at sign-up from ILS/USD/EUR/GBP, defaulting by UI language (`AuthPage.tsx:12-13,52`), validated and saved (`AuthService.cs:17,36-49`), and returned in `user.currency`. Smoke step `register-currency`. SET-1: the currency can be changed later on `/settings` (`client/src/pages/SettingsPage.tsx`, `PUT /api/me/settings`, `SettingsTests.cs`), and the car page's cost label follows it without a reload (smoke `settings-currency`, `qaset1-mobile-dark-he-14-cost-usd.png`). | No km/mi setting: the UI always shows "km" and never converts. That is SET-2, the next ticket. |

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
| 1. Auth, cars, odometer | **Complete for the MVP. MVP1-A, MVP1-B and MVP1-C are signed off.** Working end to end in EN and HE: register (with currency) and login; add, edit, archive and unarchive cars; quick odometer entry on the list and the car page (both now send the local date); edit and delete readings with the date-order rules and recompute; focus and page titles on every route. Settings (SET-1, signed off): language, theme and currency. Remaining: the km/mi unit (SET-2, next) and the car photo (blocked until the R2 credentials exist). |
| 2. Tasks, templates, km/time intervals, Reset | **Complete. MVP2-A, MVP2-B and MVP2-C are signed off.** All of spec sections 3 and 4 is done: tasks and templates, status with remaining km and days and a progress bar, the due-soon threshold, one-tap Mark done with optional cost and notes, and Undo. |
| Deploy gate | **SEC-1 signed off.** Nothing else blocks a first deploy except the owner's Azure account. |
| 3. Service history with costs | Not started. MVP2-C created `ServiceRecord` and `ServiceRecordTask` and the void endpoint; step 3 adds the history list, the full record form (date, odometer, shop, line items) and edit and delete. |
| 4. Dashboard with due/overdue status | Not started. The per-task status and the reset endpoint it needs both exist. |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | SET-2: Distance unit (km/mi), converted on display and input (plus SET-1 QA Lows 1 and 2) | BE, then FE | **Next** (written below) |
| 2 | MVP3-A: Service history list and the full service record form (spec section 5) | BE, then FE | Not written |

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

## Next ticket

### SET-2: Distance unit (km or miles)

**Goal:** A user who thinks in miles picks "Miles" in Settings, and from then on sees and enters every distance in the app in miles.

**Spec:** section 2, bullet 4 ("Unit setting (km/miles)"; SET-1 did the currency half). Part 2: `User.DistanceUnit`, and the convention "Distances are stored in km and converted for display". The column exists and `UserDto` already returns `distanceUnit` (`Km` or `Mi`), but nothing writes it.

**Binding decisions** (`docs/decisions.md`, 2026-10-15, "Distance unit rules, SET-2" and "SET-1 QA Lows"):
- Storage and the API stay in km. The client converts with 1 mi = 1.609344 km. Display rounds to whole miles; input rounds to whole km before it is sent.
- The unit saves through `PUT /api/me/settings`, defaults to Km, and is not asked at sign-up.
- Limits are shown in the user's unit, rounded down: "6,213,711 mi" for a reading and "621,371 mi" for a task interval.
- Average distance per day shows one decimal in the user's unit. Templates show converted values. The due-soon percent and time intervals don't change.
- SET-1 QA Low 1: while a radio group is saving, focus stays on its checked radio. Low 2: any new settings action, on the page or with the header switch, clears every earlier settings error.

**Scope**

*Backend (backend-engineer). Runs first. Publish the contract in `docs/contracts/SET-2.md`; it can extend `SET-1.md`.*
- `PUT /api/me/settings` also takes `distanceUnit`: `Km` or `Mi`, in the same casing as `UserDto`. A missing field is left unchanged, as for the others.
- An invalid value returns 400 `settings.invalidDistanceUnit` and saves nothing from the body. In the check order it comes after currency.
- No other endpoint changes. Every distance in requests, responses and error extensions (`previousKm`, `nextKm`, `currentKm`) stays in km.

*Frontend (frontend-engineer). Builds against `docs/contracts/SET-2.md`.*
- **One conversion module** (for example `client/src/units.ts`) covers km to the display value, the input value to km, the unit label, and the per-day value. Everything below uses it, and no screen converts on its own.
- **Settings page:** a fourth radio group, "Distance unit", with Kilometres or Miles. It saves on change like the other groups.
- **Every distance on screen follows the unit:**
  - Car list (`CarsPage.tsx`): the odometer digits and unit, the quick-add placeholder and value, and the average per day.
  - Car form (`CarFormPage.tsx`): the "Current odometer" label and value.
  - Car page (`CarPage.tsx`): the odometer, the quick-add, and the history list, including its edit form and the names of its Edit and Delete buttons.
  - Tasks (`TasksSection.tsx`): the interval, the last-done value, the remaining and overdue text, the add and edit forms (interval and last done), and the template picker's defaults.
  - Errors: the client-side validation messages and the translated server errors (`odometer.lowerThanPrevious`, `higherThanNext`, `invalidValue`, `task.invalidInterval`, `invalidLastDone`, and so on) show values and limits in the user's unit.
- **Strings:** every string that says "km" or "ק״מ" takes its unit from the module instead. In Hebrew, miles are "מייל" or "מיילים", and the Hebrew reviewer decides the forms. New strings: Distance unit, Kilometres, Miles, and `errors.settings.invalidDistanceUnit`.
- **SET-1 QA Lows 1 and 2**, on the Settings page and the header switch, as in the decisions above.

**Acceptance criteria**

*API*
1. [BE] `PUT /api/me/settings` with `{ "distanceUnit": "Mi" }` saves it, leaves the other settings unchanged, and returns the `UserDto` with `distanceUnit` `Mi`. `GET /api/me` and login then return `Mi`.
2. [BE] An invalid `distanceUnit` returns 400 `settings.invalidDistanceUnit` and saves nothing, even when the other fields are valid. Service tests cover criteria 1 and 2, and one user's change doesn't affect another user.

*Conversion*

3. [FE] With Miles chosen, a car at 80,467 km shows "50,000 mi" on the car list and the car page. Adding a reading of 50,100 mi stores 80,628 km (checked through the API) and shows "50,100 mi". A whole-mile value always shows back unchanged after saving.
4. [FE] A task with a 10,000 km interval shows "Every 6,214 mi". Its remaining and overdue text and its last-done value are in miles. Adding or editing a task with a 5,000 mi interval stores 8,047 km.
5. [FE] The server's date-order errors show the neighbouring reading in miles. The client blocks a reading above 6,213,711 mi, or an interval above 621,371 mi, with the limit in miles. The server never receives a value above its km cap.
6. [FE] The average per day shows one decimal in the user's unit ("31.1 mi/day").
7. [FE] Switching back to Kilometres shows every value exactly as before the switch, with no reload. Nothing stored changes when the unit changes.

*Settings page*

8. [BE+FE] The unit group saves on change. A failed save (mocked 500) reverts it and shows the translated error, as in the other groups.
9. [FE] SET-1 Low 1: an arrow key pressed while a group is saving leaves focus on its checked radio. Low 2: after a failed save, any later settings action (on the page or with the header switch) clears the old error, so the same error never shows twice.

*Every screen*

10. [FE] Hebrew and RTL: every new or changed string exists in `en` and `he`. Values with units read correctly in RTL, with the number and unit isolated as they are today. The Hebrew reviewer approves the mile forms.
11. [FE] Mobile: at 390px there is no horizontal overflow on the car list, the car page or Settings, in both units and both languages. A 7-digit mile value still fits the odometer digits. The new radios are at least 44px tall.
12. [FE] Accessibility: the unit group is a `fieldset` with a `legend`, and the Edit and Delete button names give the unit ("Edit reading 50,000 mi").
13. [BE+FE] Tests: `dotnet test` passes, with new tests for criteria 1 and 2. The conversion module has a small test or an assert-based self-check for rounding and the limits. `smoke.mjs` gains the steps `settings-unit-miles` (criteria 3, 4 and 7) and `settings-unit-errors` (criterion 5), and every step passes in both setups.

**Out of scope**
- Storing distances in miles, or a unit per car.
- Asking for the unit at sign-up.
- Starter templates with round mile values (such as 5,000 mi).
- Distances that don't exist yet (service records, tires and checklists). They will use the module when they're built.
- Live updates of settings across devices (SET-1 Low 3, accepted).

**Open questions:** none blocking; every rule is in decisions.md. For the owner to review: whether miles users should see round template intervals (such as 5,000 mi) instead of converted ones (6,214 mi), and whether to ask for the unit at sign-up.

---

### Later
- **MVP3-A, service history:** a list per car, the full record form (date, odometer, shop or DIY, cost, notes), and void or edit from the history.
- **Car photo upload:** blocked until the owner creates the Cloudflare R2 credentials.
- **Predicted due date** from `AvgKmPerDay` (spec 2.3): with the dashboard (step 4) or later.

## Changed since last audit
- **Signed off:** SET-1. The backend is in `8a8dd1d`; the frontend, the review fixes and the `SettingsTests.cs` fix are not committed yet.
- **Section 12:** "Light and dark mode" went from Partial to **Done**. "Hebrew and English UI" stays Done, and its `User.Locale` note is resolved.
- **Section 2:** "Unit setting (km/miles), with the currency set per user" stays **Partial**. The currency can now be changed, and only km/mi is missing (SET-2).
- **MVP2-C QA note (a)** ("Show archived" at 24px) is fixed.
- **Counts:** Done went from 14 to 15, and Partial from 8 to 7.
- **New decisions** (`docs/decisions.md`, 2026-10-15): the SET-1 QA Lows (1 and 2 are fixed in SET-2, and 3 is accepted), where the currency hint goes (Settings only), and the distance unit rules for SET-2.
- **Next ticket:** SET-2, written in full. The SET-1 ticket text is in git history up to `ad60b83`.
- **Tests:** `dotnet test` grew from 158 to 181 tests, and the smoke suite from 42 to 46 steps per setup.
