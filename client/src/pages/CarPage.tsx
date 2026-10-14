import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { api, carNotFound, isGuid, isOrderError, localToday, type OdometerReading, type Vehicle } from '../api'
import { errorMessage } from '../i18n'
import { usePage } from '../usePage'
import { Odometer, OdometerQuickEntry } from './CarsPage'
import { TasksSection } from './TasksSection'

// Car detail page: maintenance tasks above the odometer history. Service history lands here later.
export default function CarPage() {
  const { t } = useTranslation()
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

  const load = () =>
    Promise.all([api<Vehicle>(path), api<OdometerReading[]>(`${path}/odometer`)]).then(
      ([v, r]) => {
        setCar(v)
        setReadings(r)
      },
      (err) => {
        focusAfterLoad.current = null
        setError(err)
      },
    )

  useEffect(() => {
    if (!badId) load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The error page sets its own title.
  usePage(car?.nickname)

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

  if (error != null) return <CarError error={error} />
  if (!car || !readings) return <p className="muted" role="status">{t('loading')}</p>

  return (
    <>
      {back}
      <div className="card">
        <div className="row">
          <h1 tabIndex={-1}>{car.nickname}</h1>
          {car.isArchived && <span className="badge">{t('archived')}</span>}
        </div>
        <div className="reading">
          <Odometer km={car.currentOdometerKm} />
          <span className="unit">{t('km')}</span>
        </div>
        {!car.isArchived && <OdometerQuickEntry car={car} onSaved={load} />}
      </div>

      <TasksSection car={car} />

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

// Error state of a car route: the message is the h1 (titled without its full stop), under the back link.
export function CarError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const message = errorMessage(error)
  usePage(message.replace(/\.$/, ''))
  return (
    <>
      <Link to="/" className="back"><span>{t('backToCars')}</span></Link>
      <div role="alert"><h1 className="error" tabIndex={-1}>{message}</h1></div>
    </>
  )
}

function ReadingRow({ reading: r, url, editable, deletable, onSaved }: {
  reading: OdometerReading
  url: string
  editable: boolean
  deletable: boolean
  onSaved: (deleted: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  // The opener, refocused when Cancel or Escape returns the row to view. After Save or Delete the page refocuses instead.
  const returnTo = useRef<typeof mode>('view')
  const editRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (mode !== 'view') return
    ;(returnTo.current === 'edit' ? editRef : returnTo.current === 'delete' ? deleteRef : null)?.current?.focus()
    returnTo.current = 'view'
  }, [mode])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const value = r.valueKm.toLocaleString(i18n.resolvedLanguage)

  function open(next: typeof mode) {
    returnTo.current = mode
    setMode(next)
    setError(null)
    setNeedsConfirm(false)
    setConfirmCorrection(false)
  }

  const onEscape = (e: KeyboardEvent) => !busy && e.key === 'Escape' && open('view')

  async function send(method: 'PUT' | 'DELETE', body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      await api(url, method, body)
      returnTo.current = 'view'
      setMode('view')
      onSaved(method === 'DELETE')
    } catch (err) {
      setError(err)
      setNeedsConfirm(isOrderError(err))
    } finally {
      setBusy(false)
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    send('PUT', { valueKm: Number(f.get('valueKm')), readingDate: f.get('readingDate'), confirmCorrection: needsConfirm && confirmCorrection })
  }

  const errorText = error != null && <p className="error" role="alert">{errorMessage(error)}</p>
  const cancel = (autoFocus = false) => (
    <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus={autoFocus}>{t('cancel')}</button>
  )

  return (
    <li data-id={r.id}>
      <span className="value">
        <bdi>{value}</bdi> {t('km')}
      </span>
      <span className="muted">{t(`source.${r.source}`)}</span>
      {/* ReadingDate is a calendar date; format it in UTC so the viewer's time zone can't shift the day. */}
      <time dateTime={r.readingDate} className="muted">
        {new Date(r.readingDate).toLocaleDateString(i18n.resolvedLanguage, { dateStyle: 'medium', timeZone: 'UTC' })}
      </time>

      {editable && mode === 'view' && (
        <div className="actions">
          <button className="link edit" aria-label={t('editReading', { value })} ref={editRef} onClick={() => open('edit')}>
            {t('edit')}
          </button>
          {deletable && (
            <button className="link" aria-label={t('deleteReading', { value })} ref={deleteRef} onClick={() => open('delete')}>
              {t('delete')}
            </button>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <form className="inline-form" onSubmit={save} onKeyDown={onEscape}>
          <label>
            {t('readingValue')}
            <input name="valueKm" type="number" inputMode="numeric" min={0} step="any" required defaultValue={r.valueKm} autoFocus />
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
