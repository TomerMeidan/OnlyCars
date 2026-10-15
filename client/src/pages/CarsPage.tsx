import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage, money } from '../i18n'
import { Link } from 'react-router-dom'
import { api, byUrgency, isOrderError, localToday, type Dashboard, type MaintenanceTask, type Vehicle } from '../api'
import { useAuth, useDistance } from '../auth'
import { usePage } from '../usePage'
import { useRow } from '../useRow'
import { Remaining, StatusBadge, type TaskUndo } from './TasksSection'

// The dashboard on `/`: the summary, then one card per active car in the server's urgency order, then archived cars if shown.
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

  // Old cards stay up while it reloads.
  const load = () => {
    const n = ++request.current
    const today = localToday()
    return Promise.all([api<Dashboard>(`/dashboard?today=${today}`), api<Vehicle[]>(`/vehicles?includeArchived=${showArchived}`)]).then(
      ([dash, cars]) => { if (n === request.current) { setData({ dash, cars, today }); setError(null) } },
      // A failed reload keeps focus where it was (MVP1-C), so drop the pending target.
      (err) => { if (n === request.current) { focusNext.current = null; setError(err) } },
    ).finally(() => n === request.current && setRetrying(false))
  }
  const reloadThenFocus = (target: () => HTMLElement | null | undefined) => {
    focusNext.current = target
    return load()
  }

  useEffect(() => {
    load()
  }, [showArchived]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const target = focusNext.current
    focusNext.current = null
    target?.()?.focus()
  }, [data, error])

  async function toggleArchive(car: Vehicle) {
    await api(`/vehicles/${car.id}/${car.isArchived ? 'unarchive' : 'archive'}`, 'POST')
    load()
  }

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
    setUndo(null)
    // The car's card if the restored task is no longer among its first 3.
    await reloadThenFocus(() => row(taskId)?.querySelector('button.done') ?? document.querySelector(`.cars > li[data-id="${carId}"] h2 a`))
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
      <label className="inline">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
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
              <OdometerQuickEntry car={car} onSaved={() => reloadThenFocus(() =>
                document.activeElement === document.body ? document.querySelector<HTMLElement>(`.cars > li[data-id="${car.id}"] .quick button`) : null)} />
            )}
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
              </>
            )}
            <div className="actions">
              <Link to={`/cars/${car.id}/edit`}>{t('edit')}</Link>
              <button className="link" onClick={() => toggleArchive(car)}>
                {t(car.isArchived ? 'unarchive' : 'archive')}
              </button>
            </div>
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
function DashTask({ task, onReset, onUndo }: { task: MaintenanceTask; onReset: () => Promise<void>; onUndo?: () => Promise<void> }) {
  const { t } = useTranslation()
  const { busy, error, run } = useRow()
  const name = task.name
  return (
    <li data-id={task.id} className={`status-${task.status}`}>
      <div className="task-head">
        <span className="name">{name}</span>
        {task.status && <StatusBadge status={task.status} />}
      </div>
      <p><Remaining km={task.remainingKm} days={task.remainingDays} /></p>
      <button className="done" aria-label={t('markDoneTask', { name })} disabled={busy} onClick={(e) => run(onReset, e.currentTarget)}>{t('markDone')}</button>
      {onUndo && (
        <div className="undo" role="status">
          <span id={`undo-${task.id}`}>{t('markedDone')}</span>
          <button className="link" aria-describedby={`undo-${task.id}`} disabled={busy} onClick={(e) => run(onUndo, e.currentTarget)}>{t('undo')}</button>
        </div>
      )}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
    </li>
  )
}

export function OdometerQuickEntry({ car, onSaved }: { car: Vehicle; onSaved: () => void }) {
  const { t } = useTranslation()
  const d = useDistance()
  const [value, setValue] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // A ticked box that is hidden again must not confirm a later reading.
      await api(`/vehicles/${car.id}/odometer`, 'POST', { valueKm: d.toKm(Number(value), car.currentOdometerKm), readingDate: localToday(), confirmCorrection: needsConfirm && confirmCorrection })
      setValue('')
      setNeedsConfirm(false)
      setConfirmCorrection(false)
      onSaved()
    } catch (err) {
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
