import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
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

// NAV-1: the breakpoint index.css uses. Rendered rather than hidden in CSS, so each link exists once.
const phoneQuery = matchMedia('(max-width: 40em)')
const onPhoneChange = (cb: () => void) => {
  phoneQuery.addEventListener('change', cb)
  return () => phoneQuery.removeEventListener('change', cb)
}

export default function App() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const location = useLocation()
  const at = location.key
  const phone = useSyncExternalStore(onPhoneChange, () => phoneQuery.matches)
  const [moreOpen, setMoreOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const closeMore = () => {
    setMoreOpen(false)
    moreButton.current?.focus()
  }

  // A tab, Back or Forward change the page without a tap outside; crossing 40em swaps the nav. Reset during render, as React advises.
  const [navAt, setNavAt] = useState(at + phone)
  if (navAt !== at + phone) {
    setNavAt(at + phone)
    setMoreOpen(false)
  }

  // The More menu closes on Esc (focus back on More) and on a tap or focus outside it and More.
  useEffect(() => {
    if (!moreOpen) return
    const outside = (e: Event) => [menu.current, moreButton.current].some((el) => el?.contains(e.target as Node)) || setMoreOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeMore()
    addEventListener('pointerdown', outside)
    addEventListener('focusin', outside)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('pointerdown', outside)
      removeEventListener('focusin', outside)
      removeEventListener('keydown', esc)
    }
  }, [moreOpen])

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

  const logoutButton = <button className="link" onClick={confirmLogout}>{t('logout')}</button>

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
        {phone && user ? (
          // Keyed apart, so crossing 40em never turns one nav's link into the other's mid-click.
          <nav key="tabs" className="tabs">
            <NavLink to="/" end>{t('dashboard')}</NavLink>
            <NavLink to="/history">{t('tabHistory')}</NavLink>
            <NavLink to="/checklists">{t('checklists')}</NavLink>
            <NavLink to="/tires">{t('tires')}</NavLink>
            <button
              ref={moreButton}
              aria-expanded={moreOpen}
              aria-controls={moreOpen ? 'more-menu' : undefined}
              aria-current={['/reports', '/settings'].includes(location.pathname) ? 'page' : undefined}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              {t('more')}
            </button>
            {/* After More in the tab order; any choice closes it (a click bubbles here after the item's own handler). */}
            {moreOpen && (
              <div id="more-menu" ref={menu} className="more-menu" onClick={closeMore}>
                <NavLink to="/reports">{t('reports')}</NavLink>
                <NavLink to="/settings">{t('settings')}</NavLink>
                {logoutButton}
              </div>
            )}
          </nav>
        ) : user && (
          <nav key="bar">
            <NavLink to="/history">{t('serviceHistory')}</NavLink>
            <NavLink to="/reports">{t('reports')}</NavLink>
            <NavLink to="/checklists">{t('checklists')}</NavLink>
            <NavLink to="/tires">{t('tires')}</NavLink>
            <NavLink to="/settings">{t('settings')}</NavLink>
            {logoutButton}
          </nav>
        )}
      </header>
      <main>
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
