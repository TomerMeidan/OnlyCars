import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, autoFlag, carNotFound, isGuid, isOrderError, limit, localToday, runReturn, type RunReturn, type ChecklistRun, type ChecklistTemplate, type ChecklistTemplateItem, type Vehicle, type VehicleChecklist } from '../api'
import { useDistance } from '../auth'
import { errorMessage } from '../i18n'
import { useItemErrors } from '../useItemErrors'
import { usePage } from '../usePage'
import { useRow } from '../useRow'
import { CarError } from './CarPage'

// The form field each API error is about; item errors also by their row's index (the request sends the rows in order).
const fieldOf: Record<string, string> = {
  'checklistRun.futureDate': 'runAt',
  'date.tooEarly': 'runAt',
  'checklistRun.invalidOdometer': 'odometerKm',
  'odometer.lowerThanPrevious': 'odometerKm',
  'odometer.higherThanNext': 'odometerKm',
  'checklistRun.invalidNotes': 'notes',
  'checklistItem.invalidValue': 'value',
}

// A row as answered: OK / Not OK (null unanswered), the number and text as typed, and the hand flag.
type Answer = { key: string; bool: boolean | null; num: string; text: string; hand: boolean }
const numberOf = (a: Answer) => (a.num === '' ? null : Number(a.num))
const enc = encodeURIComponent

// Not worth a Retry: the car or checklist doesn't exist, or the car is archived.
const final = (err: unknown) => err instanceof ApiError && err.status < 500 && err.status !== 429

// /cars/:id/checklists/:vehicleChecklistId/run: run a checklist on a car.
export default function RunPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const d = useDistance()
  const { id = '', checklistId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState<{ car: Vehicle; checklist: VehicleChecklist; template: ChecklistTemplate } | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const [answers, setAnswers] = useState<Answer[]>([])
  const row = useRow()
  const { busy, error } = row
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const { formRef, errorId, itemKey, n, failed, tie } = useItemErrors(answers, error, fieldOf)
  const hint = useId()
  const carPath = `/cars/${enc(id)}`
  // Ids that can't exist never reach the API.
  const badId = !isGuid(id) ? carNotFound() : !isGuid(checklistId) ? new ApiError(404, { code: 'vehicleChecklist.notFound' }, 'Not Found') : null

  // shortcut: there is no GET /api/vehicle-checklists/{id}, so this loads the car's whole checklist list; add the endpoint if cars get many checklists.
  const load = () => Promise.all([api<Vehicle>(`/vehicles/${enc(id)}`), api<VehicleChecklist[]>(`/vehicles/${enc(id)}/checklists`)])
    .then(async ([car, list]) => {
      const checklist = list.find((c) => c.id === checklistId)
      if (!checklist) throw new ApiError(404, { code: 'vehicleChecklist.notFound' }, 'Not Found')
      if (car.isArchived) throw new ApiError(400, { code: 'vehicleChecklist.vehicleArchived' }, 'Bad Request')
      const template = await api<ChecklistTemplate>(`/checklist-templates/${enc(checklist.templateId)}`)
      setAnswers(template.items.map((i) => ({ key: i.id, bool: null, num: '', text: '', hand: false })))
      setData({ car, checklist, template })
      setLoadError(null)
    })
    .catch(setLoadError)
    .finally(() => setRetrying(false))
  useEffect(() => {
    if (!badId) load()
  }, [id, checklistId]) // eslint-disable-line react-hooks/exhaustive-deps

  usePage(data ? t('runTitle', { name: data.checklist.name, car: data.car.nickname }) : undefined)

  const shownError = badId ?? loadError
  if (shownError != null && !data) {
    return <CarError error={shownError} retrying={retrying} onRetry={final(shownError) ? undefined : () => { setRetrying(true); load() }} />
  }
  if (!data) return <p className="muted" role="status">{t('loading')}</p>
  const { car, checklist, template } = data

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const odometer = String(f.get('odometerKm'))
    const named = error instanceof ApiError ? [error.problem.previousKm, error.problem.nextKm] : []
    const err = await row.run(async () => {
      const r = await api<{ run: ChecklistRun }>(`/vehicle-checklists/${enc(checklist.id)}/runs`, 'POST', {
        runAt: f.get('runAt'),
        // The current odometer or a neighbour the last error named, typed back as shown, is sent as its exact km.
        odometerKm: odometer === '' ? null : d.toKm(Number(odometer), car.currentOdometerKm, ...named),
        confirmCorrection: needsConfirm && confirmCorrection,
        notes: f.get('notes'),
        // Only the value field of the item's type; the API rejects the others.
        items: template.items.map((it, i) => {
          const a = answers[i]
          return { templateItemId: it.id, isFlagged: a.hand, ...(it.type === 'Check' ? { boolValue: a.bool } : it.type === 'Number' ? { numberValue: numberOf(a) } : { textValue: a.text }) }
        }),
      })
      const ret: RunReturn = { ran: checklist.id, flagged: r.run.flaggedCount, run: r.run.id }
      // Opened from the car page: back to it, so one more Back leaves the car page. Otherwise replace the run form, so Back can't reopen it and save twice.
      if ((location.state as { fromCar?: boolean } | null)?.fromCar) {
        runReturn.current = ret
        navigate(-1)
      } else navigate(carPath, { replace: true, state: ret })
    }, (e.nativeEvent as SubmitEvent).submitter)
    if (err) {
      setNeedsConfirm(isOrderError(err))
      failed(err)
    }
  }

  const set = (i: number, patch: Partial<Answer>) => setAnswers((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error, n)}</p>
  const errorAt = isOrderError(error) ? 'odometer' : itemKey ?? 'end'
  // The translated message on a future date instead of the browser's; the server's own check stays.
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.checklistRun.futureDate') : '')
  // Back where the user came from (the car page or the dashboard); straight to the car on a page opened directly.
  const cancel = () => (location.key === 'default' ? navigate(carPath) : navigate(-1))

  return (
    <>
      <Link to={carPath} className="back"><span dir="auto">{car.nickname}</span></Link>
      <h1 tabIndex={-1}>{t('runTitle', { name: checklist.name, car: car.nickname })}</h1>
      <form className="card inline-form run-form" ref={formRef} onSubmit={submit}>
        <label>
          {t('readingDate')}
          <input name="runAt" type="date" required max={localToday()} defaultValue={localToday()} onInput={future} {...tie('runAt')} />
        </label>
        <label>
          {t('runOdometer', d.vars)}
          <input name="odometerKm" type="number" inputMode="numeric" {...d.readingInput} {...tie('odometerKm', hint)} />
          {/* Read as the field's description, not as part of its name. */}
          <span id={hint} className="muted" aria-hidden="true">{t('odometerNow', { ...d.vars, value: d.fmt(car.currentOdometerKm) })}</span>
        </label>
        {errorAt === 'odometer' && alert}
        {needsConfirm && (
          <label className="inline">
            <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} aria-describedby={errorAt === 'odometer' ? errorId : undefined} />
            {t('confirmCorrection')}
          </label>
        )}

        <div className="items" role="group" aria-label={t('checklistItems')}>
          {template.items.map((it, i) => (
            <RunItem key={it.id} item={it} answer={answers[i]} lng={lng} onChange={(patch) => set(i, patch)} tie={tie}>
              {errorAt === it.id && alert}
            </RunItem>
          ))}
        </div>

        <label className="wide">
          {t('notes')}
          <textarea name="notes" dir="auto" maxLength={1000} rows={3} {...tie('notes')} />
        </label>
        {errorAt === 'end' && alert}
        <div className="actions">
          <button disabled={busy}>{t('saveRun')}</button>
          <button type="button" className="link" disabled={busy} onClick={cancel}>{t('cancel')}</button>
        </div>
      </form>
    </>
  )
}

// One item: OK / Not OK, a number with its unit and range, or text; then the Flag toggle. An automatic flag shows why, live, and can't be cleared.
function RunItem({ item: it, answer: a, lng, onChange, tie, children }: {
  item: ChecklistTemplateItem
  answer: Answer
  lng: string | undefined
  onChange: (patch: Partial<Answer>) => void
  tie: ReturnType<typeof useItemErrors>['tie']
  children: ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  // shortcut: live flags use the Min/Max loaded with the page, the server flags with the template at save time (itemsChanged catches added or removed items, not changed limits); reload the template on Save if that is reported.
  const auto = autoFlag({ boolValue: a.bool, numberValue: numberOf(a), minValue: it.minValue, maxValue: it.maxValue })
  const label = it.label
  const named = (field: string) => ({ 'aria-label': t('runField', { label, field }) })
  const fmt = (v: number | null) => v?.toLocaleString(lng)
  // Numbers in a left-to-right isolate, so a negative bound reads "-5.5" in Hebrew too.
  const n = { n: <bdi dir="ltr" /> }
  const unit = it.unit && <> <bdi dir="auto">{it.unit}</bdi></>
  const range = it.minValue != null && it.maxValue != null ? 'rangeBoth' : it.minValue != null ? 'rangeMin' : it.maxValue != null ? 'rangeMax' : null
  const reasonId = auto ? `${id}reason` : undefined
  const rangeId = range ? `${id}range` : undefined
  const describedBy = [rangeId, reasonId].filter(Boolean).join(' ') || undefined

  return (
    <fieldset className={`item${a.hand || auto ? ' flagged' : ''}`}>
      <legend dir="auto">{label}</legend>
      {it.type === 'Check' && (
        <div className="choice">
          {[true, false].map((v) => (
            <label className="inline" key={String(v)}>
              <input type="radio" name={`${id}check`} checked={a.bool === v} onChange={() => onChange({ bool: v })}
                {...named(t(v ? 'ok' : 'notOk'))} aria-describedby={v ? undefined : reasonId} />
              {t(v ? 'ok' : 'notOk')}
            </label>
          ))}
        </div>
      )}
      {it.type === 'Number' && (
        <label className="wide">
          {t('value')}
          <span className="pct">
            {/* No inputMode: the decimal keypad has no minus sign on some phones. dir="ltr" keeps the minus before the number in Hebrew. */}
            <input type="number" dir="ltr" min={-1_000_000} max={1_000_000} step={0.01} value={a.num} onInput={limit(t('limits.runValue'))}
              onChange={(e) => onChange({ num: e.target.value })} {...named(t('value'))} {...tie('value', describedBy, it.id)} />
            {it.unit && <span dir="auto">{it.unit}</span>}
          </span>
          {range && <span className="muted" id={rangeId}><Trans i18nKey={range} values={{ min: fmt(it.minValue), max: fmt(it.maxValue) }} components={n} />{unit}</span>}
        </label>
      )}
      {it.type === 'Text' && (
        <label className="wide">
          {t('value')}
          <textarea dir="auto" maxLength={500} rows={2} value={a.text} onChange={(e) => onChange({ text: e.target.value })} {...named(t('value'))} {...tie('value', undefined, it.id)} />
        </label>
      )}
      <label className="inline">
        {/* Checked while flagged either way; an automatic flag disables it, since the server keeps that flag. */}
        <input type="checkbox" checked={a.hand || !!auto} disabled={!!auto} onChange={() => onChange({ hand: !a.hand })}
          {...named(t('flag'))} aria-describedby={reasonId} />
        {t('flag')}
      </label>
      {auto && (
        <p className="flag" id={reasonId}>
          <Trans i18nKey={`flagged.${auto}`} values={{ min: fmt(it.minValue), max: fmt(it.maxValue) }} components={n} />{auto !== 'notOk' && unit}
        </p>
      )}
      {children}
    </fieldset>
  )
}
