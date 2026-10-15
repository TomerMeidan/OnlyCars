// MVP3-B: the live total of service items must match the server's (docs/contracts/MVP3-B.md).
// Usage: node --test ui-tests/items.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsTotal } from '../src/api.ts'

test('the contract example sums to 391', () => {
  assert.equal(itemsTotal([{ quantity: 2, unitCost: 45.5 }, { quantity: 1.5, unitCost: 200 }]), 391)
})

test('half a cent rounds up where floats would round down', () => {
  assert.equal(1.005 * 100 < 100.5, true) // the float trap
  assert.equal(itemsTotal([{ quantity: 0.5, unitCost: 0.01 }]), 0.01)
  assert.equal(itemsTotal([{ quantity: 1.5, unitCost: 0.67 }]), 1.01) // 1.005
  assert.equal(itemsTotal([{ quantity: 0.1, unitCost: 0.1 }, { quantity: 0.2, unitCost: 0.1 }]), 0.03)
})

test('no items, and the caps stay exact', () => {
  assert.equal(itemsTotal([]), 0)
  assert.equal(itemsTotal([{ quantity: 10_000, unitCost: 1_000_000 }]), 10_000_000_000)
  assert.equal(itemsTotal([{ quantity: 9_999.99, unitCost: 999_999.99 }]), 9_999_989_900) // exactly 9,999,989,900.0001
})
