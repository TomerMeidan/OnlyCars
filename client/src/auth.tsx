import { createContext, useContext, useState, type ReactNode } from 'react'
import { api, setToken, getToken, type AuthResponse, type User } from './api'

interface AuthState {
  user: User | null
  authenticate: (mode: 'login' | 'register', email: string, password: string, currency?: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState>(null!)
const USER_KEY = 'user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() =>
    getToken() ? JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') : null,
  )

  const authenticate: AuthState['authenticate'] = async (mode, email, password, currency) => {
    const res = await api<AuthResponse>(`/auth/${mode}`, 'POST', { email, password, currency })
    setToken(res.token)
    localStorage.setItem(USER_KEY, JSON.stringify(res.user))
    setUser(res.user)
  }

  const logout = () => {
    setToken(null)
    localStorage.removeItem(USER_KEY)
    setUser(null)
  }

  return <AuthContext value={{ user, authenticate, logout }}>{children}</AuthContext>
}

export const useAuth = () => useContext(AuthContext)
