import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, download, type CostReport, type ServiceRecord, type ServiceRecordPage, type Vehicle } from '../api'
import { useAuth, useDistance } from '../auth'
import { toCsv } from '../csv'
import { errorMessage, money } from '../i18n'
import { KM_PER_MI } from '../units'
import { usePage } from '../usePage'
import { SpendingTabs } from './SpendingTabs'

const pad = (n: number) => String(n).padStart(2, '0')
// /history for a span of days, with the chosen car.
const historyLink = (from: string, to: string, vehicleId: string) => `/spending?${new URLSearchParams({ ...(vehicleId && { vehicleId }), from, to })}`

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
  // The print line's date: set when printing starts, so a page left open past midnight prints today's; flushSync so it is in the DOM before the print layout.
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    const onPrint = () => flushSync(() => setToday(new Date()))
    addEventListener('beforeprint', onPrint)
    return () => removeEventListener('beforeprint', onPrint)
  }, [])
  // Leading zeros dropped, so 02025 is 2025 (one option, one request); anything else goes to the API as it is.
  const year = (params.get('year') || thisYear).replace(/^0+(?=\d+$)/, '')
  const vehicleId = params.get('vehicleId') ?? ''
  const [cars, setCars] = useState<Vehicle[] | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${year}|${vehicleId}|${attempt}`
  // The answer for `key`; while another key loads, the last report stays on screen, marked busy.
  const [shown, setShown] = useState<{ key: string; vehicleId: string; report?: CostReport; error?: unknown } | null>(null)
  // After Retry or an error's way out the button is gone, so focus goes to the h1.
  const refocus = useRef(false)
  // The CSV export; its error is for the filters current when it failed (`at`, L107: also after a change mid-export), so a later change drops it.
  const [csv, setCsv] = useState<{ at?: string; busy?: boolean; error?: unknown } | null>(null)
  const keyNow = useRef(key)
  useEffect(() => { keyNow.current = key }, [key])
  const csvButton = useRef<HTMLButtonElement>(null)
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
  // Not a number, or a number the API refused for these filters (1800): the Year box shows no year (L112).
  const yearOk = /^\d+$/.test(year) && !(!busy && problem?.code === 'report.invalidYear')
  // Not the caller's car, or not a car id at all (model binding's 400): either way, back to All cars.
  const badCar = problem?.code === 'vehicle.notFound' || !!problem?.errors?.vehicleId

  function update(name: 'year' | 'vehicleId', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value); else next.delete(name)
    setParams(next)
  }
  const leave = (name: 'year' | 'vehicleId') => { refocus.current = true; update(name, '') }
  // With a car chosen, its All time figures still show.
  const isEmpty = (r: CostReport, vehicleId: string) => !vehicleId && r.years.every((y) => y.total === 0)
  // From the report, not the cached car list, so a car renamed elsewhere shows its current name; r.cars holds every car, archived too.
  const nickname = (r: CostReport, id: string) => r.cars.find((c) => c.vehicleId === id)?.nickname ?? ''
  // One export at a time: it stays busy across filter changes until it ends.
  const csvBusy = !!csv?.busy
  // Leaving the page mid-export must not download.
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // Every record of the report's year and car, page by page, oldest first, as a downloaded CSV; nothing downloads if a page fails.
  async function exportCsv(r: CostReport, vehicleId: string) {
    if (csvBusy) return // aria-disabled rather than disabled, so the button keeps focus
    setCsv({ busy: true })
    try {
      const q = { from: `${r.year}-01-01`, to: `${r.year}-12-31`, ...(vehicleId && { vehicleId }), take: '100' }
      const records: ServiceRecord[] = []
      for (let total = 1; records.length < total;) {
        const page = await api<ServiceRecordPage>(`/service-records?${new URLSearchParams({ ...q, skip: String(records.length) })}`)
        records.push(...page.items)
        total = page.items.length ? page.totalCount : 0 // an empty page (records deleted meanwhile) ends the loop
      }
      const rows = [
        [t('csvDate'), t('car'), `${t('odometer')} (${d.vars.distUnit})`, t('shop'), t('csvTasks'), t('csvCost'), t('currency'), t('notes')],
        ...records.reverse().map((s) => [s.date.slice(0, 10), nickname(r, s.vehicleId), d.value(s.odometerKm), s.shopName || t('diy'),
          s.tasks.map((k) => k.name).join('; '), s.totalCost?.toFixed(2) ?? '', user?.currency ?? '', s.notes ?? '']),
      ]
      if (!mounted.current) return
      // Filename-safe: no path, reserved, control, zero-width or bidi characters, and no leading or trailing - or .
      const safe = vehicleId && nickname(r, vehicleId)
        .replace(/[\\/:*?"<>|\s\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]+/g, '-') // eslint-disable-line no-control-regex
        .replace(/^[-.]+|[-.]+$/g, '')
      download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `onlycars-${r.year}${safe ? `-${safe}` : ''}.csv`)
      setCsv(null)
    } catch (error) {
      setCsv({ at: keyNow.current, error })
    }
  }

  const years = [...new Set([...(report?.years.map((y) => String(y.year)) ?? []), thisYear, ...(yearOk ? [year] : [])])].sort().reverse()
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
    if (isEmpty(r, vehicleId)) return (
      <div className="card">
        <p>{t('reportsEmpty')}</p>
        <div className="actions"><Link to="/">{t('goToCars')}</Link></div>
      </div>
    )
    const y = r.year
    const summary = t('historySummary', { count: r.recordCount, total: money(r.total, lng, user?.currency) })
    const month = (m: number, style: 'long' | 'short' = 'long') => new Date(y, m - 1, 1).toLocaleDateString(lng, { month: style })
    const category = (c: string | null) => c ? t(`categories.${c}`) : t('noTask')
    // Bars scale to the highest value; a non-zero value keeps a sliver so it never looks like 0.
    const topMonth = Math.max(...r.byMonth.map((m) => m.total))
    const topCategory = Math.max(...r.byCategory.map((c) => c.total))
    const scale = (v: number, top: number) => v > 0 ? `max(2px, ${(v / top) * 100}%)` : '0'
    return (
      <>
        <section className="card" aria-labelledby={`${id}year`}>
          <h2 id={`${id}year`}><bdi>{y}</bdi></h2>
          {/* aria-hidden: the total, the count and the top month and category repeat the summary line and the rows below. */}
          <div aria-hidden="true">
            <div className="big-number">{amount(r.total)}</div>
            {r.recordCount > 0 && (
              <dl className="stats">
                <div><dt>{t('statServices')}</dt><dd><bdi>{r.recordCount.toLocaleString(lng)}</bdi></dd></div>
                {topMonth > 0 && <div><dt>{t('statTopMonth')}</dt><dd>{month(r.byMonth.find((m) => m.total === topMonth)!.month)}</dd></div>}
                {topCategory > 0 && <div><dt>{t('statTopCategory')}</dt><dd>{category(r.byCategory.find((c) => c.total === topCategory)!.category)}</dd></div>}
              </dl>
            )}
          </div>
          <p>{r.recordCount ? <Link to={historyLink(`${y}-01-01`, `${y}-12-31`, vehicleId)}>{summary}</Link> : summary}</p>
          {r.unpricedCount > 0 && <p className="muted">{t('unpricedCount', { count: r.unpricedCount })}</p>}
        </section>
        <section className="card" aria-labelledby={`${id}months`}>
          <h2 id={`${id}months`}>{t('byMonth')}</h2>
          {/* aria-hidden: these bars and short month names, and the By category bars with their names and amounts, repeat the figures of the rows under them, which screen readers read instead. */}
          {topMonth > 0 && (
            <div className="month-chart" aria-hidden="true">
              {r.byMonth.map((m) => <div key={m.month}><div><span style={{ blockSize: scale(m.total, topMonth) }} /></div><span>{month(m.month, 'short')}</span></div>)}
            </div>
          )}
          <dl className="figures months">
            {r.byMonth.map((m) => row(`m${m.month}`, month(m.month), amount(m.total),
              m.recordCount ? historyLink(`${y}-${pad(m.month)}-01`, `${y}-${pad(m.month)}-${pad(new Date(y, m.month, 0).getDate())}`, vehicleId) : undefined))}
          </dl>
        </section>
        {r.byCategory.length > 0 && (
          <section className="card" aria-labelledby={`${id}categories`}>
            <h2 id={`${id}categories`}>{t('byCategory')}</h2>
            <div className="category-chart" aria-hidden="true">
              {r.byCategory.map((c) => <div key={`c${c.category}`}>{category(c.category)}{amount(c.total)}<span style={{ inlineSize: scale(c.total, topCategory) }} /></div>)}
            </div>
            <dl className="figures categories">
              {r.byCategory.map((c) => row(`c${c.category}`, category(c.category), amount(c.total)))}
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

  const canExport = !busy && report != null
  return (
    <>
      <SpendingTabs />
      <h1 tabIndex={-1}>{t('reports')}</h1>
      {report && <p className="print-only">{t('printLine', {
        year: report.year, car: shown.vehicleId ? nickname(report, shown.vehicleId) : t('allCars'), date: today.toLocaleDateString(lng, { dateStyle: 'medium' }),
      })}</p>}
      <div className="card inline-form filters" role="search">
        <label>
          {t('reportYear')}
          <select value={yearOk ? year : ''} onChange={(e) => update('year', e.target.value)}>
            {!yearOk && <option value="" disabled>{t('noYear')}</option>}
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
        {!(report && isEmpty(report, shown.vehicleId)) && (
          <div className="actions export">
            <button type="button" className="stack" ref={csvButton} data-alt={t(csvBusy ? 'exportCsv' : 'exportCsvBusy')}
              aria-disabled={!canExport || csvBusy} onClick={() => canExport && exportCsv(report, shown.vehicleId)}>
              <span>{csvBusy ? t('exportCsvBusy') : t('exportCsv')}</span>
            </button>
            <button type="button" aria-disabled={!canExport} onClick={() => canExport && window.print()}>{t('exportPdf')}</button>
          </div>
        )}
        {csv?.at === key && csv.error != null && (
          <div className="actions export">
            <p className="error" role="alert">{t('csvFailed')} {errorMessage(csv.error)}</p>
            <button type="button" onClick={() => { csvButton.current?.focus(); if (canExport) exportCsv(report, shown.vehicleId) }}>{t('retry')}</button>
          </div>
        )}
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
