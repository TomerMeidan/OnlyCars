import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, type TirePosition, type Vehicle, type VehicleTires } from '../api'
import { errorMessage } from '../i18n'
import { usePage } from '../usePage'
import { TireCard, TireDiagram, TireWarnings } from './TiresSection'

// /tires: each active car's tires from above, with a link to its page, where they are replaced, checked and rotated.
export default function TiresPage() {
  const { t } = useTranslation()
  const [cars, setCars] = useState<{ car: Vehicle; tires: VehicleTires }[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  usePage(t('tires'))

  const load = () =>
    api<Vehicle[]>('/vehicles')
      .then((cs) => Promise.all(cs.filter((c) => !c.isArchived).map(async (car) => ({ car, tires: await api<VehicleTires>(`/vehicles/${encodeURIComponent(car.id)}/tires`) }))))
      .then((xs) => { setCars(xs); setError(null) }, setError)
      .finally(() => setRetrying(false))
  useEffect(() => { load() }, [])

  return (
    <>
      <h1 tabIndex={-1}>{t('tires')}</h1>
      {error != null && (
        <div className="row">
          <p className="error" role="alert">{errorMessage(error)}</p>
          {/* aria-disabled, so Retry keeps focus while it retries. */}
          <button aria-disabled={retrying} onClick={() => {
            if (retrying) return
            setRetrying(true)
            load()
          }}>{t('retry')}</button>
        </div>
      )}
      {!cars ? (
        error == null && <div className="card"><p className="muted" role="status">{t('loading')}</p></div>
      ) : cars.length === 0 ? (
        <div className="card"><p className="muted"><Link to="/cars/new">{t('noCars')}</Link></p></div>
      ) : (
        cars.map(({ car, tires }) => <CarTires key={car.id} car={car} tires={tires} />)
      )}
    </>
  )
}

function CarTires({ car, tires }: { car: Vehicle; tires: VehicleTires }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<TirePosition[]>([])
  const id = `tires-${car.id}`
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}><Link to={`/cars/${encodeURIComponent(car.id)}`} dir="auto">{car.nickname}</Link></h2>
      <div className="tire-layout">
        <TireDiagram tires={tires.current} selected={selected} onSelect={setSelected} />
        <div className="tire-side">
          <TireWarnings tires={tires.current} />
          {selected.length > 0 ? (
            <ul className="tasks tire-details">
              {selected.map((p) => <TireCard key={p} position={p} tire={tires.current.find((x) => x.position === p)} />)}
            </ul>
          ) : <p className="muted">{t(tires.current.length ? 'pickWheel' : 'noTiresOnCar')}</p>}
        </div>
      </div>
    </section>
  )
}
