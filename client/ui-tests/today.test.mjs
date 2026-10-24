// LOW-8: which API calls get the client's today (the table in docs/contracts/LOW-8.md).
// Usage: node --test ui-tests/today.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { todayCalls } from '../src/api.ts'

const id = '6757a6dd-0000-4000-8000-000000000000'
test('every call in the contract gets today', () => {
  for (const c of [`GET /vehicles/${id}/tasks`, `POST /vehicles/${id}/tasks`, `PUT /vehicles/${id}/tasks/${id}`, `POST /vehicles/${id}/tasks/${id}/reset`,
    `POST /vehicles/${id}/service-records`, `PUT /vehicles/${id}/service-records/${id}`, `POST /vehicles/${id}/service-records/${id}/void`,
    `GET /vehicles/${id}/checklists`, `POST /vehicles/${id}/checklists`, `PUT /vehicle-checklists/${id}`, `POST /vehicle-checklists/${id}/runs`,
    'GET /dashboard', 'GET /reminders']) assert.ok(todayCalls.test(c), c)
})
test('other calls, and paths that already have a query, are left alone', () => {
  for (const c of [`GET /vehicles/${id}`, `GET /vehicles/${id}/service-records`, `DELETE /vehicles/${id}/tasks/${id}`, `GET /vehicle-checklists/${id}/runs`,
    `DELETE /vehicle-checklists/${id}`, `POST /vehicles/${id}/service-records/${id}/attachments`, `GET /vehicles/${id}/documents`, 'GET /service-records',
    'POST /reminders/snooze', 'GET /dashboard?today=2026-10-24', `GET /vehicles/${id}/tasks?x=1`, 'GET /me/export']) assert.ok(!todayCalls.test(c), c)
})
