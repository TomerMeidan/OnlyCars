# API contract: NOT-1, in-app reminders (car documents, lead time, snooze)

Published by backend-engineer. All endpoints need the JWT. Dates are `yyyy-MM-dd`. Errors are problem+json with `code` (and the listed extensions).
Enums are sent and returned as their names (exact casing).

## `today`
Every `today` below is the client's local date, optional (defaults to the server's UTC date), and must be within one day of the server's UTC date,
like the dashboard. Otherwise 400 with the code given per endpoint.

## Car documents

`VehicleDocumentDto`:
```
{ "id": guid, "vehicleId": guid,
  "type": "Insurance" | "Inspection" | "Registration" | "Licence",
  "expiryDate": "2026-11-17", "cost": 1250.00 | null, "notes": string | null,
  "status": "Ok" | "Expiring" | "Expired",
  "daysLeft": 30 }          // expiryDate - today in days; 0 = expires today, negative = expired that many days ago
```
Status with the user's lead days (`reminderLeadDays`, default 30): `Expired` when `expiryDate < today`; `Expiring` when `expiryDate <= today + leadDays`
(today counts); else `Ok`.

### `GET /api/vehicles/{vehicleId}/documents?today=`
200 `VehicleDocumentDto[]`, sorted by `expiryDate`, then type. Works on an archived car.

### `POST /api/vehicles/{vehicleId}/documents` (201) and `PUT /api/vehicles/{vehicleId}/documents/{id}` (200)
Body: `{ "type": "Insurance", "expiryDate": "2026-11-17", "cost": 1250 | null, "notes": "Comprehensive" | null }`, optional `?today=` for the returned
status. Returns the `VehicleDocumentDto`. Notes are trimmed; blank is null. A PUT that changes `expiryDate` (a renewal) also deletes the
document's snooze row, so the renewed document shows again if it is still Expiring; a PUT that keeps the date keeps the snooze.

### `DELETE /api/vehicles/{vehicleId}/documents/{id}`
204. Also deletes the document's snooze row.

### Errors (documents)
| Status | code | When | Extensions |
|---|---|---|---|
| 400 | `vehicleDocument.invalidType` | type missing or not one of the four names | |
| 400 | `vehicleDocument.invalidExpiryDate` | expiryDate missing | |
| 400 | `date.tooEarly` | expiryDate before 1900-01-01 | `minDate` |
| 400 | `date.tooLate` | expiryDate after 2100-12-31 | `maxDate` |
| 400 | `vehicleDocument.invalidCost` | cost < 0, > 1,000,000 or more than 2 decimals | |
| 400 | `vehicleDocument.invalidNotes` | notes longer than 1,000 characters | |
| 400 | `vehicleDocument.tooMany` | POST of the 51st document on a car | `max` (50) |
| 400 | `vehicleDocument.vehicleArchived` | POST, PUT or DELETE on an archived car | |
| 400 | `vehicleDocument.invalidDate` | bad `today` | |
| 404 | `vehicle.notFound` | car missing or another user's | |
| 404 | `vehicleDocument.notFound` | document missing, another user's, or on another car | |

## Reminders

### `GET /api/reminders?today=`
200:
```
{ "leadDays": 30,
  "snoozedCount": 1,        // due items currently hidden by a snooze
  "items": [ ReminderDto ] }
```
`ReminderDto`:
```
{ "kind": "Task" | "Checklist" | "Document",
  "refId": guid,            // task id, vehicle checklist id or document id
  "vehicleId": guid, "vehicleNickname": "Mazda",
  "name": "Oil change" | null,              // task or checklist name; null for a document
  "documentType": "Insurance" | null,       // null unless a document
  "status": "Overdue" | "DueSoon" | "Expired" | "Expiring",
  "dueDate": "2026-11-17" | null,           // document expiry; null for tasks and checklists
  "remainingKm": 300.00 | null,             // tasks and checklists with a km interval
  "remainingDays": 12 | null }              // tasks/checklists with a time interval; documents: daysLeft
```
Contents: enabled tasks that are Due soon or Overdue, enabled checklists with a schedule that are Due soon or Overdue, documents that are Expiring or
Expired, on non-archived cars, minus the snoozed ones. Task and checklist status, remainingKm and remainingDays are exactly what the car page and the
dashboard show (same code, server UTC date); documents and snoozes use `today`.
Order: `Overdue` and `Expired` first, then `DueSoon` and `Expiring`; within each, by `remainingDays` ascending (null last), then car nickname, then
name (documents by type).
Errors: 400 `reminder.invalidDate` (bad `today`).

### `POST /api/reminders/snooze`
Body: `{ "kind": "Task" | "Checklist" | "Document", "refId": guid, "days": 1 | 7 | 30, "today": "2026-10-18" }` (`today` optional).
Sets `snoozedUntil = today + days` (snoozing again moves it). The item is hidden while `snoozedUntil > today` and comes back on that date.
200 `{ "kind": "Task", "refId": guid, "snoozedUntil": "2026-10-25" }`.
| Status | code | When |
|---|---|---|
| 400 | `reminder.invalidSnooze` | days not 1, 7 or 30 |
| 400 | `reminder.invalidDate` | bad `today` |
| 404 | `reminder.notFound` | unknown kind, item missing, another user's, or its car is archived |

### `DELETE /api/reminders/snooze?kind=Task&refId={guid}`
Undo. 204, also when there was no snooze (or the kind is unknown).

A snooze row is also deleted when its item goes: task delete, checklist removed from the car, document delete, and a document renewal (above).

## Settings: lead time

`UserDto` (from `GET /api/me`, `PUT /api/me/settings`, login and register) gains `"reminderLeadDays": 30` (30 until the user saves another value).

`PUT /api/me/settings` accepts `"reminderLeadDays": 1..365` (optional, null leaves it). Errors: 400 `settings.invalidLeadDays` (outside 1 to 365),
extensions `min` (1) and `max` (365). Like the other settings, one bad field saves nothing.

## Examples (curl on the live API, 2026-10-18)
`POST /api/vehicles/{carId}/documents?today=2026-10-18` with `{"type":"Insurance","expiryDate":"2026-10-28","cost":1250,"notes":"Comprehensive"}` → 201
```
{"id":"2052d459-...","vehicleId":"17bbbd11-...","type":"Insurance","expiryDate":"2026-10-28","cost":1250,"notes":"Comprehensive","status":"Expiring","daysLeft":10}
```
After a PUT to `"expiryDate":"2026-10-16"`, `GET /api/reminders?today=2026-10-18` → 200
```
{"leadDays":30,"snoozedCount":0,"items":[{"kind":"Document","refId":"2052d459-...","vehicleId":"17bbbd11-...","vehicleNickname":"Mazda","name":null,
  "documentType":"Insurance","status":"Expired","dueDate":"2026-10-16","remainingKm":null,"remainingDays":-2}]}
```
`POST /api/reminders/snooze` `{"kind":"Document","refId":"2052d459-...","days":7,"today":"2026-10-18"}` → 200 `{"kind":"Document","refId":"2052d459-...","snoozedUntil":"2026-10-25"}`;
then `GET /api/reminders` → `{"leadDays":30,"snoozedCount":1,"items":[]}`; `DELETE /api/reminders/snooze?kind=Document&refId=2052d459-...` → 204 and the item is back.
`PUT /api/me/settings` `{"reminderLeadDays":366}` → 400 `{"code":"settings.invalidLeadDays","min":1,"max":365,...}`.
