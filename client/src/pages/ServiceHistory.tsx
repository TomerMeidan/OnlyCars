import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api, ApiError, isOrderError, localToday, type MaintenanceTask, type ServiceRecord, type Vehicle } from '../api'
import { useAuth, useDistance } from '../auth'
import { errorMessage } from '../i18n'
import { useRow } from '../useRow'

// The form field each API error is about, so the message is tied to that field.
const fieldOf: Record<string, string> = {
  'serviceRecord.futureDate': 'date',
  'odometer.invalidValue': 'odometerKm',
  'odometer.lowerThanPrevious': 'odometerKm',
  'odometer.higherThanNext': 'odometerKm',
  'serviceRecord.invalidCost': 'totalCost',
  'serviceRecord.shopTooLong': 'shopName',
  'serviceRecord.notesTooLong': 'notes',
}

// A record's date is a calendar date; format it in UTC so the viewer's time zone can't shift the day.
const fmtDate = (date: string, lng: string | undefined) => new Date(date).toLocaleDateString(lng, { dateStyle: 'medium', timeZone: 'UTC' })

// The car page's service history, between the tasks and the odometer history. It loads on its own, like the tasks.
export function ServiceHistory({ car, onChanged }: { car: Vehicle; onChanged: () => void }) {
  const { t } = useTranslation()
  const [records, setRecords] = useState<ServiceRecord[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const form = useRow<'record'>()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next reload, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/service-records`
  const readOnly = car.isArchived

  // Reloads whenever the car does: after a save or Undo here, and after Mark done or its Undo in the tasks. Old rows stay up meanwhile.
  useEffect(() => {
    let live = true
    api<ServiceRecord[]>(path).then(
      (rs) => live && (setRecords(rs), setError(null)),
      (err) => live && ((focusNext.current = null), setError(err)),
    )
    return () => { live = false }
  }, [path, car])

  useEffect(() => {
    const sels = focusNext.current
    const section = sectionRef.current
    if (!sels || !section) return
    focusNext.current = null
    const target = sels.map((s) => section.querySelector<HTMLElement>(s)).find(Boolean)
    ;(target ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [records])

  return (
    <section className="card" aria-labelledby="service-history" ref={sectionRef}>
      <div className="row">
        <h2 id="service-history" tabIndex={-1}>{t('serviceHistory')}</h2>
        {!readOnly && form.mode === 'view' && (
          <button className="add" ref={form.opener('record')} onClick={() => form.open('record')}>{t('recordService')}</button>
        )}
      </div>

      {form.mode === 'record' && (
        <RecordForm
          car={car}
          path={path}
          row={form}
          onSaved={(record) => {
            focusNext.current = [`li[data-id="${record.id}"] button.undo-service`]
            form.close()
            onChanged()
          }}
        />
      )}

      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      {!records ? (
        error == null && <p className="muted" role="status">{t('loading')}</p>
      ) : records.length === 0 ? (
        <p className="muted">{t('noServices')}</p>
      ) : (
        <ol className="services">
          {records.map((r, i) => (
            <ServiceRow
              key={r.id}
              record={r}
              url={`${path}/${encodeURIComponent(r.id)}`}
              readOnly={readOnly}
              onUndone={() => {
                // The next older row, then the newest, then the h2.
                focusNext.current = [`.services > li:nth-child(${i + 1}) button.undo-service`, '.services > li button.undo-service']
                onChanged()
              }}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function RecordForm({ car, path, row, onSaved }: {
  car: Vehicle
  path: string
  row: ReturnType<typeof useRow<'record'>>
  onSaved: (record: ServiceRecord) => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const d = useDistance()
  const { busy, error, run, open } = row
  const [tasks, setTasks] = useState<MaintenanceTask[] | null>(null)
  const [tasksError, setTasksError] = useState<unknown>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const startKm = d.value(car.currentOdometerKm)

  useEffect(() => {
    api<MaintenanceTask[]>(`/vehicles/${encodeURIComponent(car.id)}/tasks`).then(setTasks, setTasksError)
  }, [car.id])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const cost = f.get('totalCost')
    const body = {
      date: f.get('date'),
      // The car's odometer, left as shown, is sent back as its exact km.
      // So is a neighbour the last error named, typed back as shown.
      odometerKm: d.toKm(Number(f.get('odometerKm')), car.currentOdometerKm,
        error instanceof ApiError ? error.problem.previousKm : undefined, error instanceof ApiError ? error.problem.nextKm : undefined),
      shopName: f.get('shopName'),
      totalCost: cost === '' ? null : Number(cost),
      notes: f.get('notes'),
      taskIds: f.getAll('taskIds'),
      confirmCorrection: needsConfirm && confirmCorrection,
    }
    const err = await run(async () => onSaved((await api<{ record: ServiceRecord }>(path, 'POST', body)).record), (e.nativeEvent as SubmitEvent).submitter)
    if (err) setNeedsConfirm(isOrderError(err))
  }

  const bad = error instanceof ApiError ? fieldOf[error.problem.code ?? ''] : undefined
  // aria-describedby for a field: its hint, and the error when it is about this field.
  const tie = (name: string, hint?: string) => {
    const ids = [hint, bad === name && 'service-error'].filter(Boolean).join(' ')
    return { 'aria-invalid': bad === name || undefined, 'aria-describedby': ids || undefined }
  }
  const enabled = tasks?.filter((task) => task.isEnabled)

  return (
    <form className="inline-form" onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label>
        {t('readingDate')}
        <input name="date" type="date" required max={localToday()} defaultValue={localToday()} autoFocus {...tie('date')} />
      </label>
      <label>
        {t('serviceOdometer', d.vars)}
        <input name="odometerKm" type="number" inputMode="numeric" {...d.readingInput} max={Math.max(d.maxReading, startKm)} required defaultValue={startKm} {...tie('odometerKm')} />
      </label>
      <label className="wide">
        {t('shop')}
        <input name="shopName" maxLength={100} {...tie('shopName', 'shop-hint')} />
        {/* Read as the field's description, not as part of its name. */}
        <span id="shop-hint" className="muted" aria-hidden="true">{t('shopHint')}</span>
      </label>
      <label>
        {t('totalCost', { currency: user?.currency })}
        <input name="totalCost" type="number" inputMode="decimal" min={0} max={1_000_000} step={0.01} {...tie('totalCost')}
          // The browser blocks an out-of-range cost or a third decimal before any request, with this message on the field.
          onInput={(e) => {
            const el = e.currentTarget
            el.setCustomValidity('')
            el.setCustomValidity(el.validity.valid ? '' : t('limits.cost'))
          }} />
      </label>
      <label className="wide">
        {t('notes')}
        <textarea name="notes" maxLength={1000} rows={2} {...tie('notes')} />
      </label>
      {tasksError != null ? (
        <p className="error" role="alert">{errorMessage(tasksError)}</p>
      ) : !enabled ? (
        <p className="muted" role="status">{t('loading')}</p>
      ) : enabled.length > 0 && (
        <fieldset>
          <legend>{t('tasksDone')}</legend>
          {enabled.map((task) => (
            <label className="inline" key={task.id}>
              <input type="checkbox" name="taskIds" value={task.id} />
              {task.name}
            </label>
          ))}
        </fieldset>
      )}
      {error != null && <p className="error" role="alert" id="service-error">{errorMessage(error)}</p>}
      {needsConfirm && (
        <label className="inline">
          <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} />
          {t('confirmCorrection')}
        </label>
      )}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

function ServiceRow({ record: r, url, readOnly, onUndone }: {
  record: ServiceRecord
  url: string
  readOnly: boolean
  onUndone: () => void
}) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const d = useDistance()
  // After Undo the section refocuses (close()); Cancel and Escape go back to the row's Undo.
  const { mode, open, close, busy, error, run, opener } = useRow<'undo'>()
  // Voided: Undo stays disabled until the reload drops the row.
  const [voided, setVoided] = useState(false)
  const lng = i18n.resolvedLanguage
  const date = fmtDate(r.date, lng)

  return (
    <li data-id={r.id}>
      <div className="task-head">
        <time dateTime={r.date} className="name">{date}</time>
        <span className="value"><bdi>{d.fmt(r.odometerKm)}</bdi> {d.vars.distUnit}</span>
      </div>
      <p>
        {/* Free text in either language; dir="auto" isolates it from the page direction. */}
        {r.shopName ? <span dir="auto">{r.shopName}</span> : t('diy')}
        {r.totalCost != null && user && (
          <> · <bdi>{r.totalCost.toLocaleString(lng, { style: 'currency', currency: user.currency })}</bdi></>
        )}
      </p>
      {r.tasks.length > 0 && <p className="muted">{new Intl.ListFormat(lng).format(r.tasks.map((x) => x.name))}</p>}
      {r.notes && <p className="notes" dir="auto">{r.notes}</p>}

      {!readOnly && mode === 'view' && (
        <div className="actions">
          <button className="link undo-service" aria-label={t('undoServiceOf', { date, value: d.fmt(r.odometerKm), ...d.vars })} disabled={voided} ref={opener('undo')} onClick={() => open('undo')}>{t('undoService')}</button>
        </div>
      )}
      {mode === 'undo' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmUndoService')}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy}
              onClick={(e) => run(async () => { await api(`${url}/void`, 'POST'); setVoided(true); close(); onUndone() }, e.currentTarget)}>
              {t('undoService')}
            </button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
    </li>
  )
}
