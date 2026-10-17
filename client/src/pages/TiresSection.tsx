import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, ApiError, localToday, tireName, type TireMount, type TireSet, type Vehicle, type VehicleTires } from '../api'
import { useDistance } from '../auth'
import { errorMessage, fmtDate } from '../i18n'
import { useItemErrors } from '../useItemErrors'
import { useRow } from '../useRow'

// The field each mount or unmount error is about (decisions.md, MVP5-D); anything else shows under the form.
const fieldOf: Record<string, string> = {
  'tireMount.setMounted': 'set',
  'tireSet.notFound': 'set',
  'tireMount.overlap': 'date',
  'tireMount.futureDate': 'date',
  'date.tooEarly': 'date',
  'odometer.invalidValue': 'odometer',
  'tireMount.odometerBeforeMount': 'odometer',
}
const noItems: never[] = []

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

// The car page's Tires: the set on the car, Mount or Swap and Unmount, and the earlier mounts. It loads on its own.
// An archived car only offers Unmount, so a set is never stuck on it.
export function TiresSection({ car }: { car: Vehicle }) {
  const { t } = useTranslation()
  const [tires, setTires] = useState<VehicleTires | null>(null)
  const [sets, setSets] = useState<TireSet[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const [reloads, setReloads] = useState(0)
  const form = useRow<'mount' | 'unmount'>()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next load, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/tires`
  const readOnly = car.isArchived

  // Reloads with the car too: a new odometer reading changes the km of the set on it. Old rows stay up meanwhile.
  useEffect(() => {
    let live = true
    Promise.all([api<VehicleTires>(path), readOnly ? null : api<TireSet[]>('/tire-sets')]).then(
      ([x, s]) => live && (setTires(x), setSets(s), setError(null)),
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
  const cur = tires?.current
  // The current set is on this car, so it isn't offered either.
  const free = sets?.filter((s) => !s.openMount) ?? []

  return (
    <section className="card" aria-labelledby="tires" ref={sectionRef}>
      <h2 id="tires" tabIndex={-1}>{t('tires')}</h2>
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
          {cur ? <div className="current-tires"><MountInfo m={cur} title={tireName(cur)} set /></div> : <p className="muted">{t('noTireSetOnCar')}</p>}
          {form.mode === 'view' && (!readOnly || cur) && (
            <div className="actions">
              {!readOnly && <button className="mount" ref={form.opener('mount')} onClick={() => form.open('mount')}>{t(cur ? 'swapSet' : 'mountSet')}</button>}
              {cur && <button className="link unmount" ref={form.opener('unmount')} onClick={() => form.open('unmount')}>{t('unmountSet')}</button>}
            </div>
          )}
          {form.mode === 'mount' && free.length === 0 && (
            <div className="inline-form" onKeyDown={(e) => e.key === 'Escape' && form.open('view')}>
              <p><Trans i18nKey={sets?.length ? 'allSetsMounted' : 'noTireSetsToMount'} components={{ a: <Link to="/tires" /> }} /></p>
              <div className="actions">
                <button type="button" className="link" onClick={() => form.open('view')} autoFocus>{t('cancel')}</button>
              </div>
            </div>
          )}
          {form.mode !== 'view' && (form.mode === 'unmount' || free.length > 0) && (
            <MountForm row={form} car={car} current={cur ?? null} free={form.mode === 'mount' ? free : null} path={path}
              onSaved={() => { form.close(); reload(['button.mount', 'button.unmount']) }}
              // Taken meanwhile (another tab, or a simultaneous save): the section and picker reload and the error stays.
              // Unmounted meanwhile: there is nothing to unmount, so the form closes and focus goes to Mount.
              onStale={(code) => { if (code === 'tireMount.notFound') { form.close(); reload(['button.mount']) } else reload(null) }} />
          )}
          {tires.past.length > 0 && (
            <details>
              <summary>{t('runHistory', { n: tires.past.length })}</summary>
              <ul className="tasks mounts">
                {tires.past.map((m, i) => (
                  <PastMount key={m.id} m={m} readOnly={readOnly}
                    // The row that takes this one's place, then the first, then Mount or Swap (decisions.md, MVP1-C).
                    onDeleted={() => reload([`.mounts > li:nth-child(${i + 1}) button.link`, '.mounts > li button.link', 'button.mount', 'button.unmount'])} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}

// Mount (or Swap, when `current` is set) with `free` sets to pick from, or Unmount (free is null). Date and odometer default to today and the car's odometer.
function MountForm({ row, car, current, free, path, onSaved, onStale }: {
  row: ReturnType<typeof useRow<'mount' | 'unmount'>>
  car: Vehicle
  current: TireMount | null
  free: TireSet[] | null
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
      await api(free ? `${path}/mount` : `${path}/unmount`, 'POST',
        free ? { tireSetId: f.get('tireSetId'), mountedAt: date, odometerKm } : { unmountedAt: date, odometerKm })
      onSaved()
    }, (e.nativeEvent as SubmitEvent).submitter)
    if (err instanceof ApiError && ['tireMount.setMounted', 'tireSet.notFound', 'tireMount.notFound', 'concurrency.conflict'].includes(err.problem.code ?? '')) onStale(err.problem.code ?? '')
  }

  const at = bad ?? 'end'
  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>
  // The translated message on a future date instead of the browser's; the server's own check stays.
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.tireMount.futureDate') : '')

  return (
    <form className="inline-form tire-form" onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      {free && (
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
        <input name="date" type="date" required max={localToday()} defaultValue={localToday()} onInput={future} autoFocus={!free} {...tie('date')} />
      </label>
      {at === 'date' && alert}
      <label>
        {t('serviceOdometer', d.vars)}
        <input name="odometer" type="number" inputMode="numeric" {...d.readingInput} max={Math.max(d.maxReading, d.value(car.currentOdometerKm))} required
          defaultValue={d.value(car.currentOdometerKm)} {...tie('odometer')} />
      </label>
      {at === 'odometer' && alert}
      {at === 'end' && alert}
      <div className="actions">
        <button disabled={busy}>{t(free ? (current ? 'swapSet' : 'mountSet') : 'unmountSet')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

function PastMount({ m, readOnly, onDeleted }: { m: TireMount; readOnly: boolean; onDeleted: () => void }) {
  const { t, i18n } = useTranslation()
  // After Delete the section refocuses (close()); Cancel and Escape go back to the opener.
  const { mode, open, close, busy, error, run, opener } = useRow<'delete'>()
  const name = tireName(m)

  return (
    <li data-id={m.id}>
      <MountInfo m={m} title={name} />
      {!readOnly && mode === 'view' && (
        <div className="actions">
          <button className="link" aria-label={t('deleteMountOf', { name, date: fmtDate(m.mountedAt, i18n.resolvedLanguage) })} ref={opener('delete')}
            onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteMount')}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={(e) => run(async () => {
              // Already deleted elsewhere: it is gone either way.
              await api(`/tire-mounts/${encodeURIComponent(m.id)}`, 'DELETE')
                .catch((err) => { if (!(err instanceof ApiError && err.problem.code === 'tireMount.notFound')) throw err })
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
