import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api, ApiError, localToday, seasons, tireName, type TireMount, type TireSet } from '../api'
import { useDistance } from '../auth'
import { errorMessage, fmtDate } from '../i18n'
import { useItemErrors } from '../useItemErrors'
import { usePage } from '../usePage'
import { useRow } from '../useRow'
import { MountInfo } from './TiresSection'

// The field each API error is about; anything else shows under the form.
const fieldOf: Record<string, string> = {
  'tireSet.invalidBrand': 'brand',
  'tireSet.invalidModel': 'model',
  'tireSet.invalidSize': 'size',
  'tireSet.invalidSeason': 'season',
  'tireSet.futureDate': 'purchaseDate',
  'date.tooEarly': 'purchaseDate',
  'tireSet.invalidDotCode': 'dotCode',
  'tireSet.invalidNotes': 'notes',
}
const noItems: never[] = []

// /tires: the user's tire sets, where each one is and its km, with an inline form to add one and one per row to edit it.
export default function TiresPage() {
  const { t } = useTranslation()
  const [sets, setSets] = useState<TireSet[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const form = useRow<'new'>()
  // Selectors to focus after the next list change, the first that matches.
  const focusNext = useRef<string[] | null>(null)
  usePage(t('tires'))

  // After a save too: the server's order (brand, model, creation time) and computed km come with the list.
  const load = (focus: string[] | null = null) => {
    focusNext.current = focus
    return api<TireSet[]>('/tire-sets')
      .then((xs) => { setSets(xs); setError(null) }, (err) => { focusNext.current = null; setError(err) })
      .finally(() => setRetrying(false))
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sels = focusNext.current
    focusNext.current = null
    sels?.map((s) => document.querySelector<HTMLElement>(s)).find(Boolean)?.focus()
  }, [sets])

  const saved = (x: TireSet) => load([`.tire-sets li[data-id="${x.id}"] button.edit`])

  return (
    <>
      <div className="row">
        <h1 tabIndex={-1}>{t('tires')}</h1>
        {sets && form.mode === 'view' && (
          <button className="add" ref={form.opener('new')} onClick={() => form.open('new')}>{t('newTireSet')}</button>
        )}
      </div>
      {error != null && (
        <div className="row">
          <p className="error" role="alert">{errorMessage(error)}</p>
          {/* aria-disabled, so Retry keeps focus while it retries; a success focuses the h1. */}
          <button aria-disabled={retrying} onClick={() => {
            if (retrying) return
            setRetrying(true)
            load(['main h1'])
          }}>{t('retry')}</button>
        </div>
      )}
      {form.mode === 'new' && (
        <section className="card" aria-labelledby="new-tire-set">
          <h2 id="new-tire-set">{t('newTireSet')}</h2>
          <TireSetForm row={form} onSaved={(x) => { form.close(); saved(x) }} />
        </section>
      )}
      {!sets ? (
        error == null && <div className="card"><p className="muted" role="status">{t('loading')}</p></div>
      ) : sets.length === 0 ? (
        form.mode === 'view' && <div className="card"><p className="muted">{t('noTireSets')}</p></div>
      ) : (
        <ul className="card tasks tire-sets">
          {sets.map((x, i) => (
            <TireSetRow key={x.id} set={x} onSaved={saved} onDeleted={() => {
              // The row that takes this one's place, then the first row, then New set, then the h1 (the New form open).
              focusNext.current = [`.tire-sets > li:nth-child(${i + 1}) button.edit`, '.tire-sets > li button.edit', 'main button.add', 'main h1']
              setSets((xs) => xs && xs.filter((y) => y.id !== x.id))
            }} />
          ))}
        </ul>
      )}
    </>
  )
}

function TireSetRow({ set: x, onSaved, onDeleted }: { set: TireSet; onSaved: (x: TireSet) => void; onDeleted: () => void }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const d = useDistance()
  // After Save or Delete the page refocuses (close()); Cancel and Escape go back to the opener.
  const row = useRow<'edit' | 'delete'>()
  const { mode, open, close, busy, error, run, opener } = row
  const [historyOpen, setHistoryOpen] = useState(false)
  const url = `/tire-sets/${encodeURIComponent(x.id)}`
  const name = tireName(x)
  const m = x.openMount

  if (mode === 'edit') {
    return (
      <li data-id={x.id}>
        <h2><Trans i18nKey="editHeading" values={{ name }} components={{ n: <bdi /> }} /></h2>
        {/* Deleted elsewhere: the form closes and the row goes, as after a Delete. */}
        <TireSetForm row={row} set={x} onSaved={(s) => { close(); onSaved(s) }} onGone={() => { close(); onDeleted() }} />
      </li>
    )
  }
  return (
    <li data-id={x.id}>
      <div className="task-head">
        <span className="name" dir="auto">{name}</span>
        <span className="badge">{t(`seasons.${x.season}`)}</span>
      </div>
      {(x.size || x.purchaseDate || x.dotCode) && (
        <p className="muted facts">
          {x.size && <span>{t('tireSize')}: <span dir="auto">{x.size}</span></span>}
          {x.purchaseDate && <span>{t('bought')}: <time dateTime={x.purchaseDate}>{fmtDate(x.purchaseDate, lng)}</time></span>}
          {x.dotCode && <span>{t('dotCode')}: <span dir="auto">{x.dotCode}</span></span>}
        </p>
      )}
      <p>
        {m ? (
          <Trans i18nKey="onCarSince" values={{ car: m.vehicleNickname, date: fmtDate(m.mountedAt, lng) }}
            components={{ c: <span dir="auto" />, d: <time dateTime={m.mountedAt} /> }} />
        ) : t('inStorage')}
      </p>
      <p><Trans i18nKey="kmDriven" values={{ value: d.fmt(x.kmDriven), ...d.vars }} components={{ n: <bdi /> }} /></p>
      {x.notes && <p className="notes muted" dir="auto">{x.notes}</p>}

      {mode === 'view' && (
        <div className="actions">
          <button className="link edit" aria-label={t('editTask', { name })} ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>
          <button className="link" aria-label={t('deleteTask', { name })} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteTireSet')}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={(e) => run(async () => {
              // Already deleted elsewhere: it is gone either way.
              await api(url, 'DELETE').catch((err) => { if (!(err instanceof ApiError && err.problem.code === 'tireSet.notFound')) throw err })
              close()
              onDeleted()
            }, e.currentTarget)}>{t('delete')}</button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
      {x.mountCount > 0 && (
        <details onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
          <summary>{t('runHistory', { n: x.mountCount })}</summary>
          {/* Loaded when opened, and again after the set changes. */}
          {historyOpen && <MountHistory key={`${x.mountCount}-${x.kmDriven}`} url={`${url}/mounts`} />}
        </details>
      )}
    </li>
  )
}

// A set's mounts, newest first: the car, from and to, and the km.
function MountHistory({ url }: { url: string }) {
  const { t } = useTranslation()
  const [mounts, setMounts] = useState<TireMount[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    api<TireMount[]>(url).then((xs) => live && (setMounts(xs), setError(null)), (err) => live && setError(err))
    return () => { live = false }
  }, [url, tries])

  if (error != null) {
    return (
      <div className="row">
        <p className="error" role="alert">{errorMessage(error)}</p>
        <button onClick={() => { setError(null); setTries((n) => n + 1) }}>{t('retry')}</button>
      </div>
    )
  }
  if (!mounts) return <p className="muted" role="status">{t('loading')}</p>
  return (
    <ul className="tasks mounts">
      {mounts.map((m) => <li key={m.id}><MountInfo m={m} title={m.vehicleNickname} /></li>)}
    </ul>
  )
}

// New set (no `set`) or edit one. Cancel and Escape discard.
function TireSetForm({ row, set, onSaved, onGone }: {
  row: { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
  set?: TireSet
  onSaved: (x: TireSet) => void
  onGone?: () => void
}) {
  const { t } = useTranslation()
  const { busy, error, run, open } = row
  const { errorId, bad, tie } = useItemErrors(noItems, error, fieldOf)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (k: string) => String(f.get(k)).trim() || null
    const body = { brand: f.get('brand'), model: text('model'), size: text('size'), season: f.get('season'), purchaseDate: text('purchaseDate'), dotCode: text('dotCode'), notes: text('notes') }
    await run(async () => {
      try {
        onSaved(await api<TireSet>(set ? `/tire-sets/${encodeURIComponent(set.id)}` : '/tire-sets', set ? 'PUT' : 'POST', body))
      } catch (err) {
        if (!(onGone && err instanceof ApiError && err.problem.code === 'tireSet.notFound')) throw err
        onGone()
      }
    }, (e.nativeEvent as SubmitEvent).submitter)
  }

  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error)}</p>
  const at = bad ?? 'end'
  // The browser's checks, with the translated message, before any request; the server's own checks stay.
  const brandMsg = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.valueMissing ? t('errors.tireSet.invalidBrand') : '')
  const future = (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(e.currentTarget.validity.rangeOverflow ? t('errors.tireSet.futureDate') : '')
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
      <label>
        {t('brand')}
        <input name="brand" dir="auto" maxLength={50} required defaultValue={set?.brand ?? ''} autoFocus onInvalid={brandMsg} onInput={brandMsg} {...tie('brand')} />
      </label>
      {at === 'brand' && alert}
      {field('model', t('model'), 50, set?.model)}
      {field('size', t('tireSize'), 30, set?.size)}
      <label>
        {t('season')}
        <select name="season" defaultValue={set?.season ?? 'Summer'} {...tie('season')}>
          {seasons.map((s) => <option key={s} value={s}>{t(`seasons.${s}`)}</option>)}
        </select>
      </label>
      {at === 'season' && alert}
      <label>
        {t('purchaseDate')}
        <input name="purchaseDate" type="date" max={localToday()} defaultValue={set?.purchaseDate ?? ''} onInput={future} {...tie('purchaseDate')} />
      </label>
      {at === 'purchaseDate' && alert}
      {field('dotCode', t('dotCode'), 20, set?.dotCode)}
      <label className="wide">
        {t('storageNotes')}
        <textarea name="notes" dir="auto" maxLength={1000} rows={2} defaultValue={set?.notes ?? ''} {...tie('notes')} />
      </label>
      {at === 'notes' && alert}
      {at === 'end' && alert}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}
