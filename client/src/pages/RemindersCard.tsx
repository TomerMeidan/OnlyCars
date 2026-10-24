import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link } from 'react-router-dom'
import { api, localToday, type Reminder, type Reminders } from '../api'
import { errorMessage, fmtDate } from '../i18n'
import { useRow } from '../useRow'
import { DocStatus, ExpiresOn } from './DocumentsSection'
import { Remaining, StatusBadge, UndoBar } from './TasksSection'

const snoozeDays = [1, 7, 30]
const keyOf = (x: Pick<Reminder, 'kind' | 'refId'>) => `${x.kind}-${x.refId}`
const nameOf = (x: Reminder, t: TFunction) => x.name ?? t(`docType.${x.documentType}`)

// The dashboard's Reminders (NOT-1): due tasks and checklists and expiring documents, most urgent first (the server's order), each with Snooze.
// It loads on its own, again whenever `version` (the dashboard's data) changes, so a Mark done or a reading there shows here too.
export function RemindersCard({ version }: { version: unknown }) {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState<Reminders | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  // The last snooze, undoable until the next one.
  const [undo, setUndo] = useState<{ item: Reminder; until: string } | null>(null)
  const undoRow = useRow()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus once the next answer renders, the first that matches; the h2 if none does. A failed load keeps focus unless a selector is given.
  const focusNext = useRef<string[] | null>(null)
  // Only the latest request may show its answer.
  const request = useRef(0)

  // Old rows stay up while it reloads.
  const load = (focus: string[] | null = null) => {
    const n = ++request.current
    return api<Reminders>(`/reminders?today=${localToday()}`).then(
      (r) => { if (n === request.current) { focusNext.current = focus; setData(r); setError(null) } },
      (err) => { if (n === request.current) { focusNext.current = focus?.length ? focus : null; setError(err) } },
    ).finally(() => n === request.current && setRetrying(false))
  }
  useEffect(() => { load() }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const sels = focusNext.current
    const section = sectionRef.current
    if (!sels || !section) return
    focusNext.current = null
    ;(sels.map((s) => section.querySelector<HTMLElement>(s)).find(Boolean) ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [data, error])

  const snooze = async (item: Reminder, days: number) => {
    const r = await api<{ snoozedUntil: string }>('/reminders/snooze', 'POST', { kind: item.kind, refId: item.refId, days, today: localToday() })
    setUndo({ item, until: r.snoozedUntil })
    await load(['.undo button'])
  }
  // The bar goes once the list with the restored row is up, so focus moves straight from Undo to that row's Snooze.
  const unsnooze = async () => {
    const { item } = undo!
    await api(`/reminders/snooze?kind=${item.kind}&refId=${encodeURIComponent(item.refId)}`, 'DELETE')
    await load([`li[data-key="${keyOf(item)}"] button.snooze`])
    setUndo(null)
  }

  return (
    <section className="card" aria-labelledby="reminders" ref={sectionRef}>
      <h2 id="reminders" tabIndex={-1}>{t('reminders')}</h2>
      {undo && (
        <UndoBar id="snooze" busy={undoRow.busy} message={t('snoozedUntil', { name: nameOf(undo.item, t), car: undo.item.vehicleNickname, date: fmtDate(undo.until, i18n.resolvedLanguage) })} label={t('undoSnooze')}
          onClick={(e) => undoRow.run(unsnooze, e.currentTarget)} />
      )}
      {undoRow.error != null && <p className="error" role="alert">{errorMessage(undoRow.error)}</p>}
      {error != null && (
        <div className="row">
          <p className="error" role="alert">{errorMessage(error)}</p>
          {/* aria-disabled, so Retry keeps focus while it retries; a success focuses the h2. */}
          <button aria-disabled={retrying} onClick={() => {
            if (retrying) return
            setRetrying(true)
            load([])
          }}>{t('retry')}</button>
        </div>
      )}
      {!data ? (
        error == null && <p className="muted" role="status">{t('loading')}</p>
      ) : data.items.length === 0 ? (
        <p className="muted">{t('noReminders')}</p>
      ) : (
        <ul className="tasks">
          {data.items.map((x) => <ReminderRow key={keyOf(x)} item={x} onSnooze={(days) => snooze(x, days)} />)}
        </ul>
      )}
      {data && data.snoozedCount > 0 && <p className="muted">{t('snoozedCount', { count: data.snoozedCount })}</p>}
    </section>
  )
}

function ReminderRow({ item: x, onSnooze }: { item: Reminder; onSnooze: (days: number) => Promise<void> }) {
  const { t } = useTranslation()
  // Cancel and Escape go back to Snooze; a failed snooze keeps the choices open, focus on the one tried.
  const { mode, open, busy, error, run, opener } = useRow<'pick'>()
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (mode === 'pick') first.current?.focus() }, [mode])
  const name = nameOf(x, t)
  const label = t('snoozeOf', { name, car: x.vehicleNickname })
  const doc = x.kind === 'Document'

  return (
    <li data-key={keyOf(x)} className={`status-${x.status}`}>
      <div className="task-head">
        <span className="name" dir="auto">{name}</span>
        {doc ? <DocStatus status={x.status} daysLeft={x.remainingDays ?? 0} /> : <StatusBadge status={x.status as 'Overdue' | 'DueSoon'} />}
      </div>
      <p>{doc ? <ExpiresOn date={x.dueDate!} /> : <Remaining km={x.remainingKm} days={x.remainingDays} />}</p>
      {/* The car link stays while the choices are open (L150); a long name truncates so Snooze keeps its line (L151). */}
      <div className="actions">
        <Link className="car" to={`/cars/${encodeURIComponent(x.vehicleId)}`} dir="auto"><span>{x.vehicleNickname}</span></Link>
        {mode === 'view' && <button className="link snooze" aria-label={label} ref={opener('pick')} onClick={() => open('pick')}>{t('snooze')}</button>}
      </div>
      {mode !== 'view' && (
        <div role="group" aria-label={label} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('snoozeFor')}</p>
          <div className="actions">
            {snoozeDays.map((d, i) => (
              <button key={d} ref={i === 0 ? first : undefined} disabled={busy} onClick={(e) => run(() => onSnooze(d), e.currentTarget)}>{t(`snoozeDays.${d}`)}</button>
            ))}
            <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
          </div>
        </div>
      )}
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
    </li>
  )
}
