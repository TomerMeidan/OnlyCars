import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, type MaintenanceTask, type ServiceRecordPage, type Vehicle } from '../api'
import { useAuth } from '../auth'
import { errorMessage, money } from '../i18n'
import { usePage } from '../usePage'
import { ServiceRow } from './ServiceHistory'

const FILTERS = ['vehicleId', 'taskId', 'from', 'to', 'q'] as const
type Filter = (typeof FILTERS)[number]
const MAX_SEARCH = 100
// The filter a 400 is about, so its message sits there.
const fieldOf: Record<string, 'dates' | 'search'> = { 'serviceRecord.invalidDateRange': 'dates', 'serviceRecord.searchTooLong': 'search' }
const none = () => {}

// /history: every car's services, filtered by the URL's query string. Read-only; rows link to their car page.
export default function HistoryPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { user } = useAuth()
  const id = useId()
  const [params, setParams] = useSearchParams()
  const [vehicleId, taskId, from, to, q] = FILTERS.map((k) => params.get(k) ?? '')
  // The search box; it reaches the URL 300 ms after typing stops, or on Enter. Back and Clear refill it from the URL.
  const [text, setText] = useState(q)
  const [lastQ, setLastQ] = useState(q)
  if (q !== lastQ) { setLastQ(q); if (q !== text.trim()) setText(q) } // the URL holds it trimmed; keep a space typed before the pause
  const [cars, setCars] = useState<Vehicle[] | null>(null)
  // The chosen car's tasks, kept with its id so another car's never show.
  const [taskList, setTaskList] = useState<{ vehicleId: string; tasks?: MaintenanceTask[]; error?: unknown } | null>(null)
  const [page, setPage] = useState<ServiceRecordPage | null>(null)
  // The filters the shown page answers; any other means a reload is under way.
  const [doneQuery, setDoneQuery] = useState<string | null>(null)
  // Show more or Retry in flight.
  const [acting, setActing] = useState(false)
  const [failed, setFailed] = useState<{ err: unknown; skip: number } | null>(null)
  // Only the latest request may show its answer.
  const request = useRef(0)
  // The row to focus after the next page arrives (the first new one).
  const focusRow = useRef<number | null>(null)
  const carSelect = useRef<HTMLSelectElement>(null)
  const retryBtn = useRef<HTMLButtonElement>(null)
  usePage(t('serviceHistory'))

  // Blocked here as the server would, without a request.
  const datesBad = !!from && !!to && from > to
  const searchBad = text.trim().length > MAX_SEARCH
  const query = new URLSearchParams(FILTERS.flatMap((k) => { const v = params.get(k)?.trim(); return v ? [[k, v]] : [] })).toString()
  const blocked = datesBad || q.trim().length > MAX_SEARCH
  // A blocked filter retires any request, Show more included, so nothing is in flight.
  const busy = !blocked && (acting || doneQuery !== query)
  const { tasks, error: tasksError } = taskList?.vehicleId === vehicleId ? taskList : {}

  function load(skip: number, focus = skip > 0) {
    const n = ++request.current
    const latest = () => n === request.current
    return Promise.all([
      // Names and the archived flag aren't on the records. Kept even if the records fail, so the Task select still fills.
      cars ?? api<Vehicle[]>('/vehicles?includeArchived=true').then((cs) => { if (latest()) setCars(cs); return cs }),
      api<ServiceRecordPage>(`/service-records?skip=${skip}&${query}`),
    ]).then(
      ([, res]) => {
        if (!latest()) return
        setFailed(null)
        focusRow.current = focus ? skip : null
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

  // A car that isn't the user's would filter the list while the select says All cars.
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
    const timer = setTimeout(() => update({ q: text }, true), 300)
    return () => clearTimeout(timer)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const i = focusRow.current
    focusRow.current = null
    if (i != null) (document.querySelector<HTMLElement>(`.services > li:nth-child(${i + 1}) a.car`) ?? document.querySelector<HTMLElement>('main h1'))?.focus()
  }, [page])

  // A failed Show more swaps the button for Retry, so focus follows it there.
  useEffect(() => { if (failed?.skip) retryBtn.current?.focus() }, [failed])

  // Reads the URL now, not at render: the search's timer may fire after a select changed it.
  function update(patch: Partial<Record<Filter, string>>, replace = false) {
    const next = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) if (v?.trim()) next.set(k, v.trim()); else next.delete(k)
    setParams(next, { replace })
  }

  function clear() {
    setText('')
    setParams({})
    carSelect.current?.focus() // the button goes away
  }

  const field = fieldOf[failed?.err instanceof ApiError ? failed.err.problem.code ?? '' : '']
  const message = (name: 'dates' | 'search', bad: boolean, code: string) =>
    bad ? t(`errors.serviceRecord.${code}`) : field === name ? errorMessage(failed!.err) : null
  const datesMsg = message('dates', datesBad, 'invalidDateRange')
  const searchMsg = message('search', searchBad, 'searchTooLong')
  // aria-describedby and aria-invalid for a filter: its hint, and its message when there is one.
  const tie = (name: string, msg: string | null, hint?: string) => {
    const ids = [hint, msg && `${id}${name}`].filter(Boolean).join(' ')
    return { 'aria-invalid': !!msg || undefined, 'aria-describedby': ids || undefined }
  }

  // After a failed or blocked filter change the old rows stay, but their count and total would read as the new filter's.
  const stale = blocked || failed?.skip === 0
  const retry = failed && !field && (
    <div className="row">
      <p className="error" role="alert">{errorMessage(failed.err)}</p>
      <button ref={retryBtn} type="button" aria-disabled={busy} onClick={() => { if (!busy) { setActing(true); load(failed.skip, true) } }}>{t('retry')}</button>
    </div>
  )

  return (
    <>
      <h1 tabIndex={-1}>{t('serviceHistory')}</h1>
      <div className="card inline-form filters" role="search">
        <label>
          {t('car')}
          <select ref={carSelect} value={vehicleId} onChange={(e) => update({ vehicleId: e.target.value, taskId: '' })}>
            <option value="">{t('allCars')}</option>
            {cars?.map((c) => <option key={c.id} value={c.id}>{c.isArchived ? t('carArchived', { name: c.nickname }) : c.nickname}</option>)}
          </select>
        </label>
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
        {datesMsg && <p className="error" role="alert" id={`${id}dates`}>{datesMsg}</p>}
        <label className="wide">
          {t('search')}
          <input type="search" dir="auto" enterKeyHint="search" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || searchBad) return
              if (text.trim() !== q.trim()) update({ q: text }, true)
              else if (failed && !busy) load(0) // the same search again after a failure retries it
            }} {...tie('search', searchMsg, `${id}searchHint`)} />
          <span id={`${id}searchHint`} className="muted" aria-hidden="true">{t('searchHint')}</span>
        </label>
        {searchMsg && <p className="error" role="alert" id={`${id}search`}>{searchMsg}</p>}
        {(query || text.trim()) && (
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
              ? t(query ? 'noMatches' : 'noServices')
              : t('historySummary', { count: page.totalCount, total: money(page.totalCost, lng, user?.currency) })}
        </p>
        {failed?.skip === 0 && retry}
        {page && page.items.length > 0 && (
          <ol className="services" aria-busy={busy}>
            {page.items.map((r) => {
              const car = cars?.find((c) => c.id === r.vehicleId)
              return (
                <ServiceRow key={r.id} car={car!} record={r} url="" readOnly onEdited={none} onDeleted={none} onGone={none}
                  head={(
                    <div className="row">
                      <Link to={`/cars/${r.vehicleId}`} className="car">{car?.nickname}</Link>
                      {car?.isArchived && <span className="badge">{t('archived')}</span>}
                    </div>
                  )} />
              )
            })}
          </ol>
        )}
        {/* A failed Show more shows its error where the button was, not above thousands of rows. */}
        {failed?.skip && retry ? retry : !stale && page && page.items.length < page.totalCount && (
          <button type="button" className="more" aria-disabled={busy} onClick={() => { if (!busy) { setActing(true); load(page.items.length) } }}>{t('showMore')}</button>
        )}
      </div>
    </>
  )
}
