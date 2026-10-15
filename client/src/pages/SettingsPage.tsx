import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, currencies, type User } from '../api'
import { useAuth } from '../auth'
import { errorMessage } from '../i18n'
import { usePage } from '../usePage'

type Field = 'locale' | 'theme' | 'currency'

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { user, saveSettings, storeUser } = useAuth()
  // One save at a time, page-wide. Controls stay focusable (aria-disabled), so focus isn't dropped to <body> while saving.
  const [busy, setBusy] = useState(false)
  const saveStarted = useRef(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<{ field: Field; err: unknown } | null>(null)
  const currencyNames = new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'currency' })
  usePage(t('settings'))

  // The page shows the cached user at once; this picks up changes made on another device.
  // A failed refresh is ignored: the cached values stay usable and each save returns the server's values.
  // Once a save has started its response is newer, so a late refresh is dropped.
  useEffect(() => {
    api<User>('/me').then((u) => saveStarted.current || storeUser(u), () => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(field: Field, value: string) {
    if (busy) return // the controlled value puts the control back
    saveStarted.current = true
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      await saveSettings({ [field]: value })
      setSaved(true)
    } catch (err) {
      setError({ field, err })
    } finally {
      setBusy(false)
    }
  }

  const errorFor = (field: Field) =>
    error?.field === field && <p className="error" role="alert">{errorMessage(error.err)}</p>

  const radios = (field: 'locale' | 'theme', values: string[], label: (v: string) => ReactNode) => (
    <fieldset aria-disabled={busy}>
      <legend>{t(field === 'locale' ? 'language' : 'theme')}</legend>
      {values.map((v) => (
        <label key={v} className="inline">
          <input type="radio" name={field} value={v} checked={user![field] === v} onChange={() => save(field, v)}
            // While busy the browser undoes the check (arrow keys click too); React wouldn't put a controlled radio back.
            onClick={(e) => busy && e.preventDefault()} />
          {label(v)}
        </label>
      ))}
      {errorFor(field)}
    </fieldset>
  )

  return (
    <div className="card settings">
      <h1 tabIndex={-1}>{t('settings')}</h1>
      {radios('locale', ['He', 'En'], (v) => (v === 'He' ? <span lang="he">עברית</span> : <span lang="en">English</span>))}
      {radios('theme', ['System', 'Light', 'Dark'], (v) => t(`themes.${v}`))}
      <div className="field">
        <label>
          {t('currency')}
          <select
            name="currency"
            value={user!.currency}
            aria-disabled={busy}
            aria-describedby="currency-hint"
            // React doesn't put a controlled select back when the change is ignored, so do it here.
            onChange={(e) => (busy ? (e.target.value = user!.currency) : save('currency', e.target.value))}
          >
            {/* Options hold text only, so the code is isolated with FSI/PDI, the text form of <bdi>. */}
            {currencies.map((c) => <option key={c} value={c}>{`⁨${c}⁩ – ${currencyNames.of(c)}`}</option>)}
          </select>
        </label>
        <p id="currency-hint" className="muted">{t('currencyHint')}</p>
        {errorFor('currency')}
      </div>
      <p role="status">{saved && t('saved')}</p>
    </div>
  )
}
