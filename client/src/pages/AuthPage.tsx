import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../i18n'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { currencies } from '../api'

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { t, i18n } = useTranslation()
  const { authenticate } = useAuth()
  // Follows the UI language until the user picks one.
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null)
  const currency = pickedCurrency ?? (i18n.resolvedLanguage === 'he' ? 'ILS' : 'USD')
  const currencyNames = new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'currency' })
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      await authenticate(mode, String(form.get('email')), String(form.get('password')), mode === 'register' ? currency : undefined)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>{t(mode)}</h1>
      <p className="intro">{t('intro')}</p>
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
      <p>
        {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
        <Link to={mode === 'login' ? '/register' : '/login'}>{t(mode === 'login' ? 'register' : 'login')}</Link>
      </p>
    </form>
  )
}
