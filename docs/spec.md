# Car Maintenance Tracker: Spec

Stack suggestion: ASP.NET Core + EF Core + SQL Server backend, React/TypeScript PWA frontend. Hebrew/English with RTL.

Instructions for Claude Code: read this whole file, propose a project structure and the MVP plan, then implement step by step, starting with MVP item 1.

---

# Part 1: Requirements

## 1. Vehicles
- Add, edit and archive cars (archive on sale, keeping history)
- Fields: nickname, make, model, year, VIN, plate, fuel type, purchase date, photo
- Current odometer, with a history of readings
- Multiple cars per account

## 2. Mileage / Odometer
- Manual odometer updates (quick-entry button on the dashboard)
- Auto-log the odometer whenever a service is recorded
- Optional: estimated average km/day, used to predict when tasks come due
- Unit setting (km/miles), with the currency set per user

## 3. Maintenance Task Definitions (recurring items)
- Task name and category (oil, filters, brakes, tires, fluids, battery, belts, etc.)
- Interval by km, by time, or both (whichever comes first)
- Starter template library (oil change, air filter, cabin filter, brake fluid, coolant, spark plugs, timing belt, etc.), fully editable
- Per-car custom tasks
- Enable/disable a task without deleting it

## 4. The "Roborock" Reset Behavior
- Each task shows remaining km / days, with a progress bar and status: OK, Due soon, Overdue
- A Reset / Mark as done button that:
  - Records the current odometer and date
  - Restarts the countdown for the next interval
  - Creates a history entry (optional cost and notes, skippable for a one-tap reset)
- Undo for accidental resets
- Configurable "due soon" threshold (e.g. 10% or 500 km remaining)

## 5. Service Records (history)
- Date, odometer, shop (or DIY), total cost, notes
- Line items: part name, brand, part number, quantity, unit cost, labor cost
- Attachments: receipt photos and PDFs, invoices
- Filter and search by car, task, date or shop
- Edit and delete past records

## 6. Tires
- Tire sets: brand, model, size, season, purchase year and DOT code
- Which set is mounted on which car, with mount and unmount dates
- Km driven per set (auto-calculated from the odometer)
- Tire pressure log, tread depth log, rotation tracking
- Storage notes for the off-season set

## 7. Custom Inspection Checklists
- Checklist templates (e.g. "Monthly quick check", "Pre-road-trip", "Annual")
- Items: checkbox (OK / Not OK), numeric (tire pressure, tread depth) or text (notes)
- Per-checklist schedule: by km, by time, or manual only
- Run a checklist: tick items, add notes or photos, flag issues
- Failed items can automatically create a to-do or a maintenance task
- Run history per car

## 8. Costs and Reports
- Cost per car, per category, per month and per year
- Cost per km and total cost of ownership
- Charts: spending over time, cost by category
- Export to CSV and PDF

## 9. Reminders and Notifications
- Email (plus optional push/PWA) when a task is due soon or overdue
- Non-mileage reminders: insurance, annual inspection, registration, license renewal
- Snooze, plus a configurable lead time

## 10. Dashboard
- All cars at a glance, next due items sorted by urgency
- Overdue count and monthly spend summary
- Quick actions: update odometer, reset a task, start a checklist

## 11. Optional
- Fuel log and consumption tracking
- Issue / to-do list
- Shared access (partner or family)
- Garage directory
- Parts and warranty tracking
- Full data import/export
- OBD-II / manufacturer API odometer (future)

## 12. Non-Functional
- Email/password auth, optional Google login
- Mobile-first responsive UI, installable PWA
- Light and dark mode
- Per-user data isolation, data export and delete-account
- Hebrew and English UI, including RTL
- Receipt image storage with size limits
- Offline-tolerant odometer entry (sync later)

## MVP Scope
1. Auth, cars, odometer
2. Task definitions with templates, km/time intervals and the Reset button
3. Service history with costs
4. Dashboard with due/overdue status
5. Checklists, then tires, then reports and notifications

---

# Part 2: Data Model

Conventions: every table has Id, CreatedAt, UpdatedAt. User-owned tables carry UserId (or inherit it through VehicleId). Money is decimal(12,2). Distances are stored in km and converted for display.

## Core
- **User**: Email, PasswordHash, DistanceUnit (km/mi), Currency, Locale (he/en), Theme
- **Vehicle**: UserId, Nickname, Make, Model, Year, Vin, Plate, FuelType, PurchaseDate, PurchasePrice, PhotoUrl, CurrentOdometerKm, AvgKmPerDay (nullable, computed), IsArchived, ArchivedAt
- **VehicleShare**: VehicleId, SharedWithUserId, Role (viewer/editor)
- **OdometerReading**: VehicleId, ValueKm, ReadingDate, Source (manual/service/checklist/fuel)

## Maintenance
- **TaskTemplate** (global seeded library): Name, Category, DefaultIntervalKm, DefaultIntervalDays
- **MaintenanceTask** (per vehicle): VehicleId, TemplateId (nullable), Name, Category, IntervalKm (nullable), IntervalDays (nullable), DueSoonPercent, IsEnabled, LastDoneOdometerKm, LastDoneDate
- **ServiceRecord**: VehicleId, Date, OdometerKm, ShopName (null = DIY), TotalCost, Notes, IsVoided
- **ServiceRecordTask** (join): ServiceRecordId, MaintenanceTaskId (one service can reset several tasks)
- **ServiceItem**: ServiceRecordId, Description, Brand, PartNumber, Quantity, UnitCost, IsLabor
- **Attachment**: ServiceRecordId (nullable), IssueId (nullable), ChecklistRunId (nullable), FileUrl, FileName, ContentType, SizeBytes

### How Reset works
1. Create a ServiceRecord with the current odometer and date (cost and notes optional).
2. Add a ServiceRecordTask row.
3. Set MaintenanceTask.LastDoneOdometerKm and LastDoneDate, and log an OdometerReading.

Status is never stored. Compute it on read:
- remainingKm = IntervalKm - (CurrentOdometer - LastDoneOdometerKm)
- remainingDays = IntervalDays - (Today - LastDoneDate)
- The worse of the two decides OK, Due soon or Overdue.

Undo sets ServiceRecord.IsVoided = true, then restores each linked task's LastDone* from its previous non-voided record.

## Tires
- **TireSet**: UserId, Brand, Model, Size, Season, PurchaseDate, DotCode, Notes
- **TireMount**: TireSetId, VehicleId, MountedAt, MountOdometerKm, UnmountedAt (nullable), UnmountOdometerKm (nullable). Km on a set = sum of (unmount - mount), using the current odometer for the open mount.
- **TireMeasurement**: TireMountId, Position (FL/FR/RL/RR/Spare), PressureBar, TreadDepthMm, MeasuredAt
- **TireRotation**: TireMountId, Date, OdometerKm, Notes

## Checklists
- **ChecklistTemplate**: UserId, Name
- **ChecklistTemplateItem**: TemplateId, Label, Type (check/number/text), Unit (nullable), MinValue, MaxValue (nullable, for auto-flagging), SortOrder
- **VehicleChecklist**: VehicleId, TemplateId, IntervalKm (nullable), IntervalDays (nullable), LastRunOdometerKm, LastRunDate, IsEnabled
- **ChecklistRun**: VehicleChecklistId, RunAt, OdometerKm, Notes
- **ChecklistRunItem**: RunId, TemplateItemId, LabelSnapshot, BoolValue, NumberValue, TextValue, IsFlagged

Label is snapshotted so old runs stay readable after a template edit. A flagged item can spawn an Issue.

## Issues, Documents, Reminders
- **Issue**: VehicleId, Title, Description, Status (open/done), SourceRunItemId (nullable), ResolvedAt
- **VehicleDocument**: VehicleId, Type, ExpiryDate, Cost, Notes
- **NotificationRule**: UserId, Channel (email/push), LeadDays, LeadKm
- **Notification**: UserId, VehicleId, Kind (task/document/checklist), RefId, SentAt, SnoozedUntil (prevents duplicate sends, supports snooze)

## Optional
- **FuelLog**: VehicleId, Date, OdometerKm, Liters, TotalCost, IsFullTank
- **Garage**: UserId, Name, Phone, Address (and a nullable GarageId on ServiceRecord instead of ShopName)

## Relationships
- User 1-N Vehicle; Vehicle N-N User via VehicleShare
- Vehicle 1-N OdometerReading, MaintenanceTask, ServiceRecord, TireMount, VehicleChecklist, Issue, VehicleDocument, FuelLog
- ServiceRecord N-N MaintenanceTask (via ServiceRecordTask); ServiceRecord 1-N ServiceItem and Attachment
- TireSet 1-N TireMount; TireMount 1-N TireMeasurement
- ChecklistTemplate 1-N Item and VehicleChecklist; VehicleChecklist 1-N Run; Run 1-N RunItem

## Indexes and Constraints
- Index ServiceRecord(VehicleId, Date DESC), OdometerReading(VehicleId, ReadingDate DESC), MaintenanceTask(VehicleId, IsEnabled)
- Unique Vehicle(UserId, Vin) where Vin is not null
- Check: each MaintenanceTask and VehicleChecklist needs at least one of IntervalKm or IntervalDays
- At most one open TireMount per vehicle and per tire set
- Reject odometer readings lower than the latest, unless the user confirms a correction
