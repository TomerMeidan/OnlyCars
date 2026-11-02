import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEventHandler, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDistance } from '../auth'
import { api, ApiError, byUrgency, localToday, taskCategories, type MaintenanceTask, type TaskCategory, type TaskStatus, type TaskTemplate, type Vehicle } from '../api'
import { errorMessage, fmtDate } from '../i18n'
import { splitDays, unitDays, type Unit } from '../units'
import { noItems, useItemErrors } from '../useItemErrors'
import { useFold } from '../fold'
import { useRow } from '../useRow'

// The field a task error is about (aria-invalid, and focus after a failed Save): the date errors Last done date, task.invalidLastDone the Last done reading; any other code focuses Name.
const fieldOf: Record<string, string> = { 'date.tooEarly': 'lastDoneDate', 'task.futureDate': 'lastDoneDate', 'task.invalidLastDone': 'lastDoneOdometerKm' }

type TaskBody = Pick<MaintenanceTask, 'name' | 'category' | 'intervalKm' | 'intervalDays' | 'dueSoonPercent' | 'lastDoneOdometerKm' | 'lastDoneDate'>
// PUT is a full replace, so every save sends all of these.
const bodyOf = ({ name, category, intervalKm, intervalDays, dueSoonPercent, lastDoneOdometerKm, lastDoneDate }: TaskBody): TaskBody =>
  ({ name, category, intervalKm, intervalDays, dueSoonPercent, lastDoneOdometerKm, lastDoneDate })

// Colored by the status-* class on an ancestor.
export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation()
  return <span className="badge status">{t(`status.${status}`)}</span>
}

// "Every 10,000 km or 1 year", "Every 2 years", "Every 60,000 km".
export function Interval({ km, days }: { km: number | null; days: number | null }) {
  const { t } = useTranslation()
  const d = useDistance()
  const parts: ReactNode[] = []
  if (km != null) parts.push(<><bdi>{d.fmt(km)}</bdi> {d.vars.distUnit}</>)
  if (days != null) {
    const [n, unit] = splitDays(days)
    parts.push(<Trans i18nKey={`duration.${unit}`} count={n} components={{ n: <bdi /> }} />)
  }
  return <>{t('every')} {parts[0]}{parts[1] && <> {t('or')} {parts[1]}</>}</>
}

// The progress bar and the remaining line of a task or checklist with a status.
export function Due({ name, progress, km, days }: { name: string; progress: number; km: number | null; days: number | null }) {
  const { t } = useTranslation()
  const percent = Math.round(Math.min(progress, 1) * 100)
  return (
    <>
      <div
        className="bar"
        role="progressbar"
        aria-label={t('used', { name, percent: Math.round(progress * 100) })}
        aria-valuenow={percent}
        aria-valuetext={`${Math.round(progress * 100)}%`}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ inlineSize: `${percent}%` }} />
      </div>
      <p><Remaining km={km} days={days} /></p>
    </>
  )
}

// "1,200 km or 40 days left", "about 4 months left", "Overdue by 300 km and 12 days". Once overdue, only the overdue parts show.
export function Remaining({ km, days }: { km: number | null; days: number | null }) {
  const { t } = useTranslation()
  const d = useDistance()
  const late = (km ?? 0) < 0 || (days ?? 0) < 0
  const parts: ReactNode[] = []
  if (km != null && km < 0 === late) parts.push(<><bdi>{d.fmtUp(Math.abs(km))}</bdi>{'\u00a0'}{d.vars.distUnit}</>)
  if (days != null && days < 0 === late) {
    const d = Math.abs(days)
    parts.push(d < 60
      ? <Trans i18nKey="duration.days" count={d} components={{ n: <bdi /> }} />
      : <Trans i18nKey="aboutMonths" count={Math.floor(d / 30)} components={{ n: <bdi /> }} />)
  }
  const list = <>{parts[0]}{parts[1] && <>{late ? t('and') : <> {t('or')} </>}{parts[1]}</>}</>
  return <Trans i18nKey={late ? 'overdueBy' : 'left'} components={{ x: <span>{list}</span> }} />
}

// PRED-1: "Around 27 Nov 2026" on a task the server gives a predicted date; nothing otherwise.
export function Predicted({ date }: { date: string | null }) {
  const { i18n } = useTranslation()
  if (!date) return null
  return (
    <p className="muted predicted">
      <Trans i18nKey="around" values={{ date: fmtDate(date, i18n.resolvedLanguage) }} components={{ d: <time dateTime={date} /> }} />
    </p>
  )
}

// "Marked as done." and Undo on a task's row, on the car page and the dashboard; also "Snoozed until" on the dashboard's Reminders.
export function UndoBar({ id, busy, onClick, message, label }: { id: string; busy: boolean; onClick: MouseEventHandler<HTMLButtonElement>; message?: string; label?: string }) {
  const { t } = useTranslation()
  return (
    <div className="undo" role="status">
      {/* Focus lands on Undo in the same render as the bar, so Undo also carries the message. */}
      <span id={`undo-${id}`}>{message ?? t('markedDone')}</span>
      {/* aria-disabled, not disabled: a disabled button drops focus to body while Undo runs. */}
      <button className="link" aria-describedby={`undo-${id}`} aria-disabled={busy} onClick={(e) => !busy && onClick(e)}>{label ?? t('undo')}</button>
    </div>
  )
}

// The Maintenance section of the car page. It loads on its own, so a failure here leaves the rest of the page usable.
// The last reset, undoable from its row until the next action in this section or in the service history.
export type TaskUndo = { taskId: string; recordId: string } | null

export function TasksSection({ car, undo, setUndo, onOdometerChanged, onLogService }: {
  car: Vehicle
  undo: TaskUndo
  setUndo: (undo: TaskUndo) => void
  onOdometerChanged: () => void
  onLogService: (taskId: string) => void // the full Record a service form, with this task ticked (owner, 2026-10-30)
}) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const [tasks, setTasks] = useState<MaintenanceTask[] | null>(null)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [error, setError] = useState<unknown>(null)
  const [templatesError, setTemplatesError] = useState<unknown>(null)
  // Bumped by every local save or delete, so a reload that was already in flight refetches instead of overwriting it.
  const edits = useRef(0)
  // 'pick' is the template picker; an object is the add form (template null for a custom task).
  const [adding, setAdding] = useState<null | 'pick' | { template: TaskTemplate | null }>(null)
  const sectionRef = useRef<HTMLElement>(null)
  // A selector inside the section to focus after the next render; the h2 if it matches nothing.
  const focusNext = useRef<string | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/tasks`
  const readOnly = car.isArchived

  // Reloads whenever the car does (after any odometer change), since status follows the odometer. Old rows stay up meanwhile.
  useEffect(() => {
    let live = true
    const load = () => {
      const at = edits.current
      api<MaintenanceTask[]>(path).then(
        (ts) => live && (at !== edits.current ? load() : (setTasks(ts), setError(null))),
        (err) => live && setError(err),
      )
    }
    load()
    return () => { live = false }
  }, [path, car])
  useEffect(() => {
    if (!readOnly) api<TaskTemplate[]>('/task-templates').then(setTemplates, setTemplatesError)
  }, [readOnly])

  // Before paint, so focus never sits on body for a frame (Undo, as on the dashboard).
  useLayoutEffect(() => {
    const sel = focusNext.current
    const section = sectionRef.current
    if (!sel || !section) return
    focusNext.current = null
    ;(section.querySelector<HTMLElement>(sel) ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [tasks, adding])

  const sorted = tasks && [...tasks].sort(byUrgency(i18n.resolvedLanguage))
  const fold = useFold('maintenance')
  const due = tasks?.filter((x) => x.status !== 'Ok').length ?? 0

  const saved = (task: MaintenanceTask, focus = 'button.edit') => {
    focusNext.current = `li[data-id="${task.id}"] ${focus}`
    edits.current++
    setTasks((ts) => [...(ts ?? []).filter((x) => x.id !== task.id), task])
  }
  const reset = async (url: string, body: object) => {
    const r = await api<{ serviceRecordId: string; task: MaintenanceTask }>(`${url}/reset`, 'POST', { date: localToday(), ...body })
    saved(r.task, '.undo button')
    setUndo({ taskId: r.task.id, recordId: r.serviceRecordId })
    onOdometerChanged()
  }
  const undoReset = async () => {
    const restored = await api<MaintenanceTask[]>(`/vehicles/${encodeURIComponent(car.id)}/service-records/${encodeURIComponent(undo!.recordId)}/void`, 'POST')
    restored.forEach((task) => saved(task, 'button.done'))
    setUndo(null)
    onOdometerChanged()
  }
  const closeAdd = () => {
    focusNext.current = 'button.add'
    setAdding(null)
  }
  const onEscape = (e: KeyboardEvent) => e.key === 'Escape' && closeAdd()

  let addForm: ReactNode = null
  if (adding && adding !== 'pick') {
    const tp = adding.template
    const initial: TaskBody = {
      name: tp ? t(`templates.${tp.key}`, { defaultValue: tp.name }) : '',
      category: tp?.category ?? 'Other',
      intervalKm: tp?.defaultIntervalKm ?? null,
      intervalDays: tp?.defaultIntervalDays ?? null,
      dueSoonPercent: 10,
      lastDoneOdometerKm: car.currentOdometerKm,
      lastDoneDate: localToday(),
    }
    addForm = (
      <TaskForm
        initial={initial}
        currentKm={car.currentOdometerKm}
        onCancel={closeAdd}
        onSubmit={async (body) => {
          const task = await api<MaintenanceTask>(path, 'POST', { ...body, templateId: tp?.id ?? null })
          setAdding(null)
          saved(task)
        }}
      />
    )
  }

  return (
    // Any button or toggle here, except the Undo bar's own, ends the chance to undo. Bubble phase: clearing it in capture swallowed the Enabled checkbox's first change.
    <section {...fold.section} aria-labelledby="maintenance" ref={sectionRef}
      onClick={(e) => (e.target as Element).closest('button, input') && !(e.target as Element).closest('.undo') && setUndo(null)}>
      <div className="row">
        {fold.heading(t('maintenance'), due > 0 && t('tasksDue', { count: due }))}
        {!readOnly && tasks && !adding && <button className="add" onClick={() => setAdding('pick')}>{t('addTask')}</button>}
      </div>

      {adding === 'pick' && (
        <div className="picker" role="group" aria-labelledby="choose-task" onKeyDown={onEscape}>
          <p id="choose-task">{t('chooseTask')}</p>
          {templatesError != null && <p className="error" role="alert">{errorMessage(templatesError)}</p>}
          <ul>
            {templates.map((tp, i) => (
              <li key={tp.id}>
                <button type="button" autoFocus={i === 0} onClick={() => setAdding({ template: tp })}>
                  <span>{t(`templates.${tp.key}`, { defaultValue: tp.name })}</span>
                  <span className="muted"><Interval km={tp.defaultIntervalKm} days={tp.defaultIntervalDays} /></span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setAdding({ template: null })}>{t('customTask')}</button>
            </li>
          </ul>
          <div className="actions">
            <button type="button" className="link" onClick={closeAdd}>{t('cancel')}</button>
          </div>
        </div>
      )}
      {addForm}

      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      {!sorted ? (
        error == null && <p className="muted" role="status">{t('loading')}</p>
      ) : sorted.length === 0 ? (
        <p className="muted">{t('noTasks')}</p>
      ) : (
        <ul className="tasks">
          {sorted.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              url={`${path}/${encodeURIComponent(task.id)}`}
              currentKm={car.currentOdometerKm}
              readOnly={readOnly}
              onSaved={saved}
              onReset={() => reset(`${path}/${encodeURIComponent(task.id)}`, {})}
              onLogService={() => onLogService(task.id)}
              onUndo={undo?.taskId === task.id ? undoReset : undefined}
              onDeleted={() => {
                // The row that takes this one's place, or the h2 if it was the last.
                focusNext.current = `.tasks > li:nth-child(${i + 1}) button.edit`
                edits.current++
                setTasks((ts) => ts && ts.filter((x) => x.id !== task.id))
              }}
            />
          ))}
        </ul>
      )}
      {/* Names the average the "Around" dates use (decisions.md, PRED-1). */}
      {car.avgKmPerDay != null && sorted?.some((x) => x.predictedDueDate) && (
        <p className="muted predicted-basis">
          <Trans i18nKey="basedOnPerDay" values={{ ...d.vars, value: d.perDay(car.avgKmPerDay) }} components={{ n: <bdi /> }} />
        </p>
      )}
    </section>
  )
}

function TaskForm({ initial, currentKm, onSubmit, onCancel }: {
  initial: TaskBody
  currentKm: number
  onSubmit: (body: TaskBody) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const d = useDistance()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [count, unit] = initial.intervalDays == null ? [null, 'months' as Unit] : splitDays(initial.intervalDays)
  const { errorId, tie } = useItemErrors(noItems, error, fieldOf)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const num = (k: string) => (f.get(k) === '' ? null : Number(f.get(k)))
    const time = num('intervalTime')
    const intervalKm = num('intervalKm')
    const body: TaskBody = {
      name: String(f.get('name')),
      category: f.get('category') as TaskCategory,
      intervalKm: intervalKm == null ? null : d.toKm(intervalKm, initial.intervalKm),
      intervalDays: time == null ? null : time * unitDays[f.get('intervalUnit') as Unit],
      dueSoonPercent: Number(f.get('dueSoonPercent')),
      lastDoneOdometerKm: d.toKm(Number(f.get('lastDoneOdometerKm')), initial.lastDoneOdometerKm, currentKm),
      lastDoneDate: String(f.get('lastDoneDate')),
    }
    if (body.intervalKm == null && body.intervalDays == null) return setError(new ApiError(400, { code: 'task.intervalRequired' }, ''))
    setBusy(true)
    setError(null)
    try {
      await onSubmit(body)
    } catch (err) {
      setError(err)
      // The disabled Save dropped focus to body, out of Escape's reach: back to the field the error is about, else the first.
      const field = fieldOf[err instanceof ApiError ? err.problem.code ?? '' : ''] ?? 'name'
      ;(form.elements.namedItem(field) as HTMLElement | null)?.focus()
    } finally {
      setBusy(false)
    }
  }

  // Each limited field gets its own translated message from the browser, so nothing out of range is sent.
  function checkLimits(form: HTMLFormElement) {
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
    const days = Number(field('intervalTime').value) * unitDays[(form.elements.namedItem('intervalUnit') as HTMLSelectElement).value as Unit]
    for (const [name, ok] of [['intervalKm', true], ['intervalTime', days <= 7300], ['dueSoonPercent', true]] as const) {
      const el = field(name)
      el.setCustomValidity('')
      el.setCustomValidity(el.validity.valid && ok ? '' : t(`limits.${name}`, { ...d.vars, maxInterval: d.maxInterval }))
    }
  }

  // Intervals and the percent are whole numbers (step 1): a fraction would fail the API's model binding.
  return (
    <form className="inline-form" onSubmit={submit} onInput={(e) => checkLimits(e.currentTarget)} onKeyDown={(e) => !busy && e.key === 'Escape' && onCancel()}>
      <label className="wide">
        {t('taskName')}
        <input name="name" required maxLength={100} defaultValue={initial.name} autoFocus />
      </label>
      <label>
        {t('category')}
        <select name="category" defaultValue={initial.category}>
          {taskCategories.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
        </select>
      </label>
      <label>
        {t('intervalKm', d.vars)}
        <input name="intervalKm" type="number" inputMode="numeric" min={1} max={d.maxInterval} step={1} defaultValue={initial.intervalKm == null ? '' : d.value(initial.intervalKm)} />
      </label>
      <div className="pair">
        <label>
          {t('intervalTime')}
          <input name="intervalTime" type="number" inputMode="numeric" min={1} step={1} defaultValue={count ?? ''} />
        </label>
        <select name="intervalUnit" aria-label={t('intervalUnit')} defaultValue={unit}>
          {(Object.keys(unitDays) as Unit[]).map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
        </select>
      </div>
      <label>
        {t('dueSoonPercent')}
        <span className="pct">
          <input name="dueSoonPercent" type="number" inputMode="numeric" min={1} max={50} step={1} required defaultValue={initial.dueSoonPercent} />
          %
        </span>
      </label>
      <label>
        {t('lastDoneKm', d.vars)}
        <input name="lastDoneOdometerKm" type="number" inputMode="decimal" min={0} step="any" required defaultValue={d.value(initial.lastDoneOdometerKm)} {...tie('lastDoneOdometerKm')} />
      </label>
      <label>
        {t('lastDoneDate')}
        <input name="lastDoneDate" type="date" required max={localToday()} defaultValue={initial.lastDoneDate} {...tie('lastDoneDate')} />
      </label>
      {error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={onCancel}>{t('cancel')}</button>
      </div>
    </form>
  )
}

function TaskRow({ task, url, currentKm, readOnly, onSaved, onDeleted, onReset, onLogService, onUndo }: {
  task: MaintenanceTask
  url: string
  currentKm: number
  readOnly: boolean
  onSaved: (task: MaintenanceTask, focus?: string) => void
  onDeleted: () => void
  onReset: () => Promise<void>
  onLogService: () => void
  // Set while this row shows the Undo bar.
  onUndo?: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  // After Save or Delete the section refocuses (close()); Cancel and Escape go back to the opener.
  const { mode, open, close, busy, error, run, opener } = useRow<'edit' | 'delete'>()
  const lng = i18n.resolvedLanguage
  const name = task.name

  const errorText = error != null && <p className="error" role="alert">{errorMessage(error)}</p>

  return (
    <li data-id={task.id} className={task.status ? `status-${task.status}` : undefined}>
      <div className="task-head">
        <span className="name">{name}</span>
        {task.status && <StatusBadge status={task.status} />}
        <span className="badge">{t(`categories.${task.category}`)}</span>
        {!task.isEnabled && <span className="badge">{t('disabled')}</span>}
      </div>
      {task.status && <Due name={name} progress={task.progress!} km={task.remainingKm} days={task.remainingDays} />}
      <Predicted date={task.predictedDueDate} />
      <p className="muted"><Interval km={task.intervalKm} days={task.intervalDays} /></p>
      <p className="muted">
        {/* LastDoneDate is a calendar date; format it in UTC so the viewer's time zone can't shift the day. */}
        <Trans
          i18nKey="lastDone"
          values={{
            ...d.vars,
            value: d.fmt(task.lastDoneOdometerKm),
            date: new Date(task.lastDoneDate).toLocaleDateString(lng, { dateStyle: 'medium', timeZone: 'UTC' }),
          }}
          components={{ n: <bdi />, d: <time dateTime={task.lastDoneDate} /> }}
        />
      </p>

      {onUndo && mode === 'view' && <UndoBar id={task.id} busy={busy} onClick={(e) => run(onUndo, e.currentTarget)} />}
      {!readOnly && mode === 'view' && (
        <div className="actions">
          {task.isEnabled && (
            <>
              <button className="done" aria-label={t('markDoneTask', { name })} disabled={busy} onClick={(e) => run(onReset, e.currentTarget)}>{t('markDone')}</button>
              <button className="link log" aria-label={t('addCostNotesTask', { name })} onClick={onLogService}>{t('addCostNotes')}</button>
            </>
          )}
          <button className="link edit" aria-label={t('editTask', { name })} ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>
          <label className="inline">
            <input
              type="checkbox"
              // Shows the new state while it saves; a failed save puts it back. Not disabled while busy, so it keeps focus.
              checked={busy ? !task.isEnabled : task.isEnabled}
              aria-label={t('enabledTask', { name })}
              onChange={() => !busy && run(async () => onSaved(await api<MaintenanceTask>(url, 'PUT', { ...bodyOf(task), isEnabled: !task.isEnabled }), 'input[type=checkbox]'))}
            />
            {t('enabled')}
          </label>
          <button className="link" aria-label={t('deleteTask', { name })} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'view' && errorText}

      {mode === 'edit' && (
        <TaskForm
          initial={task}
          currentKm={currentKm}
          onCancel={() => open('view')}
          onSubmit={async (body) => {
            const saved = await api<MaintenanceTask>(url, 'PUT', body)
            close()
            onSaved(saved)
          }}
        />
      )}

      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteTask')}</p>
          {errorText}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={() => run(async () => { await api(url, 'DELETE'); onDeleted() })}>{t('delete')}</button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
    </li>
  )
}
