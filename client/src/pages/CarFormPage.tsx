import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../i18n'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, carNotFound, fuelTypes, isGuid, localToday, fileError, photoTypes, type FuelType, type Vehicle, type VehicleInput } from '../api'
import { useDistance } from '../auth'
import { usePage } from '../usePage'
import { CarError, CarPhoto } from './CarPage'
import { useRow } from '../useRow'

const maxYear = new Date().getFullYear() + 1

export default function CarFormPage() {
  const { t } = useTranslation()
  const d = useDistance()
  const { id } = useParams()
  const navigate = useNavigate()
  const [car, setCar] = useState<Vehicle | null>(null)
  const [fetchError, setError] = useState<unknown>(null)
  // An id that can't be a car never reaches the API.
  const badId = id != null && !isGuid(id)
  const error = badId ? carNotFound() : fetchError
  usePage(!id || car ? t(id ? 'editCar' : 'addCar') : undefined)

  useEffect(() => {
    if (id && !badId) api<Vehicle>(`/vehicles/${encodeURIComponent(id)}`).then(setCar, setError)
  }, [id, badId])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const str = (k: string) => String(f.get(k) ?? '').trim() || null
    const num = (k: string) => (str(k) === null ? null : Number(str(k)))
    const initialOdometer = num('initialOdometerKm')
    const body: VehicleInput = {
      nickname: str('nickname')!,
      make: str('make'),
      model: str('model'),
      year: num('year'),
      vin: str('vin'),
      plate: str('plate'),
      fuelType: str('fuelType') as FuelType | null,
      purchaseDate: str('purchaseDate'),
      purchasePrice: num('purchasePrice'),
      ...(!id && { initialOdometerKm: initialOdometer == null ? null : d.toKm(initialOdometer), readingDate: localToday() }),
    }
    try {
      await api(id ? `/vehicles/${encodeURIComponent(id)}` : '/vehicles', id ? 'PUT' : 'POST', body)
      navigate('/')
    } catch (err) {
      setError(err)
    }
  }

  if (id && !car) return error != null ? <CarError error={error} /> : null

  const field = (name: keyof Vehicle | 'initialOdometerKm', type = 'text', extra = {}) => (
    <label>
      {t(name === 'initialOdometerKm' ? 'initialOdometer' : name, d.vars)}
      <input name={name} type={type} defaultValue={String(car?.[name as keyof Vehicle] ?? '')} {...extra} />
    </label>
  )

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1 tabIndex={-1}>{t(id ? 'editCar' : 'addCar')}</h1>
      {car && <PhotoField car={car} setCar={setCar} />}
      {field('nickname', 'text', { required: true, maxLength: 100 })}
      {field('make', 'text', { maxLength: 100 })}
      {field('model', 'text', { maxLength: 100 })}
      {field('year', 'number', { min: 1900, max: maxYear })}
      {field('plate', 'text', { maxLength: 32 })}
      {field('vin', 'text', { maxLength: 17 })}
      <label>
        {t('fuelType')}
        <select name="fuelType" defaultValue={car?.fuelType ?? ''}>
          <option value="" />
          {fuelTypes.map((f) => <option key={f} value={f}>{t(`fuel.${f}`)}</option>)}
        </select>
      </label>
      {field('purchaseDate', 'date')}
      {field('purchasePrice', 'number', { min: 0, step: '0.01' })}
      {!id && field('initialOdometerKm', 'number', d.readingInput)}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      <div className="actions">
        <button>{t('save')}</button>
        <button type="button" className="link" onClick={() => navigate('/')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// The car photo on the Edit form: each change saves at once, not with the form's Save. Focus comes back to the photo control after each.
function PhotoField({ car, setCar }: { car: Vehicle; setCar: (car: Vehicle) => void }) {
  const { t } = useTranslation()
  const row = useRow<'remove'>()
  const { mode, busy, error, opener } = row
  const input = useRef<HTMLInputElement>(null)
  const pick = useRef<HTMLButtonElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  const path = `/vehicles/${encodeURIComponent(car.id)}/photo`

  // Raced another photo change: the message stays, over the car as it is now. A failed reload leaves the shown car.
  async function reloadOnConflict(e: unknown): Promise<never> {
    if (e instanceof ApiError && e.problem.code === 'concurrency.conflict') {
      await api<Vehicle>(`/vehicles/${encodeURIComponent(car.id)}`).then((v) => {
        setCar(v)
        // Nothing left to remove: back to the buttons, focus on Add photo.
        if (!v.photoUrl) { refocus.current = true; row.close() }
      }, () => {})
    }
    throw e
  }

  useEffect(() => {
    if (busy || mode !== 'view' || !refocus.current) return
    refocus.current = false
    // An archived car has no Add button: the group takes focus.
    ;(pick.current ?? group.current)?.focus()
  }, [busy, mode, error])

  async function upload(file: File | undefined) {
    if (input.current) input.current.value = '' // so the same file can be chosen again
    if (!file) return
    refocus.current = true
    await row.run(async () => {
      const invalid = fileError(file)
      if (invalid) throw invalid
      const body = new FormData()
      body.append('file', file)
      setCar(await api<Vehicle>(path, 'PUT', body).catch(reloadOnConflict))
    })
  }

  function remove(retryFrom: HTMLElement) {
    row.run(async () => {
      await api(path, 'DELETE').catch(reloadOnConflict)
      setCar({ ...car, photoUrl: null })
      refocus.current = true
      row.close()
    }, retryFrom)
  }

  return (
    <div className="photo-field" role="group" aria-labelledby="photo-label" tabIndex={-1} ref={group}>
      <span id="photo-label">{t('photo')}</span>
      <CarPhoto car={car} setCar={setCar} />
      {mode === 'view' ? (
        <>
          <div className="actions">
            {!car.isArchived && (
              <button type="button" ref={pick} aria-busy={busy} aria-disabled={busy} onClick={() => !busy && input.current?.click()}>
                {t(busy ? 'uploadingPhoto' : car.photoUrl ? 'changePhoto' : 'addPhoto')}
              </button>
            )}
            {car.photoUrl && (
              <button type="button" className="link" disabled={busy} ref={opener('remove')} onClick={() => row.open('remove')}>{t('removePhoto')}</button>
            )}
          </div>
          {car.isArchived && <p className="muted">{t('photoArchivedHint')}</p>}
        </>
      ) : (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && row.open('view')}>
          <p>{t('confirmRemovePhoto')}</p>
          <div className="actions">
            <button type="button" className="danger" aria-busy={busy} disabled={busy} onClick={(e) => remove(e.currentTarget)}>{t('remove')}</button>
            <button type="button" className="link" disabled={busy} onClick={() => row.open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
      <input ref={input} type="file" accept={photoTypes} hidden onChange={(e) => upload(e.target.files?.[0])} />
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
    </div>
  )
}
