import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { errorMessage, toLocale } from './i18n'
import AuthPage from './pages/AuthPage'
import CarPage from './pages/CarPage'
import CarFormPage from './pages/CarFormPage'
import CarsPage from './pages/CarsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const { t, i18n } = useTranslation()
  const { user, logout, saveSettings } = useAuth()
  const otherLang = i18n.resolvedLanguage === 'he' ? 'en' : 'he'
  // Kept with the page it happened on, so navigating (or logging out) clears it.
  const { key } = useLocation()
  const [langError, setLangError] = useState<{ key: string; err: unknown } | null>(null)
  const [langBusy, setLangBusy] = useState(false)

  // Signed in, the switch also saves the language to the account.
  async function switchLanguage() {
    if (langBusy) return // aria-disabled rather than disabled, so the button keeps focus
    setLangError(null)
    if (!user) return i18n.changeLanguage(otherLang)
    setLangBusy(true)
    try {
      await saveSettings({ locale: toLocale(otherLang) })
    } catch (err) {
      setLangError({ key, err })
    } finally {
      setLangBusy(false)
    }
  }

  return (
    <>
      <header>
        <Link to="/" className="brand">{t('appName')}</Link>
        <nav>
          <button className="link" onClick={switchLanguage} aria-disabled={langBusy}>
            {otherLang === 'he' ? 'עברית' : 'English'}
          </button>
          {user && <Link to="/settings">{t('settings')}</Link>}
          {user && <button className="link" onClick={logout}>{t('logout')}</button>}
        </nav>
      </header>
      <main>
        {langError?.key === key && <p className="error" role="alert">{errorMessage(langError.err)}</p>}
        {user ? (
          <Routes>
            <Route path="/" element={<CarsPage />} />
            <Route path="/cars/new" element={<CarFormPage />} />
            <Route path="/cars/:id" element={<CarPage />} />
            <Route path="/cars/:id/edit" element={<CarFormPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        )}
      </main>
    </>
  )
}
