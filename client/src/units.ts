import type { FormEvent } from 'react'
import type { TFunction } from 'i18next'
import type { User } from './api'

// Every distance on screen goes through here. The API speaks km; miles exist only on screen (decisions.md, SET-2).
export type DistanceUnit = User['distanceUnit']
export const KM_PER_MI = 1.609344
// The server's caps, in km.
export const MAX_READING_KM = 10_000_000
export const MAX_INTERVAL_KM = 1_000_000

// Exact value in the unit, before any rounding.
const inUnit = (km: number, unit: DistanceUnit) => (unit === 'Mi' ? km / KM_PER_MI : km)
// The displayed value: whole miles; km keep their stored value.
export const shown = (km: number, unit: DistanceUnit) => (unit === 'Mi' ? Math.round(km / KM_PER_MI) : km)
// A km cap in the unit, rounded down so an accepted value never converts to more than the cap.
export const maxIn = (capKm: number, unit: DistanceUnit) => Math.floor(inUnit(capKm, unit))
// What the user typed, in km for the API; miles become whole km.
// keepKm are stored values the field may hold (its starting value, the car's odometer): typed as shown, the first match is sent
// back as is, so a save never drifts by rounding past a value the server compares against.
export function toKm(value: number, unit: DistanceUnit, ...keepKm: (number | null | undefined)[]) {
  if (unit === 'Km') return value
  const kept = keepKm.find((k) => k != null && shown(k, unit) === value)
  if (kept != null) return kept
  return Math.round(value * KM_PER_MI)
}

// Everything a screen needs for one unit and language. `vars` fills {{distUnit}} ("mi", after a number) and {{distUnits}} ("miles", in labels).
// (Not {{unit}}: i18next hands that name to Intl.NumberFormat as its unit option, which breaks {{x, number}}.)
export function distance(unit: DistanceUnit, t: TFunction, lng: string | undefined) {
  const vars = { distUnit: t(`distance.${unit}`), distUnits: t(`distances.${unit}`) }
  const maxReading = maxIn(MAX_READING_KM, unit)
  const readingMessage = t('errors.odometer.invalidValue', { ...vars, maxReading })
  return {
    vars,
    maxReading,
    maxInterval: maxIn(MAX_INTERVAL_KM, unit),
    value: (km: number) => shown(km, unit),
    fmt: (km: number) => shown(km, unit).toLocaleString(lng),
    // Remaining km round up, as before SET-2; miles round like every other value, so they add up with the shown interval and readings.
    fmtUp: (km: number) => (unit === 'Mi' ? Math.round(km / KM_PER_MI) : Math.ceil(km)).toLocaleString(lng),
    perDay: (km: number) => inUnit(km, unit).toLocaleString(lng, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    toKm: (value: number, ...keepKm: (number | null | undefined)[]) => toKm(value, unit, ...keepKm),
    // Props for an odometer input: the cap in the unit, and the translated message on the field instead of the browser's.
    readingInput: {
      min: 0,
      max: maxReading,
      step: 'any',
      onInput: (e: FormEvent<HTMLInputElement>) => {
        const el = e.currentTarget
        el.setCustomValidity('')
        el.setCustomValidity(el.validity.valid ? '' : readingMessage)
      },
    },
  }
}
