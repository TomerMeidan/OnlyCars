# OnlyCars: Requirements Status

**Audit date:** 2026-10-14 (third audit, after MVP1-B, commit `c444fa6`)
**Overall:** MVP step 1 (auth, cars, odometer) is functionally complete in English and Hebrew: readings can be fixed and deleted, and the currency is chosen at sign-up. MVP1-A and MVP1-B are signed off. Step 1 still lacks car photos (blocked on R2 credentials) and the km/mi setting; MVP1-C polishes accessibility. Step 2 (tasks) starts with MVP2-A.

| Status | Count |
|---|---|
| Done | 5 |
| API only | 0 |
| Partial | 7 |
| Missing | 38 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (third audit, MVP1-B sign-off):
- `git show --stat c444fa6`: 20 files, matching the ticket's scope (odometer PUT/DELETE, shared validate and recompute, currency at register, car page edit/delete/quick entry, smoke and QA scripts, tests).
- `dotnet test`: 54 of 54 passed.
- `client/ui-tests/smoke.mjs` passed all 16 steps in both setups, including the new `edit-reading`, `delete-reading` and `register-currency` steps. The only 4xx responses were the expected 400s (lower reading on add and on edit) and the 404s for another user's car (doubled by StrictMode). Screenshots went to a scratch folder, not `out/`.
- QA (not re-run by me) verified criteria 8, 9, 11, 17-23, 26, 27 and 29 in the browser; code, security and Hebrew reviews passed after a fix round.
- `curl` on port 5150 found one new backend bug outside MVP1-B's scope: `POST /api/vehicles` with `initialOdometerKm: 99999999999999` returns 500 (`decimal(12,2)` overflow), and `initialOdometerKm: -5` is accepted (201, current odometer -5). Both go into MVP1-C. A model-binding 400 (`"year":"abc"`) leaks the type name `OnlyCars.Application.Vehicles.Dtos.CreateVehicleRequest`; this goes into SEC-1.

How the second audit was checked:
- I read the full diff of `994a0c1` and the odometer, auth and vehicle services it touches.
- `dotnet test`: 31 of 31 passed.
- `client/ui-tests/smoke.mjs` passed all 13 steps in both setups, including the new `odometer-history`, `other-users-car-not-found` and `api-register-short-password` steps. The only 4xx responses were the expected 400 (lower reading) and 404s (another user's car). Screenshots were written to a scratch folder so they don't overwrite QA's run in `client/ui-tests/out/`. The screenshot names cited below are the same as in `out/`.
- `curl` against the API on port 5150: register with an empty email, `x`, or a 1-character password returns 400 with `auth.invalidEmail` or `auth.passwordTooShort`. Login with empty input returns 400 `auth.credentialsRequired`. `GET /api/vehicles/abc` returns 404 with an empty body and no `code`.

How the first audit was checked:
- I read every file in `src/`, `tests/` and `client/src/`.
- `dotnet test`: 17 of 17 passed.
- `client/ui-tests/smoke.mjs` passed every step in both setups (desktop-light-en and mobile-dark-he). No horizontal overflow, no console errors. The only 4xx response was the expected 400 for a lower odometer reading.
- `client/ui-tests/register.mjs` passed all 6 cases.
- I sent direct API calls with `curl` to test server-side validation.
- Screenshots are in `client/ui-tests/out/`.

---

## 1. Vehicles

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Add, edit and archive cars (archive on sale, keeping history) | **Done** | API: `VehiclesController.cs:28-54`, `VehicleService.cs:30-111`. UI: `CarFormPage.tsx`, `CarsPage.tsx:19-22,55-60`. Tests: `VehicleServiceTests.cs:12,65,84`. Browser: smoke steps `add-car`, `edit-car` and `archive-car` pass in both setups (`out/mobile-dark-he-08-archive-car.png`). | Nothing for the MVP. Unarchive works too. |
| Fields: nickname, make, model, year, VIN, plate, fuel type, purchase date, photo | **Partial** | All fields except photo are on the form (`CarFormPage.tsx:57-72`) and saved (`VehicleService.cs:41-55`). The form also has a purchase price field. | **Photo:** there is no upload. `PhotoUrl` is passed through unchanged (`CarFormPage.tsx:34`), there is no file endpoint, and the car card does not show a photo. Also, VIN uniqueness has no test for the edit path. |
| Current odometer, with a history of readings | **Done** | The car name links to a car page (`CarsPage.tsx:41`, route in `App.tsx`). `/cars/:id` shows the drum counter and the history, newest first, with value, source and date (`CarPage.tsx:45-63`). It has loading, empty, error and not-found states. API: `OdometerController.cs:14-35` (GET, POST, PUT, DELETE), `OdometerService.cs:20-87` with one shared `Recompute` (`OdometerService.cs:167`). Manual readings can be edited and deleted inline (`CarPage.tsx:145-178`); non-GUID ids show "not found" without an API call (`CarPage.tsx:16`). Tests: `OdometerServiceTests.cs` (50 tests). Browser: smoke steps `odometer-history`, `edit-reading`, `delete-reading` in both setups; QA criteria 8, 9, 11, 17-20. | Nothing for the MVP. Accessibility polish (focus after Save/Delete, 44px buttons) is in MVP1-C. |
| Multiple cars per account | **Done** | The list endpoint and UI loop over all of the user's cars (`VehicleService.cs:12-22`, `CarsPage.tsx:45-62`). Tests: `VehicleServiceTests.cs:84`. | The browser tests add only one car per user, so a list of several cars has not been checked in a browser. |

## 2. Mileage / Odometer

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Manual odometer updates (quick-entry button on the dashboard) | **Partial** | The quick entry on each car card works, including the lower-reading check and the correction checkbox (`CarsPage.tsx:69-114`, `OdometerService.cs:30-65`). Tests: `OdometerServiceTests.cs`. Smoke steps `odometer-*` pass. The lower-reading error is now translated and shows the current reading (`odometer.lowerThanCurrent`, `i18n.ts:64-67`; Hebrew in `mobile-dark-he-05-odometer-lower-rejected.png`). | Quick entry is now also on the car page (`CarPage.tsx:50`), and the date-order rules apply (`odometer.lowerThanPrevious` / `higherThanNext`). Still missing: (1) there is no dashboard yet (see section 10); (2) quick entry always saves today; backdating goes through Edit, which is acceptable for now. |
| Auto-log the odometer whenever a service is recorded | **Missing** | Only the `OdometerSource.Service` enum value exists (`Enums.cs:35`). | Depends on service records (MVP step 3). |
| Optional: estimated average km/day, used to predict when tasks come due | **Partial** | `AvgKmPerDay` is computed (`OdometerService.cs:72-99`, test at `OdometerServiceTests.cs:91`) and shown on the card (`CarsPage.tsx:50-52`). | Nothing uses it for predictions yet, because tasks don't exist. |
| Unit setting (km/miles), with the currency set per user | **Partial** | Currency is chosen at sign-up from ILS/USD/EUR/GBP, defaulting by UI language (`AuthPage.tsx:12-13,52`), validated and saved (`AuthService.cs:17,36-49`), and returned in `user.currency`. Smoke step `register-currency`; QA criteria 21-23. | No way to change the currency after sign-up. No km/mi setting: the UI always shows "km" and never converts. Both need a settings screen. |

## 3. Maintenance Task Definitions

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Task name and category | **Missing** | none | `MaintenanceTask` entity, API and UI |
| Interval by km, by time, or both (whichever comes first) | **Missing** | none | Everything |
| Starter template library, fully editable | **Missing** | none | `TaskTemplate` seed data and UI |
| Per-car custom tasks | **Missing** | none | Everything |
| Enable/disable a task without deleting it | **Missing** | none | Everything |

## 4. The "Roborock" Reset Behavior

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Remaining km/days, progress bar, status (OK, Due soon, Overdue) | **Missing** | none | Everything |
| Reset / Mark as done (records odometer and date, restarts the countdown, creates a history entry with optional cost and notes) | **Missing** | none | Everything |
| Undo for accidental resets | **Missing** | none | Everything |
| Configurable "due soon" threshold | **Missing** | none | Everything |

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
| Per-user data isolation, data export and delete-account | **Partial** | Isolation: every vehicle and odometer call checks ownership and returns 404 for other users' data (`VehicleService.cs:113-128`). Tests: `VehicleServiceTests.cs:52`, `OdometerServiceTests.cs:78`. | No data export and no delete-account. |
| Hebrew and English UI, including RTL | **Done** | Every UI string exists in `en` and `he`, and `he: typeof en` makes the compiler enforce it (`i18n.ts`). `dir` is set to rtl or ltr. Every API error now has a stable `code` (`AppException.cs`, `GlobalExceptionHandler.cs`, fallback `http.<status>` in `Program.cs`). The client translates the code, or shows a translated generic message for unknown codes (`i18n.ts:154-157`). Tests: `GlobalExceptionHandlerTests.cs`. Browser: the Hebrew error screenshots `mobile-dark-he-05-*` and `-08-*`. | The language choice is saved only in localStorage, not in `User.Locale`. This is a settings gap, not a UI-language gap. |
| Receipt image storage with size limits | **Missing** | none | Everything. Car photo upload needs the same storage. |
| Offline-tolerant odometer entry (sync later) | **Missing** | The service worker caches only the app shell. | Quick entry posts directly and fails when offline. There is no queue. |

### Data model checks (Part 2, MVP step 1 tables only)
- Done: `User`, `Vehicle` and `OdometerReading` have all spec fields, plus Id, CreatedAt and UpdatedAt.
- Done: money is stored as decimal(12,2) (`VehicleConfiguration.cs:16-18`).
- Done: the unique index on Vehicle(UserId, Vin) where Vin is not null (`VehicleConfiguration.cs:26-28`).
- Done: the index on OdometerReading(VehicleId, ReadingDate DESC) (`OdometerReadingConfiguration.cs:19-20`).
- Done: readings must fit date order (lower than the previous or higher than the next is rejected) unless the user confirms; future dates and values outside 0 to 10,000,000 km are rejected (`OdometerService.cs:113-160`).
- Bug: `Vehicle` creation does not apply the same 0 to 10,000,000 range to `InitialOdometerKm` (`VehicleService.cs:54-59`). A huge value returns 500, a negative one is saved. Fixed in MVP1-C.
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Functionally complete; MVP1-A and MVP1-B signed off.** Working end to end in EN and HE: register (with currency) and login with server-side validation; add, edit, archive and unarchive cars; quick odometer entry on the list and the car page; edit and delete readings with date-order rules and recompute. Remaining: MVP1-C (accessibility polish plus the initial-odometer cap), car photo (blocked until the R2 credentials exist), and the km/mi and currency settings screen (scheduled after MVP step 2; it doesn't block anything). |
| 2. Tasks, templates, km/time intervals, Reset | **Planned.** Split into MVP2-A (data model, templates, task CRUD), MVP2-B (status and due-soon threshold) and MVP2-C (Reset and Undo). MVP2-A is written below. |
| Deploy gate | **SEC-1** (auth rate limiting, constant-time login) must land before the first deploy. It does not block step 2. |
| 3. Service history with costs | Not started |
| 4. Dashboard with due/overdue status | Not started |
| 5. Checklists, tires, reports, notifications | Not started |

## Ticket queue

| Order | Ticket | Who | State |
|---|---|---|---|
| 1 | MVP1-C: accessibility polish, initial-odometer cap | BE (small), then FE | **Next** |
| 2 | MVP2-A: task data model, templates, task CRUD | BE, then FE | Ready (written below) |
| 3 | SEC-1: pre-deployment hardening | BE only | Ready. Slot: backend-engineer picks it up after MVP2-A's backend, while frontend-engineer builds MVP2-A's frontend. **Must land before any deploy.** Never blocks step 2. |
| 4 | MVP2-B: task status and due-soon threshold | BE, then FE | Outlined |
| 5 | MVP2-C: Reset and Undo | BE, then FE | Outlined |

## Signed-off tickets

- **MVP1-A (commit `994a0c1`): signed off 2026-10-14.** Server-side auth validation, translated API errors, odometer history page. QA passed every scripted step; its open findings (malformed ids, encoded ids, history and counter disagreeing, drum label unit) were fixed in MVP1-B, and the rest (focus, title, back link) are in MVP1-C.
- **MVP1-B (commit `c444fa6`): signed off 2026-10-14.** All 30 criteria met. Evidence: code, security and Hebrew reviews passed after one fix round; QA verified criteria 8, 9, 11, 17-23, 26, 27 and 29 in the browser; the smoke suite (16 steps, both setups) covers 1, 4, 10, 16, 24 and 28; 54 xUnit tests cover 2-7, 12-15, 24 and 25; I re-ran `dotnet test` and smoke myself. QA's leftover findings (25px history buttons, focus lost after Save/Delete, amber confirm Delete) went to MVP1-C. Criterion 30 asked for "unit tests for criteria 2 to 15"; 10 and 11 are covered by smoke and QA rather than xUnit, which I accept.

### MVP1-B (signed off): Fix bad odometer readings, choose a currency at sign-up

**Goal:** A user can fix or remove a wrong odometer reading from the car page, and the car's odometer stays correct afterwards. A new user picks their currency when they sign up.

**Binding decisions** (`docs/decisions.md`):
- Readings can be edited and deleted, and `CurrentOdometerKm` and `AvgKmPerDay` are recomputed afterwards.
- Odometer dates:
  - Readings dated in the future are rejected.
  - A reading must fit date order unless the user confirms a correction.
  - The current odometer is the latest-dated reading.
- Currency is asked at sign-up.
- Odometer history lives on `/cars/:id`.

**Defaults the PM chose for this ticket** (the owner delegated these decisions; review them when the owner returns):
- **Reading order.** Readings are ordered by `ReadingDate`, then `CreatedAt`, oldest first. This is the order the server uses for the order checks and the recompute; the history UI and the GET API show the same order reversed, newest first. "The reading before" and "the reading after" a given reading mean its neighbours in this order, excluding the reading itself. Equal values are allowed (order is non-decreasing).
- **Future date.** "Future" means later than the server's UTC date plus 1 day. The extra day gives slack for Israel, which is ahead of UTC: just after midnight local time, a user's "today" is still tomorrow in UTC.
- **Recompute.** After every add, edit and delete, the server runs one shared recompute:
  - `CurrentOdometerKm` = `ValueKm` of the last reading in the order above.
  - `AvgKmPerDay` uses the existing formula (`OdometerService.cs:72-99`) over all remaining readings, so it is null with fewer than 2 readings, 0 days between the first and last reading, or no increase.
  - The old backfill branch in `AddAsync` (`OdometerService.cs:52-58`) is removed, because the recompute replaces it.
- **Only reading.** The only reading on a car can't be deleted, because deleting it would reset the odometer to 0. The user can edit it instead.
- **Non-manual readings.** Only `Source = Manual` readings can be edited or deleted here. Readings from `Service`, `Checklist` or `Fuel` belong to their source record (spec 5, "edit and delete past records") and are fixed there. None exist yet; this rule protects step 3.
- **Archived cars.** History is read-only in the UI, matching how the car list hides quick entry on archived cars (`CarsPage.tsx:55`). The API does not block it. This matches `AddAsync`.
- **Currencies.** The allowed list is `ILS`, `USD`, `EUR` and `GBP`. The default follows the UI language: Hebrew gives ILS, English gives USD. A register request without a currency gets `ILS`, the entity default (`User.cs:10`).

**Scope**

*API*
- **Edit a reading:** `PUT /api/vehicles/{vehicleId}/odometer/{readingId}`.
  - Body: `{ valueKm, readingDate, confirmCorrection }`.
  - Returns 200 with `OdometerReadingDto`.
- **Delete a reading:** `DELETE /api/vehicles/{vehicleId}/odometer/{readingId}`. Returns 204.
- **Add a reading:** `POST /api/vehicles/{vehicleId}/odometer` keeps its contract. It now uses the same date-order check and the same recompute as edit.
- **New error codes.** Each one is a coded `AppException`, so it goes through `GlobalExceptionHandler` like the existing codes.

  | Code | Status | Extension | Meaning |
  |---|---|---|---|
  | `odometer.lowerThanPrevious` | 400 | `previousKm` | The value is lower than the reading before it. Replaces `odometer.lowerThanCurrent`. |
  | `odometer.higherThanNext` | 400 | `nextKm` | The value is higher than the reading after it. |
  | `odometer.futureDate` | 400 | none | The date is in the future. |
  | `odometer.invalidValue` | 400 | none | `valueKm` is negative. `AddOdometerReadingRequest` doesn't check this today. |
  | `odometer.onlyReading` | 409 | none | The user tried to delete the car's only reading. |
  | `odometer.notManual` | 409 | none | The user tried to edit or delete a reading whose `Source` is not `Manual`. |
  | `odometerReading.notFound` | 404 | none | No such reading on this car. Comes from the existing `NotFoundException`. |

- **Register:** `RegisterRequest` gains an optional `Currency`.
  - It is validated against the allowed list and saved to `User.Currency`.
  - An unknown value returns 400 `auth.invalidCurrency`.
  - The auth response's `user.currency` returns the saved value. `UserDto` already has the field.

*Client*
- **History actions on `/cars/:id`.** Each `Manual` row has Edit and Delete buttons, except on archived cars.
  - **Edit** opens an inline form in the row: a value field (number, min 0) and a date field (`type="date"`, `max` = local today). It has Save and Cancel buttons.
  - **Delete** asks for confirmation inline in the row ("Delete this reading?" with Delete and Cancel). Don't use `window.confirm`.
- **Quick entry on `/cars/:id`.** Reuse `OdometerQuickEntry` from `CarsPage.tsx`, hidden for archived cars. After any add, edit or delete, refresh both the drum counter and the history.
- **Correction prompt.** The correction checkbox appears on a `lowerThanPrevious` or `higherThanNext` error, in quick entry and in the edit form. This replaces the `odometer.lowerThanCurrent` check at `CarsPage.tsx:88`.
- **Malformed ids** (QA item 1). On `/cars/:id` and `/cars/:id/edit`, an id that isn't a GUID shows "This car was not found." (`errors.vehicle.notFound`) without calling the API.
- **Encoded ids** (QA item 2). Pass the route id through `encodeURIComponent` before building any API path (`CarPage.tsx:17`, `CarFormPage.tsx:17`).
- **Currency picker on the register form.**
  - A `<select>` with the 4 currencies. Each label is the code plus its name in the UI language, from `Intl.DisplayNames`, for example "ILS – Israeli New Shekel" or "ILS – שקל חדש".
  - The default follows the UI language until the user changes the picker. After that, switching language keeps the user's choice.
  - Not shown on the login form.
- **Strings.** New strings for the buttons, the confirm text and every new error code, in `en` and `he`.

**Acceptance criteria**

*Edit*
1. Editing a Manual reading's value or date saves it, and the history shows the change after the save, re-sorted by date.
2. After an edit, `CurrentOdometerKm` equals the value of the latest-dated reading, and the drum counter on `/cars/:id` and on the car list shows it. Editing an older reading does not change the current odometer. Editing the latest reading does.
3. `AvgKmPerDay` is recomputed after every edit. A unit test covers a case where it changes and a case where it becomes null.
4. Editing a reading to a value lower than the reading before it returns 400 `odometer.lowerThanPrevious` with `previousKm`, and nothing is saved. The UI shows the translated message with the number and the correction checkbox. Saving again with the box ticked succeeds.
5. Editing a reading to a value higher than the reading after it returns 400 `odometer.higherThanNext` with `nextKm`, and nothing is saved. The same correction flow then works.
6. The order check uses the reading's new date. Moving a reading's date past a neighbour is checked against its new neighbours, not its old ones. A unit test covers this.
7. A value equal to a neighbour's value is accepted without confirmation.
8. A date later than UTC today plus 1 day returns 400 `odometer.futureDate`, even with `confirmCorrection` set. The date field doesn't let the user pick a date after their local today.
9. A negative `valueKm` returns 400 `odometer.invalidValue` on both edit and add.

*Delete*

10. Deleting a Manual reading needs the inline confirmation. After confirming, it disappears from the history, and `CurrentOdometerKm` and `AvgKmPerDay` are recomputed. Deleting the latest reading makes the previous reading the current odometer.
11. The only reading on a car has no Delete button. The API returns 409 `odometer.onlyReading` for it, and the reading and the odometer are unchanged.
12. Deleting a reading never needs `confirmCorrection`, even if the remaining readings are out of order.

*Rules for every write*

13. A reading whose `Source` is not `Manual` has no Edit or Delete button. A PUT or DELETE on it returns 409 `odometer.notManual`. Seed one in a unit test, because the UI can't create one yet.
14. A reading id that belongs to another car or another user's car returns 404. Nothing is changed, and nothing is revealed about the other car. Unit tests cover both cases.
15. Adding a reading:
    - Uses the same order check and recompute as editing.
    - A backdated reading higher than a later reading returns `odometer.higherThanNext`.
    - A future-dated reading returns `odometer.futureDate`.
    - This fixes QA item 3: the history and the drum counter can no longer disagree.
16. Today-dated quick entry behaves as before, but with the new code. A value lower than the latest reading shows the translated message and the correction checkbox. Smoke steps `odometer-lower-rejected` and `odometer-correction-confirmed` are updated and pass.

*Car page*

17. `/cars/:id` has the quick entry for active cars and not for archived cars. Saving a reading updates the counter and the history without a page reload.
18. Archived cars show the history with no Edit, Delete or quick entry.
19. `/cars/abc` and `/cars/abc/edit` show "This car was not found." in English and "הרכב לא נמצא." in Hebrew. No request goes to `/api/vehicles/abc`.
20. `/cars/%2e%2e%2fvehicles` makes no request outside `/api/vehicles/{id}`. It shows "not found" under criterion 19.

*Currency*

21. The register form shows a currency picker with exactly ILS, USD, EUR and GBP, labelled in the UI language.
22. With a Hebrew UI the picker starts on ILS; with an English UI it starts on USD.
23. Switching language before touching the picker moves the default. Switching after the user picks keeps the pick.
24. After sign-up, `User.Currency` holds the choice. Logging in again returns it in `user.currency`.
25. `POST /api/auth/register` with an unknown currency (`"XYZ"` or `"ils "`) returns 400 `auth.invalidCurrency`, with a translated message in `en` and `he`. Without a currency, it saves `ILS`. Unit tests cover all three cases.

*Every screen*

26. Hebrew and RTL. Every new string exists in `en` and `he`. Numbers in history rows and error messages stay left-to-right inside RTL text (use `<bdi>` like the existing rows). Buttons and the inline forms lay out correctly in RTL.
27. Mobile. At 390px wide there is no horizontal overflow on `/cars/:id` with an edit form open and with a delete confirmation open, or on the register form.
28. Loading, error and empty states:
    - Save, Delete and Register buttons are disabled while their request is in flight.
    - An API failure shows the translated message in the row or form (`role="alert"`), and the row's original values stay.
    - A car with no readings shows "No readings yet." with no actions.
29. Accessibility. Each Edit and Delete button's accessible name includes the reading, for example "Edit reading 61,250 km" or "ערוך קריאה 61,250 ק״מ".
30. Tests.
    - `dotnet test` passes, with new unit tests for edit, delete and recompute, covering criteria 2 to 15 and 24 to 25.
    - `smoke.mjs` gains three steps that pass in both setups: `edit-reading` (including one correction), `delete-reading`, and `register-currency` (checks the default and the saved value through the auth response).
    - The 404s that StrictMode doubles in the dev run are expected (QA item 6) and are not counted as failures.

**Out of scope**
- **A date picker on quick entry.** Quick entry still saves today's date. Backdating goes through Edit.
- **Changing the currency after sign-up,** and the km/mi setting. Both belong in a settings screen.
- **Persisting `User.Locale`.**
- **Car photo upload.** It is blocked until the owner creates the Cloudflare R2 credentials.
- **Showing money in the chosen currency.** No screen shows money yet except the purchase price input.
- **Fixing existing bad data.** The dev database has future-dated readings from QA. The recompute fixes each car on its next write. There is no production data.
- **Editing readings from Service, Checklist or Fuel.** This comes with their source records in MVP step 3 and later.
- **Undo for delete.**

**Open questions**
- None. Every rule above comes from `docs/decisions.md` or is a PM default listed under "Defaults the PM chose". The owner can overrule any default when they return. The likeliest to change are the USD default for English and the rule that blocks deleting the only reading.

## Next tickets

### MVP1-C (next, small): Accessibility polish and the initial-odometer cap

**Goal:** A keyboard, screen-reader or phone user can move around the car pages without losing their place or missing a tap target, and creating a car with an impossible starting odometer gives a clear error instead of a server error.

**Defaults the PM chose** (owner delegated; review on return):
- **Focus after Save** in the inline edit form: the saved row's Edit button.
- **Focus after Delete:** the Edit button of the row that took the deleted row's place (the next older reading). If the deleted row was the last row, the newest remaining row. If no row has an Edit button, the history `h2` (made focusable with `tabindex="-1"`).
- **Focus after Cancel or Escape:** the button that opened the form (Edit or Delete).
- **Escape** closes the inline edit form and the delete confirmation, the same as Cancel. Cheap, and expected by keyboard users.
- **Destructive style:** a new `--danger` colour token (red) for light and dark, used only for the confirm Delete button. It needs 4.5:1 contrast for its text in both themes.
- **`document.title` format:** `<page> · OnlyCars`, for example "Test Corolla · OnlyCars", "My cars · OnlyCars", "Sign in · OnlyCars". The page part is translated; "OnlyCars" is not.

**Scope**

*Backend (backend-engineer)*
- `POST /api/vehicles`: validate `InitialOdometerKm` with the same range as readings, 0 to 10,000,000 (`OdometerService.cs:18`, `MaxValueKm`). Reuse the constant; don't copy the number.
- Out of range returns 400 `odometer.invalidValue`, the existing code, so the client already has a translated message.
- `PUT /api/vehicles/{id}` takes no odometer value (`UpdateVehicleRequest`), so nothing to do there.

*Frontend (frontend-engineer)*
- **Route focus and title.** On every route change, move focus to the page's `h1` (`tabindex="-1"`, no visible outline jump beyond the normal focus ring) and set `document.title` as above. Not on the first page load, so the browser's default focus stays.
- **Back link.** "All cars" (`CarPage.tsx:33`) becomes an inline link whose focus outline hugs the text, with a tap target at least 44px tall on mobile (padding, not a wider box).
- **History buttons.** Edit, Delete, Cancel and the confirm Delete in history rows are at least 44px tall at 390px wide (today they measure 25px). The rows may grow; no horizontal overflow.
- **Focus management** after Save, Delete, Cancel and Escape, as above.
- **Confirm Delete** uses the `--danger` style instead of amber. The first Delete link in the row stays a plain link.
- **Car form:** show the translated `odometer.invalidValue` message when the API rejects the initial odometer, and set the input's `max` to 10000000 (min is already 0).

**Acceptance criteria**
1. [BE] `POST /api/vehicles` with `initialOdometerKm` of `-1` or `10000001` returns 400 `odometer.invalidValue`, and nothing is saved. `99999999999999` returns 400, not 500. `0` and `10000000` succeed. Unit tests cover all four.
2. [FE] After every client-side navigation (list to car page, car page to edit, back, sign in to list), focus is on the new page's `h1`, and a screen reader announces it. Checked in both smoke setups.
3. [FE] `document.title` matches the format above on the car list, car page, add car, edit car, sign-in and register pages, in English and Hebrew.
4. [FE] The "All cars" link's focus outline wraps only the text, and its tap target is at least 44px tall at 390px wide (measured with `getBoundingClientRect`).
5. [FE] At 390px wide, Edit, Delete, Cancel and confirm Delete in the history are each at least 44px tall, and there is no horizontal overflow with the edit form or delete confirmation open, in Hebrew and English.
6. [FE] After Save, focus is on the saved row's Edit button. After Delete, focus follows the rule above. After Cancel or Escape, focus returns to the button that opened the form. Focus never lands on `body`.
7. [FE] Escape closes the edit form and the delete confirmation without saving. Escape does nothing when no form is open.
8. [FE] The confirm Delete button is red in light and dark mode, with text contrast at least 4.5:1. Screenshots in both themes.
9. [FE] Entering 20000000 as the initial odometer on the add car form is blocked by the input or shows the translated `odometer.invalidValue` message; the form keeps its values.
10. [BE+FE] RTL: focus rings, the back link and the larger buttons lay out correctly in Hebrew. Every new string (page titles) exists in `en` and `he`.
11. [BE+FE] `dotnet test` passes with the new tests. `smoke.mjs` gains checks for criteria 2, 3, 5 and 6 (focus after Save) and passes in both setups. Take screenshots of the focus ring in light and dark mode.

**Out of scope**
- Skip links, a full WCAG audit, or focus traps (there are no modals).
- Any visual redesign beyond the button heights, the back link and the danger colour.
- The odometer drum label: already done in MVP1-B.

**Open questions:** none; the defaults above are the PM's.

---

### SEC-1 (deploy gate): Pre-deployment hardening of auth

**Goal:** Before the app is on the public internet, an attacker can't brute-force passwords or learn which emails have accounts by timing the login.

**When:** after MVP2-A's backend, while frontend-engineer builds MVP2-A's frontend. It must land before the first deploy to Azure, and it never blocks MVP step 2.

**Defaults the PM chose** (owner delegated; review on return):
- **Limits.** Per IP: 10 requests per 15 minutes across `POST /api/auth/login` and `POST /api/auth/register` together (fixed window). Per email on login: 10 **failed** attempts per 15 minutes per normalized email; a successful login does not count. Global: 300 requests per minute per IP across the whole API, so normal use (including the smoke suite) never hits it.
- **Response.** 429 with code `auth.tooManyAttempts` on auth endpoints and `http.429` elsewhere, a `Retry-After` header in seconds, and the usual problem-details body.
- **Per email is checked after the per-IP limit**, so a single IP can't use it to probe. A known trade-off: an attacker can lock a victim's login for up to 15 minutes by failing it 10 times. Accepted for a personal app.
- **In memory, single instance.** Counters live in process memory: they reset on restart and are not shared between instances. Fine for one Azure App Service instance on the free tier. If the API scales out, move to a shared store (Redis or SQL). The code gets a `shortcut:` comment saying so.
- **Client IP behind Azure.** App Service puts a proxy in front of the app, so `RemoteIpAddress` is the proxy's. Configure `ForwardedHeaders` (`X-Forwarded-For`) so the per-IP limit uses the real client, or every user shares one bucket.
- **Type names in 400s** (optional item): done, because it is small. Model-binding errors currently say "could not be converted to OnlyCars.Application.Vehicles.Dtos.CreateVehicleRequest" (seen with `"year":"abc"`).

**Scope**

*Backend (backend-engineer)*
- `builder.Services.AddRateLimiter` with: a partitioned fixed-window policy per IP applied to the auth controller's login and register actions, and a global limiter per IP. `app.UseRateLimiter()` in the right pipeline position. `OnRejected` writes the 429 problem body with the code and `Retry-After`.
- A per-email failed-login counter, in memory (for example `IMemoryCache` keyed by normalized email with a 15-minute expiry), checked in `AuthService.LoginAsync` before the password check, and incremented on every failure.
- **Constant-time login.** When the email is unknown, `LoginAsync` (`AuthService.cs:67-71`) still runs `passwordHasher.VerifyHashedPassword` against a dummy hash created once (static, from the same `PasswordHasher<User>`), then throws the same `auth.invalidCredentials`. Wrong password and unknown email take the same code path and the same response.
- **Model-binding 400s.** Replace the default validation messages so a malformed body returns 400 `http.400` with field names only (for example `{"year": ["Invalid value."]}`), with no .NET type names, paths or byte positions.
- `ForwardedHeaders` configured for Azure App Service.

*Frontend (frontend-engineer)*
- Add `auth.tooManyAttempts` to `en` and `he` ("Too many attempts. Try again in a few minutes." / "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות."). No other UI change.

**Acceptance criteria**
1. [BE] The 11th login or register request from one IP within 15 minutes returns 429 `auth.tooManyAttempts` with a `Retry-After` header. An integration or unit test covers it (using a short window in tests is fine).
2. [BE] The 11th failed login for one email within 15 minutes returns 429 even when the requests use different IPs (test by calling the service directly). A correct password for that email is also refused until the window passes.
3. [BE] Normal API use is unaffected: the smoke suite passes in both setups with the limiter on. Note: the smoke suite registers and logs in several users from one IP; if it exceeds 10 auth calls per run, make the limits configurable via `appsettings.Development.json` (not a code switch) and raise them there.
4. [BE] Login with an unknown email calls the password hasher exactly once (unit test with a counting hasher), and returns the same status, code and body as a wrong password.
5. [BE] `POST /api/vehicles` with `{"year":"abc"}` returns 400 whose body contains no "OnlyCars", no "Dtos" and no "LineNumber".
6. [BE] With `X-Forwarded-For` set by the proxy, two different client IPs get separate buckets. Document the App Service setting needed, if any, in the PR.
7. [FE] A 429 on sign-in or register shows the translated message in English and Hebrew, in the form's existing `role="alert"` area.
8. [BE] The rate-limit code carries a `shortcut:` comment about in-memory, single-instance counters.

**Out of scope**
- CAPTCHA, account lockout emails, 2FA, refresh-token rotation, a security headers pass, and HTTPS/HSTS config (Azure terminates TLS). Raise these in a later SEC ticket if the security review asks.
- A distributed (Redis) limiter.

**Open questions:** none.

---

### MVP2-A: Maintenance tasks on a car, from templates or custom

**Goal:** On a car's page, a user can add maintenance tasks (from a starter library or their own), set a km interval, a time interval or both, record when each was last done, edit them, and turn them off without deleting them.

**Spec:** section 3, all five bullets; data model Part 2 "Maintenance" (`TaskTemplate`, `MaintenanceTask`) and the check constraint "each MaintenanceTask needs at least one of IntervalKm or IntervalDays". Status, remaining km/days, Reset and Undo (section 4) are MVP2-B and MVP2-C.

**Defaults the PM chose** (owner delegated; review on return):
- **Tasks live on `/cars/:id`,** in a "Maintenance" section above the odometer history (decisions.md: the car page will hold tasks).
- **Categories** (fixed enum, stored like `FuelType`): `Oil`, `Filters`, `Brakes`, `Tires`, `Fluids`, `Battery`, `Belts`, `Ignition`, `Other`. These are the spec's examples plus spark plugs (`Ignition`) and a catch-all.
- **Template names in two languages.** `TaskTemplate` gets a stable `Key` (for example `oilChange`) next to the spec's `Name` (English). The client shows `templates.<key>` from `i18n.ts`. When a user adds a task from a template, the form is prefilled with the template's name in the current UI language, and that text is saved as the task's `Name`; the user can change it. Templates are global and read-only to users; "fully editable" (spec 3) is met because the user's copy is fully editable.
- **Starter library** (12 seeded templates, generic intervals, the user edits them per car):

  | Key | English name | Category | Km | Days |
  |---|---|---|---|---|
  | `oilChange` | Engine oil and filter | Oil | 10,000 | 365 |
  | `airFilter` | Air filter | Filters | 20,000 | 730 |
  | `cabinFilter` | Cabin filter | Filters | 15,000 | 365 |
  | `brakePads` | Brake pads check | Brakes | 20,000 | 365 |
  | `brakeFluid` | Brake fluid | Fluids | none | 730 |
  | `coolant` | Coolant | Fluids | 60,000 | 1,825 |
  | `transmissionFluid` | Transmission fluid | Fluids | 60,000 | none |
  | `sparkPlugs` | Spark plugs | Ignition | 60,000 | none |
  | `timingBelt` | Timing belt | Belts | 100,000 | 1,825 |
  | `tireRotation` | Tire rotation | Tires | 10,000 | none |
  | `battery` | Battery check | Battery | none | 365 |
  | `wiperBlades` | Wiper blades | Other | none | 365 |

- **Last done.** `LastDoneOdometerKm` and `LastDoneDate` are required. The add form prefills them with the car's current odometer and today; the user can change them. "Never done / unknown" is not supported in MVP2-A.
- **Interval entry.** Km is a whole number. Time is entered as a number plus a unit (days, months, years); the server only stores `IntervalDays`, with months = 30 days and years = 365 days. Display picks the largest unit that divides evenly (365 → "1 year", 180 → "6 months", 45 → "45 days").
- **Ranges.** `IntervalKm` 1 to 1,000,000. `IntervalDays` 1 to 7,300 (20 years). `LastDoneOdometerKm` 0 to the car's current odometer (a task can't have been done at a km the car hasn't reached). `LastDoneDate` not later than UTC today plus 1 day (the odometer rule). `Name` 1 to 100 characters after trimming.
- **`DueSoonPercent`.** Column created now with default 10; not shown or editable until MVP2-B.
- **Delete.** Hard delete with an inline confirmation, like readings. Once service records exist (MVP2-C), deleting a task with history needs a new rule; not now.
- **Duplicates allowed.** The same template can be added twice (for example two oil change schedules); no uniqueness check.
- **Archived cars:** tasks are shown read-only in the UI; the API does not block writes (same as readings).
- **Order:** enabled tasks first, then by name (culture-aware compare in the UI language).

**Scope**

*Backend (backend-engineer)*
- **Entities** in `OnlyCars.Domain`: `TaskCategory` enum; `TaskTemplate` (`Key`, `Name`, `Category`, `DefaultIntervalKm` int?, `DefaultIntervalDays` int?); `MaintenanceTask` (`VehicleId`, `TemplateId` nullable FK, `Name`, `Category`, `IntervalKm` int?, `IntervalDays` int?, `DueSoonPercent` int default 10, `IsEnabled` default true, `LastDoneOdometerKm` decimal(12,2), `LastDoneDate` date). Id, CreatedAt, UpdatedAt as usual. `Vehicle` 1-N `MaintenanceTask`, cascade delete.
- **EF configuration and one migration:** index `MaintenanceTask(VehicleId, IsEnabled)`; check constraint `IntervalKm IS NOT NULL OR IntervalDays IS NOT NULL` on both tables; unique index on `TaskTemplate.Key`; the 12 templates seeded with `HasData` and fixed GUIDs.
- **Endpoints** (all require auth; vehicle ownership checked like odometer, 404 for another user's car):
  - `GET /api/task-templates` returns `TaskTemplateDto[]` (`id, key, name, category, defaultIntervalKm, defaultIntervalDays`), ordered by category then key.
  - `GET /api/vehicles/{vehicleId}/tasks` returns `MaintenanceTaskDto[]` (`id, vehicleId, templateId, name, category, intervalKm, intervalDays, dueSoonPercent, isEnabled, lastDoneOdometerKm, lastDoneDate`).
  - `POST /api/vehicles/{vehicleId}/tasks`, body `{ templateId?, name, category, intervalKm?, intervalDays?, lastDoneOdometerKm, lastDoneDate }`, returns 201 with the DTO. The server stores what the client sends; `templateId` only links.
  - `PUT /api/vehicles/{vehicleId}/tasks/{taskId}`, same body plus `isEnabled` (minus `templateId`, which can't change), returns 200.
  - `DELETE /api/vehicles/{vehicleId}/tasks/{taskId}` returns 204.
- **Error codes** (coded `AppException`, through `GlobalExceptionHandler`):

  | Code | Status | Meaning |
  |---|---|---|
  | `task.nameRequired` | 400 | Name empty after trimming, or over 100 characters |
  | `task.intervalRequired` | 400 | Both intervals are null |
  | `task.invalidInterval` | 400 | An interval is outside its range |
  | `task.invalidCategory` | 400 | Category is not in the enum (accept the name as a string and validate it, so a bad value doesn't fall into a model-binding 400) |
  | `task.invalidLastDone` | 400 | `lastDoneOdometerKm` below 0 or above the car's current odometer; extension `currentKm` |
  | `task.futureDate` | 400 | `lastDoneDate` later than UTC today plus 1 day |
  | `task.invalidTemplate` | 400 | `templateId` doesn't exist |
  | `maintenanceTask.notFound` | 404 | No such task on this car (existing `NotFoundException`) |

*Frontend (frontend-engineer)*
- **Maintenance section on `/cars/:id`** above the odometer history, with an `h2` "Maintenance".
  - Each task row: name, translated category, interval text ("Every 10,000 km or 1 year", "Every 2 years", "Every 60,000 km"), last done ("Last done at 52,300 km on 3 Mar 2026"), and a "Disabled" label on disabled tasks (muted, still readable at 4.5:1).
  - Row actions (not on archived cars): Edit, an Enabled toggle (a checkbox or switch with a visible label, saving immediately), Delete with an inline confirmation in the `--danger` style from MVP1-C.
  - Empty state: "No maintenance tasks yet." with the Add button (or, on archived cars, just the text).
- **Add task.** An "Add task" button opens an inline form in the section (not a modal, not a new route):
  - First a template picker: a list of the 12 templates with translated names and their default intervals, plus "Custom task". Picking one prefills the form.
  - Fields: name, category (`<select>`), interval km (number), interval time (number plus a days/months/years `<select>`), last done km (prefilled with the current odometer), last done date (`type="date"`, `max` = local today, prefilled today). Save and Cancel.
  - At least one interval is required; the client shows the error before sending, and the server checks it too.
- **Edit task** reuses the same form inline in the row, without the template picker, prefilled from the task.
- **Focus** follows the MVP1-C rules: opening a form focuses its first field; Save focuses the row's Edit button; Cancel and Escape return focus to the opener; after Delete, focus goes to the next row's Edit button or the section `h2`.
- **Strings:** section title, buttons, field labels, 9 category names, 12 template names, interval and last-done formats, and every new error code, in `en` and `he`. Hebrew template names should be the terms an Israeli garage uses (Hebrew review).
- **API types and calls** in `api.ts`, with `encodeURIComponent` on ids like the rest.

**Acceptance criteria**

*Templates*
1. [BE] A fresh database has exactly the 12 templates above, with those keys, categories and intervals. `GET /api/task-templates` returns them to any signed-in user and 401 without a token.
2. [FE] The template picker lists all 12 with names in the UI language, plus "Custom task". Picking "Timing belt" prefills name "Timing belt" (or the Hebrew name), category Belts, 100,000 km and 5 years.

*Create, edit, delete*
3. [BE+FE] Adding a task from a template saves it with `templateId` set; adding a custom task saves it with `templateId` null. The new task appears in the section without a page reload.
4. [BE] A task with only `intervalKm`, only `intervalDays`, or both is accepted. Neither returns 400 `task.intervalRequired`, and the database check constraint also rejects it (one test inserts directly through the DbContext and expects a failure).
5. [BE] Out-of-range values return the codes in the table: `intervalKm` 0 or 1,000,001, `intervalDays` 0 or 7,301, an empty or 101-character name, an unknown category, `lastDoneOdometerKm` -1 or above the car's current odometer (with `currentKm`), a `lastDoneDate` 2 days ahead, an unknown `templateId`. Nothing is saved. Unit tests cover each.
6. [BE+FE] Editing name, category, intervals or last done saves and shows the change in the row. Changing the time unit converts correctly (6 months saves 180 days and shows "6 months").
7. [BE+FE] Toggling Enabled saves immediately; a disabled task stays in the list with the "Disabled" label and moves after the enabled tasks. Toggling back restores it. Nothing is deleted.
8. [BE+FE] Delete needs the inline confirmation, then removes the task (204), and the row disappears.
9. [BE] Another user's car, or a task id from another car, returns 404 on GET, POST, PUT and DELETE, and changes nothing. Unit tests cover both.
10. [BE] The `Vehicle` to `MaintenanceTask` foreign key cascades on delete (there is no vehicle delete endpoint yet; this is for delete-account later). Deleting a task never touches its template.

*Car page*
11. [FE] Archived cars show their tasks with no Add, Edit, Enabled toggle or Delete.
12. [FE] The add form prefills last done km with the car's current odometer and the date with today; the date field doesn't allow a future date.

*Every screen*
13. [FE] Hebrew and RTL: every new string exists in `en` and `he`; numbers stay left-to-right inside RTL text (`<bdi>`); the form and rows lay out correctly in RTL.
14. [FE] Mobile: at 390px wide there is no horizontal overflow with the template picker, the add form, an edit form, or a delete confirmation open; every button and toggle is at least 44px tall.
15. [FE] Loading, error and empty states: the section shows a loading state while tasks load; a failed load shows the translated error with the rest of the car page still usable; Save and Delete are disabled while in flight; an API error shows the translated message in the form (`role="alert"`) and keeps the user's input; the empty state shows as above.
16. [FE] Accessibility: each row's Edit, Delete and Enabled controls have accessible names that include the task name ("Edit Timing belt"). Focus follows the rules in Scope.
17. [BE+FE] Tests: `dotnet test` passes, with new tests for criteria 1, 4, 5, 9 and the CRUD paths. `smoke.mjs` gains steps `add-task-template`, `add-task-custom`, `edit-task`, `disable-task` and `delete-task`, passing in both setups.

**Out of scope**
- Status, remaining km/days, progress bars, the due-soon threshold UI (MVP2-B).
- Reset / Mark as done, history entries, Undo (MVP2-C).
- Tasks on the car list or a dashboard (MVP step 4).
- User-defined templates, editing the global library, bulk "add all recommended".
- Miles: everything is km until the settings screen exists.
- "Never done" tasks with no last-done values.

**Open questions:** none; the defaults above are the PM's. The likeliest for the owner to change: the template intervals, and requiring a last-done value.

---

### MVP2-B (outline): Task status and the due-soon threshold

- **Goal:** each task shows how much is left and whether it's OK, Due soon or Overdue (spec 4, bullets 1 and 4).
- [BE] Compute on read, never stored (Part 2): `remainingKm = IntervalKm - (CurrentOdometerKm - LastDoneOdometerKm)`, `remainingDays = IntervalDays - (today - LastDoneDate)`, plus `progress` (0 to 1+, used fraction of the worse interval) and `status`. Due soon when the remaining fraction of either interval is at or below `DueSoonPercent`; Overdue when either remaining is below 0; the worse wins. Disabled tasks have no status. Added to `MaintenanceTaskDto`. "Today" = UTC date; note the Israel offset.
- [BE+FE] `DueSoonPercent` editable per task in the task form (1 to 50, default 10). Spec says "e.g. 10% or 500 km"; we use percent only, matching the data model.
- [FE] Progress bar plus a status badge with text, not colour only; tasks sorted by urgency (Overdue, Due soon, OK, Disabled); remaining text ("1,200 km or 40 days left", "Overdue by 300 km").
- Optional: predicted due date using `AvgKmPerDay` (spec 2.3) if it's cheap; otherwise later.

### MVP2-C (outline): Reset / Mark as done, and Undo

- **Goal:** one tap marks a task done and restarts its countdown, and a mistaken tap can be undone (spec 4, bullets 2 and 3).
- [BE] Minimal `ServiceRecord` (`VehicleId, Date, OdometerKm, ShopName, TotalCost, Notes, IsVoided`) and `ServiceRecordTask`, as Part 2 "How Reset works": create the record, link the task, set `LastDone*`, log an `OdometerReading` with `Source = Service`. Add a nullable `ServiceRecordId` to `OdometerReading` so voiding removes that reading and recomputes the odometer (the MVP1-B recompute).
- [BE] `POST /api/vehicles/{id}/tasks/{taskId}/reset` with optional `odometerKm` (default current), `date` (default today), `cost`, `notes`. `POST /api/vehicles/{id}/service-records/{recordId}/void` for Undo: sets `IsVoided`, restores each linked task's `LastDone*` from its previous non-voided record (or the values the task had before the first reset, which needs storing, for example on the task as `InitialLastDone*`; decide in the ticket).
- [FE] One-tap Reset on each task row, with an optional "add cost and notes" expansion; an Undo toast for about 10 seconds after each reset, plus Undo on the task's most recent reset entry.
- Decide in the ticket: deleting a task that has service records.

### Later in step 1 (not scheduled before step 2)
- **Settings screen:** km/mi with conversion on display, currency change, theme toggle (`User.Theme`), and saving `User.Locale`.
- **Car photo upload:** blocked until the owner creates the Cloudflare R2 credentials.

## Changed since last audit
- **MVP1-A and MVP1-B signed off.** Verified with `git show --stat`, `dotnet test` (54 of 54), and the smoke suite (16 steps in both setups), on top of the reviews and QA.
- **2. Unit setting and currency:** Missing to **Partial**. The currency is chosen at sign-up and saved.
- **1. Current odometer with history:** still Done; readings can now be edited and deleted with recompute, and bad car ids show "not found".
- **2. Manual odometer updates:** still Partial; quick entry is now also on the car page. The dashboard is still missing.
- **Counts:** Partial went from 6 to 7, Missing from 39 to 38.
- **New bug found:** `POST /api/vehicles` returns 500 for a huge `initialOdometerKm` and accepts a negative one. Added to MVP1-C.
- **Ticket wording:** MVP1-B's "Reading order" default said the history shows readings oldest first; it shows them newest first. Fixed.
- **Tickets now use the BE/FE format.** MVP1-C rewritten (odometer label item dropped, done in MVP1-B; QA's button height, focus and destructive-button findings added; initial-odometer cap added). New: SEC-1 (deploy gate) and MVP2-A (tasks), with MVP2-B and MVP2-C outlined.
- **Tests:** `dotnet test` grew from 31 to 54 tests, and the smoke suite from 13 to 16 steps per setup.
