// ERR-1b: crashes to the onlycars-web project. Loaded by main.tsx only when the build has VITE_SENTRY_DSN, in its own chunk.
import { captureException, init } from '@sentry/react'
import { cachedUser } from './api'
import { dropped, scrubBreadcrumb, scrubEvent } from './scrub'

init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: __RELEASE__ || undefined,
  environment: import.meta.env.MODE,
  // SDK 11's form of sendDefaultPii false: no IP, cookies, bodies or query; the User-Agent stays for the browser.
  dataCollection: { userInfo: false, cookies: false, httpHeaders: { request: { allow: ['User-Agent'] }, response: false }, httpBodies: [], urlQueryParams: false, stackFrameVariables: false },
  // Errors only: no session pings, no console breadcrumbs.
  integrations: (all) => all.filter((i) => i.name !== 'BrowserSession' && i.name !== 'Console'),
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSend(event, hint) {
    if (dropped(hint.originalException, navigator.onLine)) return null
    return scrubEvent({ ...event, user: { id: cachedUser()?.id } })
  },
})

export const report = (error: unknown, componentStack?: string) =>
  captureException(error, { contexts: { react: { componentStack } } })
