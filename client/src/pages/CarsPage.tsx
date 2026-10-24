import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage, fmtDate, money } from '../i18n'
import { Link } from 'react-router-dom'
import { api, ApiError, byUrgency, isOrderError, Offline, localToday, runPath, type Dashboard, type DashboardTask, type Vehicle, type VehicleChecklist } from '../api'
import { useAuth, useDistance } from '../auth'
import { usePage } from '../usePage'
import { useRow } from '../useRow'
import { discard, enqueue, MAX_QUEUE, newRequestId, readQueue, saveAsCorrection, saveCars, savedCars, sendQueue, useQueue, type Queued } from '../offline'
import { RemindersCard } from './RemindersCard'
import { Remaining, StatusBadge, UndoBar, type TaskUndo } from './TasksSection'

// The dashboard on `/`: the summary, the reminders, then one card per active car in the server's urgency order, then archived cars if shown.
export default function CarsPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const d = useDistance()
  const { user } = useAuth()
  // The car fields come from /vehicles (the dashboard leaves out plate, average and archived cars); `today` is the date the month was asked for.
  const [data, setData] = useState<{ dash: Dashboard; cars: Vehicle[]; today: string } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const [undo, setUndo] = useState<TaskUndo>(null)
  // Only the latest request may show its answer.
  const request = useRef(0)
  // What to focus once the next reload renders: cards and rows move with urgency, and moving a node drops its focus.
  const focusNext = useRef<(() => HTMLElement | null | undefined) | null>(null)
  usePage(t('dashboard'))

  // `then` callbacks waiting for the next shown answer, kept when a newer load replaces theirs (so no load path brings back a stale Undo bar).
  const pending = useRef<(() => void)[]>([])

  // Old cards stay up while it reloads. `then` (Undo's setUndo(null)) runs with the answer's state updates, so the bar and the restored row swap in one render.
  const load = (then?: () => void) => {
    const n = ++request.current
    const today = localToday()
    if (then) pending.current.push(then)
    const done = () => pending.current.splice(0).forEach((f) => f())
    return Promise.all([api<Dashboard>(`/dashboard?today=${today}`), api<Vehicle[]>(`/vehicles?includeArchived=${showArchived}`)]).then(
      ([dash, cars]) => {
        if (n !== request.current) return
        setData({ dash, cars, today })
        setError(null)
        done()
        // OFF-1: the active cars, for the offline entry panel; and the server answers again, so send what waits.
        saveCars(user!.id, cars.filter((c) => !c.isArchived).map(({ id, nickname, currentOdometerKm }) => ({ id, nickname, currentOdometerKm })))
        if (readQueue(user!.id).some((i) => i.state === 'waiting')) sendQueue(user!.id) // not for refused ones alone: each load would resend them
      },
      (err) => {
        if (n !== request.current) return
        // A failed reload keeps focus where it was (MVP1-C); only if `then` removed the focused control (the Undo bar) does the target apply.
        const target = focusNext.current
        focusNext.current = target && (() => (document.activeElement === document.body ? target() : null))
        setError(err)
        done()
      },
    ).finally(() => n === request.current && setRetrying(false))
  }
  const reloadThenFocus = (target: () => HTMLElement | null | undefined, then?: () => void) => {
    focusNext.current = target
    return load(then)
  }

  useEffect(() => {
    load()
  }, [showArchived]) // eslint-disable-line react-hooks/exhaustive-deps

  // OFF-1: after queued readings were sent, the odometers and tasks follow.
  const queue = useQueue(user!.id)
  const sentSeen = useRef(queue.sent)
  useEffect(() => {
    if (queue.sent === sentSeen.current) return
    sentSeen.current = queue.sent
    load()
  }, [queue.sent]) // eslint-disable-line react-hooks/exhaustive-deps
  const offlineCars = error != null && !data ? savedCars(user!.id) : null

  // Before paint, so focus never sits on body between the reloaded cards and their target.
  useLayoutEffect(() => {
    const target = focusNext.current
    focusNext.current = null
    if (!target) return
    target()?.focus()
    // The target can be gone (a card archived away) or disabled; focus never stays on body.
    if (document.activeElement === document.body) document.querySelector<HTMLElement>('main h1')?.focus()
  }, [data, error])

  const taskPath = (carId: string, taskId: string) => `/vehicles/${encodeURIComponent(carId)}/tasks/${encodeURIComponent(taskId)}`
  const row = (taskId: string) => document.querySelector<HTMLElement>(`.cars li[data-id="${taskId}"]`)
  const markDone = async (carId: string, taskId: string) => {
    const r = await api<{ serviceRecordId: string }>(`${taskPath(carId, taskId)}/reset`, 'POST', { date: localToday() })
    setUndo({ taskId, recordId: r.serviceRecordId })
    await reloadThenFocus(() => row(taskId)?.querySelector('.undo button'))
  }
  const undoReset = async (carId: string) => {
    const { taskId, recordId } = undo!
    await api(`/vehicles/${encodeURIComponent(carId)}/service-records/${encodeURIComponent(recordId)}/void`, 'POST')
    // Undo ends with the reloaded data, so the row stays until then; the car's card if the restored task is no longer among its first 3.
    await reloadThenFocus(() => row(taskId)?.querySelector('button.done') ?? document.querySelector(`.cars > li[data-id="${carId}"] h2 a`), () => setUndo(null))
  }

  const byId = new Map(data?.cars.map((c) => [c.id, c]))
  const cards = data && [
    ...data.dash.vehicles.flatMap((v) => (byId.has(v.id) ? [{ car: byId.get(v.id)!, dash: v }] : [])),
    ...data.cars.filter((c) => c.isArchived).map((car) => ({ car, dash: undefined })),
  ]
  const retryFailed = error != null && (
    <div className="row">
      <p className="error" role="alert">{errorMessage(error)}</p>
      {/* aria-disabled, so Retry keeps focus while it retries; a success focuses the h1. */}
      <button aria-disabled={retrying} onClick={() => {
        if (retrying) return
        setRetrying(true)
        reloadThenFocus(() => document.querySelector('main h1'))
      }}>{t('retry')}</button>
    </div>
  )

  return (
    <>
      <div className="row">
        <h1 tabIndex={-1}>{t('dashboard')}</h1>
        <Link to="/cars/new" className="button">{t('addCar')}</Link>
      </div>
      {retryFailed}
      {queue.items.length > 0 && <QueueCard names={new Map((data?.cars ?? savedCars(user!.id)?.cars ?? []).map((c) => [c.id, c.nickname]))} />}
      {error != null && !data && <OfflineEntry saved={offlineCars} onSaved={() => load()} />}
      {data ? (
        <div className="card summary">
          <Counts overdue={data.dash.overdueCount} dueSoon={data.dash.dueSoonCount} />
          <p>
            <Link to={`/history?from=${data.dash.month}-01&to=${data.today}`}>
              {t('thisMonth', { count: data.dash.monthServiceCount, total: money(data.dash.monthTotalCost, lng, user?.currency) })}
            </Link>
          </p>
        </div>
      ) : (
        error == null && <div className="card summary"><p className="muted" role="status">{t('loading')}</p></div>
      )}
      {/* Not without active cars: the dashboard's own empty state shows instead. */}
      {data && data.dash.vehicles.length > 0 && <RemindersCard version={data} />}
      <label className="inline">
        <input type="checkbox" checked={showArchived} onChange={(e) => { setUndo(null); setShowArchived(e.target.checked) }} />
        {t('showArchived')}
      </label>
      {cards?.length === 0 && <p>{t('noCars')}</p>}
      {/* Any button or input on a card, except the Undo bar's own, ends the chance to undo (as in the car page's Maintenance). */}
      <ul className="cars" onClick={(e) => (e.target as Element).closest('button, input') && !(e.target as Element).closest('.undo') && setUndo(null)}>
        {cards?.map(({ car, dash }) => (
          <li key={car.id} data-id={car.id} className={`card${car.isArchived ? ' archived' : ''}`}>
            <div className="row">
              <h2><Link to={`/cars/${car.id}`}>{car.nickname}</Link></h2>
              {car.isArchived && <span className="badge">{t('archived')}</span>}
            </div>
            <div>
              <p>{[car.year, car.make, car.model].filter(Boolean).join(' ')}</p>
              {car.plate && <p className="muted">{t('plateValue', { plate: car.plate })}</p>}
            </div>
            <div className="reading">
              <Odometer km={car.currentOdometerKm} />
              <span className="unit">{d.vars.distUnit}</span>
              {car.avgKmPerDay != null && (
                <span className="muted">{t('perDay', { ...d.vars, value: d.perDay(car.avgKmPerDay) })}</span>
              )}
            </div>
            {!car.isArchived && (
              // Only if the card's move dropped focus.
              <OdometerQuickEntry car={car} queue onSaved={() => reloadThenFocus(() =>
                document.activeElement === document.body ? document.querySelector<HTMLElement>(`.cars > li[data-id="${car.id}"] .quick button`) : null)} />
            )}
            <PendingNotes carId={car.id} />
            {dash && (
              <>
                <Counts overdue={dash.overdueCount} dueSoon={dash.dueSoonCount} />
                {dash.tasks.length === 0 ? (
                  <div className="actions">
                    <p className="muted">{t('noTasks')}</p>
                    <Link to={`/cars/${car.id}`}>{t('addTask')}</Link>
                  </div>
                ) : (
                  <>
                    <ul className="tasks dash-tasks">
                      {/* The row showing Undo stays even when its reset moved it past the first 3. */}
                      {[...dash.tasks].sort(byUrgency(lng)).filter((task, i) => i < 3 || task.id === undo?.taskId).map((task) => (
                        <DashTask
                          key={task.id}
                          task={task}
                          onReset={() => markDone(car.id, task.id)}
                          onUndo={undo?.taskId === task.id ? () => undoReset(car.id) : undefined}
                        />
                      ))}
                    </ul>
                    <div className="actions">
                      <Link to={`/cars/${car.id}`}>{t('allTasksCount', { n: dash.tasks.length })}</Link>
                    </div>
                  </>
                )}
                {dash.checklists.length > 0 && <StartChecklist carId={car.id} checklists={dash.checklists} />}
                {dash.openIssueCount > 0 && (
                  <div className="actions"><Link to={`/cars/${car.id}`}>{t('openIssues', { count: dash.openIssueCount })}</Link></div>
                )}
              </>
            )}
            <CarActions car={car} onArchived={() => reloadThenFocus(() => document.querySelector<HTMLElement>(`.cars > li[data-id="${car.id}"] button.archive`))} />
          </li>
        ))}
      </ul>
    </>
  )
}

// "2 overdue · Nothing due soon", colored only when there is something.
function Counts({ overdue, dueSoon }: { overdue: number; dueSoon: number }) {
  const { t } = useTranslation()
  return (
    <p className="counts">
      <span className={overdue ? 'status-Overdue' : 'muted'}>{t('overdueCount', { count: overdue })}</span>
      <span className={dueSoon ? 'status-DueSoon' : 'muted'}>{t('dueSoonCount', { count: dueSoon })}</span>
    </p>
  )
}

// A task on a dashboard card: one-tap Mark done (no cost or notes), then Undo on the row as on the car page.
function DashTask({ task, onReset, onUndo }: { task: DashboardTask; onReset: () => Promise<void>; onUndo?: () => Promise<void> }) {
  const { t } = useTranslation()
  const { busy, error, run, open } = useRow()
  // New data (a new task object) clears an old Mark done error; open('view') only clears the error here.
  useEffect(() => open('view'), [task]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <li data-id={task.id} className={`status-${task.status}`}>
      <div className="task-head">
        <span className="name">{task.name}</span>
        <StatusBadge status={task.status} />
      </div>
      <p><Remaining km={task.remainingKm} days={task.remainingDays} /></p>
      <button className="done" aria-label={t('markDoneTask', { name: task.name })} disabled={busy} onClick={(e) => run(onReset, e.currentTarget)}>{t('markDone')}</button>
      {onUndo && <UndoBar id={task.id} busy={busy} onClick={(e) => run(onUndo, e.currentTarget)} />}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
    </li>
  )
}

// The car's enabled checklists, most urgent first (the server's order): one opens its run page, several open a list to pick from.
function StartChecklist({ carId, checklists }: { carId: string; checklists: VehicleChecklist[] }) {
  const { t } = useTranslation()
  // Cancel and Escape go back to Start a checklist.
  const { mode, open, opener } = useRow<'pick'>()
  // The first checklist takes focus as the list opens.
  const first = useRef<HTMLAnchorElement>(null)
  useEffect(() => { if (mode === 'pick') first.current?.focus() }, [mode])
  if (checklists.length === 1) {
    const c = checklists[0]
    return <div className="actions"><Link to={runPath(carId, c.id)} aria-label={t('startChecklistOf', { name: c.name })}>{t('startChecklist')}</Link></div>
  }
  if (mode === 'view') return <div className="actions"><button className="link" ref={opener('pick')} onClick={() => open('pick')}>{t('startChecklist')}</button></div>
  return (
    <div className="picker" role="group" aria-labelledby={`pick-${carId}`} onKeyDown={(e) => e.key === 'Escape' && open('view')}>
      <p id={`pick-${carId}`}>{t('chooseChecklist')}</p>
      <ul>
        {checklists.map((c, i) => (
          <li key={c.id} className={c.status ? `status-${c.status}` : undefined}>
            <Link className="button" to={runPath(carId, c.id)} ref={i === 0 ? first : undefined}>
              <span dir="auto">{c.name}</span>
              {c.status && <StatusBadge status={c.status} />}
            </Link>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="link" onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </div>
  )
}

// Edit and Archive or Unarchive; a failed archive shows on its card, which stays as it was.
function CarActions({ car, onArchived }: { car: Vehicle; onArchived: () => Promise<void> }) {
  const { t } = useTranslation()
  const { busy, error, run, open } = useRow()
  // A reload (a new car object) clears an old archive error; open('view') only clears the error here.
  useEffect(() => open('view'), [car]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="actions">
        <Link to={`/cars/${car.id}/edit`}>{t('edit')}</Link>
        {/* Busy until the reload ends, so it can't be sent twice. */}
        <button className="link archive" disabled={busy}
          onClick={(e) => run(async () => { await api(`/vehicles/${car.id}/${car.isArchived ? 'unarchive' : 'archive'}`, 'POST'); await onArchived() }, e.currentTarget)}>
          {t(car.isArchived ? 'unarchive' : 'archive')}
        </button>
      </div>
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
    </>
  )
}

// queue (the dashboard only, OFF-1): a reading that gets no answer is kept to send later instead of showing an error.
export function OdometerQuickEntry({ car, onSaved, queue }: { car: Pick<Vehicle, 'id' | 'currentOdometerKm'>; onSaved: () => void; queue?: boolean }) {
  const { t } = useTranslation()
  const d = useDistance()
  const [value, setValue] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const [busy, setBusy] = useState(false)
  const { user } = useAuth()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const cleared = () => {
      setValue('')
      setNeedsConfirm(false)
      setConfirmCorrection(false)
    }
    // A ticked box that is hidden again must not confirm a later reading. The id makes a resend after a lost reply harmless (OFF-1).
    const body = { valueKm: d.toKm(Number(value), car.currentOdometerKm), readingDate: localToday(), confirmCorrection: needsConfirm && confirmCorrection, clientRequestId: newRequestId() }
    try {
      if (queue && !navigator.onLine) throw new Offline()
      await api(`/vehicles/${car.id}/odometer`, 'POST', body)
      cleared()
      onSaved()
    } catch (err) {
      // No answer (offline, or the connection dropped): kept to send later. An HTTP error shows as before.
      if (queue && !(err instanceof ApiError)) {
        if (enqueue(user!.id, { ...body, vehicleId: car.id })) cleared()
        else setError(new ApiError(0, { code: 'offline.queueFull', max: MAX_QUEUE }, ''))
        return
      }
      setError(err)
      setNeedsConfirm(isOrderError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="quick" onSubmit={submit}>
      <input
        type="number"
        inputMode="numeric"
        {...d.readingInput}
        required
        placeholder={t('newReading', d.vars)}
        aria-label={t('newReading', d.vars)}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button disabled={busy}>{t('updateOdometer')}</button>
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      {needsConfirm && (
        <label className="inline">
          <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} />
          {t('confirmCorrection')}
        </label>
      )}
    </form>
  )
}

// OFF-1: the car's queued readings, under its quick entry.
function PendingNotes({ carId }: { carId: string }) {
  const { t } = useTranslation()
  const d = useDistance()
  const { items, sending } = useQueue(useAuth().user!.id)
  const mine = items.filter((i) => i.vehicleId === carId)
  if (!mine.length) return null
  return (
    <ul className="pending">
      {mine.map((i) => (
        <li key={i.clientRequestId} className={i.state === 'notSent' ? 'error' : 'muted'}>
          {t(i.clientRequestId === sending ? 'readingSending' : i.state === 'waiting' ? 'readingWaiting' : 'readingNotSent', { ...d.vars, value: d.fmt(i.valueKm) })}
        </li>
      ))}
    </ul>
  )
}

// OFF-1: every queued reading with its state and Send now; a refused one with its reason, Save as correction (date order only) and Discard.
function QueueCard({ names }: { names: Map<string, string> }) {
  const { t } = useTranslation()
  const userId = useAuth().user!.id
  const { items, sending } = useQueue(userId)
  const waiting = items.filter((i) => i.state === 'waiting').length
  const notSent = items.length - waiting
  return (
    <section className="card queue" aria-labelledby="queue-title">
      <h2 id="queue-title">{t('queueTitle')}</h2>
      <p role="status">{sending ? t('sendingNow') : [waiting && t('queueCount', { count: waiting }), notSent && t('notSentCount', { count: notSent })].filter(Boolean).join(' ')}</p>
      <ul className="tasks">
        {items.map((i) => <QueuedRow key={i.clientRequestId} item={i} name={names.get(i.vehicleId)} busy={sending != null} />)}
      </ul>
      <div className="actions">
        <button className="more" aria-disabled={sending != null} onClick={() => !sending && sendQueue(userId)}>{t('sendNow')}</button>
      </div>
    </section>
  )
}

function QueuedRow({ item, name, busy }: { item: Queued; name: string | undefined; busy: boolean }) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const userId = useAuth().user!.id
  const { mode, open, opener } = useRow<'discard'>()
  const err = new ApiError(400, item.error ?? {}, '')
  // The order messages' own wording here: there is no box to tick.
  const reason = isOrderError(err) ? errorMessage(err, undefined, `queued.${item.error!.code!.split('.')[1]}`) : errorMessage(err)
  return (
    <li>
      <div className="task-head">
        <span className="name">{name ?? t('unknownCar')}</span>
        <span><bdi>{d.fmt(item.valueKm)}</bdi> {d.vars.distUnit} · <time dateTime={item.readingDate}>{fmtDate(item.readingDate, i18n.resolvedLanguage)}</time></span>
      </div>
      {item.state === 'waiting' ? <p className="muted">{t('waitingToSend')}</p> : <p className="error" role="alert">{t('notSentBecause', { reason })}</p>}
      {item.state === 'notSent' && mode === 'view' && (
        <div className="actions">
          {isOrderError(err) && <button className="more" aria-disabled={busy} onClick={() => !busy && saveAsCorrection(userId, item.clientRequestId)}>{t('saveAsCorrection')}</button>}
          <button className="link" ref={opener('discard')} aria-disabled={busy} onClick={() => !busy && open('discard')}>{t('discard')}</button>
        </div>
      )}
      {mode === 'discard' && (
        <div className="inline-form" onKeyDown={(e) => e.key === 'Escape' && open('view')}>
          <p>{t('confirmDiscardReading')}</p>
          <div className="actions">
            <button className="danger" onClick={() => discard(userId, item.clientRequestId)}>{t('discard')}</button>
            <button type="button" className="link" onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
    </li>
  )
}

// OFF-1: when the dashboard can't load, one quick entry per car from the last load, its odometer marked last known.
function OfflineEntry({ saved, onSaved }: { saved: ReturnType<typeof savedCars>; onSaved: () => void }) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const at = saved && new Date(saved.at).toLocaleString(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <section className="card offline" aria-labelledby="offline-title">
      <h2 id="offline-title">{t('offlineEntry')}</h2>
      {!saved?.cars.length ? <p className="muted">{t('offlineNoCars')}</p> : (
        <>
          <p className="muted">{t('offlineHint')}</p>
          <ul className="tasks">
            {saved.cars.map((car) => (
              <li key={car.id} data-id={car.id}>
                <span className="name">{car.nickname}</span>
                <p className="muted">{t('lastKnown', { ...d.vars, value: d.fmt(car.currentOdometerKm), at })}</p>
                <OdometerQuickEntry car={car} queue onSaved={onSaved} />
                <PendingNotes carId={car.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// Drum counter; only digits that changed since the last render roll in.
export function Odometer({ km }: { km: number }) {
  const d = useDistance()
  const value = String(Math.round(d.value(km)))
  const digits = value.padStart(6, '0')
  const [seen, setSeen] = useState({ digits, before: digits })
  if (seen.digits !== digits) setSeen({ digits, before: seen.digits })
  const lead = digits.length - value.length
  const { before } = seen

  return (
    <span className="odometer" role="img" aria-label={`${Number(value).toLocaleString()} ${d.vars.distUnit}`}>
      {[...digits].map((d, i) => (
        <span key={digits.length - i} className={i < lead ? 'lead' : undefined} aria-hidden>
          <b key={d} className={before.length === digits.length && before[i] !== d ? 'roll' : undefined}>{d}</b>
        </span>
      ))}
    </span>
  )
}
