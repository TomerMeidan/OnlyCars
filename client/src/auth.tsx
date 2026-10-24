import { createContext, useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, applyTheme, cachedUser, getToken, setToken, USER_KEY, type AuthResponse, type User } from './api'
import i18n, { toLocale } from './i18n'
import { clearOffline, pruneOffline } from './offline'
import { distance } from './units'

type Settings = Partial<Pick<User, 'locale' | 'theme' | 'currency' | 'distanceUnit' | 'reminderLeadDays'>>

interface AuthState {
  user: User | null
  authenticate: (mode: 'login' | 'register', email: string, password: string, currency?: string) => Promise<void>
  logout: () => void
  // Applies the change at once, saves it, and puts the old values back if the save fails. Resolves to whether it saved.
  // `at` tags a failure with where it happened; each save clears every earlier failure, wherever it showed.
  saveSettings: (patch: Settings, at: string) => Promise<boolean>
  settingsError: { at: string; err: unknown } | null
  storeUser: (user: User) => void
}

const AuthContext = createContext<AuthState>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cachedUser)
  const [settingsError, setSettingsError] = useState<AuthState['settingsError']>(null)

  // Signed in, the account's language and theme win.
  function show(u: User) {
    setUser(u)
    applyTheme(u.theme)
    if (toLocale(i18n.resolvedLanguage) !== u.locale) i18n.changeLanguage(u.locale.toLowerCase())
  }

  function storeUser(u: User) {
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    show(u)
  }

  const authenticate: AuthState['authenticate'] = async (mode, email, password, currency) => {
    const locale = mode === 'register' ? toLocale(i18n.resolvedLanguage) : undefined
    const res = await api<AuthResponse>(`/auth/${mode}`, 'POST', { email, password, currency, locale })
    setToken(res.token)
    pruneOffline(res.user.id)
    storeUser(res.user)
  }

  const saveSettings: AuthState['saveSettings'] = async (patch, at) => {
    const old = user!
    setSettingsError(null)
    show({ ...old, ...patch })
    const token = getToken()
    try {
      const saved = await api<User>('/me/settings', 'PUT', patch)
      // Logged out (or in as someone else) meanwhile: storing it would bring back a user without a token.
      if (getToken() !== token) return false
      storeUser(saved)
      return true
    } catch (err) {
      if (getToken() !== token) return false
      show(cachedUser() ?? old) // the last saved values; the snapshot may predate a later successful save
      setSettingsError({ at, err })
      return false
    }
  }

  // Also clears the user's offline readings and car list (OFF-1); a 401 in api() keeps them for the next login.
  const logout = () => {
    if (user) clearOffline(user.id)
    setToken(null)
    localStorage.removeItem(USER_KEY)
    setUser(null)
    applyTheme(undefined)
  }

  return <AuthContext value={{ user, authenticate, logout, saveSettings, settingsError, storeUser }}>{children}</AuthContext>
}

export const useAuth = () => useContext(AuthContext)

// The signed-in user's distance unit with its conversions and labels (units.ts).
export function useDistance() {
  const { t, i18n } = useTranslation()
  return distance(useAuth().user?.distanceUnit ?? 'Km', t, i18n.resolvedLanguage)
}
