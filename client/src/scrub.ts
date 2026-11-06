// ERR-1b privacy, the trust boundary before Sentry: nothing personal leaves the app (decisions.md "Error reporting, ERR-1").
// Pure, so ui-tests/scrub.test.mjs runs it in Node.
import type { Breadcrumb, ErrorEvent } from '@sentry/react'
import { ApiError, Offline } from './api.ts' // .ts so node --test can load it

const absolute = /\bhttps?:\/\/[^\s/?#"'<>()]+[^\s?#"'<>()]*(?:[?#][^\s"'<>()]*)?/g
const relative = /(^|[\s"'(=])(\/[^\s?#"'<>()]*)[?#][^\s"'<>()]*/g
const email = /[^\s@<>()"',;:/]+@[^\s@<>()"',;:/]+\.[a-z]{2,}/gi

// A URL loses its query and fragment (signed storage links, search words); another site's URL keeps only its origin.
function url(u: string) {
  try {
    const { origin, pathname } = new URL(u)
    return origin === globalThis.location?.origin ? origin + pathname : origin
  } catch {
    return '[scrubbed]'
  }
}

export const scrubText = (s: string) => s.replace(absolute, url).replace(relative, '$1$2').replace(email, '[scrubbed]')

const walk = (v: unknown): unknown =>
  typeof v === 'string' ? scrubText(v)
    : Array.isArray(v) ? v.map(walk)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
        : v

// Every string in the event is scrubbed; the user is only the id (no email, name or IP).
export const scrubEvent = (e: ErrorEvent): ErrorEvent =>
  ({ ...(walk(e) as ErrorEvent), user: e.user?.id ? { id: e.user.id } : undefined })

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  if (b.category === 'console') return null
  const out = walk(b) as Breadcrumb
  // A click's selector keeps tags, ids and classes; its aria-label, title or alt can hold the user's own words.
  if (b.category?.startsWith('ui.') && out.message) out.message = out.message.replace(/\[[^\]]*\]/g, '')
  return out
}

// Already shown to the user (the server's 4xx answer, offline), or no connection to send on: dropped, never queued.
export const dropped = (err: unknown, online: boolean) =>
  !online || err instanceof Offline || (err instanceof ApiError && err.status < 500)
