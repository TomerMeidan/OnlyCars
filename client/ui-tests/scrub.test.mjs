// ERR-1b criterion 2: what beforeSend and beforeBreadcrumb let reach Sentry.
// Usage: node --test ui-tests/scrub.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropped, scrubBreadcrumb, scrubEvent } from '../src/scrub.ts'
import { ApiError, Offline } from '../src/api.ts'

const signed = 'https://x.r2.cloudflarestorage.com/k/receipt.pdf?X-Amz-Signature=abc&X-Amz-Credential=key'

test('an event keeps no email, query, signed link or user detail', () => {
  const event = {
    message: 'Failed for dana@example.com',
    exception: { values: [{ type: 'Error', value: `Could not open ${signed} for dana@example.com` }] },
    request: { url: 'https://onlycars.example/history?q=oil', headers: { 'User-Agent': 'Chrome', Referer: 'https://mail.example/inbox?id=7' } },
    breadcrumbs: [{ category: 'fetch', data: { method: 'GET', url: '/api/service-records?q=oil', status_code: 200 } }],
    user: { id: 'u-1', email: 'dana@example.com', ip_address: '1.2.3.4', username: 'Dana' },
  }
  const out = scrubEvent(event)
  const text = JSON.stringify(out)
  for (const bad of ['dana@', 'example.com', 'X-Amz', 'abc', 'q=oil', 'id=7', '1.2.3.4', 'Dana', '/k/receipt']) assert.ok(!text.includes(bad), `${bad} in ${text}`)
  assert.deepEqual(out.user, { id: 'u-1' })
  assert.equal(out.exception.values[0].value, 'Could not open https://x.r2.cloudflarestorage.com for [scrubbed]')
  assert.equal(out.breadcrumbs[0].data.url, '/api/service-records')
  assert.equal(out.request.headers['User-Agent'], 'Chrome')
  assert.equal(scrubEvent({ message: 'x' }).user, undefined) // signed out: no user
})

test('console breadcrumbs are dropped; others lose queries and click text', () => {
  assert.equal(scrubBreadcrumb({ category: 'console', message: 'hello dana@example.com' }), null)
  assert.deepEqual(scrubBreadcrumb({ category: 'fetch', data: { method: 'GET', url: '/api/service-records?q=oil', status_code: 200 } }).data,
    { method: 'GET', url: '/api/service-records', status_code: 200 })
  assert.deepEqual(scrubBreadcrumb({ category: 'navigation', data: { from: '/history?q=oil', to: '/cars/1' } }).data, { from: '/history', to: '/cars/1' })
  assert.equal(scrubBreadcrumb({ category: 'xhr', data: { url: signed } }).data.url, 'https://x.r2.cloudflarestorage.com')
  assert.equal(scrubBreadcrumb({ category: 'ui.click', message: 'main > li.row > button.danger[aria-label="Delete Dana\'s Corolla"]' }).message,
    'main > li.row > button.danger')
})

test('4xx and offline are dropped; 5xx and crashes are kept', () => {
  assert.equal(dropped(new ApiError(404, null, 'x'), true), true)
  assert.equal(dropped(new ApiError(500, null, 'x'), true), false)
  assert.equal(dropped(new Offline('x'), true), true)
  assert.equal(dropped(new Error('x'), false), true)
  assert.equal(dropped(new Error('x'), true), false)
})
