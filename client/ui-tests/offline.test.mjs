// OFF-1: the offline odometer queue (send order, what stops a run, what marks a reading Not sent, the cap, per user).
// Usage: node --test ui-tests/offline.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null, get length() { return store.size } }
let online = true
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online } }, configurable: true })
globalThis.location = { assign() {} }
store.set('token', 't')
// Each answer: a status (with an optional code) or 'drop' (no response).
let answers = []
const posted = []
globalThis.fetch = async (url, init) => {
  posted.push({ url, body: JSON.parse(init.body) })
  const a = answers.shift() ?? 200
  if (a === 'drop') throw new TypeError('Failed to fetch')
  const [status, code] = Array.isArray(a) ? a : [a]
  return new Response(JSON.stringify(status === 200 ? { id: 'r' } : { code, previousKm: 100 }), { status })
}
const { MAX_QUEUE, discard, enqueue, readQueue, saveAsCorrection, sendQueue, clearOffline, pruneOffline, saveCars, savedCars } = await import('../src/offline.ts')

const item = (n) => ({ clientRequestId: `id-${n}`, vehicleId: 'car', valueKm: n, readingDate: '2026-10-24', confirmCorrection: false })
const reset = () => { clearOffline('u'); clearOffline('v'); store.set('token', 't'); posted.length = 0; answers = []; online = true }
const ids = (u = 'u') => readQueue(u).map((i) => `${i.clientRequestId}:${i.state}`)

test('sends oldest first with each id, and removes what was saved', async () => {
  reset()
  await sendQueue('u') // an empty run must not block the next one
  for (const n of [1, 2, 3]) enqueue('u', item(n))
  await sendQueue('u')
  assert.deepEqual(posted.map((p) => p.body.clientRequestId), ['id-1', 'id-2', 'id-3'])
  assert.deepEqual(posted[0].body, { valueKm: 1, readingDate: '2026-10-24', confirmCorrection: false, clientRequestId: 'id-1' })
  assert.deepEqual(ids(), [])
})

test('no response stops the run and keeps everything waiting; offline sends nothing', async () => {
  reset()
  for (const n of [1, 2]) enqueue('u', item(n))
  answers = ['drop']
  await sendQueue('u')
  assert.equal(posted.length, 1)
  assert.deepEqual(ids(), ['id-1:waiting', 'id-2:waiting'])
  online = false
  await sendQueue('u')
  assert.equal(posted.length, 1)
})

test('a refusal marks Not sent with its code and goes on; 429 and 401 stop', async () => {
  reset()
  for (const n of [1, 2, 3, 4]) enqueue('u', item(n))
  answers = [[400, 'odometer.lowerThanPrevious'], 200, [429, 'http.429']]
  await sendQueue('u')
  assert.deepEqual(ids(), ['id-1:notSent', 'id-3:notSent', 'id-4:waiting'])
  assert.deepEqual(readQueue('u')[0].error, { code: 'odometer.lowerThanPrevious', previousKm: 100 })
  posted.length = 0
  answers = [[400, 'odometer.lowerThanPrevious'], [401]]
  await sendQueue('u')
  assert.equal(posted.length, 2)
  assert.deepEqual(ids(), ['id-1:notSent', 'id-3:notSent', 'id-4:waiting'])
})

test('Save as correction resends the same id confirmed; Discard removes', async () => {
  reset()
  enqueue('u', item(1))
  enqueue('u', item(2))
  answers = [[400, 'odometer.lowerThanPrevious'], [400, 'odometer.invalidValue']]
  await sendQueue('u')
  posted.length = 0
  answers = [200, [400, 'odometer.invalidValue']]
  await saveAsCorrection('u', 'id-1')
  assert.deepEqual(posted[0].body, { valueKm: 1, readingDate: '2026-10-24', confirmCorrection: true, clientRequestId: 'id-1' })
  assert.deepEqual(ids(), ['id-2:notSent'])
  discard('u', 'id-2')
  assert.deepEqual(ids(), [])
})

test('at most 20 per user, and users never share a queue', () => {
  reset()
  for (let n = 0; n < MAX_QUEUE; n++) assert.equal(enqueue('u', item(n)), true)
  assert.equal(enqueue('u', item(99)), false)
  assert.equal(readQueue('u').length, MAX_QUEUE)
  assert.deepEqual(readQueue('v'), [])
  clearOffline('u')
  assert.deepEqual(readQueue('u'), [])
})

test('one run at a time per user; a later call starts a new run; another user is not held up', async () => {
  reset()
  for (const n of [1, 2]) enqueue('u', item(n))
  enqueue('v', item(3))
  await Promise.all([sendQueue('u'), sendQueue('u'), sendQueue('v')])
  assert.deepEqual(posted.map((p) => p.body.clientRequestId).sort(), ['id-1', 'id-2', 'id-3'])
  enqueue('u', item(4))
  await sendQueue('u')
  assert.deepEqual(posted.map((p) => p.body.clientRequestId).slice(3), ['id-4'])
})

test('login keeps only this user\'s data, its car list for 30 days and all its queued readings; damaged storage reads as empty', () => {
  reset()
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
  enqueue('u', { ...item(1), readingDate: day(31) })
  enqueue('u', { ...item(2), readingDate: day(1) })
  enqueue('v', item(3))
  saveCars('v', [])
  saveCars('u', [])
  store.set('token', 't')
  pruneOffline('u')
  assert.deepEqual(ids(), ['id-1:waiting', 'id-2:waiting'])
  assert.notEqual(savedCars('u'), null)
  assert.equal(store.has('odometerQueue:v') || store.has('offlineCars:v'), false)
  assert.equal(store.get('token'), 't')
  store.set('offlineCars:u', JSON.stringify({ at: day(31), cars: [] }))
  pruneOffline('u')
  assert.equal(savedCars('u'), null)
  store.set('odometerQueue:u', '{oops')
  store.set('offlineCars:u', '{oops')
  assert.deepEqual(readQueue('u'), [])
  assert.equal(savedCars('u'), null)
})
