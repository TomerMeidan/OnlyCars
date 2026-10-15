import { useEffect, useRef, useState } from 'react'

// A list row's inline modes (forms and confirm steps) and its request, with the MVP1-C focus rules:
// Cancel or Escape (open('view')) refocuses the button that opened the mode; after a success, close() leaves focus to the list;
// a failed request refocuses where the user was once its disabled button is enabled again.
export function useRow<M extends string>() {
  const [mode, setMode] = useState<M | 'view'>('view')
  // The mode being left, so returning to view can refocus its opener.
  const returnTo = useRef<M | 'view'>('view')
  const openers = useRef<Partial<Record<M | 'view', HTMLElement | null>>>({})
  useEffect(() => {
    if (mode !== 'view') return
    openers.current[returnTo.current]?.focus()
    returnTo.current = 'view'
  }, [mode])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const retry = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (busy) return
    retry.current?.focus()
    retry.current = null
  }, [busy])

  function open(next: M | 'view') {
    returnTo.current = mode
    setMode(next)
    setError(null)
  }
  function close() {
    returnTo.current = 'view'
    setMode('view')
  }
  // Resolves to the error, or null once the request succeeded.
  async function run(request: () => Promise<void>, retryFrom?: HTMLElement | null) {
    setBusy(true)
    setError(null)
    try {
      await request()
      return null
    } catch (err) {
      setError(err)
      retry.current = retryFrom ?? null
      return err
    } finally {
      setBusy(false)
    }
  }
  // Ref callback for the button that opens `m`.
  const opener = (m: M) => (el: HTMLElement | null) => { openers.current[m] = el }

  return { mode, open, close, busy, error, run, opener }
}
