import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { api, carNotFound, isGuid, isOrderError, type OdometerReading, type Vehicle } from '../api'
import { errorMessage } from '../i18n'
import { Odometer, OdometerQuickEntry } from './CarsPage'

// Car detail page. Sections stack here as features land (tasks, service history); for now only odometer history.
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

  const load = () =>
    Promise.all([api<Vehicle>(path), api<OdometerReading[]>(`${path}/odometer`)]).then(
      ([v, r]) => {
        setCar(v)
        setReadings(r)
      },
      setError,
    )

  useEffect(() => {
    if (!badId) load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const back = <Link to="/">{t('backToCars')}</Link>

  if (error != null) return <>{back}<p className="error" role="alert">{errorMessage(error)}</p></>
  if (!car || !readings) return <p className="muted" role="status">{t('loading')}</p>

  return (
    <>
      {back}
      <div className="card">
        <div className="row">
          <h1>{car.nickname}</h1>
          {car.isArchived && <span className="badge">{t('archived')}</span>}
        </div>
        <div className="reading">
          <Odometer km={car.currentOdometerKm} />
          <span className="unit">{t('km')}</span>
        </div>
        {!car.isArchived && <OdometerQuickEntry car={car} onSaved={load} />}
      </div>

      <section className="card" aria-labelledby="odometer-history">
        <h2 id="odometer-history">{t('odometerHistory')}</h2>
        {readings.length === 0 ? (
          <p className="muted">{t('noReadings')}</p>
        ) : (
          <ol className="history">
            {readings.map((r) => (
              <ReadingRow
                key={r.id}
                reading={r}
                url={`${path}/odometer/${r.id}`}
                // History is read-only on archived cars; non-manual readings are fixed on their source record.
                editable={!car.isArchived && r.source === 'Manual'}
                // The only reading can't be deleted (the API answers 409); the user edits it instead.
                deletable={readings.length > 1}
                onSaved={load}
              />
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

// The user's calendar date, for the date field's max.
function localToday() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function ReadingRow({ reading: r, url, editable, deletable, onSaved }: {
  reading: OdometerReading
  url: string
  editable: boolean
  deletable: boolean
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const value = r.valueKm.toLocaleString(i18n.resolvedLanguage)

  function open(next: typeof mode) {
    setMode(next)
    setError(null)
    setNeedsConfirm(false)
    setConfirmCorrection(false)
  }

  async function send(method: 'PUT' | 'DELETE', body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      await api(url, method, body)
      setMode('view')
      onSaved()
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
    <button type="button" className="link" onClick={() => open('view')} autoFocus={autoFocus}>{t('cancel')}</button>
  )

  return (
    <li>
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
          <button className="link" aria-label={t('editReading', { value })} onClick={() => open('edit')}>{t('edit')}</button>
          {deletable && (
            <button className="link" aria-label={t('deleteReading', { value })} onClick={() => open('delete')}>{t('delete')}</button>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <form className="inline-form" onSubmit={save}>
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
        <div className="inline-form">
          <p>{t('confirmDeleteReading')}</p>
          {errorText}
          <div className="actions">
            <button disabled={busy} onClick={() => send('DELETE')}>{t('delete')}</button>
            {cancel(true)}
          </div>
        </div>
      )}
    </li>
  )
}
