import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../i18n'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { accountDeleted, currencies } from '../api'
import { GoogleButton } from '../google'
import { usePage } from '../usePage'

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { t, i18n } = useTranslation()
  const { authenticate, authenticateGoogle } = useAuth()
  // Follows the UI language until the user picks one.
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null)
  const currency = pickedCurrency ?? (i18n.resolvedLanguage === 'he' ? 'ILS' : 'USD')
  const currencyNames = new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'currency' })
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  usePage(t(mode))
  // Read once and cleared, so the note doesn't come back on a later visit.
  const [deleted] = useState(() => accountDeleted.current)
  useEffect(() => { accountDeleted.current = false }, [])

  async function run(signIn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    run(() => authenticate(mode, String(form.get('email')), String(form.get('password')), mode === 'register' ? currency : undefined))
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      {/* Focus lands on the h1 after the redirect, so it carries the note too. */}
      <h1 tabIndex={-1} aria-describedby={deleted ? 'account-deleted' : undefined}>{t(mode)}</h1>
      {deleted && <p id="account-deleted" className="notice" role="status">{t('accountDeleted')}</p>}
      <p className="intro">{t('intro')}</p>
      {/* A first Google sign-in makes the account, with the currency shown on Register (or the language's default). */}
      <GoogleButton text={mode === 'login' ? 'signin_with' : 'signup_with'} or onCredential={(idToken) => run(() => authenticateGoogle(idToken, currency))} />
      <label>
        {t('email')}
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        {t('password')}
        <input
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 8 : undefined}
          required
        />
      </label>
      {mode === 'register' && (
        <label>
          {t('currency')}
          <select name="currency" value={currency} onChange={(e) => setPickedCurrency(e.target.value)}>
            {currencies.map((c) => <option key={c} value={c}>{`${c} – ${currencyNames.of(c)}`}</option>)}
          </select>
        </label>
      )}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      <button disabled={busy}>{t(mode)}</button>
      <p className="switch">
        {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
        <Link to={mode === 'login' ? '/register' : '/login'}>{t(mode === 'login' ? 'register' : 'login')}</Link>
      </p>
    </form>
  )
}
