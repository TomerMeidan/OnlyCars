import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, ApiError, isGoneRecord, isOrderError, itemsTotal, localToday, type MaintenanceTask, type ServiceItem, type ServiceRecord, type Vehicle } from '../api'
import { useAuth, useDistance } from '../auth'
import { errorMessage, money } from '../i18n'
import { useRow } from '../useRow'

// The form field each API error is about, so the message is tied to that field (item fields also by the error's row index).
const fieldOf: Record<string, string> = {
  'serviceRecord.futureDate': 'date',
  'odometer.invalidValue': 'odometerKm',
  'odometer.lowerThanPrevious': 'odometerKm',
  'odometer.higherThanNext': 'odometerKm',
  'serviceRecord.invalidCost': 'totalCost',
  'serviceRecord.shopTooLong': 'shopName',
  'serviceRecord.notesTooLong': 'notes',
  'serviceItem.invalidDescription': 'description',
  'serviceItem.brandTooLong': 'brand',
  'serviceItem.partNumberTooLong': 'partNumber',
  'serviceItem.invalidQuantity': 'quantity',
  'serviceItem.invalidUnitCost': 'unitCost',
}

const MAX_ITEMS = 50

// A record's date is a calendar date; format it in UTC so the viewer's time zone can't shift the day.
const fmtDate = (date: string, lng: string | undefined) => new Date(date).toLocaleDateString(lng, { dateStyle: 'medium', timeZone: 'UTC' })
const taskList = (r: ServiceRecord, lng: string | undefined) => new Intl.ListFormat(lng).format(r.tasks.map((x) => x.name))

// An item row as typed. Keyed by a local counter: the server's item ids change on every save.
type Item = { key: number; description: string; brand: string; partNumber: string; quantity: string; unitCost: string; isLabor: boolean }
let nextKey = 0
const toItem = (i: ServiceItem | null, isLabor = false): Item => ({
  key: nextKey++,
  description: i?.description ?? '',
  brand: i?.brand ?? '',
  partNumber: i?.partNumber ?? '',
  quantity: i ? String(i.quantity) : '1',
  unitCost: i ? String(i.unitCost) : '',
  isLabor: i?.isLabor ?? isLabor,
})

// The browser blocks an out-of-range number or a third decimal before any request, with this message on the field.
const limit = (message: string) => (e: FormEvent<HTMLInputElement>) => {
  const el = e.currentTarget
  el.setCustomValidity('')
  el.setCustomValidity(el.validity.valid ? '' : message)
}

// The car page's service history, between the tasks and the odometer history. It loads on its own, like the tasks.
export function ServiceHistory({ car, onChanged }: { car: Vehicle; onChanged: () => void }) {
  const { t } = useTranslation()
  const [records, setRecords] = useState<ServiceRecord[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  // "Already deleted": a row action found its record gone and reloaded the list.
  const [gone, setGone] = useState(false)
  const form = useRow<'record'>()
  // Rows with their Edit form open; Record a service is hidden meanwhile, as while its own form is open.
  const [editing, setEditing] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next reload, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/service-records`
  const readOnly = car.isArchived

  // Reloads whenever the car does: after a save or Delete here, and after Mark done or its Undo in the tasks. Old rows stay up meanwhile.
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

  const changed = () => { setGone(false); onChanged() }
  // The tasks and odometer may have moved too (deleted elsewhere), so everything reloads, as after a Delete.
  const onGone = () => { focusNext.current = []; setGone(true); onChanged() }

  return (
    <section className="card" aria-labelledby="service-history" ref={sectionRef}>
      <div className="row">
        <h2 id="service-history" tabIndex={-1}>{t('serviceHistory')}</h2>
        <div className="actions">
          <Link to={`/history?vehicleId=${encodeURIComponent(car.id)}`}>{t('searchAllHistory')}</Link>
          {!readOnly && form.mode === 'view' && !editing && (
            <button className="add" ref={form.opener('record')} onClick={() => { setGone(false); form.open('record') }}>{t('recordService')}</button>
          )}
        </div>
      </div>

      {form.mode === 'record' && (
        <RecordForm
          car={car}
          url={path}
          row={form}
          onTaskGone={onChanged}
          onSaved={(record) => {
            focusNext.current = [`li[data-id="${record.id}"] button.edit-service`]
            form.close()
            changed()
          }}
        />
      )}

      {gone && <p className="muted" role="status">{t('serviceGone')}</p>}
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
              car={car}
              record={r}
              url={`${path}/${encodeURIComponent(r.id)}`}
              readOnly={readOnly}
              onEdited={(record) => {
                // A new date, odometer or tasks can move the row, the car's odometer and the tasks: everything reloads, as after Record.
                focusNext.current = [`li[data-id="${record.id}"] button.edit-service`]
                setRecords((rs) => rs && rs.map((x) => (x.id === record.id ? record : x)))
                changed()
              }}
              onDeleted={() => {
                // The next older row, then the newest, then the h2.
                focusNext.current = [`.services > li:nth-child(${i + 1}) button.delete-service`, '.services > li button.delete-service']
                changed()
              }}
              onGone={onGone}
              onTaskGone={onChanged}
              onEditing={(n) => setEditing((x) => x + n)}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

// Record a service (no record) or edit one, with the same fields.
function RecordForm({ car, url, row, record, onSaved, onGone, onTaskGone }: {
  car: Vehicle
  url: string // the list's path to record, the record's to edit
  row: { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
  record?: ServiceRecord
  onSaved: (record: ServiceRecord) => void
  onGone?: () => void
  onTaskGone?: () => void // a ticked task was deleted: the page's own task list reloads
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { user } = useAuth()
  const d = useDistance()
  const id = useId()
  const { busy, run, open } = row
  // A gone record reloads the list instead, so its error never shows here.
  const error = isGoneRecord(row.error) ? null : row.error
  const [tasks, setTasks] = useState<MaintenanceTask[] | null>(null)
  const [tasksError, setTasksError] = useState<unknown>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const [items, setItems] = useState(() => record?.items.map((i) => toItem(i)) ?? [])
  // The row the last item error was about, by key, so it stays on that row when others are removed; gone with its row.
  const [errKey, setErrKey] = useState<number>()
  // The item row whose description to focus after the next items change; -1 is Add part.
  const focusItem = useRef<number | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  // The odometer field starts at the record's value when editing, at the car's when recording.
  const startStored = record?.odometerKm ?? car.currentOdometerKm
  const startKm = d.value(startStored)

  const loadTasks = () => api<MaintenanceTask[]>(`/vehicles/${encodeURIComponent(car.id)}/tasks`).then(setTasks, setTasksError)
  useEffect(() => { loadTasks() }, [car.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const i = focusItem.current
    focusItem.current = null
    const form = formRef.current
    if (i == null || !form) return
    form.querySelector<HTMLElement>(i < 0 ? 'button.add-part' : `.item:nth-of-type(${i + 1}) input`)?.focus()
  }, [items])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const cost = f.get('totalCost') // absent while items set the total
    const edits = {
      shopName: f.get('shopName'),
      totalCost: cost ? Number(cost) : null,
      notes: f.get('notes'),
      items: items.map((i) => ({
        description: i.description,
        brand: i.brand,
        partNumber: i.partNumber,
        quantity: Number(i.quantity),
        unitCost: Number(i.unitCost),
        isLabor: i.isLabor,
      })),
    }
    const submitter = (e.nativeEvent as SubmitEvent).submitter
    // PUT and POST take the same body and both answer { record, tasks }; the page reloads the tasks itself.
    const err = await run(async () => onSaved((await api<{ record: ServiceRecord }>(url, record ? 'PUT' : 'POST', {
      ...edits,
      date: f.get('date'),
      // The starting odometer, left as shown, is sent back as its exact km.
      // So is a neighbour the last error named, typed back as shown.
      odometerKm: d.toKm(Number(f.get('odometerKm')), startStored,
        error instanceof ApiError ? error.problem.previousKm : undefined, error instanceof ApiError ? error.problem.nextKm : undefined),
      // Tasks not loaded: an edit leaves them as they are (null) instead of unlinking them all.
      taskIds: shown || !record ? f.getAll('taskIds') : null,
      confirmCorrection: needsConfirm && confirmCorrection,
    })).record), submitter)
    if (isGoneRecord(err)) onGone?.()
    else if (err) {
      // A ticked task was deleted meanwhile: reload the list so its checkbox goes; the other ticks stay (keyed by task id).
      if (err instanceof ApiError && err.problem.code === 'maintenanceTask.notFound') { loadTasks(); onTaskGone?.() }
      setNeedsConfirm(isOrderError(err))
      setErrKey(err instanceof ApiError && err.problem.index != null ? items[err.problem.index]?.key : undefined)
    }
  }

  const problem = error instanceof ApiError ? error.problem : undefined
  const bad = fieldOf[problem?.code ?? '']
  const errorId = `${id}error`
  // aria-describedby for a field: its hint, and the error when it is about this field (and this item row, for item fields).
  const tie = (name: string, hint?: string, itemKey?: number) => {
    const hit = bad === name && itemKey === (problem?.index == null ? undefined : errKey)
    const ids = [hint, hit && errorId].filter(Boolean).join(' ')
    return { 'aria-invalid': hit || undefined, 'aria-describedby': ids || undefined }
  }
  // The date-order error sits under the odometer field, an item error on its row, the rest above Save.
  // An item error names its row by where it is now, not where it was when sent.
  const errRow = items.findIndex((x) => x.key === errKey)
  const alert = error != null && (
    <p className="error" role="alert" id={errorId}>{problem?.code === 'maintenanceTask.notFound' ? t('taskGone') : errorMessage(error, errRow < 0 ? undefined : errRow + 1)}</p>
  )
  const errorAt = isOrderError(error) ? 'odometer' : problem?.index == null ? 'end' : errKey
  // A disabled task stays listed while the record is linked to it, so saving doesn't unlink it.
  const linked = new Set(record?.tasks.map((x) => x.id))
  const shown = tasks?.filter((task) => task.isEnabled || linked.has(task.id))
  const total = itemsTotal(items.map((i) => ({ quantity: Number(i.quantity) || 0, unitCost: Number(i.unitCost) || 0 })))
  const currency = user?.currency
  const setItem = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const add = (isLabor: boolean) => { focusItem.current = items.length; setItems([...items, toItem(null, isLabor)]) }
  // The translated message on a future date instead of the browser's; the server's own check stays.
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.serviceRecord.futureDate') : '')
  // Focus goes to the next row, then the previous one, then Add part.
  const remove = (i: number) => { focusItem.current = i < items.length - 1 ? i : i - 1; setItems(items.filter((_, j) => j !== i)) }

  return (
    <form className="inline-form" ref={formRef} onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label>
        {t('readingDate')}
        <input name="date" type="date" required max={localToday()} onInput={future} defaultValue={record?.date.slice(0, 10) ?? localToday()} autoFocus {...tie('date')} />
      </label>
      <label>
        {t('serviceOdometer', d.vars)}
        <input name="odometerKm" type="number" inputMode="numeric" {...d.readingInput} max={Math.max(d.maxReading, startKm)} required defaultValue={startKm} {...tie('odometerKm')} />
      </label>
      {errorAt === 'odometer' && alert}
      {needsConfirm && (
        <label className="inline">
          <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} aria-describedby={errorAt === 'odometer' ? errorId : undefined} />
          {t('confirmCorrection')}
        </label>
      )}
      <label className="wide">
        {t('shop')}
        <input name="shopName" maxLength={100} defaultValue={record?.shopName ?? ''} {...tie('shopName', `${id}shop`)} />
        {/* Read as the field's description, not as part of its name. */}
        <span id={`${id}shop`} className="muted" aria-hidden="true">{t('shopHint')}</span>
      </label>

      <div className="items" role="group" aria-label={t('items')}>
        {items.map((it, i) => {
          const n = i + 1
          const named = (field: string) => ({ 'aria-label': t('itemField', { n, field }) })
          const quantity = it.isLabor ? t('hours') : t('quantity')
          const unitCost = it.isLabor ? t('ratePerHour', { currency }) : t('unitCost', { currency })
          return (
            <fieldset className="item" key={it.key}>
              <legend>{t('item', { n })}{it.isLabor && <> · {t('labour')}</>}</legend>
              <label className="wide">
                {t('description')}
                <input dir="auto" required maxLength={100} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })}
                  {...named(t('description'))} {...tie('description', undefined, it.key)} />
              </label>
              {!it.isLabor && (
                <>
                  <label>
                    {t('brand')}
                    <input dir="auto" maxLength={100} value={it.brand} onChange={(e) => setItem(i, { brand: e.target.value })} {...named(t('brand'))} {...tie('brand', undefined, it.key)} />
                  </label>
                  <label>
                    {t('partNumber')}
                    <input dir="auto" maxLength={50} value={it.partNumber} onChange={(e) => setItem(i, { partNumber: e.target.value })} {...named(t('partNumber'))} {...tie('partNumber', undefined, it.key)} />
                  </label>
                </>
              )}
              <label>
                {quantity}
                <input type="number" inputMode="decimal" required min={0.01} max={10_000} step={0.01} value={it.quantity} onInput={limit(t('limits.quantity'))}
                  onChange={(e) => setItem(i, { quantity: e.target.value })} {...named(quantity)} {...tie('quantity', undefined, it.key)} />
              </label>
              <label>
                {unitCost}
                <input type="number" inputMode="decimal" required min={0} max={1_000_000} step={0.01} value={it.unitCost} onInput={limit(t('limits.cost'))}
                  onChange={(e) => setItem(i, { unitCost: e.target.value })} {...named(unitCost)} {...tie('unitCost', undefined, it.key)} />
              </label>
              <button type="button" className="link" aria-label={t('removeItem', { n })} disabled={busy} onClick={() => remove(i)}>{t('remove')}</button>
              {errorAt === it.key && alert}
            </fieldset>
          )
        })}
        <div className="actions">
          <button type="button" className="link add-part" disabled={busy || items.length >= MAX_ITEMS} onClick={() => add(false)}>{t('addPart')}</button>
          <button type="button" className="link" disabled={busy || items.length >= MAX_ITEMS} onClick={() => add(true)}>{t('addLabour')}</button>
        </div>
      </div>

      {/* With items the total is their sum, computed as the server does; keyed so the typed field starts fresh. */}
      {items.length > 0 ? (
        <label key="sum">
          {t('totalCost', { currency })}
          <input readOnly value={money(total, lng, currency)} {...tie('totalCost', `${id}sum`)} />
          <span id={`${id}sum`} className="muted" aria-hidden="true">{t('totalFromItems')}</span>
        </label>
      ) : (
        <label key="typed">
          {t('totalCost', { currency })}
          <input name="totalCost" type="number" inputMode="decimal" min={0} max={1_000_000} step={0.01} defaultValue={record?.totalCost ?? ''}
            onInput={limit(t('limits.cost'))} {...tie('totalCost')} />
        </label>
      )}
      <label className="wide">
        {t('notes')}
        <textarea name="notes" maxLength={1000} rows={2} defaultValue={record?.notes ?? ''} {...tie('notes')} />
      </label>
      {tasksError != null ? (
        <p className="error" role="alert">{errorMessage(tasksError)}</p>
      ) : !shown ? (
        <p className="muted" role="status">{t('loading')}</p>
      ) : shown.length > 0 && (
        <fieldset>
          <legend>{t('tasksDone')}</legend>
          {shown.map((task) => (
            <label className="inline" key={task.id}>
              <input type="checkbox" name="taskIds" value={task.id} defaultChecked={linked.has(task.id)} />
              {task.name}
            </label>
          ))}
        </fieldset>
      )}
      {errorAt === 'end' && alert}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// Also the rows of /history, read-only, with the car's name and tag as `head`.
export function ServiceRow({ car, record: r, url, readOnly, onEdited, onDeleted, onGone, onTaskGone, onEditing, head }: {
  car: Vehicle
  record: ServiceRecord
  head?: ReactNode
  url: string
  readOnly: boolean
  onEdited: (record: ServiceRecord) => void
  onDeleted: () => void
  onGone: () => void
  onTaskGone?: () => void
  onEditing?: (n: 1 | -1) => void
}) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const d = useDistance()
  const id = useId()
  // After Delete the section refocuses (close()); after Save, Cancel and Escape, focus goes back to the button that opened the mode.
  const row = useRow<'edit' | 'delete'>()
  const { mode, open, close, busy, error, run, opener } = row
  // Deleted: Delete stays disabled until the reload drops the row.
  const [voided, setVoided] = useState(false)
  // Counted up while the Edit form is open, and down when it closes or the row goes; before paint, so Record a service never flashes.
  useLayoutEffect(() => {
    if (mode !== 'edit') return
    onEditing?.(1)
    return () => onEditing?.(-1)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const lng = i18n.resolvedLanguage
  const date = fmtDate(r.date, lng)
  // Each action is named by date, odometer and shop, and described by the row's cost and tasks (MVP3-A QA Low 1).
  const vars = { date, value: d.fmt(r.odometerKm), ...d.vars, shop: r.shopName ?? t('diy') }
  const describedBy = [r.totalCost != null && `${id}cost`, r.tasks.length > 0 && `${id}tasks`].filter(Boolean).join(' ') || undefined

  if (mode === 'edit') {
    return (
      <li data-id={r.id}>
        {/* Closed too, in case the reload still lists the record. */}
        <RecordForm car={car} url={url} row={row} record={r} onGone={() => { close(); onGone() }} onTaskGone={onTaskGone}
          onSaved={(saved) => { onEdited(saved); open('view') }} />
      </li>
    )
  }

  return (
    <li data-id={r.id}>
      {head}
      <div className="task-head">
        <time dateTime={r.date} className="name">{date}</time>
        <span className="value"><bdi>{d.fmt(r.odometerKm)}</bdi> {d.vars.distUnit}</span>
      </div>
      <p>
        {/* Free text in either language; dir="auto" isolates it from the page direction. */}
        {r.shopName ? <span dir="auto">{r.shopName}</span> : t('diy')}
        {r.totalCost != null && user && <> · <bdi id={`${id}cost`}>{money(r.totalCost, lng, user.currency)}</bdi></>}
      </p>
      {r.tasks.length > 0 && <p className="muted" id={`${id}tasks`}>{taskList(r, lng)}</p>}
      {r.notes && <p className="notes" dir="auto">{r.notes}</p>}
      {r.items.length > 0 && (
        <ul className="service-items">
          {r.items.map((it) => (
            <li key={it.id}>
              <span dir="auto">{it.description}</span>
              {it.brand && <span dir="auto" className="muted">{it.brand}</span>}
              {it.partNumber && <span dir="auto" className="muted">{it.partNumber}</span>}
              {/* Each value isolated on its own, so the amount reads like the row total in RTL. */}
              <span className="amount"><bdi>{it.quantity.toLocaleString(lng)}</bdi> × <bdi>{money(it.unitCost, lng, user?.currency)}</bdi></span>
              {it.isLabor && <span className="badge">{t('labour')}</span>}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && mode === 'view' && (
        <div className="actions">
          <button className="link edit-service" aria-label={t('editServiceOf', vars)} aria-describedby={describedBy} disabled={voided}
            ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>
          <button className="link delete-service" aria-label={t('deleteServiceOf', vars)} aria-describedby={describedBy} disabled={voided}
            ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteService')}</p>
          {error != null && !isGoneRecord(error) && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy || voided}
              onClick={async (e) => {
                const err = await run(async () => { await api(`${url}/void`, 'POST'); setVoided(true); close(); onDeleted() }, e.currentTarget)
                if (isGoneRecord(err)) { setVoided(true); onGone() }
              }}>
              {t('delete')}
            </button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
    </li>
  )
}
