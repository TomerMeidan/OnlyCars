import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { errorMessage, toLocale } from './i18n'
import AuthPage from './pages/AuthPage'
import CarPage from './pages/CarPage'
import CarFormPage from './pages/CarFormPage'
import CarsPage from './pages/CarsPage'
import ChecklistsPage from './pages/ChecklistsPage'
import HistoryPage from './pages/HistoryPage'
import RunPage from './pages/RunPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const { t, i18n } = useTranslation()
  const { user, logout, saveSettings, settingsError } = useAuth()
  const otherLang = i18n.resolvedLanguage === 'he' ? 'en' : 'he'
  // A failure is kept with the page it happened on, so navigating (or logging out) clears it.
  const at = `header@${useLocation().key}`
  const [langBusy, setLangBusy] = useState(false)

  // Signed in, the switch also saves the language to the account.
  async function switchLanguage() {
    if (langBusy) return // aria-disabled rather than disabled, so the button keeps focus
    if (!user) return i18n.changeLanguage(otherLang)
    setLangBusy(true)
    await saveSettings({ locale: toLocale(otherLang) }, at)
    setLangBusy(false)
  }

  return (
    <>
      <header>
        <Link to="/" className="brand">{t('appName')}</Link>
        <nav>
          <button className="link" onClick={switchLanguage} aria-disabled={langBusy}>
            {otherLang === 'he' ? 'עברית' : 'English'}
          </button>
          {user && <Link to="/history">{t('serviceHistory')}</Link>}
          {user && <Link to="/checklists">{t('checklists')}</Link>}
          {user && <Link to="/settings">{t('settings')}</Link>}
          {user && <button className="link" onClick={logout}>{t('logout')}</button>}
        </nav>
      </header>
      <main>
        {settingsError?.at === at && <p className="error" role="alert">{errorMessage(settingsError.err)}</p>}
        {user ? (
          <Routes>
            <Route path="/" element={<CarsPage />} />
            <Route path="/cars/new" element={<CarFormPage />} />
            <Route path="/cars/:id" element={<CarPage />} />
            <Route path="/cars/:id/edit" element={<CarFormPage />} />
            <Route path="/cars/:id/checklists/:checklistId/run" element={<RunPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/checklists" element={<ChecklistsPage />} />
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
