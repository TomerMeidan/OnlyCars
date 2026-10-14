# OnlyCars: Requirements Status

**Audit date:** 2026-10-14 (second audit, after MVP1-A, commit `994a0c1`)
**Overall:** MVP step 1 (auth, cars, odometer) works end to end in English and Hebrew. What is left in step 1: fixing bad readings, the currency choice, car photos, and the km/mi setting. Steps 2 to 5 have not started.

| Status | Count |
|---|---|
| Done | 5 |
| API only | 0 |
| Partial | 6 |
| Missing | 39 |
| Deferred | 7 |
| **Total** | **57** |

How this was checked (second audit):
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
| Current odometer, with a history of readings | **Done** | The car name links to a car page (`CarsPage.tsx:41`, route in `App.tsx`). `/cars/:id` shows the drum counter and the history, newest first, with value, source and date (`CarPage.tsx:45-63`). It has loading, empty, error and not-found states. API: `OdometerController.cs:14`, `OdometerService.cs:13-23`. Browser: smoke step `odometer-history` in both setups (`mobile-dark-he-07-odometer-history.png`). | Readings can't be edited or deleted yet (MVP1-B). `/cars/abc` shows the generic "Something went wrong" instead of "car not found", because the API's GUID route constraint returns an empty 404. |
| Multiple cars per account | **Done** | The list endpoint and UI loop over all of the user's cars (`VehicleService.cs:12-22`, `CarsPage.tsx:45-62`). Tests: `VehicleServiceTests.cs:84`. | The browser tests add only one car per user, so a list of several cars has not been checked in a browser. |

## 2. Mileage / Odometer

| Requirement | Status | Evidence | What's missing |
|---|---|---|---|
| Manual odometer updates (quick-entry button on the dashboard) | **Partial** | The quick entry on each car card works, including the lower-reading check and the correction checkbox (`CarsPage.tsx:69-114`, `OdometerService.cs:30-65`). Tests: `OdometerServiceTests.cs`. Smoke steps `odometer-*` pass. The lower-reading error is now translated and shows the current reading (`odometer.lowerThanCurrent`, `i18n.ts:64-67`; Hebrew in `mobile-dark-he-05-odometer-lower-rejected.png`). | (1) There is no dashboard yet (see section 10). (2) You can't pick a reading date in the UI, although the API accepts one. (3) There is no quick entry on the car page (MVP1-B). |
| Auto-log the odometer whenever a service is recorded | **Missing** | Only the `OdometerSource.Service` enum value exists (`Enums.cs:35`). | Depends on service records (MVP step 3). |
| Optional: estimated average km/day, used to predict when tasks come due | **Partial** | `AvgKmPerDay` is computed (`OdometerService.cs:72-99`, test at `OdometerServiceTests.cs:91`) and shown on the card (`CarsPage.tsx:50-52`). | Nothing uses it for predictions yet, because tasks don't exist. |
| Unit setting (km/miles), with the currency set per user | **Missing** | Only the `User.DistanceUnit` and `User.Currency` columns exist (`User.cs:9-10`). | There is no endpoint or screen to change them. The UI always shows "km" (`CarsPage.tsx:49`, `i18n.ts:34-40`) and never converts to miles. |

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
- Done: lower readings are rejected unless the user confirms (`OdometerService.cs:34-39`).
- Not started: `VehicleShare` (optional).

---

## MVP progress

| Step | State |
|---|---|
| 1. Auth, cars, odometer | **Mostly done, gaps remain.** Working end to end in EN and HE: register and login with server-side validation, add, edit, archive and unarchive cars, quick odometer entry with a translated correction prompt, and the car page with odometer history. MVP1-A is built and awaiting QA sign-off. Gaps: readings can't be edited or deleted and there is no currency choice (both in MVP1-B), no car photo (blocked until the R2 credentials exist), and no km/mi setting. |
| 2. Tasks, templates, km/time intervals, Reset | Not started |
| 3. Service history with costs | Not started |
| 4. Dashboard with due/overdue status | Not started |
| 5. Checklists, tires, reports, notifications | Not started |

## Current ticket

**MVP1-A (commit `994a0c1`): built, awaiting QA sign-off.** It covered server-side auth validation, translated API errors, and the odometer history page. The QA run passed every scripted step. The main session signs it off; the PM has not. QA's findings are folded into MVP1-B (items 1 to 3) and MVP1-C (items 4 and 5).

### MVP1-B: Fix bad odometer readings, choose a currency at sign-up

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
- **Reading order.** Readings are ordered by `ReadingDate`, then `CreatedAt`. This is the order the history already uses, oldest first. "The reading before" and "the reading after" a given reading mean its neighbours in this order, excluding the reading itself. Equal values are allowed (order is non-decreasing).
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

### MVP1-C (next, small): Car page accessibility polish (QA items 4 and 5)

1. **Focus and title.** On every route change, focus moves to the page's `h1`, and `document.title` is set per page, for example "Test Corolla · OnlyCars".
2. **Odometer label.** The drum counter's `aria-label` includes the unit, for example "61,250 km" or "61,250 ק״מ".
3. **Back link.** The "All cars" link is inline (its focus outline hugs the text) and has a tap target at least 44px tall on mobile.
4. **Testing.** Check in both smoke setups, then take screenshots of the focus ring in light and dark mode.

## Changed since last audit
- **1. Current odometer with history:** Partial to **Done**. `/cars/:id` lists the readings (MVP1-A).
- **12. Email/password auth:** Partial to **Done**. The server validates register and login input.
- **12. Hebrew and English UI:** Partial to **Done**. API errors carry codes that the client translates.
- **2. Manual odometer updates:** still Partial. The Hebrew error is fixed. The dashboard, the date picker and quick entry on the car page are still missing.
- **Counts:** Done went from 2 to 5, and Partial went from 9 to 6.
- **MVP1-A:** built and awaiting QA sign-off. QA passed every scripted step. Its findings became MVP1-B and MVP1-C.
- **New decision in `decisions.md`:** the odometer date-order rule. It is built into MVP1-B.
- **Tests:** `dotnet test` grew from 17 to 31 tests, and the smoke suite from 10 to 13 steps per setup.
