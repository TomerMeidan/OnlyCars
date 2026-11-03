// TIRE-2b: tire age and the low-tread line. Usage: node --test ui-tests/tires.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ageMonths, lowTread } from '../src/tires.ts'

test('age counts from the DOT week, else the purchase date, else the fitted date', () => {
  const today = '2026-11-03'
  assert.equal(ageMonths({ dotDate: '2024-11-04', purchaseDate: '2026-10-01', fittedAt: '2026-10-01' }, today), 23)
  assert.equal(ageMonths({ dotDate: null, purchaseDate: '2025-11-03', fittedAt: '2026-10-01' }, today), 12)
  assert.equal(ageMonths({ dotDate: null, purchaseDate: null, fittedAt: '2026-10-04' }, today), 0)
  assert.equal(ageMonths({ dotDate: null, purchaseDate: null, fittedAt: '2026-12-01' }, today), 0) // never negative
})

test('low tread is under 3 mm, and no measurement is not low', () => {
  assert.equal(lowTread({ latestMeasurement: { measuredAt: '2026-11-01', position: 'FL', pressureBar: null, treadDepthMm: 2.9 } }), true)
  assert.equal(lowTread({ latestMeasurement: { measuredAt: '2026-11-01', position: 'FL', pressureBar: 2.3, treadDepthMm: 3 } }), false)
  assert.equal(lowTread({ latestMeasurement: { measuredAt: '2026-11-01', position: 'FL', pressureBar: 2.3, treadDepthMm: null } }), false)
  assert.equal(lowTread({ latestMeasurement: null }), false)
})
