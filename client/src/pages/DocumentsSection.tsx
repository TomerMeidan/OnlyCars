import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api, ApiError, documentTypes, limit, localToday, type VehicleDocument, type Vehicle } from '../api'
import { useAuth } from '../auth'
import { errorMessage, fmtDate, money } from '../i18n'
import { useFold } from '../fold'
import { useRow } from '../useRow'

// "Expired 3 days ago", "Expires today", "Expires in 10 days"; nothing when Ok (the expiry date says it). Colored by a status-* class on an ancestor.
export function DocStatus({ status, daysLeft }: { status: string; daysLeft: number }) {
  if (status === 'Ok') return null
  const text = daysLeft < 0 ? <Trans i18nKey="expired" count={-daysLeft} components={{ n: <bdi /> }} />
    : daysLeft === 0 ? <Trans i18nKey="expiresToday" />
    : <Trans i18nKey="expiresIn" count={daysLeft} components={{ n: <bdi /> }} />
  return <span className="badge status">{text}</span>
}

export function ExpiresOn({ date }: { date: string }) {
  const { i18n } = useTranslation()
  return <Trans i18nKey="expiresOn" values={{ date: fmtDate(date, i18n.resolvedLanguage) }} components={{ d: <time dateTime={date} /> }} />
}

type DocBody = Pick<VehicleDocument, 'type' | 'expiryDate' | 'cost' | 'notes'>
// The form field a server error is about, so editing that field clears the error.
const fieldOf: Record<string, string> = {
  'vehicleDocument.invalidType': 'type', 'vehicleDocument.invalidExpiryDate': 'expiryDate', 'date.tooEarly': 'expiryDate', 'date.tooLate': 'expiryDate',
  'vehicleDocument.invalidCost': 'cost', 'vehicleDocument.invalidNotes': 'notes',
}

function DocumentForm({ row, initial, onSubmit }: {
  row: { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
  initial?: DocBody
  onSubmit: (body: DocBody) => Promise<void>
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { busy, error, run, open } = row
  const [cleared, setCleared] = useState<unknown>(null)
  const field = error instanceof ApiError ? fieldOf[error.problem.code ?? ''] : undefined

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const cost = f.get('cost')
    const body = { type: f.get('type'), expiryDate: f.get('expiryDate'), cost: cost ? Number(cost) : null, notes: f.get('notes') } as DocBody
    await run(() => onSubmit(body), (e.nativeEvent as SubmitEvent).submitter)
  }

  return (
    <form className="inline-form" onSubmit={submit} onChange={(e) => field && (e.target as Element).getAttribute('name') === field && setCleared(error)} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label>
        {t('documentType')}
        <select name="type" defaultValue={initial?.type} autoFocus>
          {documentTypes.map((x) => <option key={x} value={x}>{t(`docType.${x}`)}</option>)}
        </select>
      </label>
      <label>
        {t('expiryDate')}
        <input name="expiryDate" type="date" required defaultValue={initial?.expiryDate} />
      </label>
      <label>
        {t('cost', { currency: user?.currency })}
        <input name="cost" type="number" inputMode="decimal" min={0} max={1_000_000} step={0.01} defaultValue={initial?.cost ?? ''} onInput={limit(t('limits.cost'))} />
      </label>
      <label className="wide">
        {t('notes')}
        <textarea name="notes" maxLength={1000} rows={2} dir="auto" defaultValue={initial?.notes ?? ''} />
      </label>
      {error != null && error !== cleared && <p className="error" role="alert">{errorMessage(error)}</p>}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// The car page's Documents, after To-dos: insurance, inspection, registration and licence, by expiry date (the server's order). It loads on its own.
export function DocumentsSection({ car }: { car: Vehicle }) {
  const { t } = useTranslation()
  const [list, setList] = useState<VehicleDocument[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const form = useRow<'add'>()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next load, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/documents`
  const readOnly = car.isArchived

  useEffect(() => {
    let live = true
    api<VehicleDocument[]>(`${path}?today=${localToday()}`).then(
      (xs) => live && (setList(xs), setError(null)),
      (err) => live && ((focusNext.current = null), setError(err)),
    ).finally(() => live && setRetrying(false))
    return () => { live = false }
  }, [path, car, reloads])

  useEffect(() => {
    const sels = focusNext.current
    const section = sectionRef.current
    if (!sels || !section || !list) return
    focusNext.current = null
    ;(sels.map((s) => section.querySelector<HTMLElement>(s)).find(Boolean) ?? section.querySelector<HTMLElement>('h2'))?.focus()
  }, [list])

  const reload = (focus: string[], message: string | null = null) => {
    focusNext.current = focus
    setNote(message)
    setReloads((n) => n + 1)
  }

  const fold = useFold('documents')

  return (
    <section {...fold.section} aria-labelledby="documents" ref={sectionRef}>
      <div className="row">
        {fold.heading(t('documents'))}
        {!readOnly && list && form.mode === 'view' && (
          <button className="add" ref={form.opener('add')} onClick={() => form.open('add')}>{t('addDocument')}</button>
        )}
      </div>
      {note && <p role="status">{note}</p>}

      {form.mode === 'add' && (
        <DocumentForm row={form} onSubmit={async (body) => {
          const x = await api<VehicleDocument>(`${path}?today=${localToday()}`, 'POST', body)
          form.close()
          reload([`li[data-id="${x.id}"] button.edit`])
        }} />
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
        form.mode === 'view' && <p className="muted">{t('noDocuments')}</p>
      ) : (
        <ul className="tasks documents">
          {list.map((x, i) => (
            <DocumentRow
              key={x.id}
              doc={x}
              path={`${path}/${encodeURIComponent(x.id)}`}
              readOnly={readOnly}
              onSaved={() => reload([`li[data-id="${x.id}"] button.edit`])}
              // The row that takes this one's place, then the first, then Add a document (decisions.md, MVP1-C).
              onDeleted={() => reload([`.documents > li:nth-child(${i + 1}) button.edit`, '.documents > li button.edit', 'button.add'])}
              onGone={() => reload(['button.add'], t('documentGone'))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function DocumentRow({ doc: x, path, readOnly, onSaved, onDeleted, onGone }: {
  doc: VehicleDocument
  path: string
  readOnly: boolean
  onSaved: () => void
  onDeleted: () => void
  onGone: () => void
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { user } = useAuth()
  // After Save or Delete the section refocuses (close()); Cancel and Escape go back to the opener.
  const row = useRow<'edit' | 'delete'>()
  const { mode, open, close, busy, error, run, opener } = row
  const name = t(`docType.${x.type}`)
  const label = { name, date: fmtDate(x.expiryDate, lng) }
  // Deleted elsewhere (another tab): the list reloads with a note instead of an error.
  const gone = async (request: () => Promise<void>) => {
    try {
      await request()
    } catch (err) {
      if (!(err instanceof ApiError && err.problem.code === 'vehicleDocument.notFound')) throw err
      close()
      onGone()
    }
  }

  return (
    <li data-id={x.id} className={`status-${x.status}`}>
      <div className="task-head">
        <span className="name">{name}</span>
        <DocStatus status={x.status} daysLeft={x.daysLeft} />
      </div>
      <p><ExpiresOn date={x.expiryDate} />{x.cost != null && <> · <bdi>{money(x.cost, lng, user?.currency)}</bdi></>}</p>
      {x.notes && <p className="notes" dir="auto">{x.notes}</p>}

      {!readOnly && mode === 'view' && (
        <div className="actions">
          <button className="link edit" aria-label={t('editDocumentOf', label)} ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>
          <button className="link" aria-label={t('deleteDocumentOf', label)} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}

      {mode === 'edit' && (
        <DocumentForm row={row} initial={x} onSubmit={(body) => gone(async () => {
          await api(`${path}?today=${localToday()}`, 'PUT', body)
          close()
          onSaved()
        })} />
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteDocument')}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={(e) => run(() => gone(async () => {
              await api(path, 'DELETE')
              close()
              onDeleted()
            }), e.currentTarget)}>{t('delete')}</button>
            <button type="button" className="link" disabled={busy} onClick={() => open('view')} autoFocus>{t('cancel')}</button>
          </div>
        </div>
      )}
    </li>
  )
}
