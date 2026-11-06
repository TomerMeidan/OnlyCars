import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, ApiError, attachmentTypes, signedAt, fileError, isGoneRecord, photoTypes, isOrderError, itemsTotal, limit, localToday, type Attachment, type MaintenanceTask, type ServiceItem, type ServiceRecord, type Vehicle } from '../api'
import { useAuth, useDistance } from '../auth'
import { errorMessage, fmtDate, money } from '../i18n'
import { useItemErrors } from '../useItemErrors'
import { useFold } from '../fold'
import { useRow } from '../useRow'

// The form field each API error is about, so the message is tied to that field (item fields also by the error's row index).
const fieldOf: Record<string, string> = {
  'serviceRecord.futureDate': 'date',
  'date.tooEarly': 'date',
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

// The car page's service history, between the tasks and the odometer history. It loads on its own, like the tasks.
// logFor: a task's "Log with details" opens Record a service with that task ticked; n reopens it for the same task.
export function ServiceHistory({ car, logFor, onChanged }: { car: Vehicle; logFor?: { taskId: string; n: number } | null; onChanged: () => void }) {
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
    // A saved row moves to its date's place (newest first), so it lights up where it landed: on a PC the whole list
    // fits and the top row, another of today's, looked like the date hadn't changed (owner, 2026-11-03).
    if (target?.matches('.edit-service')) target.closest('li')?.animate([{ background: 'color-mix(in srgb, var(--amber) 35%, transparent)' }, {}], { duration: 2000, easing: 'ease-in' })
  }, [records])

  const fold = useFold('service-history')
  useEffect(() => {
    if (!logFor || readOnly) return
    fold.setCollapsed(false)
    form.open('record')
    sectionRef.current?.scrollIntoView({ block: 'start' })
  }, [logFor]) // eslint-disable-line react-hooks/exhaustive-deps

  const changed = () => { setGone(false); onChanged() }
  // The tasks and odometer may have moved too (deleted elsewhere), so everything reloads, as after a Delete.
  const onGone = () => { focusNext.current = []; setGone(true); onChanged() }

  return (
    <section {...fold.section} aria-labelledby="service-history" ref={sectionRef}>
      <div className="row">
        {fold.heading(t('serviceHistory'))}
        <div className="actions">
          <Link to={`/spending?vehicleId=${encodeURIComponent(car.id)}`}>{t('searchAllHistory')}</Link>
          {!readOnly && form.mode === 'view' && !editing && (
            <button className="add" ref={form.opener('record')} onClick={() => { setGone(false); form.open('record') }}>{t('recordService')}</button>
          )}
        </div>
      </div>

      {form.mode === 'record' && (
        <RecordForm
          key={logFor?.n}
          car={car}
          url={path}
          row={form}
          preselect={logFor?.taskId}
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
              onFiles={(record) => setRecords((rs) => rs && rs.map((x) => (x.id === record.id ? record : x)))}
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
function RecordForm({ car, url, row, record, preselect, onSaved, onGone, onTaskGone }: {
  car: Vehicle
  url: string // the list's path to record, the record's to edit
  row: { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
  record?: ServiceRecord
  preselect?: string // a new record's task, ticked at the start
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
  const [date, setDate] = useState(() => record?.date.slice(0, 10) ?? localToday())
  const { formRef, errorId, itemKey, n, focus, failed, tie } = useItemErrors(items, error, fieldOf)
  // The odometer field starts at the record's value when editing, at the car's when recording.
  const startStored = record?.odometerKm ?? car.currentOdometerKm
  const startKm = d.value(startStored)

  const loadTasks = () => api<MaintenanceTask[]>(`/vehicles/${encodeURIComponent(car.id)}/tasks`).then(setTasks, setTasksError)
  useEffect(() => { loadTasks() }, [car.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // shortcut: onTaskGone reloads the car, and if that reload fails the error page replaces this open form; keep the form if it is ever reported.
      if (err instanceof ApiError && err.problem.code === 'maintenanceTask.notFound') { loadTasks(); onTaskGone?.() }
      setNeedsConfirm(isOrderError(err))
      failed(err)
    }
  }

  // The date-order error sits under the odometer field, an item error on its row, the rest above Save.
  const alert = error != null && (
    <p className="error" role="alert" id={errorId}>{error instanceof ApiError && error.problem.code === 'maintenanceTask.notFound' ? t('taskGone') : errorMessage(error, n)}</p>
  )
  const errorAt = isOrderError(error) ? 'odometer' : itemKey ?? 'end'
  // A disabled task stays listed while the record is linked to it, so saving doesn't unlink it.
  const linked = new Set(record ? record.tasks.map((x) => x.id) : preselect ? [preselect] : [])
  const shown = tasks?.filter((task) => task.isEnabled || linked.has(task.id))
  const total = itemsTotal(items.map((i) => ({ quantity: Number(i.quantity) || 0, unitCost: Number(i.unitCost) || 0 })))
  const currency = user?.currency
  const setItem = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const rowSel = (i: number) => `.item:nth-of-type(${i + 1}) input`
  const add = (isLabor: boolean) => { focus(rowSel(items.length)); setItems([...items, toItem(null, isLabor)]) }
  // The translated message on a future date instead of the browser's; the server's own check stays.
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.serviceRecord.futureDate') : '')
  // Focus goes to the next row, then the previous one, then Add part.
  const remove = (i: number) => { focus(i < items.length - 1 ? rowSel(i) : i > 0 ? rowSel(i - 1) : 'button.add-part'); setItems(items.filter((_, j) => j !== i)) }

  return (
    <form className="inline-form" ref={formRef} onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label>
        {t('readingDate')}
        <input name="date" type="date" required max={localToday()} onInput={(e) => { future(e); setDate(e.currentTarget.value) }} defaultValue={date} autoFocus {...tie('date', `${id}date`)} />
        {/* The field's order follows the browser's language (10/12 can be 10 Dec), so the date is spelled out too (owner, 2026-11-03). */}
        <span id={`${id}date`} className="muted" aria-hidden="true">{date && fmtDate(date, lng)}</span>
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
export function ServiceRow({ car, record: r, url, readOnly, openOnly, onEdited, onFiles, onDeleted, onGone, onTaskGone, onEditing, head }: {
  car: Vehicle
  record: ServiceRecord
  head?: ReactNode
  url: string
  readOnly: boolean
  openOnly?: boolean // files can only be opened (/history)
  onFiles: (record: ServiceRecord) => void // its files changed, or got fresh links
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
  const describedBy = [r.totalCost != null && `${id}cost`, (r.tasks.length > 0 || r.tireCount > 0) && `${id}tasks`].filter(Boolean).join(' ') || undefined

  if (mode === 'edit') {
    return (
      <li data-id={r.id} id={`service-${r.id}`}>
        {/* Closed too, in case the reload still lists the record. */}
        <RecordForm car={car} url={url} row={row} record={r} onGone={() => { close(); onGone() }} onTaskGone={onTaskGone}
          onSaved={(saved) => { onEdited(saved); open('view') }} />
      </li>
    )
  }

  return (
    <li data-id={r.id} id={`service-${r.id}`}>
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
      {r.tasks.length > 0 ? <p className="muted" id={`${id}tasks`}>{taskList(r, lng)}</p>
        : r.tireCount > 0 ? <p className="muted tires-bought" id={`${id}tasks`}>{t('tiresRecord', { count: r.tireCount })}</p> : null}
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

      <Attachments kind="file" parent={r} url={url} canAdd={!readOnly} canDelete={!openOnly} addLabel={t('addFileTo', vars)} scanLabel={t('scanTo', vars)} onChange={onFiles} onGone={onGone}
        isGone={isGoneRecord} load={async () => {
          const fresh = (await api<ServiceRecord[]>(`/vehicles/${encodeURIComponent(r.vehicleId)}/service-records`)).find((x) => x.id === r.id)
          if (!fresh) throw new ApiError(404, { code: 'serviceRecord.notFound' }, 'Not Found')
          return fresh
        }} />

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
          <p>{t('confirmDeleteService')}{r.attachments.length > 0 && ` ${t('filesDeletedToo')}`}</p>
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

const MAX_FILES = 10
// SCAN-1: the scanner is its own chunk, fetched on the first Scan tap.
// shortcut: a chunk that fails to load (offline before the service worker cached it) stays failed until a reload; retry in place if users hit it.
const Scanner = lazy(() => import('./Scanner').catch(() => ({ default: ScanFailed })))
function ScanFailed({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return <p className="error" role="alert">{t('scanUnavailable')} <button type="button" className="link" onClick={onClose}>{t('close')}</button></p>
}
// When each file's signed URL arrived. The URL lasts an hour, so an Open after 55 minutes fetches a fresh one first.
const isStale = (a: Attachment) => Date.now() - (signedAt.get(a) ?? 0) >= 55 * 60_000
// Signed storage links are https; anything else (javascript:, data:, http:) is never opened.
const isHttps = (u: string) => { try { return new URL(u).protocol === 'https:' } catch { return false } }

// What differs between a service's files (FILE-2) and a run's photos (FILE-3): the types, the words, and the error texts that
// replace errorMessage()'s (file.* name the car photo; attachment.tooMany is one code for both parents).
const fileKind = { types: attachmentTypes, list: 'attachments', add: 'addFile', busy: 'uploadingFile', confirm: 'confirmDeleteFile', max: 'filesMax',
  errors: (c: string) => c.startsWith('file.') && `attachmentFile.${c.slice(5)}` }
const kinds = {
  file: fileKind,
  // SCAN-2b: a car document's files say "document" where a service's say "service".
  document: { ...fileKind, max: 'documentFilesMax', errors: (c: string) => (c === 'attachment.tooMany' ? 'documentFile.tooMany' : fileKind.errors(c)) },
  photo: { types: photoTypes, list: 'photos', add: 'addPhoto', busy: 'uploadingPhoto', confirm: 'confirmDeletePhoto', max: 'photosMax',
    errors: (c: string) => (c.startsWith('attachment.') || c === 'file.unsupportedType' ? `runPhoto.${c.slice(c.indexOf('.') + 1)}` : c === 'file.quotaExceeded' && 'attachmentFile.quotaExceeded') },
}

// A parent's files under its row: a service's files (FILE-2) or a run's photos (FILE-3). Open everywhere; Delete where canDelete;
// Add where canAdd (not on an archived car), one upload at a time. Each change saves at once.
// Focus returns to Add after an upload, and to the list (or Add when it empties) after a delete.
export function Attachments<T extends { attachments: Attachment[] }>({ kind, parent, url, canAdd, canDelete, addLabel, scanLabel, isGone, load, onChange, onGone }: {
  kind: keyof typeof kinds
  parent: T
  url: string // the parent's path
  canAdd: boolean
  canDelete: boolean
  addLabel: string
  scanLabel?: string // shows Scan beside Add (a service's or a document's files)
  isGone: (err: unknown) => boolean // the parent was deleted meanwhile
  load: () => Promise<T> // the parent as stored now, with fresh links; throws the gone error once it's deleted
  onChange: (parent: T) => void
  onGone: () => void
}) {
  const k = kinds[kind]
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  // The mode is the id of the file whose Delete is being confirmed.
  const row = useRow<string>()
  const { mode, busy, error, opener } = row
  const [uploading, setUploading] = useState(false)
  // A failed reload after an upload's 409: shown after the conflict message, not instead of it.
  const [reloadError, setReloadError] = useState<unknown>(null)
  // The last file was deleted where none can be added: the group stays (empty) this once, to hold focus.
  const [emptied, setEmptied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pick = useRef<HTMLButtonElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const refocus = useRef<'add' | 'list' | null>(null)
  const [scanning, setScanning] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const scan = useRef<HTMLButtonElement>(null)
  const scanned = useRef(false)
  const files = parent.attachments

  useEffect(() => { for (const a of files) if (!signedAt.has(a)) signedAt.set(a, Date.now()) }, [files])

  useEffect(() => {
    if (busy || mode !== 'view' || !refocus.current) return
    const target = refocus.current === 'list' && files.length ? group.current : pick.current ?? group.current
    refocus.current = null
    target?.focus()
  }, [busy, mode, error, files])

  // Focus back on Scan (or the group, at 10 files) once the scanner closes.
  useEffect(() => {
    if (scanned.current && !scanning) (scan.current ?? group.current)?.focus()
    scanned.current = scanning
  }, [scanning])

  // From the scanner, focus stays in it: the scanner closes only after a successful upload.
  async function upload(file: File | undefined, fromScanner = false) {
    if (input.current) input.current.value = '' // so the same file can be chosen again
    if (!file) return
    if (!fromScanner) refocus.current = 'add'
    setReloadError(null)
    setUploading(true)
    const err = await row.run(async () => {
      const invalid = fileError(file, k.types)
      if (invalid) throw invalid
      const body = new FormData()
      body.append('file', file)
      try {
        onChange(await api<T>(`${url}/attachments`, 'POST', body))
      } catch (e) {
        // Raced a Delete or another upload: the message stays, over the files as they are now (or the parent is gone).
        if (e instanceof ApiError && e.problem.code === 'concurrency.conflict') {
          await reload().catch((r) => { if (isGone(r)) throw r; setReloadError(r) })
        }
        throw e
      }
    })
    setUploading(false)
    if (isGone(err)) onGone()
    return err
  }

  function openCamera() {
    if (!camera.current) return
    camera.current.value = '' // a photo from an earlier scan isn't read again
    camera.current.click()
  }

  function closeScanner() {
    row.open('view') // drops the scan's upload error, which belongs to the scanner
    setScanning(false)
  }

  async function remove(a: Attachment, retryFrom: HTMLElement) {
    setReloadError(null)
    const err = await row.run(() => api(`${url}/attachments/${encodeURIComponent(a.id)}`, 'DELETE'), retryFrom)
    // Already deleted (another tab): it goes from the list too, with the message.
    if (err && !(err instanceof ApiError && err.problem.code === 'attachment.notFound')) return
    refocus.current = 'list'
    if (files.length === 1 && !canAdd) setEmptied(true)
    onChange({ ...parent, attachments: files.filter((x) => x.id !== a.id) })
    row.close()
  }

  // A link older than 55 minutes would land on the storage's expired-link error: the window opens now, in the click, so pop-up
  // blockers allow it, and gets the fresh URL once the parent is reloaded.
  // shortcut: load() fetches all of the car's records (or the checklist's runs) for one fresh URL; add a single-parent GET if those reach thousands.
  async function open(e: MouseEvent<HTMLAnchorElement>, a: Attachment) {
    if (!isStale(a)) return
    e.preventDefault()
    setReloadError(null)
    const w = window.open('', '_blank')
    if (w) w.opener = null // as rel="noopener"
    const err = await row.run(async () => {
      const href = (await reload()).attachments.find((x) => x.id === a.id)?.url
      if (!href || !isHttps(href)) throw new ApiError(404, { code: 'attachment.notFound' }, 'Not Found')
      // Blocked: the link now holds the fresh URL, for a second tap.
      if (w) w.location.href = href
    })
    if (err) w?.close()
    if (isGone(err)) onGone()
  }

  async function reload() {
    const fresh = await load()
    onChange(fresh)
    return fresh
  }

  const own = k.errors(error instanceof ApiError ? error.problem.code ?? '' : '')
  const message = errorMessage(error, undefined, own && i18n.exists(`errors.${own}`) ? own : undefined)
  const size = (b: number) => {
    const [n, unit] = b < 1_048_576 ? [Math.max(b / 1024, 0.1), 'kb' as const] : [b / 1_048_576, 'mb' as const]
    return <><bdi>{n.toLocaleString(lng, { maximumFractionDigits: 1 })}</bdi> {t(unit)}</>
  }

  // Nothing to show or add (an archived car's or /history's record without files): no empty group for screen readers.
  if (!canAdd && files.length === 0 && !emptied) return null
  return (
    <div className="files" role="group" aria-label={t(k.list)} tabIndex={-1} ref={group}>
      {files.length > 0 && (
        <>
          <span className="muted" aria-hidden="true">{t(k.list)}</span>
          <ul>
            {files.map((a) => (
              <li key={a.id}>
                {/* No URL without storage (or not https): the name only. */}
                {a.url && isHttps(a.url) ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" onClick={(e) => open(e, a)}>
                    <bdi>{a.fileName}</bdi><span className="visually-hidden">{` ${t('opensNewTab')}`}</span>
                  </a>
                ) : <bdi>{a.fileName}</bdi>}
                <span className="muted">{size(a.sizeBytes)}</span>
                {canDelete && mode !== a.id && (
                  <button type="button" className="link" aria-label={t('deleteFileOf', { name: a.fileName })} disabled={busy}
                    ref={opener(a.id)} onClick={() => row.open(a.id)}>{t('delete')}</button>
                )}
                {mode === a.id && (
                  <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && row.open('view')}>
                    <p>{t(k.confirm)}</p>
                    <div className="actions">
                      <button type="button" className="danger" aria-busy={busy} disabled={busy} onClick={(e) => remove(a, e.currentTarget)}>{t('delete')}</button>
                      <button type="button" className="link" disabled={busy} onClick={() => row.open('view')} autoFocus>{t('cancel')}</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {canAdd && files.length >= MAX_FILES && <p className="muted">{t(k.max)}</p>}
      {canAdd && files.length < MAX_FILES && (
        <div className="file-actions">
          <button type="button" className="add-file" ref={pick} aria-label={uploading ? undefined : addLabel} aria-busy={uploading} aria-disabled={busy}
            onClick={() => !busy && input.current?.click()}>
            {t(uploading ? k.busy : k.add)}
          </button>
          <input ref={input} type="file" accept={k.types} hidden onChange={(e) => upload(e.target.files?.[0])} />
          {scanLabel && (
            <>
              {/* Clicked in the tap itself (a camera or file picker needs a user gesture); the scanner reads it once it has loaded. */}
              <button type="button" className="scan" ref={scan} aria-label={scanLabel} aria-disabled={busy}
                onClick={() => { if (busy) return; setScanning(true); openCamera() }}>{t('scan')}</button>
              <input ref={camera} type="file" accept="image/*" capture="environment" hidden />
            </>
          )}
        </div>
      )}
      {/* Outside Add's block: a reload that reaches 10 files mustn't drop the scanner's pages and error. */}
      {scanning && (
        <Suspense fallback={<p className="muted" role="status">{t('scanLoading')}</p>}>
          <Scanner camera={camera} openCamera={openCamera} busy={busy} onClose={closeScanner}
            onSave={async (file) => { if (!(await upload(file, true))) closeScanner() }}
            error={error != null && !isGone(error) && <>{message}{reloadError != null && ` ${errorMessage(reloadError)}`}</>} />
        </Suspense>
      )}
      {!scanning && error != null && !isGone(error) && <p className="error" role="alert">{message}{reloadError != null && ` ${errorMessage(reloadError)}`}</p>}
    </div>
  )
}
