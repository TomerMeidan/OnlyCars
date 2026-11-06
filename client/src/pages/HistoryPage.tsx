import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, download, localToday, yearAgo, signedAt, type MaintenanceTask, type ServiceRecord, type ServiceRecordPage, type Vehicle } from '../api'
import { useAuth, useDistance } from '../auth'
import { toCsv } from '../csv'
import { errorMessage, fmtDate, money } from '../i18n'
import { usePage } from '../usePage'
import { SpendingTabs } from './SpendingTabs'
import { ServiceRow } from './ServiceHistory'

const FILTERS = ['vehicleId', 'taskId', 'from', 'to', 'q'] as const
type Filter = (typeof FILTERS)[number] | 'sort' | 'dir'
const SORTS = ['date', 'cost', 'odometer'] as const
type Sort = (typeof SORTS)[number]
const MAX_SEARCH = 100
const MAX_WORDS = 10
const PAGE = 50 // sent as take, so the gone-reload's page math holds
const CSV_CAP = 5000 // 50 requests at most, so one export can't spend the API's 300/min rate limit
const CHIPS = ['oil', 'tires', 'brakes'] as const
// The filter a 400 is about, so its message sits there.
const fieldOf: Record<string, 'dates' | 'search'> = {
  'serviceRecord.invalidDateRange': 'dates', 'serviceRecord.searchTooLong': 'search', 'serviceRecord.searchTooManyWords': 'search',
}
const none = () => {}
const words = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean)
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// /spending: every car's services as a live search table (SRCH-1b), filtered and sorted by the URL's query string.
// Read-only; a row opens its service card in place, which links to its car.
export default function HistoryPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { user } = useAuth()
  const d = useDistance()
  const id = useId()
  const [params, setParams] = useSearchParams()
  const [vehicleId, taskId, from, to, q] = FILTERS.map((k) => params.get(k) ?? '')
  const sort: Sort = SORTS.find((x) => x === params.get('sort')) ?? 'date'
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  // The search box; it reaches the URL 150 ms after typing stops, or on Enter. Back and Clear refill it from the URL.
  const [text, setText] = useState(q)
  const [lastQ, setLastQ] = useState(q)
  if (q !== lastQ) { setLastQ(q); if (q !== text.trim()) setText(q) } // the URL holds it trimmed; keep a space typed before the pause
  const [cars, setCars] = useState<Vehicle[] | null>(null)
  // The chosen car's tasks, kept with its id so another car's never show.
  const [taskState, setTaskList] = useState<{ vehicleId: string; tasks?: MaintenanceTask[]; error?: unknown } | null>(null)
  const [page, setPage] = useState<ServiceRecordPage | null>(null)
  // The search the shown rows answer; while the box differs, the rows are narrowed here until the server answers.
  const [shownQ, setShownQ] = useState('')
  // The filters the shown page answers; any other means a reload is under way.
  const [doneQuery, setDoneQuery] = useState<string | null>(null)
  // Show more or Retry in flight.
  const [acting, setActing] = useState(false)
  const [failed, setFailed] = useState<{ err: unknown; skip: number } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [csv, setCsv] = useState<{ busy?: boolean; error?: unknown; cut?: number } | null>(null)
  // Only the latest request may show its answer.
  const request = useRef(0)
  // The row to focus after the next page arrives (the first new one).
  const focusRow = useRef<number | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const retryBtn = useRef<HTMLButtonElement>(null)
  const csvButton = useRef<HTMLButtonElement>(null)
  // A record was found gone and the rows reloaded: the note, which takes focus once.
  const [goneNote, setGoneNote] = useState(false)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const focusNote = useRef(false)
  // Leaving the page mid-export must not download.
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  usePage(t('serviceHistory'))

  // Blocked here as the server would, without a request.
  const datesBad = !!from && !!to && from > to
  const searchCode = text.trim().length > MAX_SEARCH ? 'searchTooLong' : words(text).length > MAX_WORDS ? 'searchTooManyWords' : null
  const searchBad = !!searchCode
  const filtered = FILTERS.some((k) => params.get(k)?.trim())
  // sort and dir only when not the default (date, newest first), and only the values the server knows.
  const sent = { vehicleId, taskId, from, to, q, sort: sort === 'date' ? '' : sort, dir: dir === 'asc' ? dir : '' }
  const query = new URLSearchParams(Object.entries(sent).flatMap(([k, v]) => (v.trim() ? [[k, v.trim()]] : []))).toString()
  const blocked = datesBad || q.trim().length > MAX_SEARCH || words(q).length > MAX_WORDS
  // A blocked filter retires any request, Show more included, so nothing is in flight.
  const busy = !blocked && (acting || doneQuery !== query)
  const { tasks, error: tasksError } = taskState?.vehicleId === vehicleId ? taskState : {}

  // With `rows` (a record was found gone): reloads that many rows from the start, page by page, instead of one page.
  function load(skip: number, focus = skip > 0, rows = 0) {
    const n = ++request.current
    const latest = () => n === request.current
    const answers = q.trim()
    const get = (at: number) => api<ServiceRecordPage>(`/service-records?skip=${at}&take=${PAGE}&${query}`)
    return Promise.all([
      // Names and the archived flag aren't on the records. Kept even if the records fail, so the Task select still fills.
      cars ?? api<Vehicle[]>('/vehicles?includeArchived=true').then((cs) => { if (latest()) setCars(cs); return cs }),
      rows ? Promise.all(Array.from({ length: Math.ceil(rows / PAGE) }, (_, i) => get(i * PAGE))).then((ps) => ({ ...ps[0], items: ps.flatMap((p) => p.items) })) : get(skip),
    ]).then(
      ([, res]) => {
        if (!latest()) return
        setFailed(null)
        setGoneNote(rows > 0)
        focusNote.current = rows > 0
        focusRow.current = focus ? skip : null
        setShownQ(answers)
        // Stamped now: a row's service card (and its file links) may first open long after the links were signed.
        for (const r of res.items) for (const a of r.attachments) signedAt.set(a, Date.now())
        setPage((p) => (skip && p ? { ...res, items: [...p.items, ...res.items] } : res))
      },
      (err) => latest() && setFailed({ err, skip }),
    ).finally(() => {
      if (latest()) { setDoneQuery(query); setActing(false) }
    })
  }

  useEffect(() => {
    // Blocking also retires the request in flight, so its answer can't replace the rows.
    if (blocked) request.current++
    else load(0)
  }, [query, blocked]) // eslint-disable-line react-hooks/exhaustive-deps

  // A car that isn't the user's would filter the list while the pills say All cars.
  useEffect(() => {
    if (cars && vehicleId && !cars.some((c) => c.id === vehicleId)) update({ vehicleId: '', taskId: '' }, true)
  }, [cars, vehicleId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only once the car is known: an unknown id is dropped from the URL instead (above).
  const known = !!cars?.some((c) => c.id === vehicleId)
  useEffect(() => {
    if (!known) return
    let live = true
    api<MaintenanceTask[]>(`/vehicles/${encodeURIComponent(vehicleId)}/tasks`).then(
      (ts) => live && setTaskList({ vehicleId, tasks: ts }),
      (error) => live && setTaskList({ vehicleId, error }),
    )
    return () => { live = false }
  }, [vehicleId, known])

  useEffect(() => {
    if (text.trim() === q.trim() || searchBad) return
    const timer = setTimeout(() => update({ q: text }, true), 150)
    return () => clearTimeout(timer)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const i = focusRow.current
    focusRow.current = null
    const note = focusNote.current
    focusNote.current = false
    if (note) noteRef.current?.focus()
    else if (i != null) (document.querySelectorAll<HTMLElement>('main tr.record button.open')[i] ?? document.querySelector<HTMLElement>('main h1'))?.focus()
  }, [page])

  // A failed Show more swaps the button for Retry, so focus follows it there.
  useEffect(() => { if (failed?.skip) retryBtn.current?.focus() }, [failed])

  // Reads the URL now, not at render: the search's timer may fire after a filter changed it.
  function update(patch: Partial<Record<Filter, string>>, replace = false) {
    const next = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) if (v?.trim()) next.set(k, v.trim()); else next.delete(k)
    setParams(next, { replace })
  }
  // A chip or quick search: into the box and the URL at once.
  const search = (v: string) => { setText(v); update({ q: v }) }

  function clear() {
    setText('')
    update({ vehicleId: '', taskId: '', from: '', to: '', q: '' }) // the sort is not a filter
    searchInput.current?.focus() // the button goes away
  }

  // First tap on a column sorts it descending, the next tap flips it.
  function sortBy(s: Sort) {
    const next = s === sort && dir === 'desc' ? 'asc' : 'desc'
    update({ sort: s === 'date' && next === 'desc' ? '' : s, dir: next === 'desc' ? '' : next })
  }

  const carOf = (r: ServiceRecord) => cars?.find((c) => c.id === r.vehicleId)
  const what = (r: ServiceRecord) =>
    r.tasks.length ? new Intl.ListFormat(lng).format(r.tasks.map((x) => x.name)) : r.tireCount ? t('tireChange', { count: r.tireCount }) : r.items[0]?.description ?? t('serviceWord')
  // The server's every-word rule over the fields a row carries (not the starter templates' names, which only the server sees).
  const ws = searchBad ? [] : words(text)
  const matches = (r: ServiceRecord) => {
    const all = [r.shopName, r.notes, ...r.tasks.map((x) => x.name), ...r.items.flatMap((i) => [i.description, i.brand, i.partNumber])].join('\n').toLowerCase()
    return ws.every((w) => all.includes(w))
  }
  const rows = page ? (text.trim() !== shownQ ? page.items.filter(matches) : page.items) : []
  // Longest first, so "oil" wins over "o" where both match.
  const re = ws.length ? new RegExp(`(${[...ws].sort((a, b) => b.length - a.length).map(escape).join('|')})`, 'gi') : null
  const hi = (s: string): ReactNode => (re ? s.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p)) : s)

  const field = fieldOf[failed?.err instanceof ApiError ? failed.err.problem.code ?? '' : '']
  const message = (name: 'dates' | 'search', code: string | null) =>
    code ? t(`errors.serviceRecord.${code}`) : field === name ? errorMessage(failed!.err) : null
  const datesMsg = message('dates', datesBad ? 'invalidDateRange' : null)
  const searchMsg = message('search', searchCode)
  // aria-describedby and aria-invalid for a filter: its hint, and its message when there is one.
  const tie = (name: string, msg: string | null, hint?: string) => {
    const ids = [hint, msg && `${id}${name}`].filter(Boolean).join(' ')
    return { 'aria-invalid': !!msg || undefined, 'aria-describedby': ids || undefined }
  }

  const today = localToday()
  const ranges = [
    ['rangeThisYear', `${today.slice(0, 4)}-01-01`, today],
    ['rangeLast12', yearAgo(today), today],
    ['allTime', '', ''],
  ] as const

  // Every match, not only the loaded rows, in the current sort; nothing downloads if a page fails.
  async function exportCsv() {
    if (csv?.busy) return // aria-disabled rather than disabled, so the button keeps focus
    setCsv({ busy: true })
    try {
      const records: ServiceRecord[] = []
      let total = 1
      while (records.length < Math.min(total, CSV_CAP)) {
        const p = await api<ServiceRecordPage>(`/service-records?skip=${records.length}&take=100&${query}`)
        records.push(...p.items)
        total = p.items.length ? p.totalCount : 0 // an empty page (records deleted meanwhile) ends the loop
      }
      records.splice(CSV_CAP)
      const csvRows = [
        [t('csvDate'), t('car'), t('whatWasDone'), t('shop'), `${t('odometer')} (${d.vars.distUnit})`, `${t('colCost')} (${user?.currency ?? ''})`],
        ...records.map((r) => [r.date.slice(0, 10), carOf(r)?.nickname ?? '', what(r), r.shopName || t('diy'), d.value(r.odometerKm), r.totalCost?.toFixed(2) ?? '']),
      ]
      if (!mounted.current) return
      download(new Blob([toCsv(csvRows)], { type: 'text/csv;charset=utf-8' }), `onlycars-search-${today}.csv`)
      setCsv(total > CSV_CAP ? { cut: total } : null)
    } catch (error) {
      setCsv({ error })
    }
  }

  // After a failed or blocked filter change the old rows stay, but their count and total would read as the new filter's.
  const stale = blocked || failed?.skip === 0
  const searching = !!page && (busy || (!searchBad && text.trim() !== q.trim()))
  const canExport = !!page && !stale && page.totalCount > 0
  const retry = failed && !field && (
    <div className="row">
      <p className="error" role="alert">{errorMessage(failed.err)}</p>
      <button ref={retryBtn} type="button" aria-disabled={busy} onClick={() => { if (!busy) { setActing(true); load(failed.skip, true) } }}>{t('retry')}</button>
    </div>
  )
  const amount = (v: number) => money(v, lng, user?.currency)
  const summary = page && [
    t('historySummary', { count: page.totalCount, total: amount(page.totalCost) }),
    page.averageCost != null && t('averageIs', { amount: amount(page.averageCost) }),
    page.lastDate && t('lastOn', { date: fmtDate(page.lastDate, lng) }),
  ].filter(Boolean).join(' · ')

  // Date order only: year and month headers with their count and total, left out for a group Show more may still add to.
  const grouped = sort === 'date'
  const groups = new Map<string, { n: number; cost: number }>()
  for (const r of rows) for (const k of [r.date.slice(0, 4), r.date.slice(0, 7)]) {
    const g = groups.get(k) ?? { n: 0, cost: 0 }
    g.n++
    g.cost += r.totalCost ?? 0
    groups.set(k, g)
  }
  const last = page && page.items.length < page.totalCount ? page.items.at(-1)?.date : undefined
  const head = (key: string, label: string, kind: 'year' | 'month') => {
    const g = groups.get(key)!
    return (
      <tr className={`group ${kind}`}>
        <th colSpan={6} scope={kind === 'year' ? 'rowgroup' : undefined}>
          <span className="group-head">
            <span>{label}</span>
            {!last?.startsWith(key) && <span className="muted">{t('historySummary', { count: g.n, total: amount(g.cost) })}</span>}
          </span>
        </th>
      </tr>
    )
  }
  const sortHead = (s: Sort, label: string) => (
    <th className={s === 'date' ? 'sortable' : 'num sortable'} aria-sort={sort === s ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => sortBy(s)}>
        {label}<span aria-hidden="true" className="arrow">{sort === s ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
  const record = (r: ServiceRecord) => {
    const car = carOf(r)
    const open = openId === r.id
    return (
      <Fragment key={r.id}>
        {/* The date button is the row's keyboard handle; a tap anywhere on the row does the same. */}
        <tr className={open ? 'record open' : 'record'} data-id={r.id} onClick={() => setOpenId(open ? null : r.id)}>
          <th scope="row" className="c-date">
            <button type="button" className="open" aria-expanded={open} aria-controls={open ? `${id}r${r.id}` : undefined}>
              <time dateTime={r.date}><bdi>{fmtDate(r.date, lng)}</bdi></time>
            </button>
          </th>
          <td className="c-car"><span dir="auto">{hi(car?.nickname ?? '')}</span>{car?.isArchived && <> <span className="badge">{t('archived')}</span></>}</td>
          <td className="c-what"><span dir="auto">{hi(what(r))}</span></td>
          <td className="c-shop">{r.shopName ? <span dir="auto">{hi(r.shopName)}</span> : t('diy')}</td>
          <td className="num c-odo"><bdi>{d.fmt(r.odometerKm)}</bdi> {d.vars.distUnit}</td>
          <td className="num c-cost">{r.totalCost != null && <bdi>{amount(r.totalCost)}</bdi>}</td>
        </tr>
        {open && car && (
          <tr className="detail" id={`${id}r${r.id}`}>
            <td colSpan={6}>
              <ol className="services">
                <ServiceRow car={car} record={r} url="" readOnly openOnly onEdited={none} onDeleted={none} onGone={() => load(0, false, page!.items.length)}
                  onFiles={(x) => setPage((p) => p && { ...p, items: p.items.map((y) => (y.id === x.id ? x : y)) })}
                  head={(
                    <div className="row">
                      <Link to={`/cars/${r.vehicleId}`} className="car">{car.nickname}</Link>
                      {car.isArchived && <span className="badge">{t('archived')}</span>}
                    </div>
                  )} />
              </ol>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }
  // One tbody per year in date order, so each year's header heads its rows; one tbody otherwise.
  const bodies = grouped
    ? [...new Set(rows.map((r) => r.date.slice(0, 4)))].map((y) => {
        const ofYear = rows.filter((r) => r.date.startsWith(y))
        return (
          <tbody key={y}>
            {head(y, y, 'year')}
            {ofYear.map((r, i) => {
              const ym = r.date.slice(0, 7)
              return (
                <Fragment key={r.id}>
                  {ofYear[i - 1]?.date.slice(0, 7) !== ym && head(ym, new Date(`${ym}-01T00:00Z`).toLocaleDateString(lng, { month: 'long', timeZone: 'UTC' }), 'month')}
                  {record(r)}
                </Fragment>
              )
            })}
          </tbody>
        )
      })
    : <tbody>{rows.map(record)}</tbody>

  return (
    <>
      <SpendingTabs />
      <h1 tabIndex={-1}>{t('serviceHistory')}</h1>
      <div className="card inline-form filters" role="search">
        <div className="quick" role="group" aria-label={t('quickSearches')}>
          {CHIPS.map((c) => {
            const w = t(`chipWords.${c}`)
            const on = text.trim().toLowerCase() === w
            return <button key={c} type="button" className="more" aria-pressed={on} onClick={() => search(on ? '' : w)}>{t(`chips.${c}`)}</button>
          })}
        </div>
        <label className="wide">
          {t('search')}
          <input ref={searchInput} type="search" dir="auto" enterKeyHint="search" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || searchBad) return
              if (text.trim() !== q.trim()) update({ q: text }, true)
              else if (failed && !busy) load(0) // the same search again after a failure retries it
            }} {...tie('search', searchMsg, `${id}searchHint`)} />
          <span id={`${id}searchHint`} className="muted" aria-hidden="true">{t('searchHint')}</span>
        </label>
        {searchMsg && <p className="error" role="alert" id={`${id}search`}>{searchMsg}</p>}
        <fieldset className="quick">
          <legend>{t('car')}</legend>
          {[{ id: '', nickname: t('allCars'), isArchived: false }, ...(cars ?? [])].map((c) => (
            <button key={c.id} type="button" className={c.isArchived ? 'more archived-car' : 'more'} aria-pressed={vehicleId === c.id}
              onClick={() => update({ vehicleId: c.id, taskId: '' })}>
              {/* The name isolated, so a Hebrew name doesn't pull "(archived)" to its side */}
              {c.isArchived ? t('carArchived', { name: `⁨${c.nickname}⁩` }) : <bdi>{c.nickname}</bdi>}
            </button>
          ))}
        </fieldset>
        <label>
          {t('task')}
          <select value={taskId} disabled={!vehicleId} onChange={(e) => update({ taskId: e.target.value })} {...tie('task', null, vehicleId ? undefined : `${id}taskHint`)}>
            <option value="">{t('allTasks')}</option>
            {tasks?.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
          </select>
          {!vehicleId && <span id={`${id}taskHint`} className="muted" aria-hidden="true">{t('chooseCarFirst')}</span>}
        </label>
        {tasksError != null && <p className="error" role="alert">{errorMessage(tasksError)}</p>}
        <label>
          {t('dateFrom')}
          <input type="date" value={from} onChange={(e) => update({ from: e.target.value })} {...tie('dates', datesMsg)} />
        </label>
        <label>
          {t('dateTo')}
          <input type="date" value={to} onChange={(e) => update({ to: e.target.value })} {...tie('dates', datesMsg)} />
        </label>
        <div className="quick" role="group" aria-label={t('dateRanges')}>
          {ranges.map(([k, f, tt]) => (
            <button key={k} type="button" className="more" aria-pressed={from === f && to === tt} onClick={() => update({ from: f, to: tt })}>{t(k)}</button>
          ))}
        </div>
        {datesMsg && <p className="error" role="alert" id={`${id}dates`}>{datesMsg}</p>}
        {(filtered || text.trim()) && (
          <div className="actions">
            <button type="button" className="link" onClick={clear}>{t('clearFilters')}</button>
          </div>
        )}
      </div>

      <div className="card">
        <p className={page && !stale ? undefined : 'muted'} role="status">
          {!page || stale
            ? busy && t('loading')
            : page.totalCount === 0
              ? t(filtered ? 'noMatches' : 'noServices')
              : summary}
        </p>
        {page && !stale && page.totalCount === 0 && filtered && (
          <div className="actions"><button type="button" className="link" onClick={clear}>{t('clearFilters')}</button></div>
        )}
        {goneNote && <p className="muted" role="status" tabIndex={-1} ref={noteRef}>{t('serviceGoneRefreshed')}</p>}
        {failed?.skip === 0 && retry}
        {page && page.items.length > 0 && (
          <>
            <div className="row results-note">
              <p className="muted">{t(`sortedBy.${sort}.${dir}`)}</p>
              <span className="muted" style={{ visibility: searching ? undefined : 'hidden' }}>{t('searching')}</span>
            </div>
            <table className="results" aria-busy={busy}>
              <thead>
                <tr>
                  {sortHead('date', t('csvDate'))}
                  <th>{t('car')}</th>
                  <th>{t('whatWasDone')}</th>
                  <th>{t('shop')}</th>
                  {sortHead('odometer', t('odometer'))}
                  {sortHead('cost', t('colCost'))}
                </tr>
              </thead>
              {bodies}
            </table>
          </>
        )}
        {/* A failed Show more shows its error where the button was, not above thousands of rows. */}
        {failed?.skip && retry ? retry : !stale && page && page.items.length < page.totalCount && (
          <button type="button" className="more" aria-disabled={busy} onClick={() => { if (!busy) { setActing(true); load(page.items.length) } }}>{t('showMore')}</button>
        )}
        {page && (
          <div className="actions export">
            <button type="button" className="stack" ref={csvButton} data-alt={t(csv?.busy ? 'exportCsv' : 'exportCsvBusy')}
              aria-disabled={!canExport || !!csv?.busy} onClick={() => canExport && exportCsv()}>
              <span>{csv?.busy ? t('exportCsvBusy') : t('exportCsv')}</span>
            </button>
            {csv?.cut != null && <p className="muted" role="status">{t('csvCut', { cap: CSV_CAP.toLocaleString(lng), total: csv.cut.toLocaleString(lng) })}</p>}
            {csv?.error != null && (
              <>
                <p className="error" role="alert">{t('csvFailed')} {errorMessage(csv.error)}</p>
                <button type="button" onClick={() => { csvButton.current?.focus(); if (canExport) exportCsv() }}>{t('retry')}</button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
