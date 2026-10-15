import { createContext, useContext, useState, type ReactNode } from 'react'
import { api, applyTheme, cachedUser, setToken, USER_KEY, type AuthResponse, type User } from './api'
import i18n, { toLocale } from './i18n'

type Settings = Partial<Pick<User, 'locale' | 'theme' | 'currency'>>

interface AuthState {
  user: User | null
  authenticate: (mode: 'login' | 'register', email: string, password: string, currency?: string) => Promise<void>
  logout: () => void
  // Applies the change at once, saves it, and puts the old values back if the save fails.
  saveSettings: (patch: Settings) => Promise<void>
  storeUser: (user: User) => void
}

const AuthContext = createContext<AuthState>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cachedUser)

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
    storeUser(res.user)
  }

  const saveSettings = async (patch: Settings) => {
    const old = user!
    show({ ...old, ...patch })
    try {
      storeUser(await api<User>('/me/settings', 'PUT', patch))
    } catch (err) {
      show(cachedUser() ?? old) // the last saved values; the snapshot may predate a later successful save
      throw err
    }
  }

  const logout = () => {
    setToken(null)
    localStorage.removeItem(USER_KEY)
    setUser(null)
    applyTheme(undefined)
  }

  return <AuthContext value={{ user, authenticate, logout, saveSettings, storeUser }}>{children}</AuthContext>
}

export const useAuth = () => useContext(AuthContext)
