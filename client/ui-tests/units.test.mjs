// Conversion and rounding rules of SET-2, with the ticket's worked numbers.
// Usage: node --test ui-tests/units.test.mjs (Node strips the types from units.ts.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_INTERVAL_KM, MAX_READING_KM, maxIn, shown, toKm } from '../src/units.ts'

test('km to miles rounds to whole miles', () => {
  assert.equal(shown(80_467, 'Mi'), 50_000)
  assert.equal(shown(10_000, 'Mi'), 6_214)
})

test('miles to km rounds to whole km, and a whole-mile value shows back unchanged', () => {
  assert.equal(toKm(50_100, 'Mi'), 80_628)
  assert.equal(toKm(5_000, 'Mi'), 8_047)
  for (let mi = 0; mi <= 200_000; mi += 7) assert.equal(shown(toKm(mi, 'Mi'), 'Mi'), mi)
})

test('an unchanged field sends its stored km back', () => {
  // 80,465 km shows as 49,999 mi, which converts to 80,466 km: above the odometer, so it must not be sent.
  assert.equal(toKm(49_999, 'Mi'), 80_466)
  assert.equal(toKm(49_999, 'Mi', 80_465), 80_465)
  assert.equal(toKm(9_321, 'Mi', 15_000), 15_000)
  assert.equal(toKm(9_322, 'Mi', 15_000), 15_002)
})

test("the car's odometer typed as shown sends its exact km", () => {
  // Last done: 80,407 km shows as 49,963 mi, which alone converts to 80,408, above the odometer.
  assert.equal(toKm(49_963, 'Mi'), 80_408)
  assert.equal(toKm(49_963, 'Mi', 72_000, 80_407), 80_407)
  // Quick-add: 80,402 km shows as 49,959 mi, which alone converts to 80,401, below the last reading.
  assert.equal(toKm(49_959, 'Mi'), 80_401)
  assert.equal(toKm(49_959, 'Mi', 80_402), 80_402)
  // History edit, typed as a neighbour shows: 79,401 km is 49,337 mi, which alone converts to 79,400, below that neighbour.
  assert.equal(toKm(49_337, 'Mi'), 79_400)
  assert.equal(toKm(49_337, 'Mi', 80_000, 79_401, 80_466), 79_401)
  // And the next one: 80,473 km is 50,004 mi, which alone converts to 80,474, above it.
  assert.equal(toKm(50_004, 'Mi'), 80_474)
  assert.equal(toKm(50_004, 'Mi', 80_000, 79_401, 80_473), 80_473)
  // The first match wins, and a null keep is skipped.
  assert.equal(toKm(49_963, 'Mi', null, 80_407, 80_408), 80_407)
  // Every km that shows as a whole mile comes back unchanged when kept.
  for (let km = 80_000; km <= 90_000; km++) assert.equal(toKm(shown(km, 'Mi'), 'Mi', km), km)
})

test('limits round down and never convert above the km cap', () => {
  assert.equal(maxIn(MAX_READING_KM, 'Mi'), 6_213_711)
  assert.equal(maxIn(MAX_INTERVAL_KM, 'Mi'), 621_371)
  assert.ok(toKm(6_213_711, 'Mi') <= MAX_READING_KM)
  assert.ok(toKm(621_371, 'Mi') <= MAX_INTERVAL_KM)
})

test('km stay as stored', () => {
  assert.equal(shown(61_250.5, 'Km'), 61_250.5)
  assert.equal(toKm(61_250.5, 'Km', 1), 61_250.5)
  assert.equal(maxIn(MAX_READING_KM, 'Km'), MAX_READING_KM)
})
