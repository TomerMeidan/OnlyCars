import { useSyncExternalStore } from 'react'
import { api, ApiError, getToken, type Problem } from './api.ts' // .ts so node --test can load it (ui-tests/offline.test.mjs)

// OFF-1: dashboard odometer readings entered without a connection, kept per user in localStorage until the server takes them.
export const MAX_QUEUE = 20
export interface Queued {
  clientRequestId: string // sent on every try, so a retry after a lost reply never adds a second reading
  vehicleId: string
  valueKm: number
  readingDate: string // the local date at entry
  confirmCorrection: boolean
  state: 'waiting' | 'notSent'
  error?: Pick<Problem, 'code' | 'previousKm' | 'nextKm' | 'max'> // why the server refused it (notSent)
}
// The active cars from the last dashboard load, for the offline entry panel only.
export interface SavedCars { at: string; cars: { id: string; nickname: string; currentOdometerKm: number }[] }

const queueKey = (userId: string) => `odometerQueue:${userId}`
const carsKey = (userId: string) => `offlineCars:${userId}`

const listeners = new Set<() => void>()
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
// Another tab changed the queue: re-read it. Optional so node --test (no window) can load this module.
globalThis.addEventListener?.('storage', () => setStatus({}))
// sending: the item on its way; sent: counts runs that sent something, so the dashboard reloads after each.
let status = { sending: null as string | null, sent: 0 }
const setStatus = (patch: Partial<typeof status>) => { status = { ...status, ...patch }; listeners.forEach((f) => f()) }

// Stored text may be damaged or edited by hand: unreadable counts as nothing stored.
function parse(raw: string | null) {
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}
// Parsed again only when the stored text changed, so useSyncExternalStore gets a stable snapshot.
let cache: { raw: string | null; items: Queued[] } = { raw: null, items: [] }
export function readQueue(userId: string): Queued[] {
  const raw = localStorage.getItem(queueKey(userId))
  if (raw !== cache.raw) {
    const items = parse(raw)
    cache = { raw, items: Array.isArray(items) ? items : [] }
  }
  return cache.items
}
// Always from the stored list, so a change made meanwhile (a discard, a logout) is never written over.
function writeQueue(userId: string, f: (q: Queued[]) => Queued[]) {
  const q = f(readQueue(userId))
  if (q.length) localStorage.setItem(queueKey(userId), JSON.stringify(q))
  else localStorage.removeItem(queueKey(userId))
  setStatus({})
}
const replace = (userId: string, id: string, f: (i: Queued) => Queued | null) =>
  writeQueue(userId, (q) => q.flatMap((i) => (i.clientRequestId === id ? (f(i) ?? []) : [i])))

export function useQueue(userId: string) {
  const items = useSyncExternalStore(subscribe, () => readQueue(userId))
  return { items, ...useSyncExternalStore(subscribe, () => status) }
}

// False when the queue is full.
export function enqueue(userId: string, item: Omit<Queued, 'state'>) {
  if (readQueue(userId).length >= MAX_QUEUE) return false
  writeQueue(userId, (q) => [...q, { ...item, state: 'waiting' }])
  return true
}
export const discard = (userId: string, id: string) => replace(userId, id, () => null)
export function saveAsCorrection(userId: string, id: string) {
  replace(userId, id, (i) => ({ ...i, confirmCorrection: true, state: 'waiting', error: undefined }))
  return sendQueue(userId)
}

export const saveCars = (userId: string, cars: SavedCars['cars']) =>
  localStorage.setItem(carsKey(userId), JSON.stringify({ at: new Date().toISOString(), cars } satisfies SavedCars))
export const savedCars = (userId: string): SavedCars | null => parse(localStorage.getItem(carsKey(userId)))
// Logout and account delete: nothing of this user's stays in the browser.
export function clearOffline(userId: string) {
  localStorage.removeItem(carsKey(userId))
  writeQueue(userId, () => [])
}
// Login: nothing of another user's stays in this browser, and this user's car list goes after 30 days.
// This user's own queued readings are never dropped here: they leave only when sent, deleted, or on a confirmed logout.
export function pruneOffline(userId: string) {
  const mine = [queueKey(userId), carsKey(userId)]
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '') // collected first: removing shifts the indexes
  for (const k of keys) if (/^(odometerQueue|offlineCars):/.test(k) && !mine.includes(k)) localStorage.removeItem(k)
  const at = Date.parse(savedCars(userId)?.at ?? '')
  if (!(at >= Date.now() - 30 * 864e5)) localStorage.removeItem(carsKey(userId)) // an unreadable date counts as old
}

// Sends every queued reading, oldest first, one at a time; refused ones too, as their cause (a 429, a later reading) may be gone.
// Stops when the connection fails, on 401 (the api() helper signs out; the queue stays for this user), on 429, or when the user changes.
// One run at a time per user; a run for another user (after a logout and login) is not held up by the old one.
let running: { userId: string; p: Promise<void> } | null = null
export function sendQueue(userId: string): Promise<void> {
  if (!navigator.onLine) return Promise.resolve()
  if (running?.userId === userId) return running.p
  const p: Promise<void> = (async () => {
    const token = getToken()
    const tried = new Set<string>()
    let sent = false
    try {
      for (let item; getToken() === token && (item = readQueue(userId).find((i) => !tried.has(i.clientRequestId)));) {
        const { clientRequestId, vehicleId, valueKm, readingDate, confirmCorrection } = item
        tried.add(clientRequestId)
        setStatus({ sending: clientRequestId })
        try {
          await api(`/vehicles/${encodeURIComponent(vehicleId)}/odometer`, 'POST', { valueKm, readingDate, confirmCorrection, clientRequestId })
          replace(userId, clientRequestId, () => null)
          sent = true
        } catch (err) {
          if (!(err instanceof ApiError) || err.status === 401) break // no response (an ApiError is the server's answer), or signed out
          const { code, previousKm, nextKm, max } = err.problem
          replace(userId, clientRequestId, (i) => ({ ...i, state: 'notSent', error: { code: code ?? `http.${err.status}`, previousKm, nextKm, max } }))
          if (err.status === 429) break
        }
      }
    } finally {
      setStatus({ sending: null, ...(sent && { sent: status.sent + 1 }) })
    }
  // Cleared in a later microtask: an empty queue finishes before the assignment, which would otherwise keep a settled run forever.
  })().finally(() => { if (running?.p === p) running = null })
  running = { userId, p }
  return p
}

// crypto.randomUUID exists only in a secure context; the dev server opened by LAN address over http is not one.
export const newRequestId = () => crypto.randomUUID?.() ??
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16))
