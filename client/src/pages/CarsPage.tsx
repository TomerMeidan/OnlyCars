import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../i18n'
import { Link } from 'react-router-dom'
import { api, isOrderError, localToday, type Vehicle } from '../api'
import { useDistance } from '../auth'
import { usePage } from '../usePage'

export default function CarsPage() {
  const { t } = useTranslation()
  const d = useDistance()
  const [cars, setCars] = useState<Vehicle[] | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<unknown>(null)
  usePage(t('myCars'))

  const load = () =>
    api<Vehicle[]>(`/vehicles?includeArchived=${showArchived}`).then(setCars, setError)

  useEffect(() => {
    load()
  }, [showArchived]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleArchive(car: Vehicle) {
    await api(`/vehicles/${car.id}/${car.isArchived ? 'unarchive' : 'archive'}`, 'POST')
    load()
  }

  return (
    <>
      <div className="row">
        <h1 tabIndex={-1}>{t('myCars')}</h1>
        <Link to="/cars/new" className="button">{t('addCar')}</Link>
      </div>
      <label className="inline">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {t('showArchived')}
      </label>
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      {cars?.length === 0 && <p>{t('noCars')}</p>}
      <ul className="cars">
        {cars?.map((car) => (
          <li key={car.id} className={`card${car.isArchived ? ' archived' : ''}`}>
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
            {!car.isArchived && <OdometerQuickEntry car={car} onSaved={load} />}
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
