import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { providers } from './api'

type Gsi = {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
}
declare global {
  interface Window { google?: { accounts: { id: Gsi } } }
}

let script: Promise<void> | undefined
const loadScript = () => (script ??= new Promise((resolve, reject) => {
  const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true })
  s.onload = () => resolve()
  s.onerror = () => { script = undefined; reject(new Error('Google script')) } // offline now: try again on the next visit
  document.head.append(s)
}))

// Google's own button; onCredential gets the ID token to send to the API. Shows nothing (and no "or") until Google is ready,
// so without a client id or a connection the page is as before.
export function GoogleButton({ text, onCredential, or = false }: {
  text: 'signin_with' | 'signup_with' | 'continue_with'
  onCredential: (idToken: string) => void
  or?: boolean
}) {
  const { t, i18n } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const callback = useRef(onCredential)
  useEffect(() => { callback.current = onCredential })
  const [ready, setReady] = useState(false)
  const lng = i18n.resolvedLanguage

  useEffect(() => {
    let live = true
    providers()
      .then(async ({ googleClientId: id }) => {
        if (!id) return
        await loadScript()
        const el = box.current
        if (!live || !el || !window.google) return
        window.google.accounts.id.initialize({ client_id: id, callback: (r) => callback.current(r.credential) })
        el.replaceChildren()
        // No width: the box is hidden (width 0) until the button is in it, and Google refuses width=0.
        window.google.accounts.id.renderButton(el, { text, theme: 'outline', size: 'large', locale: lng })
        setReady(true)
      })
      .catch(() => {})
    return () => { live = false }
  }, [text, lng])

  return (
    <>
      <div ref={box} className="google-button" />
      {ready && or && <p className="or muted">{t('or')}</p>}
    </>
  )
}
