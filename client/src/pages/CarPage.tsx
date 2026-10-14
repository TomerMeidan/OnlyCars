import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { api, type OdometerReading, type Vehicle } from '../api'
import { errorMessage } from '../i18n'
import { Odometer } from './CarsPage'

// Car detail page. Sections stack here as features land (tasks, service history); for now only odometer history.
export default function CarPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const [car, setCar] = useState<Vehicle | null>(null)
  const [readings, setReadings] = useState<OdometerReading[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    Promise.all([api<Vehicle>(`/vehicles/${id}`), api<OdometerReading[]>(`/vehicles/${id}/odometer`)]).then(
      ([v, r]) => {
        setCar(v)
        setReadings(r)
      },
      setError,
    )
  }, [id])

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
      </div>

      <section className="card" aria-labelledby="odometer-history">
        <h2 id="odometer-history">{t('odometerHistory')}</h2>
        {readings.length === 0 ? (
          <p className="muted">{t('noReadings')}</p>
        ) : (
          <ol className="history">
            {readings.map((r) => (
              <li key={r.id}>
                <span className="value">
                  <bdi>{r.valueKm.toLocaleString(i18n.resolvedLanguage)}</bdi> {t('km')}
                </span>
                <span className="muted">{t(`source.${r.source}`)}</span>
                {/* ReadingDate is a calendar date; format it in UTC so the viewer's time zone can't shift the day. */}
                <time dateTime={r.readingDate} className="muted">
                  {new Date(r.readingDate).toLocaleDateString(i18n.resolvedLanguage, { dateStyle: 'medium', timeZone: 'UTC' })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}
