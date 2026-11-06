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
          {/* The dial from the favicon on the deep teal tile (fixed colors, the same in both themes); the name next to it is the link's text. */}
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <rect width="48" height="48" rx="14" fill="#0b6b5a" />
            <path d="M10 31a14 14 0 1 1 28 0" fill="none" stroke="#f2a516" strokeWidth="4" strokeLinecap="round" />
            <path d="M24 31 32.5 20" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="24" cy="31" r="3.5" fill="#fff" />
          </svg>
          {t('appName')}
        </Link>
        {/* NavLink marks the current page with aria-current="page", which the stylesheet lights up. */}
        {phone && user ? (
          // Keyed apart, so crossing 40em never turns one nav's link into the other's mid-click.
          <nav key="tabs" className="tabs">
            <NavLink to="/" end><TabIcon d={icons.dashboard} />{t('dashboard')}</NavLink>
            <NavLink to="/spending"><TabIcon d={icons.spending} />{t('spending')}</NavLink>
            <NavLink to="/tires"><TabIcon d={icons.tires} />{t('tires')}</NavLink>
            <button
              ref={moreButton}
              aria-expanded={moreOpen}
              aria-controls={moreOpen ? 'more-menu' : undefined}
              aria-current={location.pathname.startsWith('/settings') ? 'page' : undefined}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <TabIcon d={icons.more} />{t('more')}
            </button>
            {/* After More in the tab order; any choice closes it (a click bubbles here after the item's own handler). */}
            {moreOpen && (
              <div id="more-menu" ref={menu} className="more-menu" onClick={closeMore}>
                <NavLink to="/settings">{t('settings')}</NavLink>
                {logoutButton}
              </div>
            )}
          </nav>
        ) : user && (
          <nav key="bar">
            <NavLink to="/spending">{t('spending')}</NavLink>
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
            <Route path="/spending" element={<HistoryPage />} />
            <Route path="/spending/reports" element={<ReportsPage />} />
            <Route path="/history" element={<Moved to="/spending" />} />
            <Route path="/reports" element={<Moved to="/spending/reports" />} />
            <Route path="/settings/checklists" element={<ChecklistsPage />} />
            <Route path="/checklists" element={<Moved to="/settings/checklists" />} />
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

// The tab bar's icons (24px, stroked); none points a direction, so none is mirrored in Hebrew. The label beside each is the name.
const icons = {
  dashboard: 'M4.5 16a7.5 7.5 0 1 1 15 0M12 16l3.5-4.5M12 16h.01M3 20h18',
  spending: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  tires: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21',
  more: 'M4 6h16M4 12h16M4 18h16',
}
function TabIcon({ d }: { d: string }) {
  return (
    <span className="tab-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
    </span>
  )
}

// A page that moved (owner, 2026-10-30): old links and bookmarks land on the new address with their filters.
function Moved({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={to + search} replace />
}
