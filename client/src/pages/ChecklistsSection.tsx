import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, localToday, runPath, type ChecklistRun, type ChecklistRunItem, type ChecklistTemplate, type Vehicle, type VehicleChecklist } from '../api'
import { useDistance } from '../auth'
import { errorMessage, fmtDate } from '../i18n'
import { useRow } from '../useRow'
import { splitDays, unitDays, type Unit } from '../units'
import { Due, Interval, StatusBadge } from './TasksSection'

// The server's cap on a checklist's time interval (10 years).
const MAX_DAYS = 3650

// Where the run page sends the user back to: the checklist whose Run button gets focus, and the flagged count after a Save.
export type RunReturn = { ran: string; flagged?: number }

// The car page's checklists, after Maintenance. It loads on its own, like the tasks.
export function ChecklistsSection({ car, onChanged }: { car: Vehicle; onChanged: () => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  // Read once, then cleared from the history entry, so a reload doesn't repeat the status line.
  const [back] = useState(() => location.state as RunReturn | null)
  useEffect(() => {
    if (back) navigate(location.pathname, { replace: true, state: null })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [list, setList] = useState<VehicleChecklist[] | null>(null)
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [templatesError, setTemplatesError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  // Bumped to reload the list after a change here.
  const [version, setVersion] = useState(0)
  const form = useRow<'add'>()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next load, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(back && [`li[data-id="${back.ran}"] a.run`])
  const path = `/vehicles/${encodeURIComponent(car.id)}/checklists`
  const readOnly = car.isArchived

  // Reloads with the car too (a run's delete moves the odometer). Old rows stay up meanwhile.
  useEffect(() => {
    let live = true
    api<VehicleChecklist[]>(path).then(
      (xs) => live && (setList(xs), setError(null)),
      (err) => live && ((focusNext.current = null), setError(err)),
    ).finally(() => live && setRetrying(false))
    return () => { live = false }
  }, [path, car, version])
  useEffect(() => {
    if (!readOnly) api<ChecklistTemplate[]>('/checklist-templates').then(setTemplates, setTemplatesError)
  }, [readOnly])

  useEffect(() => {
    const sels = focusNext.current
    const section = sectionRef.current
    // Not before the first load: the target (the Run button after a run) isn't there yet.
    if (!sels || !section || !list) return
    focusNext.current = null
    ;(sels.map((s) => section.querySelector<HTMLElement>(s)).find(Boolean) ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [list])

  const reload = (focus: string[]) => {
    focusNext.current = focus
    setVersion((v) => v + 1)
  }
  const available = templates?.filter((tp) => !list?.some((c) => c.templateId === tp.id))
  const savedId = back?.flagged == null ? undefined : 'run-saved'

  return (
    <section className="card" aria-labelledby="checklists" ref={sectionRef}>
      <div className="row">
        <h2 id="checklists" tabIndex={-1}>{t('checklists')}</h2>
        {!readOnly && list && form.mode === 'view' && (
          <button className="add" ref={form.opener('add')} onClick={() => form.open('add')}>{t('addChecklist')}</button>
        )}
      </div>
      {savedId && <p role="status" id={savedId}>{t('runSaved', { count: back!.flagged })}</p>}

      {form.mode === 'add' && (
        !available ? (
          templatesError != null ? <p className="error" role="alert">{errorMessage(templatesError)}</p> : <p className="muted" role="status">{t('loading')}</p>
        ) : available.length === 0 ? (
          <div className="inline-form" onKeyDown={(e) => e.key === 'Escape' && form.open('view')}>
            <p><Trans i18nKey={templates!.length ? 'allAttached' : 'noTemplates'} components={{ a: <Link to="/checklists" /> }} /></p>
            <div className="actions">
              <button type="button" className="link" onClick={() => form.open('view')} autoFocus>{t('cancel')}</button>
            </div>
          </div>
        ) : (
          <ScheduleForm row={form} templates={available} onSubmit={async (body) => {
            const c = await api<VehicleChecklist>(path, 'POST', { ...body, date: localToday() })
            form.close()
            reload([`li[data-id="${c.id}"] a.run`])
          }} />
        )
      )}

      {error != null && (
        <div className="row">
          <p className="error" role="alert">{errorMessage(error)}</p>
          {/* aria-disabled, so Retry keeps focus while it retries; a success focuses the h2. */}
          <button aria-disabled={retrying} onClick={() => {
            if (retrying) return
            setRetrying(true)
            reload([])
          }}>{t('retry')}</button>
        </div>
      )}
      {!list ? (
        error == null && <p className="muted" role="status">{t('loading')}</p>
      ) : list.length === 0 ? (
        form.mode === 'view' && <p className="muted">{t('noChecklistsOnCar')}</p>
      ) : (
        <ul className="tasks car-checklists">
          {list.map((c, i) => (
            <ChecklistRow
              key={c.id}
              car={car}
              checklist={c}
              readOnly={readOnly}
              describedBy={c.id === back?.ran ? savedId : undefined}
              onEdited={() => reload([`li[data-id="${c.id}"] button.edit`])}
              // The row that takes this one's place, then the first, then Add a checklist.
              onRemoved={() => reload([`.car-checklists > li:nth-child(${i + 1}) button.edit`, '.car-checklists > li button.edit', 'button.add'])}
              onRunsChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

type ScheduleBody = { templateId?: string; intervalKm: number | null; intervalDays: number | null; isEnabled?: boolean }

// Add a checklist (with the templates to pick from) or edit one's schedule and on/off. Both intervals empty is manual only.
function ScheduleForm({ row, templates, checklist, onSubmit }: {
  row: { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
  templates?: ChecklistTemplate[]
  checklist?: VehicleChecklist
  onSubmit: (body: ScheduleBody) => Promise<void>
}) {
  const { t } = useTranslation()
  const d = useDistance()
  const hint = useId()
  const { busy, error, run, open } = row
  const [count, unit] = checklist?.intervalDays == null ? [null, 'months' as Unit] : splitDays(checklist.intervalDays)

  // Each limited field gets its own translated message from the browser, so nothing out of range is sent.
  function checkLimits(form: HTMLFormElement) {
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
    const days = Number(field('intervalTime').value) * unitDays[field('intervalUnit').value as Unit]
    for (const [name, ok, message] of [
      ['intervalKm', true, t('limits.intervalKm', { ...d.vars, maxInterval: d.maxInterval })],
      ['intervalTime', days <= MAX_DAYS, t('limits.checklistTime')],
    ] as const) {
      const el = field(name)
      el.setCustomValidity('')
      el.setCustomValidity(el.validity.valid && ok ? '' : message)
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const num = (k: string) => (f.get(k) === '' ? null : Number(f.get(k)))
    const km = num('intervalKm')
    const time = num('intervalTime')
    await run(() => onSubmit({
      ...(templates && { templateId: String(f.get('templateId')) }),
      intervalKm: km == null ? null : d.toKm(km, checklist?.intervalKm),
      intervalDays: time == null ? null : time * unitDays[f.get('intervalUnit') as Unit],
      ...(checklist && { isEnabled: f.get('isEnabled') === 'on' }),
    }), (e.nativeEvent as SubmitEvent).submitter)
  }

  // Intervals are whole numbers (step 1): a fraction would fail the API's model binding.
  return (
    <form className="inline-form" onSubmit={submit} onInput={(e) => checkLimits(e.currentTarget)} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      {templates && (
        <label className="wide">
          {t('checklist')}
          <select name="templateId" autoFocus>
            {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
          </select>
        </label>
      )}
      <label>
        {t('intervalKm', d.vars)}
        <input name="intervalKm" type="number" inputMode="numeric" min={1} max={d.maxInterval} step={1} autoFocus={!templates} aria-describedby={hint}
          defaultValue={checklist?.intervalKm == null ? '' : d.value(checklist.intervalKm)} />
      </label>
      <div className="pair">
        <label>
          {t('intervalTime')}
          <input name="intervalTime" type="number" inputMode="numeric" min={1} step={1} aria-describedby={hint} defaultValue={count ?? ''} />
        </label>
        <select name="intervalUnit" aria-label={t('intervalUnit')} defaultValue={unit}>
          {(Object.keys(unitDays) as Unit[]).map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
        </select>
      </div>
      <p className="muted" id={hint}>{t('intervalHint')}</p>
      {checklist && (
        <label className="inline">
          <input type="checkbox" name="isEnabled" defaultChecked={checklist.isEnabled} />
          {t('enabled')}
        </label>
      )}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

function ChecklistRow({ car, checklist: c, readOnly, describedBy, onEdited, onRemoved, onRunsChanged }: {
  car: Vehicle
  checklist: VehicleChecklist
  readOnly: boolean
  describedBy?: string
  onEdited: () => void
  onRemoved: () => void
  onRunsChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  // After Save or Remove the section refocuses (close()); Cancel and Escape go back to the opener.
  const row = useRow<'edit' | 'remove'>()
  const { mode, open, close, busy, error, run, opener } = row
  const name = c.name
  const url = `/vehicle-checklists/${encodeURIComponent(c.id)}`

  return (
    <li data-id={c.id} className={c.status ? `status-${c.status}` : undefined}>
      <div className="task-head">
        <span className="name" dir="auto">{name}</span>
        {c.status && <StatusBadge status={c.status} />}
        {!c.isEnabled && <span className="badge">{t('disabled')}</span>}
      </div>
      {c.status && <Due name={name} progress={c.progress!} km={c.remainingKm} days={c.remainingDays} />}
      <p className="muted">{c.intervalKm == null && c.intervalDays == null ? t('manualOnly') : <Interval km={c.intervalKm} days={c.intervalDays} />}</p>
      <p className="muted">
        {c.runCount ? (
          <Trans i18nKey="lastRun" values={{ date: fmtDate(c.lastRunDate, i18n.resolvedLanguage) }} components={{ d: <time dateTime={c.lastRunDate} /> }} />
        ) : t('notRunYet')}
      </p>

      {!readOnly && mode === 'view' && (
        <div className="actions">
          {c.isEnabled && (
            <Link className="button run" to={runPath(car.id, c.id)} aria-label={t('runOf', { name })} aria-describedby={describedBy}>{t('run')}</Link>
          )}
          <button className="link edit" aria-label={t('editTask', { name })} ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>
          <button className="link" aria-label={t('removeChecklistOf', { name })} ref={opener('remove')} onClick={() => open('remove')}>{t('remove')}</button>
        </div>
      )}
      {mode === 'edit' && (
        <ScheduleForm row={row} checklist={c} onSubmit={async (body) => {
          await api(url, 'PUT', body)
          close()
          onEdited()
        }} />
      )}
      {mode === 'remove' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmRemoveChecklist')}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={(e) => run(async () => {
              // Already removed elsewhere: it is gone either way.
              await api(url, 'DELETE').catch((err) => { if (!(err instanceof ApiError && err.problem.code === 'vehicleChecklist.notFound')) throw err })
              close()
              onRemoved()
            }, e.currentTarget)}>{t('remove')}</button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
      <RunHistory checklist={c} readOnly={readOnly} onChanged={onRunsChanged} />
    </li>
  )
}

// "History (3)", collapsed; the runs load the first time it opens.
function RunHistory({ checklist: c, readOnly, onChanged }: { checklist: VehicleChecklist; readOnly: boolean; onChanged: () => void }) {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<ChecklistRun[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const ref = useRef<HTMLDetailsElement>(null)
  // Selectors to focus after the next change of the runs, the first that matches; the summary if none does.
  const focusNext = useRef<string[] | null>(null)

  const load = () => api<ChecklistRun[]>(`/vehicle-checklists/${encodeURIComponent(c.id)}/runs`).then(
    (rs) => { setRuns(rs); setError(null) },
    (err) => { focusNext.current = null; setError(err) },
  ).finally(() => setRetrying(false))

  useEffect(() => {
    const sels = focusNext.current
    const box = ref.current
    if (!sels || !box) return
    focusNext.current = null
    ;(sels.map((s) => box.querySelector<HTMLElement>(s)).find(Boolean) ?? box.querySelector<HTMLElement>('summary'))?.focus()
  }, [runs])

  return (
    <details className="run-history" ref={ref} onToggle={(e) => e.currentTarget.open && !runs && load()}>
      <summary>{t('runHistory', { n: c.runCount })}</summary>
      {error != null && (
        <div className="row">
          <p className="error" role="alert">{errorMessage(error)}</p>
          <button aria-disabled={retrying} onClick={() => {
            if (retrying) return
            setRetrying(true)
            focusNext.current = []
            load()
          }}>{t('retry')}</button>
        </div>
      )}
      {!runs ? (
        error == null && <p className="muted" role="status">{t('loading')}</p>
      ) : runs.length === 0 ? (
        <p className="muted">{t('noRuns')}</p>
      ) : (
        <ol className="run-list">
          {runs.map((r, i) => (
            <RunRow key={r.id} run={r} readOnly={readOnly} onDeleted={() => {
              // The next older run, then the newest, then the summary (decisions.md, MVP1-C).
              focusNext.current = [`.run-list > li:nth-child(${i + 1}) button.delete-run`, '.run-list > li button.delete-run']
              setRuns((rs) => rs && rs.filter((x) => x.id !== r.id))
              onChanged()
            }} />
          ))}
        </ol>
      )}
    </details>
  )
}

function RunRow({ run: r, readOnly, onDeleted }: { run: ChecklistRun; readOnly: boolean; onDeleted: () => void }) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const { mode, open, close, busy, error, run, opener } = useRow<'delete'>()
  const date = fmtDate(r.runAt, i18n.resolvedLanguage)

  return (
    <li data-id={r.id}>
      <details>
        <summary>
          <time dateTime={r.runAt}>{date}</time> · <span className="value"><bdi>{d.fmt(r.odometerKm)}</bdi> {d.vars.distUnit}</span> ·{' '}
          <span className={r.flaggedCount ? 'flag' : 'muted'}>{t('flaggedCount', { count: r.flaggedCount })}</span>
        </summary>
        <ul className="run-items">
          {r.items.map((it) => (
            <li key={it.id}>
              <span dir="auto">{it.label}</span>
              <RunValue item={it} />
              {it.isFlagged && <span className="flag">{t('flagged.hand')}</span>}
            </li>
          ))}
        </ul>
      </details>
      {r.notes && <p className="notes" dir="auto">{r.notes}</p>}
      {!readOnly && mode === 'view' && (
        <div className="actions">
          <button className="link delete-run" aria-label={t('deleteRunOf', { date })} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteRun')}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={(e) => run(async () => {
              // Already deleted elsewhere: it is gone either way.
              await api(`/checklist-runs/${encodeURIComponent(r.id)}`, 'DELETE').catch((err) => { if (!(err instanceof ApiError && err.problem.code === 'checklistRun.notFound')) throw err })
              close()
              onDeleted()
            }, e.currentTarget)}>{t('delete')}</button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
    </li>
  )
}

// A run item's answer: OK or Not OK, the number with its unit, or the text.
function RunValue({ item: it }: { item: ChecklistRunItem }) {
  const { t, i18n } = useTranslation()
  if (it.type === 'Check') return <span>{it.boolValue == null ? t('unanswered') : t(it.boolValue ? 'ok' : 'notOk')}</span>
  if (it.type === 'Text') return it.textValue == null ? <span className="muted">{t('unanswered')}</span> : <span className="notes" dir="auto">{it.textValue}</span>
  if (it.numberValue == null) return <span className="muted">{t('unanswered')}</span>
  return <span><bdi dir="ltr">{it.numberValue.toLocaleString(i18n.resolvedLanguage)}</bdi>{it.unit && <> <bdi dir="auto">{it.unit}</bdi></>}</span>
}
