import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { api, carNotFound, isGuid, isOrderError, localToday, Offline, runReturn, type OdometerReading, type Vehicle } from '../api'
import { errorMessage } from '../i18n'
import { useDistance } from '../auth'
import { usePage } from '../usePage'
import { useRow } from '../useRow'
import { Odometer, OdometerQuickEntry } from './CarsPage'
import { ChecklistsSection } from './ChecklistsSection'
import { DocumentsSection } from './DocumentsSection'
import { IssuesSection } from './IssuesSection'
import { ServiceHistory } from './ServiceHistory'
import { TasksSection, type TaskUndo } from './TasksSection'
import { TiresSection } from './TiresSection'

// Car detail page: maintenance tasks, to-dos, documents, checklists, tires, the service history, then the odometer history.
export default function CarPage() {
  const { t } = useTranslation()
  const d = useDistance()
  const { id = '' } = useParams()
  const [car, setCar] = useState<Vehicle | null>(null)
  const [readings, setReadings] = useState<OdometerReading[] | null>(null)
  const [fetchError, setError] = useState<unknown>(null)
  // An id that can't be a car never reaches the API.
  const badId = !isGuid(id)
  const error = badId ? carNotFound() : fetchError
  const path = `/vehicles/${encodeURIComponent(id)}`
  // Where focus goes once the history reloads after a Save (that row) or a Delete (the row now at its index).
  const focusAfterLoad = useRef<{ id: string } | { index: number } | null>(null)
  const historyRef = useRef<HTMLElement>(null)
  // Here so a save or Undo in the service history ends it too: it may void the very record.
  const [undo, setUndo] = useState<TaskUndo>(null)
  // Bumped when the run history creates a to-do, so To-dos reloads.
  const [issuesVersion, setIssuesVersion] = useState(0)

  const load = () =>
    Promise.all([api<Vehicle>(path), api<OdometerReading[]>(`${path}/odometer`)]).then(
      ([v, r]) => {
        setCar(v)
        setReadings(r)
        // Only the offline state recovers: another error stays, also when an overlapping load succeeds (StrictMode loads twice).
        setError((e: unknown) => (e instanceof Offline ? null : e))
      },
      (err) => {
        focusAfterLoad.current = null
        // A run Save that went back here leaves its note for the checklists, which won't show now: drop it so a later car page doesn't (L71).
        runReturn.current = null
        setError(err)
      },
    )

  useEffect(() => {
    if (!badId) load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // L199: offline, the page says so with Retry, as the dashboard does, and loads again by itself once the connection is back.
  const offline = error instanceof Offline
  const [retrying, setRetrying] = useState(false)
  const retry = () => {
    setRetrying(true)
    load().finally(() => setRetrying(false))
  }
  useEffect(() => {
    if (!offline) return
    addEventListener('online', retry)
    return () => removeEventListener('online', retry)
  }, [offline]) // eslint-disable-line react-hooks/exhaustive-deps

  // The error pages set their own title; undefined while offline, so the car's h1 takes focus once it loads.
  usePage(offline ? undefined : car?.nickname)

  useEffect(() => {
    const f = focusAfterLoad.current
    const section = historyRef.current
    if (!f || !section) return
    focusAfterLoad.current = null
    const edits = [...section.querySelectorAll('.history > li')].map((li) => li.querySelector<HTMLElement>('button.edit'))
    const target = 'id' in f
      ? section.querySelector<HTMLElement>(`li[data-id="${f.id}"] button.edit`)
      : edits[f.index] ?? edits.find(Boolean)
    ;(target ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [readings])

  const back = <Link to="/" className="back"><span>{t('backToCars')}</span></Link>

  if (offline) return <CarOffline error={error} retrying={retrying} onRetry={retry} />
  if (error != null) return <CarError error={error} />
  if (!car || !readings) return <p className="muted" role="status">{t('loading')}</p>

  return (
    <>
      {back}
      <div className="card">
        <CarPhoto car={car} setCar={setCar} />
        <div className="row">
          <h1 tabIndex={-1}>{car.nickname}</h1>
          {car.isArchived && <span className="badge">{t('archived')}</span>}
        </div>
        <div className="reading">
          <Odometer km={car.currentOdometerKm} />
          <span className="unit">{d.vars.distUnit}</span>
        </div>
        {!car.isArchived && <OdometerQuickEntry car={car} onSaved={load} />}
      </div>

      <TasksSection car={car} undo={undo} setUndo={setUndo} onOdometerChanged={load} />
      <IssuesSection car={car} version={issuesVersion} />
      <DocumentsSection car={car} />
      <ChecklistsSection car={car} onChanged={load} onIssuesChanged={() => setIssuesVersion((v) => v + 1)} />
      <TiresSection car={car} />
      <ServiceHistory car={car} onChanged={() => { setUndo(null); load() }} />

      <section className="card" aria-labelledby="odometer-history" ref={historyRef}>
        <h2 id="odometer-history" tabIndex={-1}>{t('odometerHistory')}</h2>
        {readings.length === 0 ? (
          <p className="muted">{t('noReadings')}</p>
        ) : (
          <ol className="history">
            {readings.map((r, i) => (
              <ReadingRow
                key={r.id}
                reading={r}
                url={`${path}/odometer/${r.id}`}
                // History is read-only on archived cars; non-manual readings are fixed on their source record.
                editable={!car.isArchived && r.source === 'Manual'}
                // The only reading can't be deleted (the API answers 409); the user edits it instead.
                deletable={readings.length > 1}
                // Newest first, in the server's order: the neighbours it compares an edit against.
                neighbourKm={[readings[i + 1]?.valueKm, readings[i - 1]?.valueKm]}
                onSaved={(deleted) => {
                  focusAfterLoad.current = deleted ? { index: i } : { id: r.id }
                  load()
                }}
              />
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

// The car's photo, or nothing. Its signed URL lasts an hour: when a URL fails to load, the car is fetched again once for a fresh one,
// so a page left open recovers each time. A fresh URL that fails before it ever loaded is not retried (no loop while storage is down).
export function CarPhoto({ car, setCar }: { car: Vehicle; setCar: (car: Vehicle) => void }) {
  const fresh = useRef<string | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const url = car.photoUrl
  if (!url || url === broken) return null
  const failed = () => {
    if (url === fresh.current) return setBroken(url)
    fresh.current = url
    api<Vehicle>(`/vehicles/${encodeURIComponent(car.id)}`).then((v) => {
      if (v.photoUrl === url) return setBroken(url)
      fresh.current = v.photoUrl
      setCar(v)
    }, () => setBroken(url))
  }
  return <img className="car-photo" src={url} alt={car.nickname} onError={failed} onLoad={() => { fresh.current = null }} />
}

// Error state of a car route: the message is the h1 (titled without its full stop), under the back link.
// With onRetry (a failure worth retrying), Retry keeps focus while it retries (aria-disabled while `retrying`).
export function CarError({ error, onRetry, retrying }: { error: unknown; onRetry?: () => void; retrying?: boolean }) {
  const { t } = useTranslation()
  const message = errorMessage(error)
  usePage(message.replace(/\.$/, ''))
  return (
    <>
      <Link to="/" className="back"><span>{t('backToCars')}</span></Link>
      <div role="alert"><h1 className="error" tabIndex={-1}>{message}</h1></div>
      {onRetry && <div className="actions"><button aria-disabled={retrying} onClick={() => !retrying && onRetry()}>{t('retry')}</button></div>}
    </>
  )
}

// L199: offline, as on the dashboard: the page's own h1, then the message with Retry (aria-disabled, so it keeps focus while it retries).
function CarOffline({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const { t } = useTranslation()
  usePage(t('car'))
  return (
    <>
      <Link to="/" className="back"><span>{t('backToCars')}</span></Link>
      <h1 tabIndex={-1}>{t('car')}</h1>
      <div className="row">
        <p className="error" role="alert">{errorMessage(error)}</p>
        <button aria-disabled={retrying} onClick={() => !retrying && onRetry()}>{t('retry')}</button>
      </div>
    </>
  )
}

function ReadingRow({ reading: r, url, editable, deletable, neighbourKm, onSaved }: {
  reading: OdometerReading
  url: string
  editable: boolean
  deletable: boolean
  neighbourKm: (number | undefined)[]
  onSaved: (deleted: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  // After Save or Delete the page refocuses (close()); Cancel and Escape go back to the opener.
  const row = useRow<'edit' | 'delete'>()
  const { mode, busy, error, opener } = row
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const value = d.fmt(r.valueKm)

  function open(next: typeof mode) {
    row.open(next)
    setNeedsConfirm(false)
    setConfirmCorrection(false)
  }

  const onEscape = (e: KeyboardEvent) => !busy && e.key === 'Escape' && open('view')

  async function send(method: 'PUT' | 'DELETE', body?: unknown) {
    const err = await row.run(async () => {
      await api(url, method, body)
      row.close()
      onSaved(method === 'DELETE')
    }, document.activeElement as HTMLElement | null)
    setNeedsConfirm(isOrderError(err))
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    send('PUT', { valueKm: d.toKm(Number(f.get('valueKm')), r.valueKm, ...neighbourKm), readingDate: f.get('readingDate'), confirmCorrection: needsConfirm && confirmCorrection })
  }

  const errorText = error != null && <p className="error" role="alert">{errorMessage(error)}</p>
  const cancel = (autoFocus = false) => (
    <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus={autoFocus}>{t('cancel')}</button>
  )

  return (
    <li data-id={r.id}>
      <span className="value">
        <bdi>{value}</bdi> {d.vars.distUnit}
      </span>
      <span className="muted">{t(`source.${r.source}`)}</span>
      {/* ReadingDate is a calendar date; format it in UTC so the viewer's time zone can't shift the day. */}
      <time dateTime={r.readingDate} className="muted">
        {new Date(r.readingDate).toLocaleDateString(i18n.resolvedLanguage, { dateStyle: 'medium', timeZone: 'UTC' })}
      </time>

      {editable && mode === 'view' && (
        <div className="actions">
          <button className="link edit" aria-label={t('editReading', { ...d.vars, value })} ref={opener('edit')} onClick={() => open('edit')}>
            {t('edit')}
          </button>
          {deletable && (
            <button className="link" aria-label={t('deleteReading', { ...d.vars, value })} ref={opener('delete')} onClick={() => open('delete')}>
              {t('delete')}
            </button>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <form className="inline-form" onSubmit={save} onKeyDown={onEscape}>
          <label>
            {t('readingValue', d.vars)}
            <input name="valueKm" type="number" inputMode="numeric" {...d.readingInput} max={Math.max(d.maxReading, d.value(r.valueKm))} required defaultValue={d.value(r.valueKm)} autoFocus />
          </label>
          <label>
            {t('readingDate')}
            <input name="readingDate" type="date" required max={localToday()} defaultValue={r.readingDate} />
          </label>
          {errorText}
          {needsConfirm && (
            <label className="inline">
              <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} />
              {t('confirmCorrection')}
            </label>
          )}
          <div className="actions">
            <button disabled={busy}>{t('save')}</button>
            {cancel()}
          </div>
        </form>
      )}

      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={onEscape}>
          <p>{t('confirmDeleteReading')}</p>
          {errorText}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={() => send('DELETE')}>{t('delete')}</button>
            {cancel(true)}
          </div>
        </div>
      )}
    </li>
  )
}
