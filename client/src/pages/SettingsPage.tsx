import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { accountDeleted, api, ApiError, apiResponse, currencies, download, limit, type User } from '../api'
import { useAuth } from '../auth'
import { GoogleButton } from '../google'
import { errorMessage } from '../i18n'
import { usePage } from '../usePage'

type Field = 'locale' | 'theme' | 'currency' | 'distanceUnit' | 'reminderLeadDays' | 'emailReminders'

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { user, saveSettings, settingsError, storeUser, logout } = useAuth()
  // One save at a time, page-wide. Controls stay focusable (aria-disabled), so focus isn't dropped to <body> while saving.
  const [busy, setBusy] = useState(false)
  const saveStarted = useRef(false)
  const [saved, setSaved] = useState(false)
  // A failure is tagged with its field and this visit, so leaving the page clears it.
  const { key } = useLocation()
  const at = (field: Field) => `${field}@${key}`
  const currencyNames = new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'currency' })
  usePage(t('settings'))
  // Typed here and saved with Save; follows the saved value (a refresh, or put back after a failed save).
  const savedLead = String(user!.reminderLeadDays ?? '') // undefined in a user cached before NOT-1, until the refresh below
  const [lead, setLead] = useState({ saved: savedLead, value: savedLead })
  if (lead.saved !== savedLead) setLead({ saved: savedLead, value: savedLead })

  // The page shows the cached user at once; this picks up changes made on another device.
  // A failed refresh is ignored: the cached values stay usable and each save returns the server's values.
  // Once a save has started its response is newer, so a late refresh is dropped.
  useEffect(() => {
    api<User>('/me').then((u) => saveStarted.current || storeUser(u), () => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(field: Field, value: string | number | boolean) {
    if (busy) return // the controlled value puts the control back
    saveStarted.current = true
    setBusy(true)
    setSaved(false)
    setSaved(await saveSettings({ [field]: value }, at(field)))
    setBusy(false)
  }

  // ACC-1: everything the user owns as one JSON file, under the server's file name. One export at a time.
  const [exp, setExp] = useState<{ busy?: boolean; done?: boolean; error?: unknown } | null>(null)
  const exportButton = useRef<HTMLButtonElement>(null)
  // Leaving the page mid-export cancels the request and never downloads.
  const exportAbort = useRef<AbortController>(null)
  useEffect(() => () => exportAbort.current?.abort(), [])
  async function exportData() {
    if (exp?.busy) return // aria-disabled rather than disabled, so the button keeps focus
    setExp({ busy: true })
    const { signal } = (exportAbort.current = new AbortController())
    try {
      const res = await apiResponse('/me/export', 'GET', undefined, signal)
      const blob = await res.blob()
      // A stream cut off mid-file still comes as a 200: a file that doesn't parse is an error, never saved (L162).
      const data = JSON.parse(await blob.text())
      // filename= up to ";" (ASP.NET writes it unquoted, then filename*); else the same UTC date from the body.
      const name = res.headers.get('Content-Disposition')?.match(/filename="?([^";]+)/)?.[1] ?? `onlycars-export-${data.exportedAt.slice(0, 10)}.json`
      if (signal.aborted) return
      download(blob, name)
      setExp({ done: true })
    } catch (error) {
      if (signal.aborted) return
      setExp({ error })
      exportButton.current?.focus() // pressing Export again is the retry
    }
  }

  // ACC-2: delete the account. null is closed; the panel opens on its heading, and Cancel or Escape go back to the opener.
  // An account made with Google has no password: a fresh Google sign-in confirms instead, kept as googleIdToken.
  const [del, setDel] = useState<{ busy?: boolean; error?: unknown; googleIdToken?: string } | null>(null)
  const withGoogle = user!.hasPassword === false
  const deleteButton = useRef<HTMLButtonElement>(null)
  const delHeading = useRef<HTMLHeadingElement>(null)
  const delPassword = useRef<HTMLInputElement>(null)
  const delAlert = useRef<HTMLParagraphElement>(null)
  const delOpen = del != null
  const delCode = del?.error instanceof ApiError ? del.error.problem.code : undefined
  const badPassword = delCode === 'auth.invalidCredentials' || delCode === 'auth.credentialsRequired'
  useEffect(() => { if (delOpen) delHeading.current?.focus() }, [delOpen])
  // A password error keeps the user in the field; any other goes to its message, and Delete is the retry.
  useEffect(() => { if (del?.error != null) (badPassword ? delPassword : delAlert).current?.focus() }, [del?.error, badPassword])
  function closeDelete() {
    if (del?.busy) return
    setDel(null) // unmounts the panel, which clears the password
    deleteButton.current?.focus()
  }
  async function deleteAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (del?.busy) return // aria-disabled, so a second Enter lands here
    const password = new FormData(e.currentTarget).get('password')
    const googleIdToken = del?.googleIdToken
    if (withGoogle && !googleIdToken) return setDel({ error: new ApiError(400, { code: 'auth.googleRequired' }, 'Bad Request') })
    setDel({ busy: true, googleIdToken })
    try {
      await api('/me', 'DELETE', withGoogle ? { googleIdToken } : { password })
      accountDeleted.current = true
      logout() // the signed-out routes send /settings to /login
    } catch (error) {
      setDel({ error }) // drops a Google confirmation too: a retry signs in with Google again (the server takes one up to 10 minutes old)
    }
  }
  const delMessage = del?.error == null ? null
    : delCode === 'auth.invalidCredentials' ? t('deleteAccountWrongPassword')
    : delCode === 'auth.credentialsRequired' ? t('deleteAccountPasswordRequired')
    : delCode === 'auth.googleRequired' ? t('deleteAccountGoogleRequired')
    : `${t('deleteAccountFailed')} ${del.error instanceof ApiError && del.error.status === 429 ? t('deleteAccountTooMany') : errorMessage(del.error)}`

  const errorFor = (field: Field) =>
    settingsError?.at === at(field) && <p className="error" role="alert">{errorMessage(settingsError.err)}</p>

  const radios = (field: Exclude<Field, 'currency' | 'reminderLeadDays' | 'emailReminders'>, legend: string, values: string[], label: (v: string) => ReactNode) => (
    <fieldset aria-disabled={busy}>
      <legend>{t(legend)}</legend>
      {values.map((v) => (
        <label key={v} className="inline">
          <input type="radio" name={field} value={v} checked={user![field] === v} onChange={() => save(field, v)}
            // While busy the browser undoes the check (arrow keys click too); React wouldn't put a controlled radio back.
            // Focus goes back to the checked radio, so it never rests on one that isn't (SET-1 QA Low 1).
            onClick={(e) => {
              if (!busy) return
              e.preventDefault()
              e.currentTarget.closest('fieldset')!.querySelector<HTMLInputElement>(`[value="${user![field]}"]`)!.focus()
            }} />
          {label(v)}
        </label>
      ))}
      {errorFor(field)}
    </fieldset>
  )

  return (
    <div className="card settings">
      <h1 tabIndex={-1}>{t('settings')}</h1>
      {radios('locale', 'language', ['He', 'En'], (v) => (v === 'He' ? <span lang="he">עברית</span> : <span lang="en">English</span>))}
      {radios('theme', 'theme', ['System', 'Light', 'Dark'], (v) => t(`themes.${v}`))}
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
      {radios('distanceUnit', 'distanceUnit', ['Km', 'Mi'], (v) => t(`distanceUnits.${v}`))}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); save('reminderLeadDays', Number(lead.value)) }}>
        <label>
          {t('leadDays')}
          <input name="reminderLeadDays" type="number" inputMode="numeric" required min={1} max={365} step={1} value={lead.value}
            aria-describedby="lead-days-hint" onChange={(e) => setLead({ ...lead, value: e.target.value })} onInput={limit(t('limits.leadDays'))} />
        </label>
        <button aria-disabled={busy}>{t('save')}</button>
        <p id="lead-days-hint" className="muted">{t('leadDaysHint')}</p>
        {errorFor('reminderLeadDays')}
      </form>
      <div className="field">
        <label className="inline">
          {/* React puts a controlled checkbox back when a busy change is ignored. */}
          <input type="checkbox" name="emailReminders" checked={user!.emailReminders ?? true} aria-disabled={busy} aria-describedby="email-reminders-hint"
            onChange={(e) => save('emailReminders', e.target.checked)} />
          {t('emailReminders')}
        </label>
        <p id="email-reminders-hint" className="muted">{t('emailRemindersHint')}</p>
        {errorFor('emailReminders')}
      </div>
      <p role="status">{saved && t('saved')}</p>
      <section className="field" aria-labelledby="your-data">
        <h2 id="your-data">{t('yourData')}</h2>
        <p className="muted">{t('exportDataHint')}</p>
        <div className="actions export">
          <button type="button" className="stack" ref={exportButton} data-alt={t(exp?.busy ? 'exportData' : 'exportDataBusy')}
            aria-disabled={!!exp?.busy} onClick={exportData}>
            <span>{exp?.busy ? t('exportDataBusy') : t('exportData')}</span>
          </button>
        </div>
        <p role="status">{exp?.done && t('downloaded')}</p>
        {exp?.error != null && (
          <p className="error" role="alert">
            {t('exportDataFailed')} {exp.error instanceof ApiError && exp.error.status === 429 ? t('exportTooMany') : errorMessage(exp.error)}
          </p>
        )}
        <div className="actions">
          <button type="button" className="danger" ref={deleteButton} aria-expanded={delOpen} onClick={() => (del ? closeDelete() : setDel({}))}>
            {t('deleteAccount')}
          </button>
        </div>
        {del && (
          <form className="inline-form" aria-labelledby="delete-account-title" onSubmit={deleteAccount}
            onKeyDown={(e) => e.key === 'Escape' && closeDelete()}>
            <h3 id="delete-account-title" tabIndex={-1} ref={delHeading}>{t('deleteAccountTitle')}</h3>
            <p>{t('deleteAccountWarning')}</p>
            <p>{t('deleteAccountExportFirst')}</p>
            {withGoogle ? (
              del.googleIdToken ? <p role="status">{t('deleteAccountGoogleDone')}</p> : <>
                <p>{t('deleteAccountGoogle')}</p>
                <GoogleButton text="continue_with" onCredential={(googleIdToken) => setDel({ googleIdToken })} />
              </>
            ) : (
              <label>
                {t('password')}
                <input ref={delPassword} name="password" type="password" autoComplete="current-password" required
                  aria-invalid={badPassword || undefined} aria-describedby={badPassword ? 'delete-account-error' : undefined} />
              </label>
            )}
            {delMessage && <p id="delete-account-error" className="error" role="alert" tabIndex={-1} ref={delAlert}>{delMessage}</p>}
            <div className="actions">
              <button className="danger stack" aria-disabled={!!del.busy} data-alt={t(del.busy ? 'deleteAccountConfirm' : 'deleteAccountBusy')}>
                <span>{t(del.busy ? 'deleteAccountBusy' : 'deleteAccountConfirm')}</span>
              </button>
              <button type="button" className="link" aria-disabled={!!del.busy} onClick={closeDelete}>{t('cancel')}</button>
            </div>
          </form>
        )}
      </section>
      <section className="field" aria-labelledby="checklist-templates">
        <h2 id="checklist-templates">{t('checklistTemplates')}</h2>
        <p className="muted">{t('checklistTemplatesHint')}</p>
        <div className="actions"><Link to="/settings/checklists">{t('checklistTemplates')}</Link></div>
      </section>
    </div>
  )
}
