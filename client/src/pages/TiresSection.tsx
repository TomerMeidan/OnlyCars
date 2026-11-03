import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api, ApiError, isOrderError, limit, localToday, seasons, tireName, type Tire, type TireCheck, type TirePosition, type TireRotation, type Vehicle, type VehicleTires } from '../api'
import { useAuth, useDistance } from '../auth'
import { errorMessage, fmtDate } from '../i18n'
import { noItems, useItemErrors } from '../useItemErrors'
import { unfold, useFold } from '../fold'
import { useRow } from '../useRow'
import { ageMonths, LOW_TREAD_MM, lowTread, tireGroups, wheels } from '../tires'

// The field each tire error is about (contract TIRE-2a); 'row' is a whole wheel of a check; anything else shows under the form.
const fieldOf: Record<string, string> = {
  'tire.invalidPositions': 'positions',
  'tire.invalidBrand': 'brand',
  'tire.invalidModel': 'model',
  'tire.invalidSize': 'size',
  'tire.invalidSeason': 'season',
  'tire.invalidDotCode': 'dotCode',
  'tire.futurePurchaseDate': 'purchaseDate',
  'tire.invalidNotes': 'notes',
  'serviceRecord.notesTooLong': 'notes',
  'tireRotation.invalidNotes': 'notes',
  'tire.futureDate': 'date',
  'tire.dateBeforeFitted': 'date',
  'tire.dateBeforeRotation': 'date',
  'date.tooEarly': 'date',
  'tireMeasurement.duplicate': 'date',
  'tireRotation.beforeLatest': 'date',
  'odometer.invalidValue': 'odometer',
  'tire.odometerBeforeFitted': 'odometer',
  'odometer.lowerThanPrevious': 'odometer',
  'odometer.higherThanNext': 'odometer',
  'serviceRecord.invalidCost': 'cost',
  'serviceRecord.shopTooLong': 'shop',
  'tireMeasurement.invalidPressure': 'pressure',
  'tireMeasurement.invalidTread': 'tread',
  'tireMeasurement.empty': 'row',
  'tireMeasurement.invalidPosition': 'row',
  'tireMeasurement.duplicatePosition': 'row',
  'tireMeasurement.noTire': 'row',
}
// Changed elsewhere meanwhile: the section reloads; the form and its message stay.
const staleCodes = ['tire.notFound', 'tireMeasurement.noTire', 'tireRotation.noTire', 'concurrency.conflict']
type Mode = 'replace' | 'check' | 'rotation'
type Row = { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
type Log = { tires: VehicleTires; checks: TireCheck[]; rotations: TireRotation[] }
const frontToBack: Partial<Record<TirePosition, TirePosition>> = { FL: 'RL', RL: 'FL', FR: 'RR', RR: 'FR' }
const cross: Partial<Record<TirePosition, TirePosition>> = { FL: 'RR', RR: 'FL', FR: 'RL', RL: 'FR' }

// Short texts about tires, in the user's language and distance unit.
function useTireText() {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const num = (v: number) => v.toLocaleString(i18n.resolvedLanguage)
  return {
    num,
    group: (ps: TirePosition[]) => (ps.length === 1 ? t(`positions.${ps[0]}`) : ps.length === 4 ? t('groups.all') : t(ps[0] === 'FL' ? 'groups.front' : 'groups.rear')),
    age: (x: Tire) => {
      const m = ageMonths(x, localToday())
      return m >= 12 ? t('ageYears', { count: Math.floor(m / 12) }) : m > 0 ? t('ageMonths', { count: m }) : t('ageNew')
    },
    km: (x: Tire) => t('kmValue', { value: d.fmt(x.kmOnTire), ...d.vars }),
    bar: (v: number) => t('barValue', { value: num(v) }),
    mm: (v: number) => t('mmValue', { value: num(v) }),
  }
}

// The record's row in the service history on this page, its section opened first; focus goes to its Add file, where the receipt goes.
// Done here, not by the browser's jump: a jump to an element that can't take focus moves focus to the page (HTML "scroll to the fragment").
const toRecord = (e: MouseEvent<HTMLAnchorElement>) => {
  const row = document.getElementById(e.currentTarget.hash.slice(1))
  const target = row?.querySelector<HTMLElement>('button.add-file') ?? row?.querySelector<HTMLElement>('a, button')
  if (!row || !target) return // not listed yet: the browser's own jump
  e.preventDefault()
  unfold(row)
  row.scrollIntoView({ block: 'start' })
  target.focus({ preventScroll: true })
}

// A warning line for each tire on the car that needs attention, whichever wheels are selected.
export function TireWarnings({ tires }: { tires: Tire[] }) {
  const { t } = useTranslation()
  const x = useTireText()
  return tires.filter(lowTread).map((y) => (
    <p key={y.id} className="status-DueSoon low-tread">
      <span className="badge status">{t('lowTread')}</span>{' '}
      {t('lowTreadOf', { wheel: t(`positions.${y.position}`), value: x.num(y.latestMeasurement?.treadDepthMm ?? 0), min: LOW_TREAD_MM })}
    </p>
  ))
}

// The car from above, front at the top: four wheels and the spare behind it, each a button with its tire's short facts.
// Always left to right, so the driver's left wheel stays on the left in Hebrew; the facts keep the page's direction.
export function TireDiagram({ tires, selected, onSelect }: { tires: Tire[]; selected: TirePosition[]; onSelect: (ps: TirePosition[]) => void }) {
  const { t, i18n } = useTranslation()
  const x = useTireText()
  const dir = i18n.dir()
  return (
    <div className="tire-car" dir="ltr">
      <svg className="car-body" viewBox="0 0 100 200" aria-hidden="true" focusable="false">
        <path className="shell" d="M11 60L3 56V66L11 69ZM89 60L97 56V66L89 69Z" />
        <path className="shell" d="M50 3C76 3 88 9 89 28L91 172C91 190 80 197 50 197C20 197 9 190 9 172L11 28C12 9 24 3 50 3Z" />
        <path className="lamp" d="M18 10Q26 6 34 7M82 10Q74 6 66 7" />
        <path className="glass" d="M18 78H82L76 54Q50 47 24 54Z" />
        <rect className="roof" x="20" y="82" width="60" height="58" rx="6" />
        <path className="glass" d="M20 144H80L75 164Q50 170 25 164Z" />
      </svg>
      {(['FL', 'FR', 'RL', 'RR', 'Spare'] as const).map((p) => {
        const tire = tires.find((y) => y.position === p)
        const m = tire?.latestMeasurement
        const low = tire != null && lowTread(tire)
        const facts = tire
          ? [tireName(tire), x.age(tire), x.km(tire), m?.pressureBar != null && x.bar(m.pressureBar), m?.treadDepthMm != null && x.mm(m.treadDepthMm)].filter((f): f is string => !!f)
          : [t('noTire')]
        return (
          <button key={p} type="button" className={`wheel wheel-${p}${tire ? '' : ' empty'}${low ? ' attention' : ''}`} aria-pressed={selected.includes(p)}
            aria-label={`${t(`positions.${p}`)}: ${[...facts, low && t('lowTread')].filter(Boolean).join(', ')}`} onClick={() => onSelect([p])}>
            <span className="tire" />
            <span className="wheel-facts">
              {facts.map((f, i) => <span key={i} dir={i === 0 && tire ? 'auto' : dir}>{f}</span>)}
              {low && <span className="status-DueSoon" dir={dir}><span className="badge status">{t('lowTread')}</span></span>}
            </span>
          </button>
        )
      })}
      <p className="visually-hidden" role="status">{selected.length > 0 && t('selectedWheels', { wheels: x.group(selected) })}</p>
    </div>
  )
}

function Measure({ bar, mm }: { bar: number | null; mm: number | null }) {
  const { i18n } = useTranslation()
  const num = (v: number) => ({ value: v.toLocaleString(i18n.resolvedLanguage) })
  return (
    <span>
      {bar != null && <Trans i18nKey="pressureOf" values={num(bar)} components={{ n: <bdi /> }} />}
      {bar != null && mm != null && ', '}
      {mm != null && <Trans i18nKey="treadOf" values={num(mm)} components={{ n: <bdi /> }} />}
    </span>
  )
}

// One wheel's tire in full. With `car` (the car page) it has Replace, Edit, Delete and its purchase record; on /tires it only shows.
export function TireCard({ position: p, tire, car, onReplace, reload, onChanged }: {
  position: TirePosition
  tire: Tire | undefined
  car?: Vehicle
  onReplace?: (ps: TirePosition[], el: HTMLElement) => void
  reload?: (focus: string[] | null) => void
  onChanged?: () => void // a tire deleted: the service history's tire counts change
}) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const x = useTireText()
  // After Save or Delete the section refocuses (close()); Cancel and Escape go back to the opener.
  const row = useRow<'edit' | 'delete'>()
  const { mode, open, close, busy, error, run, opener } = row
  const date = (v: string) => fmtDate(v, i18n.resolvedLanguage)
  const wheel = t(`positions.${p}`)
  const m = tire?.latestMeasurement
  const sel = `.tire-details li[data-position="${p}"]`
  const canEdit = car != null && !car.isArchived

  return (
    <li data-position={p}>
      <div className="task-head">
        <span className="name">{wheel}</span>
        {tire && <span className="badge">{t(`seasons.${tire.season}`)}</span>}
      </div>
      {!tire ? (
        <>
          <p className="muted">{t('noTire')}</p>
          {canEdit && onReplace && (
            <div className="actions"><button className="link add-tire" onClick={(e) => onReplace([p], e.currentTarget)}>{t('addTire')}</button></div>
          )}
        </>
      ) : mode === 'edit' && car ? (
        // Deleted elsewhere: the form closes and the section reloads without it.
        <TireForm row={row} car={car} tire={tire} onEdited={() => { close(); reload?.([`${sel} button.edit`]) }} onStale={(code) => { if (code === 'tire.notFound') close(); reload?.([`${sel} button`]) }} />
      ) : (
        <>
          <p className="tire-name" dir="auto">{tireName(tire)}</p>
          {(tire.size || tire.dotCode) && (
            <p className="muted facts">
              {tire.size && <span>{t('tireSize')}: <span dir="auto">{tire.size}</span></span>}
              {tire.dotCode && <span>{t('dotCode')}: <span dir="auto">{tire.dotCode}</span></span>}
            </p>
          )}
          <p>{t('tireAge', { age: x.age(tire) })}</p>
          <p className="muted">
            <Trans i18nKey="fittedOn" values={{ date: date(tire.fittedAt), value: d.fmt(tire.fittedOdometerKm), ...d.vars }} components={{ d: <time dateTime={tire.fittedAt} />, n: <bdi /> }} />
          </p>
          <p><Trans i18nKey="kmOnTire" values={{ value: d.fmt(tire.kmOnTire), ...d.vars }} components={{ n: <bdi /> }} /></p>
          {m ? (
            <p>
              <Trans i18nKey="latestCheckOn" values={{ date: date(m.measuredAt) }} components={{ d: <time dateTime={m.measuredAt} /> }} />{' '}
              <Measure bar={m.pressureBar} mm={m.treadDepthMm} />
            </p>
          ) : <p className="muted">{t('notMeasured')}</p>}
          {tire.notes && <p className="notes" dir="auto">{tire.notes}</p>}
          {car && mode === 'view' && (canEdit || tire.serviceRecordId) && (
            <div className="actions">
              {canEdit && onReplace && (
                <button className="link replace-one" aria-label={t('replaceTireOf', { wheel })} onClick={(e) => onReplace([p], e.currentTarget)}>{t('replaceTire')}</button>
              )}
              {canEdit && <button className="link edit" aria-label={t('editTireOf', { wheel })} ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>}
              {canEdit && <button className="link delete" aria-label={t('deleteTireOf', { wheel })} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>}
              {tire.serviceRecordId && <a href={`#service-${tire.serviceRecordId}`} onClick={toRecord}>{t('purchaseRecord')}</a>}
            </div>
          )}
          {mode === 'delete' && (
            <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
              <p>{t('confirmDeleteTire')}</p>
              {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
              <div className="actions">
                <button className="danger" disabled={busy} onClick={(e) => run(async () => {
                  // Already deleted elsewhere: it is gone either way.
                  await api(`/tires/${encodeURIComponent(tire.id)}`, 'DELETE').catch((err) => { if (!(err instanceof ApiError && err.problem.code === 'tire.notFound')) throw err })
                  close()
                  reload?.([`${sel} button.add-tire`])
                  onChanged?.()
                }, e.currentTarget)}>{t('delete')}</button>
                <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
              </div>
            </div>
          )}
        </>
      )}
    </li>
  )
}

// The car page's Tires: the drawing, the selected wheels' tires, Replace (a wheel, a pair, all 4 or the spare), checks and rotations,
// and the tires taken off. It loads on its own and reloads with the car. An archived car only shows.
export function TiresSection({ car, onChanged }: { car: Vehicle; onChanged: () => void }) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const x = useTireText()
  const [log, setLog] = useState<Log | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [selected, setSelected] = useState<TirePosition[]>([])
  // Bumped each time Replace opens, so its form starts again from the tire it replaces.
  const [opened, setOpened] = useState(0)
  // After a Replace: its service record, where the receipt goes (null when none was made).
  const [saved, setSaved] = useState<{ recordId: string | null } | null>(null)
  const form = useRow<Mode>()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next load, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/tires`
  const readOnly = car.isArchived
  const date = (v: string) => fmtDate(v, i18n.resolvedLanguage)

  // Reloads with the car too: a new odometer reading changes the km on each tire. Old rows stay up meanwhile.
  useEffect(() => {
    let live = true
    Promise.all([api<VehicleTires>(path), api<TireCheck[]>(`${path}/checks`), api<TireRotation[]>(`${path}/rotations`)]).then(
      ([tires, checks, rotations]) => live && (setLog({ tires, checks, rotations }), setError(null)),
      (err) => live && ((focusNext.current = null), setError(err)),
    ).finally(() => live && setRetrying(false))
    return () => { live = false }
  }, [path, car, reloads])

  useEffect(() => {
    const sels = focusNext.current
    const section = sectionRef.current
    if (!sels || !section || !log) return
    focusNext.current = null
    ;(sels.map((s) => section.querySelector<HTMLElement>(s)).find(Boolean) ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [log])

  const reload = (focus: string[] | null) => {
    focusNext.current = focus
    setReloads((n) => n + 1)
  }
  const cur = log?.tires.current ?? []
  const on = (p: TirePosition) => cur.find((y) => y.position === p)
  // While Replace is open, a wheel or a group changes its wheels and keeps what was typed.
  const openReplace = (ps: TirePosition[], el: HTMLElement) => {
    setSelected(ps)
    setSaved(null)
    if (form.mode === 'replace') return
    form.opener('replace')(el)
    setOpened((n) => n + 1)
    form.open('replace')
  }
  const quick: TirePosition[][] = [['FL', 'FR'], ['RL', 'RR'], wheels, ...(on('Spare') ? [['Spare'] as TirePosition[]] : [])]
  // The row that takes a deleted one's place, then the first, then `rest`.
  const afterDelete = (list: string, i: number, ...rest: string[]) => [`.${list} > li:nth-child(${i + 1}) button.link`, `.${list} > li button.link`, ...rest]
  const fold = useFold('tires')
  const rot = log?.tires.lastRotation

  return (
    <section {...fold.section} aria-labelledby="tires" ref={sectionRef}>
      <div className="row">
        {fold.heading(t('tires'))}
        {/* Kept up while Replace is open, so Cancel can give it focus back. */}
        {log && !readOnly && (
          <button className="add replace-tires" onClick={(e) => openReplace(selected.length ? selected : wheels, e.currentTarget)}>{t('replaceTires')}</button>
        )}
      </div>
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
      {!log ? (
        error == null && <p className="muted" role="status">{t('loading')}</p>
      ) : (
        <>
          {!readOnly && cur.length > 0 && (form.mode === 'view' || form.mode === 'replace') && (
            <div className="quick tire-groups" role="group" aria-label={t('quickWheels')}>
              {quick.map((g) => (
                <button key={g.join()} type="button" className="more" aria-pressed={selected.join() === g.join()} onClick={(e) => openReplace(g, e.currentTarget)}>{x.group(g)}</button>
              ))}
            </div>
          )}
          <div className="tire-layout">
            <TireDiagram tires={cur} selected={selected} onSelect={setSelected} />
            <div className="tire-side">
              <TireWarnings tires={cur} />
              {/* Up whatever is selected, so Cancel can give Add tires focus back. */}
              {cur.length === 0 && (
                <div className="actions">
                  <p className="muted">{t('noTiresOnCar')}</p>
                  {!readOnly && <button className="add add-tires" onClick={(e) => openReplace(wheels, e.currentTarget)}>{t('addTires')}</button>}
                </div>
              )}
              {selected.length > 0 ? (
                <ul className="tasks tire-details">
                  {selected.map((p) => <TireCard key={`${p}-${on(p)?.id}`} position={p} tire={on(p)} car={car} onReplace={openReplace} reload={reload} onChanged={onChanged} />)}
                </ul>
              ) : cur.length > 0 && <p className="muted">{t('pickWheel')}</p>}
            </div>
          </div>
          {form.mode === 'replace' && (
            <TireForm key={opened} row={form} car={car} tire={on(selected[0])} tires={cur} positions={selected} onPositions={setSelected} path={path}
              onReplaced={(v) => {
                setSaved({ recordId: v.current.find((y) => selected.includes(y.position))?.serviceRecordId ?? null })
                focusNext.current = ['.tire-saved']
                setLog((l) => l && { ...l, tires: v })
                form.close()
                onChanged() // the new service record and odometer reading
              }}
              onStale={() => reload(null)} />
          )}
          {saved && form.mode === 'view' && (
            <p className="tire-saved" role="status" tabIndex={-1}>
              {saved.recordId ? (
                <Trans i18nKey="tiresSavedRecord" components={{ a: <a href={`#service-${saved.recordId}`} onClick={toRecord} /> }} />
              ) : t('tiresSaved')}
            </p>
          )}
          {cur.length > 0 && (
            <div className="tire-log">
              <p className="last-check" tabIndex={-1}>
                {log.tires.lastCheckDate ? (
                  <Trans i18nKey="lastCheck" values={{ date: date(log.tires.lastCheckDate) }} components={{ d: <time dateTime={log.tires.lastCheckDate} /> }} />
                ) : <span className="muted">{t('noChecks')}</span>}
              </p>
              <p className="last-rotation" tabIndex={-1}>
                {rot ? (
                  <Trans i18nKey="lastRotation" values={{ date: date(rot.date), value: d.fmt(rot.kmSince), ...d.vars }} components={{ d: <time dateTime={rot.date} />, n: <bdi /> }} />
                ) : <span className="muted">{t('notRotated')}</span>}
              </p>
            </div>
          )}
          {!readOnly && cur.length > 0 && form.mode === 'view' && (
            <div className="actions">
              <button className="link log-check" ref={form.opener('check')} onClick={() => form.open('check')}>{t('logCheck')}</button>
              {cur.length > 1 && <button className="link log-rotation" ref={form.opener('rotation')} onClick={() => form.open('rotation')}>{t('logRotation')}</button>}
            </div>
          )}
          {form.mode === 'check' && <CheckForm row={form} tires={cur} path={path} onSaved={() => { form.close(); reload(['.last-check']) }} onStale={() => reload(null)} />}
          {form.mode === 'rotation' && <RotationForm row={form} car={car} tires={cur} path={path} onSaved={() => { form.close(); reload(['.last-rotation']) }} onStale={() => reload(null)} />}
          {log.checks.length > 0 && (
            <details>
              <summary>{t('checksHistory', { n: log.checks.length })}</summary>
              <ul className="tasks checks">
                {log.checks.map((c, i) => (
                  <DeleteRow key={c.measuredAt} readOnly={readOnly} label={t('deleteCheckOf', { date: date(c.measuredAt) })} confirm={t('confirmDeleteCheck')}
                    url={`${path}/checks/${c.measuredAt}`} gone="tireMeasurement.notFound" onDeleted={() => reload(afterDelete('checks', i, 'button.log-check'))}>
                    <p><time dateTime={c.measuredAt}>{date(c.measuredAt)}</time></p>
                    <ul className="check-items">
                      {c.items.map((it) => <li key={it.tireId}>{t(`positions.${it.position}`)}: <Measure bar={it.pressureBar} mm={it.treadDepthMm} /></li>)}
                    </ul>
                  </DeleteRow>
                ))}
              </ul>
            </details>
          )}
          {log.rotations.length > 0 && (
            <details>
              <summary>{t('rotationsHistory', { n: log.rotations.length })}</summary>
              <ul className="tasks rotations">
                {log.rotations.map((r, i) => (
                  // Only the newest rotation can be deleted (it moves its tires back).
                  <DeleteRow key={r.id} readOnly={readOnly || i > 0} label={t('deleteRotationOf', { date: date(r.date) })} confirm={t('confirmDeleteRotation')}
                    url={`/tire-rotations/${encodeURIComponent(r.id)}`} gone="tireRotation.notFound" onDeleted={() => reload(['.rotations > li button.link', 'button.log-rotation'])}
                    onError={(code) => staleCodes.concat('tireRotation.notLatest', 'tireRotation.tireRemoved').includes(code) && reload(null)}>
                    <p><time dateTime={r.date}>{date(r.date)}</time></p>
                    <p><Trans i18nKey="rotationAt" values={{ value: d.fmt(r.odometerKm), ...d.vars }} components={{ n: <bdi /> }} /></p>
                    {r.moves.length > 0 ? (
                      <p>{new Intl.ListFormat(i18n.resolvedLanguage, { type: 'unit' }).format(r.moves.map((mv) => t('moveOf', { from: t(`positions.${mv.fromPosition}`), to: t(`positions.${mv.toPosition}`) })))}</p>
                    ) : <p className="muted">{t('wheelsNotRecorded')}</p>}
                    {r.notes && <p className="notes" dir="auto">{r.notes}</p>}
                  </DeleteRow>
                ))}
              </ul>
            </details>
          )}
          {log.tires.removed.length > 0 && (
            <details>
              <summary>{t('tireHistory', { n: log.tires.removed.length })}</summary>
              <ul className="tasks removed-tires">
                {log.tires.removed.map((y) => (
                  <li key={y.id}>
                    <div className="task-head">
                      <span className="name" dir="auto">{tireName(y)}</span>
                      <span className="badge">{t(`positions.${y.position}`)}</span>
                    </div>
                    <p className="muted">
                      <Trans i18nKey="tireRange" values={{ from: date(y.fittedAt), to: date(y.removedAt ?? y.fittedAt) }}
                        components={{ f: <time dateTime={y.fittedAt} />, t: <time dateTime={y.removedAt ?? undefined} /> }} />
                    </p>
                    <p><Trans i18nKey="kmOnTire" values={{ value: d.fmt(y.kmOnTire), ...d.vars }} components={{ n: <bdi /> }} /></p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}

// Replace (with `positions`): new tires on those wheels in one save, prefilled from `tire`, the one they replace.
// Edit (without): the details of `tire`. Cancel and Escape discard.
function TireForm({ row, car, tire, tires, positions, onPositions, path, onReplaced, onEdited, onStale }: {
  row: Row
  car: Vehicle
  tire: Tire | undefined
  tires?: Tire[] // the tires on the car: a reading typed in miles at an old tire's fitted km goes back as that km
  positions?: TirePosition[]
  onPositions?: (ps: TirePosition[]) => void
  path?: string
  onReplaced?: (x: VehicleTires) => void
  onEdited?: (x: Tire) => void
  onStale: (code: string) => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const d = useDistance()
  const x = useTireText()
  const id = useId()
  const { busy, error, run, open } = row
  const { errorId, bad, tie } = useItemErrors(noItems, error, fieldOf)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const replace = positions != null

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (k: string) => String(f.get(k) ?? '').trim() || null
    const details = { brand: text('brand'), model: text('model'), size: text('size'), season: f.get('season'), dotCode: text('dotCode'), purchaseDate: text('purchaseDate'), notes: text('notes') }
    const p = error instanceof ApiError ? error.problem : {}
    const err = await run(async () => {
      if (!replace) return onEdited?.(await api<Tire>(`/tires/${encodeURIComponent(tire?.id ?? '')}`, 'PUT', details))
      const cost = text('cost')
      onReplaced?.(await api<VehicleTires>(`${path}/replace`, 'POST', {
        ...details,
        positions,
        date: f.get('date'),
        purchaseDate: details.purchaseDate ?? f.get('date'),
        // Typed as shown, the car's odometer, an old tire's fitted km or a reading the last error named goes back as its exact km.
        odometerKm: d.toKm(Number(f.get('odometer')), car.currentOdometerKm, p.previousKm, p.nextKm, p.fittedOdometerKm, ...(tires ?? []).map((y) => y.fittedOdometerKm)),
        cost: cost == null ? null : Number(cost),
        shopName: text('shop'),
        confirmCorrection: needsConfirm && confirmCorrection,
      }))
    }, (e.nativeEvent as SubmitEvent).submitter)
    setNeedsConfirm(isOrderError(err))
    if (err instanceof ApiError && staleCodes.includes(err.problem.code ?? '')) onStale(err.problem.code ?? '')
  }

  const at = bad ?? 'end'
  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>
  // The browser's checks, with the translated message, before any request; the server's own checks stay.
  const brandMsg = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.valueMissing ? t('errors.tire.invalidBrand') : '')
  const future = (code: string) => (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t(code) : '')
  const field = (name: string, label: string, max: number, value: string | null | undefined) => (
    <>
      <label>
        {label}
        <input name={name} dir="auto" maxLength={max} defaultValue={value ?? ''} {...tie(name)} />
      </label>
      {at === name && alert}
    </>
  )

  return (
    <form className="inline-form tire-form" onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      {replace && (
        <>
          <label className="wide">
            {t('wheelsToReplace')}
            <select name="positions" value={positions.join()} onChange={(e) => onPositions?.(e.target.value.split(',') as TirePosition[])} autoFocus {...tie('positions')}>
              {tireGroups.map((g) => <option key={g.join()} value={g.join()}>{x.group(g)}</option>)}
            </select>
          </label>
          {at === 'positions' && alert}
          <label>
            {t('readingDate')}
            <input name="date" type="date" required max={localToday()} defaultValue={localToday()} onInput={future('errors.tire.futureDate')} {...tie('date')} />
          </label>
          {at === 'date' && alert}
          <label>
            {t('serviceOdometer', d.vars)}
            <input name="odometer" type="number" inputMode="numeric" {...d.readingInput} max={Math.max(d.maxReading, d.value(car.currentOdometerKm))} required
              defaultValue={d.value(car.currentOdometerKm)} {...tie('odometer')} />
          </label>
          {at === 'odometer' && alert}
          {needsConfirm && (
            <label className="inline">
              <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} aria-describedby={errorId} />
              {t('confirmCorrection')}
            </label>
          )}
        </>
      )}
      <label>
        {t('brand')}
        <input name="brand" dir="auto" maxLength={50} required defaultValue={tire?.brand ?? ''} autoFocus={!replace} onInvalid={brandMsg} onInput={brandMsg} {...tie('brand')} />
      </label>
      {at === 'brand' && alert}
      {field('model', t('model'), 50, tire?.model)}
      {field('size', t('tireSize'), 30, tire?.size)}
      <label>
        {t('season')}
        <select name="season" defaultValue={tire?.season ?? 'Summer'} {...tie('season')}>
          {seasons.map((s) => <option key={s} value={s}>{t(`seasons.${s}`)}</option>)}
        </select>
      </label>
      {at === 'season' && alert}
      {/* New tires have their own DOT week and purchase date, so Replace doesn't copy them. */}
      {field('dotCode', t('dotCode'), 20, replace ? null : tire?.dotCode)}
      <label>
        {t('purchaseDate')}
        <input name="purchaseDate" type="date" max={localToday()} defaultValue={replace ? '' : tire?.purchaseDate ?? ''} onInput={future('errors.tire.futurePurchaseDate')}
          {...tie('purchaseDate', replace ? `${id}pd` : undefined)} />
        {replace && <span id={`${id}pd`} className="muted">{t('purchaseDateHint')}</span>}
      </label>
      {at === 'purchaseDate' && alert}
      {replace && (
        <>
          <label>
            {t('cost', { currency: user?.currency })}
            <input name="cost" type="number" inputMode="decimal" min={0} max={1000000} step={0.01} onInput={limit(t('limits.cost'))} {...tie('cost')} />
          </label>
          {at === 'cost' && alert}
          <label>
            {t('shop')}
            <input name="shop" dir="auto" maxLength={100} {...tie('shop')} />
          </label>
          {at === 'shop' && alert}
        </>
      )}
      <label className="wide">
        {t('notes')}
        <textarea name="notes" dir="auto" maxLength={1000} rows={2} defaultValue={replace ? '' : tire?.notes ?? ''} {...tie('notes')} />
      </label>
      {at === 'notes' && alert}
      {replace && <p className="muted">{t('replaceHint')}</p>}
      {!['positions', 'date', 'odometer', 'brand', 'model', 'size', 'season', 'dotCode', 'purchaseDate', 'cost', 'shop', 'notes'].includes(at) && alert}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// Log a check: the date and a row per wheel that has a tire. Empty rows are not sent, so an item error's index is into the sent ones.
function CheckForm({ row, tires, path, onSaved, onStale }: { row: Row; tires: Tire[]; path: string; onSaved: () => void; onStale: () => void }) {
  const { t } = useTranslation()
  const { busy, error, run, open } = row
  const { errorId, bad, tie } = useItemErrors(noItems, error, fieldOf)
  const [sent, setSent] = useState<TirePosition[]>([])
  const index = error instanceof ApiError ? error.problem.index : undefined
  const wheel = index == null ? undefined : sent[index]
  const positions = tires.map((y) => y.position)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null)
    const items = positions.map((position) => ({ position, pressureBar: num(`p${position}`), treadDepthMm: num(`t${position}`) }))
      .filter((y) => y.pressureBar != null || y.treadDepthMm != null)
    setSent(items.map((y) => y.position))
    // No values at all goes to the server too; its tireMeasurement.empty shows under the form.
    const err = await run(async () => {
      await api(`${path}/checks`, 'POST', { measuredAt: f.get('date'), items })
      onSaved()
    }, (e.nativeEvent as SubmitEvent).submitter)
    if (err instanceof ApiError && staleCodes.includes(err.problem.code ?? '')) onStale()
  }

  const at = wheel ?? (bad === 'date' ? 'date' : 'end')
  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.tire.futureDate') : '')
  // A wheel's input the error is about: its pressure or tread, or both for a whole-wheel error.
  const tieWheel = (p: TirePosition, field: string) => (wheel === p && (bad === field || bad === 'row') ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})

  return (
    <form className="inline-form tire-form tire-check" onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label>
        {t('readingDate')}
        <input name="date" type="date" required max={localToday()} defaultValue={localToday()} onInput={future} autoFocus {...tie('date')} />
      </label>
      {at === 'date' && alert}
      <div className="items">
        {positions.map((p) => {
          const name = t(`positions.${p}`)
          return (
            <fieldset className="item" key={p}>
              <legend>{name}</legend>
              <label>
                {t('pressureBar')}
                <input name={`p${p}`} type="number" inputMode="decimal" min={0.5} max={6} step={0.01} onInput={limit(t('errors.tireMeasurement.invalidPressure'))}
                  aria-label={t('wheelField', { wheel: name, field: t('pressureBar') })} {...tieWheel(p, 'pressure')} />
              </label>
              <label>
                {t('treadMm')}
                <input name={`t${p}`} type="number" inputMode="decimal" min={0} max={20} step={0.1} onInput={limit(t('errors.tireMeasurement.invalidTread'))}
                  aria-label={t('wheelField', { wheel: name, field: t('treadMm') })} {...tieWheel(p, 'tread')} />
              </label>
              {at === p && alert}
            </fieldset>
          )
        })}
      </div>
      {at === 'end' && alert}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// Log a rotation: for each wheel with a tire, the wheel its tire went to (the spare may swap in). Unmoved tires are not sent.
function RotationForm({ row, car, tires, path, onSaved, onStale }: { row: Row; car: Vehicle; tires: Tire[]; path: string; onSaved: () => void; onStale: () => void }) {
  const { t } = useTranslation()
  const d = useDistance()
  const { busy, error, run, open } = row
  const { errorId, bad, tie } = useItemErrors(noItems, error, fieldOf)
  const positions = tires.map((y) => y.position)
  const [to, setTo] = useState<Partial<Record<TirePosition, TirePosition>>>(() => Object.fromEntries(positions.map((p) => [p, p])))
  const four = wheels.every((p) => positions.includes(p))

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const moves = positions.filter((p) => to[p] !== p).map((p) => ({ fromPosition: p, toPosition: to[p] }))
    const err = await run(async () => {
      // The car's odometer, left as shown, goes back as its exact km.
      await api(`${path}/rotations`, 'POST', { date: f.get('date'), odometerKm: d.toKm(Number(f.get('odometer')), car.currentOdometerKm), notes: f.get('notes'), moves })
      onSaved()
    }, (e.nativeEvent as SubmitEvent).submitter)
    if (err instanceof ApiError && staleCodes.includes(err.problem.code ?? '')) onStale()
  }

  const at = bad ?? 'end'
  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.tire.futureDate') : '')

  return (
    <form className="inline-form tire-form" onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label>
        {t('readingDate')}
        <input name="date" type="date" required max={localToday()} defaultValue={localToday()} onInput={future} autoFocus {...tie('date')} />
      </label>
      {at === 'date' && alert}
      <label>
        {t('serviceOdometer', d.vars)}
        <input name="odometer" type="number" inputMode="numeric" {...d.readingInput} max={Math.max(d.maxReading, d.value(car.currentOdometerKm))} required
          defaultValue={d.value(car.currentOdometerKm)} {...tie('odometer')} />
      </label>
      {at === 'odometer' && alert}
      <fieldset className="moves">
        <legend>{t('rotationMoves')}</legend>
        {four && (
          <div className="quick">
            <button type="button" className="more" onClick={() => setTo((m) => ({ ...m, ...frontToBack }))}>{t('frontToBack')}</button>
            <button type="button" className="more" onClick={() => setTo((m) => ({ ...m, ...cross }))}>{t('crossRotation')}</button>
          </div>
        )}
        {positions.map((p) => (
          <label key={p}>
            {t('movedTo', { wheel: t(`positions.${p}`) })}
            <select name={`to${p}`} value={to[p]} onChange={(e) => setTo((m) => ({ ...m, [p]: e.target.value as TirePosition }))}>
              {positions.map((q) => <option key={q} value={q}>{t(`positions.${q}`)}</option>)}
            </select>
          </label>
        ))}
      </fieldset>
      <label className="wide">
        {t('notes')}
        <textarea name="notes" dir="auto" maxLength={500} rows={2} {...tie('notes')} />
      </label>
      {at === 'notes' && alert}
      {!['date', 'odometer', 'notes'].includes(at) && alert}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// A history row with Delete and its confirm step. After Delete the section refocuses (close()); Cancel and Escape go back to the opener.
function DeleteRow({ label, confirm, url, gone, readOnly, onDeleted, onError, children }: {
  label: string
  confirm: string
  url: string
  gone: string // the 404 code of a row deleted elsewhere: it is gone either way
  readOnly: boolean
  onDeleted: () => void
  onError?: (code: string) => void // after a refused Delete, with its code
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { mode, open, close, busy, error, run, opener } = useRow<'delete'>()

  return (
    <li>
      {children}
      {!readOnly && mode === 'view' && (
        <div className="actions">
          <button className="link" aria-label={label} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{confirm}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={async (e) => {
              const err = await run(async () => {
                await api(url, 'DELETE').catch((err) => { if (!(err instanceof ApiError && err.problem.code === gone)) throw err })
                close()
                onDeleted()
              }, e.currentTarget)
              if (err instanceof ApiError) onError?.(err.problem.code ?? '')
            }}>{t('delete')}</button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
    </li>
  )
}
