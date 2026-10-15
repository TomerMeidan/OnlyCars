export type FuelType = 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric' | 'Lpg' | 'Other'
export const fuelTypes: FuelType[] = ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'Lpg', 'Other']

export const currencies = ['ILS', 'USD', 'EUR', 'GBP']

export interface User {
  id: string
  email: string
  distanceUnit: 'Km' | 'Mi'
  currency: string
  locale: 'En' | 'He'
  theme: 'Light' | 'Dark' | 'System'
}

export interface AuthResponse {
  token: string
  expiresAt: string
  user: User
}

export interface Vehicle {
  id: string
  nickname: string
  make: string | null
  model: string | null
  year: number | null
  vin: string | null
  plate: string | null
  fuelType: FuelType | null
  purchaseDate: string | null
  purchasePrice: number | null
  photoUrl: string | null
  currentOdometerKm: number
  avgKmPerDay: number | null
  isArchived: boolean
}

export type VehicleInput = Omit<Vehicle, 'id' | 'currentOdometerKm' | 'avgKmPerDay' | 'isArchived'> & {
  initialOdometerKm?: number | null
}

export type OdometerSource = 'Manual' | 'Service' | 'Checklist' | 'Fuel'

export interface OdometerReading {
  id: string
  vehicleId: string
  valueKm: number
  readingDate: string
  source: OdometerSource
}

export type TaskCategory = 'Oil' | 'Filters' | 'Brakes' | 'Tires' | 'Fluids' | 'Battery' | 'Belts' | 'Ignition' | 'Other'
export const taskCategories: TaskCategory[] = ['Oil', 'Filters', 'Brakes', 'Tires', 'Fluids', 'Battery', 'Belts', 'Ignition', 'Other']

export interface TaskTemplate {
  id: string
  key: string
  name: string
  category: TaskCategory
  defaultIntervalKm: number | null
  defaultIntervalDays: number | null
}

export interface MaintenanceTask {
  id: string
  vehicleId: string
  templateId: string | null
  name: string
  category: TaskCategory
  intervalKm: number | null
  intervalDays: number | null
  dueSoonPercent: number
  isEnabled: boolean
  lastDoneOdometerKm: number
  lastDoneDate: string
  // Computed on every read; all four are null for a disabled task.
  status: TaskStatus | null
  remainingKm: number | null
  remainingDays: number | null
  progress: number | null
}

export type TaskStatus = 'Ok' | 'DueSoon' | 'Overdue'

// ProblemDetails from the API; `code` is translated by errorMessage() in i18n.ts.
export interface Problem {
  title?: string
  detail?: string
  code?: string
  previousKm?: number
  nextKm?: number
  currentKm?: number
}

export class ApiError extends Error {
  status: number
  problem: Problem
  constructor(status: number, problem: Problem | null, fallback: string) {
    super(problem?.detail ?? problem?.title ?? fallback)
    this.status = status
    this.problem = problem ?? {}
  }
}

const TOKEN_KEY = 'token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

export const USER_KEY = 'user'
export const cachedUser = (): User | null => (getToken() ? JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') : null)

// System removes the attribute, so the OS preference applies through the CSS.
export function applyTheme(theme: User['theme'] | undefined) {
  if (theme === 'Light' || theme === 'Dark') document.documentElement.dataset.theme = theme.toLowerCase()
  else delete document.documentElement.dataset.theme
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401 && token) {
    setToken(null)
    location.assign('/login')
  }
  if (!res.ok) {
    const problem = await res.json().catch(() => null)
    throw new ApiError(res.status, problem, res.statusText)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

// The API accepts an out-of-order reading once the user confirms it is a correction.
export const isOrderError = (err: unknown) =>
  err instanceof ApiError && ['odometer.lowerThanPrevious', 'odometer.higherThanNext'].includes(err.problem.code ?? '')

export const isGuid = (s: string | undefined) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s ?? '')

// The API's answer for a car that doesn't exist, used without a request when the route id can't be one.
export const carNotFound = () => new ApiError(404, { code: 'vehicle.notFound' }, 'Not Found')

// The user's calendar date, for date fields' max and defaults.
export function localToday() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
