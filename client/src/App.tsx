import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { errorMessage, toLocale } from './i18n'
import { readQueue, sendQueue } from './offline'
import AuthPage from './pages/AuthPage'
import CarPage from './pages/CarPage'
import CarFormPage from './pages/CarFormPage'
import CarsPage from './pages/CarsPage'
import ChecklistsPage from './pages/ChecklistsPage'
import HistoryPage from './pages/HistoryPage'
import ReportsPage from './pages/ReportsPage'
import RunPage from './pages/RunPage'
import SettingsPage from './pages/SettingsPage'
import TiresPage from './pages/TiresPage'

export default function App() {
  const { t, i18n } = useTranslation()
  const { user, logout, saveSettings, settingsError } = useAuth()
  const otherLang = i18n.resolvedLanguage === 'he' ? 'en' : 'he'
  // A failure is kept with the page it happened on, so navigating (or logging out) clears it.
  const at = `header@${useLocation().key}`
  const [langBusy, setLangBusy] = useState(false)

  // OFF-1: queued readings go on app start, after login and when the connection is back.
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    const send = () => sendQueue(userId)
    send()
    addEventListener('online', send)
    return () => removeEventListener('online', send)
  }, [userId])
  const confirmLogout = () => (!readQueue(userId!).length || confirm(t('logoutLosesReadings'))) && logout()

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
        <Link to="/" className="brand">
          {/* The dial from the favicon; the name next to it is the link's text. */}
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="M10 31a14 14 0 1 1 28 0" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            <path d="M24 31 32.5 20" stroke="var(--cluster-ink)" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="24" cy="31" r="3.5" fill="var(--cluster-ink)" />
          </svg>
          {t('appName')}
        </Link>
        {/* NavLink marks the current page with aria-current="page", which the stylesheet lights up. */}
        <nav>
          <button className="link" onClick={switchLanguage} aria-disabled={langBusy}>
            {otherLang === 'he' ? 'עברית' : 'English'}
          </button>
          {user && <NavLink to="/history">{t('serviceHistory')}</NavLink>}
          {user && <NavLink to="/reports">{t('reports')}</NavLink>}
          {user && <NavLink to="/checklists">{t('checklists')}</NavLink>}
          {user && <NavLink to="/tires">{t('tires')}</NavLink>}
          {user && <NavLink to="/settings">{t('settings')}</NavLink>}
          {user && <button className="link" onClick={confirmLogout}>{t('logout')}</button>}
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
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/checklists" element={<ChecklistsPage />} />
            <Route path="/tires" element={<TiresPage />} />
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
