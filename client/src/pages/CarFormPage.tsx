import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../i18n'
import { useNavigate, useParams } from 'react-router-dom'
import { api, carNotFound, fuelTypes, isGuid, type FuelType, type Vehicle, type VehicleInput } from '../api'
import { usePage } from '../usePage'
import { CarError } from './CarPage'

const maxYear = new Date().getFullYear() + 1

export default function CarFormPage() {
  const { t } = useTranslation()
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
      photoUrl: car?.photoUrl ?? null,
      ...(!id && { initialOdometerKm: num('initialOdometerKm') }),
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
      {t(name === 'initialOdometerKm' ? 'initialOdometer' : name)}
      <input name={name} type={type} defaultValue={String(car?.[name as keyof Vehicle] ?? '')} {...extra} />
    </label>
  )

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1 tabIndex={-1}>{t(id ? 'editCar' : 'addCar')}</h1>
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
      {!id && field('initialOdometerKm', 'number', { min: 0, max: 10_000_000, step: 'any' })}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      <div className="actions">
        <button>{t('save')}</button>
        <button type="button" className="link" onClick={() => navigate('/')}>{t('cancel')}</button>
      </div>
    </form>
  )
}
