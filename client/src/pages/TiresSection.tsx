import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, ApiError, limit, localToday, tireName, tirePositions, type TireCheck, type TireMount, type TirePosition, type TireRotation, type TireSet, type Vehicle, type VehicleTires } from '../api'
import { useDistance } from '../auth'
import { errorMessage, fmtDate } from '../i18n'
import { noItems, useItemErrors } from '../useItemErrors'
import { useFold } from '../fold'
import { useRow } from '../useRow'

// The field each tire error is about (decisions.md, MVP5-D and MVP5-E); 'row' is a whole wheel of a check; anything else shows under the form.
const fieldOf: Record<string, string> = {
  'tireMount.setMounted': 'set',
  'tireSet.notFound': 'set',
  'tireMount.overlap': 'date',
  'tireMount.futureDate': 'date',
  'tireMount.dateBeforeMount': 'date',
  'tireMeasurement.duplicate': 'date',
  'date.tooEarly': 'date',
  'odometer.invalidValue': 'odometer',
  'tireMount.odometerBeforeMount': 'odometer',
  'tireRotation.invalidNotes': 'notes',
  'tireMeasurement.invalidPressure': 'pressure',
  'tireMeasurement.invalidTread': 'tread',
  'tireMeasurement.empty': 'row',
  'tireMeasurement.invalidPosition': 'row',
  'tireMeasurement.duplicatePosition': 'row',
}
// Taken, gone or off the car meanwhile: the section reloads.
const staleCodes = ['tireMount.setMounted', 'tireSet.notFound', 'tireMount.notFound', 'tireMount.notOpen', 'concurrency.conflict']
type Mode = 'mount' | 'unmount' | 'check' | 'rotation'
// The checks and rotations of the set on the car, newest first.
type Log = [TireCheck[], TireRotation[]]

// One mount: its dates, the odometer it went on at (while on), and its km. `title` is the set on the car page, the car on /tires.
export function MountInfo({ m, title, set }: { m: TireMount; title: string; set?: boolean }) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const date = (x: string) => fmtDate(x, i18n.resolvedLanguage)
  return (
    <>
      <div className="task-head">
        <span className="name" dir="auto">{title}</span>
        {set && <span className="badge">{t(`seasons.${m.season}`)}</span>}
      </div>
      {set && m.size && <p className="muted">{t('tireSize')}: <span dir="auto">{m.size}</span></p>}
      <p className="muted">
        {m.unmountedAt ? (
          <Trans i18nKey="mountRange" values={{ from: date(m.mountedAt), to: date(m.unmountedAt) }}
            components={{ f: <time dateTime={m.mountedAt} />, t: <time dateTime={m.unmountedAt} /> }} />
        ) : (
          <Trans i18nKey="mountedSince" values={{ from: date(m.mountedAt), value: d.fmt(m.mountOdometerKm), ...d.vars }}
            components={{ f: <time dateTime={m.mountedAt} />, n: <bdi /> }} />
        )}
      </p>
      <p><Trans i18nKey="kmDriven" values={{ value: d.fmt(m.kmDriven), ...d.vars }} components={{ n: <bdi /> }} /></p>
    </>
  )
}

// A check's wheels, each with its pressure and tread as typed (2.4 stays 2.4, 2.25 shows 2.25), in the user's number format.
function CheckItems({ c }: { c: TireCheck }) {
  const { t, i18n } = useTranslation()
  const num = (v: number) => ({ value: v.toLocaleString(i18n.resolvedLanguage) })
  return (
    <ul className="check-items">
      {c.items.map((x) => (
        <li key={x.position}>
          {t(`positions.${x.position}`)}:{' '}
          <span>
            {x.pressureBar != null && <Trans i18nKey="pressureOf" values={num(x.pressureBar)} components={{ n: <bdi /> }} />}
            {x.pressureBar != null && x.treadDepthMm != null && ', '}
            {x.treadDepthMm != null && <Trans i18nKey="treadOf" values={num(x.treadDepthMm)} components={{ n: <bdi /> }} />}
          </span>
        </li>
      ))}
    </ul>
  )
}

// The car page's Tires: the set on the car with its last check and rotation; Mount or Swap, Unmount, Log a check or a rotation;
// the set's checks and rotations; and the earlier mounts. It loads on its own.
// An archived car only offers Unmount, so a set is never stuck on it; its checks and rotations show without Log or Delete.
export function TiresSection({ car }: { car: Vehicle }) {
  const { t, i18n } = useTranslation()
  const d = useDistance()
  const [tires, setTires] = useState<VehicleTires | null>(null)
  const [log, setLog] = useState<Log | null>(null)
  const [sets, setSets] = useState<TireSet[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const [reloads, setReloads] = useState(0)
  const form = useRow<Mode>()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next load, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/tires`
  const readOnly = car.isArchived
  const date = (x: string) => fmtDate(x, i18n.resolvedLanguage)

  // Reloads with the car too: a new odometer reading changes the km of the set on it. Old rows stay up meanwhile.
  // The checks and rotations of the set on the car load in the same round, so a reload's focus can land on any of their rows.
  useEffect(() => {
    let live = true
    const load = api<VehicleTires>(path).then(async (x): Promise<[VehicleTires, Log | null]> => {
      const m = x.current && `/tire-mounts/${encodeURIComponent(x.current.id)}`
      return [x, m ? await Promise.all([api<TireCheck[]>(`${m}/checks`), api<TireRotation[]>(`${m}/rotations`)]) : null]
    })
    Promise.all([load, readOnly ? null : api<TireSet[]>('/tire-sets')]).then(
      ([[x, l], s]) => live && (setTires(x), setLog(l), setSets(s), setError(null)),
      (err) => live && ((focusNext.current = null), setError(err)),
    ).finally(() => live && setRetrying(false))
    return () => { live = false }
  }, [path, car, readOnly, reloads])

  useEffect(() => {
    const sels = focusNext.current
    const section = sectionRef.current
    if (!sels || !section || !tires) return
    focusNext.current = null
    ;(sels.map((s) => section.querySelector<HTMLElement>(s)).find(Boolean) ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [tires])

  const reload = (focus: string[] | null) => {
    focusNext.current = focus
    setReloads((n) => n + 1)
  }
  // Taken meanwhile (another tab, or a simultaneous save): the section and picker reload and the error stays.
  // Unmounted or off the car meanwhile: there is nothing left to act on, so the form closes and focus goes to Mount.
  const stale = (code: string) => {
    if (code === 'tireMount.notFound' || code === 'tireMount.notOpen') { form.close(); reload(['button.mount']) } else reload(null)
  }
  const cur = tires?.current
  // The current set is on this car, so it isn't offered either.
  const free = sets?.filter((s) => !s.openMount) ?? []
  const check = cur?.lastCheck
  const rot = cur?.lastRotation
  // The row that takes a deleted one's place, then the first, then `rest` (decisions.md, MVP1-C).
  const afterDelete = (list: string, i: number, ...rest: string[]) => [`.${list} > li:nth-child(${i + 1}) button.link`, `.${list} > li button.link`, ...rest]

  const fold = useFold('tires')

  return (
    <section {...fold.section} aria-labelledby="tires" ref={sectionRef}>
      {fold.heading(t('tires'))}
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
      {!tires ? (
        error == null && <p className="muted" role="status">{t('loading')}</p>
      ) : (
        <>
          {cur ? (
            <div className="current-tires">
              <MountInfo m={cur} title={tireName(cur)} set />
              <div className="last-check" tabIndex={-1}>
                {check ? (
                  <>
                    <p><Trans i18nKey="lastCheck" values={{ date: date(check.measuredAt) }} components={{ d: <time dateTime={check.measuredAt} /> }} /></p>
                    <CheckItems c={check} />
                  </>
                ) : <p className="muted">{t('noChecks')}</p>}
              </div>
              <p className={rot ? 'last-rotation' : 'last-rotation muted'} tabIndex={-1}>
                {rot ? (
                  <Trans i18nKey="lastRotation" values={{ date: date(rot.date), value: d.fmt(rot.kmSince), ...d.vars }}
                    components={{ d: <time dateTime={rot.date} />, n: <bdi /> }} />
                ) : t('notRotated')}
              </p>
            </div>
          ) : <p className="muted">{t('noTireSetOnCar')}</p>}
          {form.mode === 'view' && (!readOnly || cur) && (
            <div className="actions">
              {!readOnly && <button className="mount" ref={form.opener('mount')} onClick={() => form.open('mount')}>{t(cur ? 'swapSet' : 'mountSet')}</button>}
              {cur && <button className="link unmount" ref={form.opener('unmount')} onClick={() => form.open('unmount')}>{t('unmountSet')}</button>}
              {cur && !readOnly && (
                <>
                  <button className="link log-check" ref={form.opener('check')} onClick={() => form.open('check')}>{t('logCheck')}</button>
                  <button className="link log-rotation" ref={form.opener('rotation')} onClick={() => form.open('rotation')}>{t('logRotation')}</button>
                </>
              )}
            </div>
          )}
          {form.mode === 'mount' && free.length === 0 && (
            <div className="inline-form" onKeyDown={(e) => e.key === 'Escape' && form.open('view')}>
              {/* A Mount whose set was taken meanwhile keeps its message once no set is left to pick (L73). */}
              {form.error != null && <p className="error" role="alert">{errorMessage(form.error)}</p>}
              <p><Trans i18nKey={sets?.length ? 'allSetsMounted' : 'noTireSetsToMount'} components={{ a: <Link to="/tires" /> }} /></p>
              <div className="actions">
                <button type="button" className="link" onClick={() => form.open('view')} autoFocus>{t('cancel')}</button>
              </div>
            </div>
          )}
          {(form.mode === 'unmount' || (form.mode === 'rotation' && cur) || (form.mode === 'mount' && free.length > 0)) && (
            <MountForm mode={form.mode} row={form} car={car} current={cur ?? null} free={free} path={path}
              onSaved={() => { form.close(); reload(form.mode === 'rotation' ? ['.last-rotation'] : ['button.mount', 'button.unmount']) }}
              onStale={stale} />
          )}
          {form.mode === 'check' && cur && (
            <CheckForm row={form} mount={cur} onSaved={() => { form.close(); reload(['.last-check']) }} onStale={stale} />
          )}
          {cur && log && log[0].length > 0 && (
            <details>
              <summary>{t('checksHistory', { n: log[0].length })}</summary>
              <ul className="tasks checks">
                {log[0].map((c, i) => (
                  <DeleteRow key={c.measuredAt} readOnly={readOnly} label={t('deleteCheckOf', { date: date(c.measuredAt) })} confirm={t('confirmDeleteCheck')}
                    url={`/tire-mounts/${encodeURIComponent(cur.id)}/checks/${c.measuredAt}`} gone="tireMeasurement.notFound" onDeleted={() => reload(afterDelete('checks', i, 'button.log-check'))}>
                    <p><time dateTime={c.measuredAt}>{date(c.measuredAt)}</time></p>
                    <CheckItems c={c} />
                  </DeleteRow>
                ))}
              </ul>
            </details>
          )}
          {cur && log && log[1].length > 0 && (
            <details>
              <summary>{t('rotationsHistory', { n: log[1].length })}</summary>
              <ul className="tasks rotations">
                {log[1].map((r, i) => (
                  <DeleteRow key={r.id} readOnly={readOnly} label={t('deleteRotationOf', { date: date(r.date) })} confirm={t('confirmDeleteRotation')}
                    url={`/tire-rotations/${encodeURIComponent(r.id)}`} gone="tireRotation.notFound" onDeleted={() => reload(afterDelete('rotations', i, 'button.log-rotation'))}>
                    <p><time dateTime={r.date}>{date(r.date)}</time></p>
                    <p><Trans i18nKey="rotationAt" values={{ value: d.fmt(r.odometerKm), ...d.vars }} components={{ n: <bdi /> }} /></p>
                    {r.notes && <p className="notes" dir="auto">{r.notes}</p>}
                  </DeleteRow>
                ))}
              </ul>
            </details>
          )}
          {tires.past.length > 0 && (
            <details>
              <summary>{t('runHistory', { n: tires.past.length })}</summary>
              <ul className="tasks mounts">
                {tires.past.map((m, i) => (
                  <DeleteRow key={m.id} readOnly={readOnly} label={t('deleteMountOf', { name: tireName(m), date: date(m.mountedAt) })} confirm={t('confirmDeleteMount')}
                    url={`/tire-mounts/${encodeURIComponent(m.id)}`} gone="tireMount.notFound" onDeleted={() => reload(afterDelete('mounts', i, 'button.mount', 'button.unmount'))}>
                    <MountInfo m={m} title={tireName(m)} />
                  </DeleteRow>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}

// Mount (or Swap, when `current` is set) with `free` sets to pick from, Unmount, or Log a rotation of `current`.
// Date and odometer default to today and the car's odometer.
function MountForm({ mode, row, car, current, free, path, onSaved, onStale }: {
  mode: 'mount' | 'unmount' | 'rotation'
  row: ReturnType<typeof useRow<Mode>>
  car: Vehicle
  current: TireMount | null
  free: TireSet[]
  path: string
  onSaved: () => void
  onStale: (code: string) => void
}) {
  const { t } = useTranslation()
  const d = useDistance()
  const { busy, error, run, open } = row
  const { errorId, bad, tie } = useItemErrors(noItems, error, fieldOf)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    // Typed as shown, the car's odometer or the mount's start go back exactly, so miles can't round below the mount's start.
    const odometerKm = d.toKm(Number(f.get('odometer')), car.currentOdometerKm, current?.mountOdometerKm)
    const date = f.get('date')
    const err = await run(async () => {
      await (mode === 'mount' ? api(`${path}/mount`, 'POST', { tireSetId: f.get('tireSetId'), mountedAt: date, odometerKm })
        : mode === 'unmount' ? api(`${path}/unmount`, 'POST', { unmountedAt: date, odometerKm })
        : api(`/tire-mounts/${encodeURIComponent(current?.id ?? '')}/rotations`, 'POST', { date, odometerKm, notes: f.get('notes') }))
      onSaved()
    }, (e.nativeEvent as SubmitEvent).submitter)
    if (err instanceof ApiError && staleCodes.includes(err.problem.code ?? '')) onStale(err.problem.code ?? '')
  }

  const at = bad ?? 'end'
  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>
  // The translated message on a future date instead of the browser's; the server's own check stays.
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.tireMount.futureDate') : '')

  return (
    <form className="inline-form tire-form" onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      {mode === 'mount' && (
        <label className="wide">
          {t('tireSet')}
          <select name="tireSetId" autoFocus {...tie('set')}>
            {free.map((s) => <option key={s.id} value={s.id}>{[tireName(s), s.size, t(`seasons.${s.season}`)].filter(Boolean).join(', ')}</option>)}
          </select>
        </label>
      )}
      {at === 'set' && alert}
      <label>
        {t('readingDate')}
        <input name="date" type="date" required max={localToday()} defaultValue={localToday()} onInput={future} autoFocus={mode !== 'mount'} {...tie('date')} />
      </label>
      {at === 'date' && alert}
      <label>
        {t('serviceOdometer', d.vars)}
        <input name="odometer" type="number" inputMode="numeric" {...d.readingInput} max={Math.max(d.maxReading, d.value(car.currentOdometerKm))} required
          defaultValue={d.value(car.currentOdometerKm)} {...tie('odometer')} />
      </label>
      {at === 'odometer' && alert}
      {mode === 'rotation' && (
        <label className="wide">
          {t('notes')}
          <textarea name="notes" dir="auto" maxLength={500} rows={2} {...tie('notes')} />
        </label>
      )}
      {!['set', 'date', 'odometer'].includes(at) && alert}
      <div className="actions">
        <button disabled={busy}>{t(mode === 'rotation' ? 'save' : mode === 'unmount' ? 'unmountSet' : current ? 'swapSet' : 'mountSet')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// Log a check of the set on the car: the date and the five wheels. Empty wheels are not sent, so an item error's index is into the sent ones.
function CheckForm({ row, mount, onSaved, onStale }: {
  row: ReturnType<typeof useRow<Mode>>
  mount: TireMount
  onSaved: () => void
  onStale: (code: string) => void
}) {
  const { t } = useTranslation()
  const { busy, error, run, open } = row
  const { errorId, bad, tie } = useItemErrors(noItems, error, fieldOf)
  const [sent, setSent] = useState<TirePosition[]>([])
  const index = error instanceof ApiError ? error.problem.index : undefined
  const wheel = index == null ? undefined : sent[index]

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null)
    const items = tirePositions.map((position) => ({ position, pressureBar: num(`p${position}`), treadDepthMm: num(`t${position}`) }))
      .filter((x) => x.pressureBar != null || x.treadDepthMm != null)
    setSent(items.map((x) => x.position))
    // No values at all goes to the server too; its tireMeasurement.empty shows under the form.
    const err = await run(async () => {
      await api(`/tire-mounts/${encodeURIComponent(mount.id)}/checks`, 'POST', { measuredAt: f.get('date'), items })
      onSaved()
    }, (e.nativeEvent as SubmitEvent).submitter)
    if (err instanceof ApiError && staleCodes.includes(err.problem.code ?? '')) onStale(err.problem.code ?? '')
  }

  const at = wheel ?? (bad === 'date' ? 'date' : 'end')
  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.tireMount.futureDate') : '')
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
        {tirePositions.map((p) => {
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

// A history row with Delete and its confirm step. After Delete the section refocuses (close()); Cancel and Escape go back to the opener.
function DeleteRow({ label, confirm, url, gone, readOnly, onDeleted, children }: {
  label: string
  confirm: string
  url: string
  gone: string // the 404 code of a row deleted elsewhere: it is gone either way
  readOnly: boolean
  onDeleted: () => void
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
            <button className="danger" disabled={busy} onClick={(e) => run(async () => {
              await api(url, 'DELETE').catch((err) => { if (!(err instanceof ApiError && err.problem.code === gone)) throw err })
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
