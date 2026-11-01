// PERF-1: a GET from the last minute is reused; any change, a failure or another user empties it.
// Usage: node --test ui-tests/cache.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map([['token', 't']])
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
globalThis.location = { assign() {} }
const calls = []
let fail = false
globalThis.fetch = async (url, init) => {
  calls.push(`${init.method} ${url}`)
  return fail ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ n: calls.length }), { status: 200 })
}
const { api, setToken } = await import('../src/api.ts')

test('a second GET of the same path is not sent, and each caller gets its own copy', async () => {
  const a = await api('/vehicles')
  a.n = 99
  assert.deepEqual(await api('/vehicles'), { n: 1 })
  assert.equal(calls.length, 1)
})

test('a change empties the cache; a failed GET is asked again; a new user starts empty', async () => {
  await api('/vehicles', 'POST', {})
  await api('/vehicles')
  assert.deepEqual(calls.slice(-2), ['POST /api/vehicles', 'GET /api/vehicles'])
  fail = true
  await assert.rejects(api('/tires'))
  fail = false
  await api('/tires')
  assert.deepEqual(calls.slice(-2), ['GET /api/tires', 'GET /api/tires'])
  setToken('other')
  await api('/tires')
  assert.equal(calls.at(-1), 'GET /api/tires')
  assert.equal(calls.length, 6)
})
