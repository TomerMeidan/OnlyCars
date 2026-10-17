import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, type CostReport, type Vehicle } from '../api'
import { useAuth, useDistance } from '../auth'
import { errorMessage, money } from '../i18n'
import { KM_PER_MI } from '../units'
import { usePage } from '../usePage'

const pad = (n: number) => String(n).padStart(2, '0')
// /history for a span of days, with the chosen car.
const historyLink = (from: string, to: string, vehicleId: string) => `/history?${new URLSearchParams({ ...(vehicleId && { vehicleId }), from, to })}`

// /reports: cost reports for a year and every car's all-time costs; the Year and Car filters live in the URL, as on /history.
export default function ReportsPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { user } = useAuth()
  const d = useDistance()
  const unit = user?.distanceUnit ?? 'Km'
  const id = useId()
  const [params, setParams] = useSearchParams()
  const [thisYear] = useState(() => String(new Date().getFullYear())) // the local year at page load
  const year = params.get('year') || thisYear
  const vehicleId = params.get('vehicleId') ?? ''
  const [cars, setCars] = useState<Vehicle[] | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${year}|${vehicleId}|${attempt}`
  // The answer for `key`; while another key loads, the last report stays on screen, marked busy.
  const [shown, setShown] = useState<{ key: string; vehicleId: string; report?: CostReport; error?: unknown } | null>(null)
  // After Retry or an error's way out the button is gone, so focus goes to the h1.
  const refocus = useRef(false)
  usePage(t('reports'))

  useEffect(() => {
    let live = true
    const q = new URLSearchParams({ year, ...(vehicleId && { vehicleId }) })
    Promise.all([
      // The Car filter needs every car, archived too; the report's own `cars` holds only the chosen one.
      cars ?? api<Vehicle[]>('/vehicles?includeArchived=true').then((cs) => { if (live) setCars(cs); return cs }),
      api<CostReport>(`/reports/costs?${q}`),
    ]).then(([, report]) => live && setShown({ key, vehicleId, report }), (error) => live && setShown({ key, vehicleId, error }))
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (shown?.report && refocus.current) document.querySelector<HTMLElement>('main h1')?.focus()
    if (shown) refocus.current = false
  }, [shown])

  const busy = shown?.key !== key
  const report = shown?.report
  const problem = shown?.error instanceof ApiError ? shown.error.problem : undefined
  // Not the caller's car, or not a car id at all (model binding's 400): either way, back to All cars.
  const badCar = problem?.code === 'vehicle.notFound' || !!problem?.errors?.vehicleId

  function update(name: 'year' | 'vehicleId', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value); else next.delete(name)
    setParams(next)
  }
  const leave = (name: 'year' | 'vehicleId') => { refocus.current = true; update(name, '') }

  const years = [...new Set([...(report?.years.map((y) => String(y.year)) ?? []), thisYear, ...(/^\d+$/.test(year) ? [year] : [])])].sort().reverse()
  const carOptions = cars && [...cars].sort((a, b) => Number(a.isArchived) - Number(b.isArchived))

  const amount = (v: number, maxDigits?: number) => <bdi>{money(v, lng, user?.currency, maxDigits)}</bdi>
  // A label and value row; `to` makes the value a link described by its label.
  const row = (k: string, label: ReactNode, value: ReactNode, to?: string) => (
    <div key={k}>
      <dt id={`${id}${k}`}>{label}</dt>
      <dd>{to ? <Link to={to} aria-describedby={`${id}${k}`}>{value}</Link> : value}</dd>
    </div>
  )
  const archived = (name: string, isArchived: boolean) => <>{name}{isArchived && <> <span className="badge">{t('archived')}</span></>}</>

  // vehicleId is the one the report was asked for, so links and By car match the figures while another filter loads.
  function body(r: CostReport, vehicleId: string) {
    // With a car chosen, its All time figures still show.
    if (!vehicleId && r.years.every((y) => y.total === 0)) return (
      <div className="card">
        <p>{t('reportsEmpty')}</p>
        <div className="actions"><Link to="/">{t('goToCars')}</Link></div>
      </div>
    )
    const y = r.year
    const summary = t('historySummary', { count: r.recordCount, total: money(r.total, lng, user?.currency) })
    const month = (m: number) => new Date(y, m - 1, 1).toLocaleDateString(lng, { month: 'long' })
    return (
      <>
        <section className="card" aria-labelledby={`${id}year`}>
          <h2 id={`${id}year`}><bdi>{y}</bdi></h2>
          <p>{r.recordCount ? <Link to={historyLink(`${y}-01-01`, `${y}-12-31`, vehicleId)}>{summary}</Link> : summary}</p>
          {r.unpricedCount > 0 && <p className="muted">{t('unpricedCount', { count: r.unpricedCount })}</p>}
        </section>
        <section className="card" aria-labelledby={`${id}months`}>
          <h2 id={`${id}months`}>{t('byMonth')}</h2>
          <dl className="figures months">
            {r.byMonth.map((m) => row(`m${m.month}`, month(m.month), amount(m.total),
              m.recordCount ? historyLink(`${y}-${pad(m.month)}-01`, `${y}-${pad(m.month)}-${pad(new Date(y, m.month, 0).getDate())}`, vehicleId) : undefined))}
          </dl>
        </section>
        {r.byCategory.length > 0 && (
          <section className="card" aria-labelledby={`${id}categories`}>
            <h2 id={`${id}categories`}>{t('byCategory')}</h2>
            <dl className="figures categories">
              {r.byCategory.map((c) => row(`c${c.category}`, c.category ? t(`categories.${c.category}`) : t('noTask'), amount(c.total)))}
            </dl>
          </section>
        )}
        {!vehicleId && r.byVehicle.length > 0 && (
          <section className="card" aria-labelledby={`${id}cars`}>
            <h2 id={`${id}cars`}>{t('byCar')}</h2>
            <dl className="figures by-car">
              {r.byVehicle.map((c) => row(`v${c.vehicleId}`, archived(c.nickname, c.isArchived), amount(c.total), historyLink(`${y}-01-01`, `${y}-12-31`, c.vehicleId)))}
            </dl>
          </section>
        )}
        <section className="card" aria-labelledby={`${id}all`}>
          <h2 id={`${id}all`}>{t('allTime')}</h2>
          {r.cars.map((c) => (
            <div key={c.vehicleId} className="car-costs">
              <h3>{archived(c.nickname, c.isArchived)}</h3>
              <dl className="figures">
                {row(`s${c.vehicleId}`, t('serviceTotal'), amount(c.serviceTotal))}
                {row(`k${c.vehicleId}`, t('distanceDriven'), <><bdi>{d.fmt(c.kmDriven)}</bdi> {d.vars.distUnit}</>)}
                {row(`p${c.vehicleId}`, t(`costPer.${unit}`), c.costPerKm == null
                  ? <span className="muted">{t('notEnoughReadings')}</span>
                  : amount(unit === 'Mi' ? c.costPerKm * KM_PER_MI : c.costPerKm, 4))}
                {c.purchasePrice != null && row(`b${c.vehicleId}`, t('purchasePrice'), amount(c.purchasePrice))}
                {row(`t${c.vehicleId}`, t('totalCostOfOwnership'), c.totalCostOfOwnership == null
                  ? <Link to={`/cars/${c.vehicleId}/edit`}>{t('addPurchasePrice')}</Link>
                  : amount(c.totalCostOfOwnership))}
              </dl>
            </div>
          ))}
        </section>
      </>
    )
  }

  return (
    <>
      <h1 tabIndex={-1}>{t('reports')}</h1>
      <div className="card inline-form filters" role="search">
        <label>
          {t('reportYear')}
          <select value={year} onChange={(e) => update('year', e.target.value)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          {t('car')}
          <select value={vehicleId} onChange={(e) => update('vehicleId', e.target.value)}>
            <option value="">{t('allCars')}</option>
            {carOptions?.map((c) => <option key={c.id} value={c.id}>{c.isArchived ? t('carArchived', { name: c.nickname }) : c.nickname}</option>)}
          </select>
        </label>
        <p className="muted" role="status">{busy && t('loading')}</p>
      </div>
      {shown?.error != null && (
        <div className="card">
          <p className="error" role="alert">{badCar ? t('errors.vehicle.notFound') : errorMessage(shown.error)}</p>
          <div className="actions">
            {badCar ? <button type="button" onClick={() => leave('vehicleId')}>{t('allCars')}</button>
              : problem?.code === 'report.invalidYear' ? <button type="button" onClick={() => leave('year')}>{t('showThisYear')}</button>
              : <button type="button" aria-disabled={busy} onClick={() => { if (!busy) { refocus.current = true; setAttempt((a) => a + 1) } }}>{t('retry')}</button>}
          </div>
        </div>
      )}
      {report && <div className="report" aria-busy={busy}>{body(report, shown.vehicleId)}</div>}
    </>
  )
}
