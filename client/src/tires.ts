// TIRE-2b: the tire rules the screens share. Only type imports, so node --test can load this file (ui-tests/tires.test.mjs).
import type { Tire, TirePosition } from './api'

export const wheels: TirePosition[] = ['FL', 'FR', 'RL', 'RR']
// What one Replace may take (contract TIRE-2a), in its picker's order.
export const tireGroups: TirePosition[][] = [['FL'], ['FR'], ['RL'], ['RR'], ['FL', 'FR'], ['RL', 'RR'], wheels, ['Spare']]

// Whole months from the DOT week, else the purchase date, else the fitted date, to `today` (all YYYY-MM-DD).
export function ageMonths(x: Pick<Tire, 'dotDate' | 'purchaseDate' | 'fittedAt'>, today: string) {
  const [y1, m1, d1] = (x.dotDate ?? x.purchaseDate ?? x.fittedAt).slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  return Math.max(0, (y2 - y1) * 12 + m2 - m1 - (d2 < d1 ? 1 : 0))
}

// shortcut: a fixed 3 mm "replace soon" line (the legal minimum is 1.6 mm), not a setting; make it one if owners ask.
export const LOW_TREAD_MM = 3
export const lowTread = (x: Pick<Tire, 'latestMeasurement'>) => (x.latestMeasurement?.treadDepthMm ?? Infinity) < LOW_TREAD_MM
