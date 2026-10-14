import { useTranslation } from 'react-i18next'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import AuthPage from './pages/AuthPage'
import CarPage from './pages/CarPage'
import CarFormPage from './pages/CarFormPage'
import CarsPage from './pages/CarsPage'

export default function App() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuth()
  const otherLang = i18n.resolvedLanguage === 'he' ? 'en' : 'he'

  return (
    <>
      <header>
        <Link to="/" className="brand">{t('appName')}</Link>
        <nav>
          <button className="link" onClick={() => i18n.changeLanguage(otherLang)}>
            {otherLang === 'he' ? 'עברית' : 'English'}
          </button>
          {user && <button className="link" onClick={logout}>{t('logout')}</button>}
        </nav>
      </header>
      <main>
        {user ? (
          <Routes>
            <Route path="/" element={<CarsPage />} />
            <Route path="/cars/new" element={<CarFormPage />} />
            <Route path="/cars/:id" element={<CarPage />} />
            <Route path="/cars/:id/edit" element={<CarFormPage />} />
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
