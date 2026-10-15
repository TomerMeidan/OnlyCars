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

// Urgency order; disabled tasks (no status) go last.
const rank = (s: TaskStatus | null) => (s ? ['Overdue', 'DueSoon', 'Ok'].indexOf(s) : 3)
// Most urgent first: by status, then most used, then by name. The car page and the dashboard both list a car's tasks this way.
export const byUrgency = (lng: string | undefined) => (a: MaintenanceTask, b: MaintenanceTask) =>
  rank(a.status) - rank(b.status) || (b.progress ?? 0) - (a.progress ?? 0) || a.name.localeCompare(b.name, lng, { numeric: true })

export interface ServiceRecord {
  id: string
  vehicleId: string
  date: string
  odometerKm: number
  shopName: string | null // null = DIY
  totalCost: number | null
  notes: string | null
  tasks: Pick<MaintenanceTask, 'id' | 'name' | 'category'>[]
  items: ServiceItem[] // when not empty, totalCost is their sum
}

// GET /service-records: one page of matches; the count and total cover every match.
export interface ServiceRecordPage {
  items: ServiceRecord[]
  totalCount: number
  totalCost: number
}

// GET /dashboard: active cars, most urgent first, each with all its enabled tasks; the month figures equal /history's for the same dates.
export interface Dashboard {
  overdueCount: number
  dueSoonCount: number
  month: string // YYYY-MM
  monthTotalCost: number
  monthServiceCount: number
  vehicles: { id: string; overdueCount: number; dueSoonCount: number; tasks: MaintenanceTask[] }[]
}

// The id changes on every save (the list is replaced), so nothing on screen is keyed on it.
export interface ServiceItem {
  id: string
  description: string
  brand: string | null
  partNumber: string | null
  quantity: number // hours on a labour row
  unitCost: number
  isLabor: boolean
}

// The server's total for items: the sum of quantity times unit cost, rounded once to 2 decimals, worked in integer cents
// because floats misround (1.005 * 100 is 100.4999...). Exact up to the caps (5e15 < MAX_SAFE_INTEGER).
export const itemsTotal = (items: { quantity: number; unitCost: number }[]) =>
  Math.round(items.reduce((sum, i) => sum + Math.round(i.quantity * 100) * Math.round(i.unitCost * 100), 0) / 100) / 100

// ProblemDetails from the API; `code` is translated by errorMessage() in i18n.ts.
export interface Problem {
  title?: string
  detail?: string
  code?: string
  previousKm?: number
  nextKm?: number
  currentKm?: number
  index?: number // the 0-based item row of a serviceItem.* error
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

// The record was deleted meanwhile (for example in another tab): a row action reloads the history instead of showing an error.
export const isGoneRecord = (err: unknown) =>
  err instanceof ApiError && ['serviceRecord.alreadyVoided', 'serviceRecord.notFound'].includes(err.problem.code ?? '')

export const isGuid = (s: string | undefined) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s ?? '')

// The API's answer for a car that doesn't exist, used without a request when the route id can't be one.
export const carNotFound = () => new ApiError(404, { code: 'vehicle.notFound' }, 'Not Found')

// The user's calendar date, for date fields' max and defaults.
export function localToday() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
