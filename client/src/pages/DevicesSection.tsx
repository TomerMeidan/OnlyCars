import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { errorMessage, fmtDate } from '../i18n'

type DeviceToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null }
type CreatedDeviceToken = { id: string; name: string; createdAt: string; token: string }

// OBD-1: tokens for devices that only add odometer readings (the OBD adapter app). A token is shown once, when it is made.
export default function DevicesSection() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const [tokens, setTokens] = useState<DeviceToken[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [created, setCreated] = useState<CreatedDeviceToken | null>(null)
  const [copied, setCopied] = useState(false)
  const tokenField = useRef<HTMLInputElement>(null)

  const load = () => api<DeviceToken[]>('/me/device-tokens').then(setTokens, setError)
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // The new token is selected, so it can be copied by hand where the Copy button isn't allowed.
  useEffect(() => { if (created) tokenField.current?.select() }, [created])

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      setCreated(await api<CreatedDeviceToken>('/me/device-tokens', 'POST', { name }))
      setName('')
      await load()
    } catch (err) {
      setError(err)
    }
    setBusy(false)
  }

  async function remove(token: DeviceToken) {
    if (busy || !confirm(t('deviceRemoveConfirm', { name: token.name }))) return
    setBusy(true)
    setError(null)
    try {
      await api(`/me/device-tokens/${encodeURIComponent(token.id)}`, 'DELETE')
      if (created?.id === token.id) setCreated(null)
      await load()
    } catch (err) {
      setError(err)
    }
    setBusy(false)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created!.token)
      setCopied(true)
    } catch {
      tokenField.current?.select() // no clipboard permission: the selected text can still be copied by hand
    }
  }

  return (
    <section className="field" aria-labelledby="devices">
      <h2 id="devices">{t('devices')}</h2>
      <p className="muted">{t('devicesHint')}</p>
      {tokens?.length === 0 && <p className="muted">{t('deviceNone')}</p>}
      {!!tokens?.length && (
        <ul className="devices">
          {tokens.map((token) => (
            <li key={token.id}>
              <span>
                <bdi>{token.name}</bdi>
                <span className="muted">
                  {' '}{t('deviceAdded', { date: fmtDate(token.createdAt, lng) })}, {token.lastUsedAt
                    ? t('deviceLastUsed', { date: fmtDate(token.lastUsedAt, lng) }) : t('deviceNeverUsed')}
                </span>
              </span>
              <button type="button" className="link" aria-disabled={busy} onClick={() => remove(token)}>{t('remove')}</button>
            </li>
          ))}
        </ul>
      )}
      {created ? (
        <div className="inline-form">
          <h3>{t('deviceTokenTitle', { name: created.name })}</h3>
          <p>{t('deviceTokenOnce')}</p>
          <label className="wide">
            {t('deviceToken')}
            <input ref={tokenField} readOnly dir="ltr" value={created.token} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <div className="actions">
            <button type="button" onClick={copy}>{t('deviceCopy')}</button>
            <button type="button" className="link" onClick={() => setCreated(null)}>{t('deviceDone')}</button>
          </div>
          <p role="status">{copied && t('deviceCopied')}</p>
        </div>
      ) : (
        <form className="inline-form" onSubmit={create}>
          <label>
            {t('deviceName')}
            <input name="deviceName" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button aria-disabled={busy}>{t('deviceAdd')}</button>
        </form>
      )}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
    </section>
  )
}
