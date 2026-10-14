# OnlyCars: Requirements Checklist

One line per requirement in `docs/spec.md`. Updated after every ticket is signed off. Evidence and details are in `docs/requirements-status.md`.

**Last updated:** 2026-10-14, after the MVP2-A backend
**Progress:** 5 of 50 required items done, 7 partly done, 38 not started. The 7 optional items are not counted.

Legend:
- `[x]` done: works end to end in the UI, in Hebrew and English, and is tested.
- `[~]` partly done: what's missing is in *italics*.
- `[ ]` not started.
- 🔨 being built now.

## MVP progress
- [x] **Step 1: Accounts, cars, odometer.** Done, apart from the gaps marked below.
- [ ] **Step 2: Maintenance tasks, templates, Reset** 🔨 MVP2-A: backend done (API, database, 12 templates); screens being built. Then MVP2-B (status) and MVP2-C (Reset and Undo).
- [ ] **Step 3: Service history with costs**
- [ ] **Step 4: Dashboard with due and overdue status**
- [ ] **Step 5: Checklists, then tires, then reports and notifications**
- [ ] **Before going online: SEC-1** (limit login attempts, constant-time login) 🔨 being built

## 1. Vehicles
- [x] Add, edit and archive cars, keeping their history
- [~] Fields: nickname, make, model, year, VIN, plate, fuel type, purchase date, photo. *Missing: photo upload, which needs Cloudflare R2 set up.*
- [x] Current odometer, with a history of readings, which you can edit and delete
- [x] Multiple cars per account

## 2. Mileage / Odometer
- [~] Manual odometer updates with a quick-entry button. *Works on the car list and car page; the dashboard doesn't exist yet.*
- [ ] Auto-log the odometer when a service is recorded (needs step 3)
- [~] Average km/day, used to predict due dates. *Calculated and shown; predictions come with step 2.*
- [~] Km/miles unit, and a currency per user. *Currency is chosen at sign-up. Missing: a km/miles setting and a way to change the currency later.*

## 3. Maintenance Task Definitions 🔨
*The backend for all five items below is done and tested. They get ticked once the screens are built and QA has passed.*
- [ ] Task name and category
- [ ] Interval by km, by time, or both (whichever comes first)
- [ ] Starter template library, fully editable
- [ ] Custom tasks per car
- [ ] Turn a task off without deleting it

## 4. The "Roborock" Reset
- [ ] Remaining km and days, a progress bar, and status: OK, Due soon, Overdue
- [ ] Reset / Mark as done (records odometer and date, restarts the countdown, creates a history entry)
- [ ] Undo for accidental resets
- [ ] Configurable "due soon" threshold

## 5. Service Records
- [ ] Date, odometer, shop or DIY, total cost, notes
- [ ] Line items: part, brand, part number, quantity, unit cost, labour
- [ ] Attachments: receipt photos, PDFs, invoices
- [ ] Filter and search by car, task, date or shop
- [ ] Edit and delete past records

## 6. Tires
- [ ] Tire sets: brand, model, size, season, purchase year, DOT code
- [ ] Which set is on which car, with mount and unmount dates
- [ ] Km driven per set, calculated automatically
- [ ] Pressure log, tread depth log, rotation tracking
- [ ] Storage notes for the off-season set

## 7. Inspection Checklists
- [ ] Checklist templates
- [ ] Items: checkbox, number or text
- [ ] Schedule by km, by time, or manual only
- [ ] Run a checklist: tick items, add notes or photos, flag issues
- [ ] Failed items create a to-do or a maintenance task
- [ ] Run history per car

## 8. Costs and Reports
- [ ] Cost per car, per category, per month and per year
- [ ] Cost per km and total cost of ownership
- [ ] Charts: spending over time, cost by category
- [ ] Export to CSV and PDF

## 9. Reminders and Notifications
- [ ] Email (and optional push) when a task is due soon or overdue
- [ ] Non-mileage reminders: insurance, inspection, registration, licence
- [ ] Snooze, and a configurable lead time

## 10. Dashboard
- [ ] All cars at a glance, next due items sorted by urgency
- [ ] Overdue count and monthly spend summary
- [ ] Quick actions: update odometer, reset a task, start a checklist

## 12. Non-Functional
- [x] Email/password login *(optional Google login: not started)*
- [~] Mobile-first and installable as an app. *Mobile layout is done (44px tap targets, no sideways scrolling). Missing: proper app icons, and a verified install.*
- [~] Light and dark mode. *Follows the system setting. Missing: an in-app switch.*
- [~] Each user's data is private, plus data export and delete-account. *Privacy is done and tested. Missing: export and delete-account.*
- [x] Hebrew and English, including right-to-left
- [ ] Receipt image storage with size limits (needs Cloudflare R2)
- [ ] Offline odometer entry that syncs later

## 11. Optional (deferred, as the spec allows)
- [ ] Fuel log and consumption tracking
- [ ] Issue / to-do list
- [ ] Shared access (partner or family)
- [ ] Garage directory
- [ ] Parts and warranty tracking
- [ ] Full data import/export
- [ ] OBD-II / manufacturer API odometer

## Waiting on the owner
- [ ] Create a Cloudflare R2 bucket and access key. This blocks car photos and receipts.
- [ ] Review the delegated decisions in `docs/decisions.md`, especially the 12 starter task intervals.
- [ ] Create an Azure account, when it's time to deploy.
