import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api, ApiError, localToday, type Issue, type Vehicle } from '../api'
import { errorMessage, fmtDate } from '../i18n'
import { useRow } from '../useRow'

type IssueBody = { title: string; description: string }

// Focuses an element, first opening the "Done (n)" toggle around it.
const focusIn = (el: HTMLElement | null | undefined) => {
  el?.closest('details')?.setAttribute('open', '')
  el?.focus()
}

// From the run history's "To-do created": focuses that to-do's Edit (its h2 on an archived car). False if it isn't on the page.
export function focusIssue(id: string) {
  const li = document.querySelector<HTMLElement>(`section[aria-labelledby=todos] li[data-id="${id}"]`)
  if (li) focusIn(li.querySelector<HTMLElement>('button.edit') ?? document.querySelector<HTMLElement>('#todos'))
  return li != null
}

// Title and description, for Add a to-do, Edit, and Create to-do in the run history.
export function IssueForm({ row, initial, onSubmit }: {
  row: { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
  initial?: IssueBody
  onSubmit: (body: IssueBody) => Promise<void>
}) {
  const { t } = useTranslation()
  const { busy, error, run, open } = row

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    await run(() => onSubmit({ title: String(f.get('title')), description: String(f.get('description')) }), (e.nativeEvent as SubmitEvent).submitter)
  }

  return (
    <form className="inline-form" onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label className="wide">
        {t('issueTitle')}
        <input name="title" required maxLength={100} dir="auto" defaultValue={initial?.title} autoFocus />
      </label>
      <label className="wide">
        {t('description')}
        <textarea name="description" maxLength={1000} rows={2} dir="auto" defaultValue={initial?.description} />
      </label>
      {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}

// The car page's To-dos, after Maintenance: open ones, then the done ones under a collapsed "Done (n)". It loads on its own.
// `version` is bumped by the run history after it creates a to-do.
export function IssuesSection({ car, version }: { car: Vehicle; version: number }) {
  const { t } = useTranslation()
  const [list, setList] = useState<Issue[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const [reloads, setReloads] = useState(0)
  // After Done, Reopen, or a to-do that was deleted elsewhere.
  const [note, setNote] = useState<string | null>(null)
  const form = useRow<'add'>()
  const sectionRef = useRef<HTMLElement>(null)
  // Selectors to focus after the next load, the first that matches; the h2 if none does.
  const focusNext = useRef<string[] | null>(null)
  const path = `/vehicles/${encodeURIComponent(car.id)}/issues`
  const readOnly = car.isArchived

  // Reloads with the car too: deleting a run (which reloads the car) clears its to-dos' source. Old rows stay up meanwhile.
  useEffect(() => {
    let live = true
    api<Issue[]>(path).then(
      (xs) => live && (setList(xs), setError(null)),
      (err) => live && ((focusNext.current = null), setError(err)),
    ).finally(() => live && setRetrying(false))
    return () => { live = false }
  }, [path, car, version, reloads])

  useEffect(() => {
    const sels = focusNext.current
    const section = sectionRef.current
    if (!sels || !section || !list) return
    focusNext.current = null
    focusIn(sels.map((s) => section.querySelector<HTMLElement>(s)).find(Boolean) ?? section.querySelector<HTMLElement>('h2'))
  }, [list])

  const reload = (focus: string[], message: string | null = null) => {
    focusNext.current = focus
    setNote(message)
    setReloads((n) => n + 1)
  }
  const open = list?.filter((x) => x.status === 'Open') ?? []
  const done = list?.filter((x) => x.status === 'Done') ?? []
  const rows = (xs: Issue[], cls: string) => (
    <ul className={`tasks issues ${cls}`}>
      {xs.map((x, i) => (
        <IssueRow
          key={x.id}
          issue={x}
          readOnly={readOnly}
          onSaved={(focus, message) => reload([`li[data-id="${x.id}"] ${focus}`], message)}
          // The row that takes this one's place, then the first, then Add a to-do (decisions.md, MVP1-C).
          onDeleted={() => reload([`.${cls} > li:nth-child(${i + 1}) button.edit`, '.issues > li button.edit', 'button.add'])}
          onGone={() => reload(['button.add'], t('issueGone'))}
        />
      ))}
    </ul>
  )

  return (
    <section className="card" aria-labelledby="todos" ref={sectionRef}>
      <div className="row">
        <h2 id="todos" tabIndex={-1}>{t('todos')}</h2>
        {!readOnly && list && form.mode === 'view' && (
          <button className="add" ref={form.opener('add')} onClick={() => form.open('add')}>{t('addIssue')}</button>
        )}
      </div>
      {note && <p role="status">{note}</p>}

      {form.mode === 'add' && (
        <IssueForm row={form} onSubmit={async (body) => {
          const x = await api<Issue>(path, 'POST', body)
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
      ) : (
        <>
          {open.length === 0 ? form.mode === 'view' && <p className="muted">{t('noOpenIssues')}</p> : rows(open, 'open-issues')}
          {done.length > 0 && (
            <details>
              <summary>{t('doneIssues', { n: done.length })}</summary>
              {rows(done, 'done-issues')}
            </details>
          )}
        </>
      )}
    </section>
  )
}

function IssueRow({ issue: x, readOnly, onSaved, onDeleted, onGone }: {
  issue: Issue
  readOnly: boolean
  onSaved: (focus: string, message?: string) => void
  onDeleted: () => void
  onGone: () => void
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  // After Save, Done, Reopen or Delete the section refocuses (close()); Cancel and Escape go back to the opener.
  const row = useRow<'edit' | 'delete'>()
  const { mode, open, close, busy, error, run, opener } = row
  const url = `/issues/${encodeURIComponent(x.id)}`
  const title = x.title

  // PUT replaces everything, so every save sends title and description, and a done to-do its date again.
  const put = (body: Partial<Issue>) =>
    api<Issue>(url, 'PUT', { title: x.title, description: x.description, status: x.status, resolvedAt: x.resolvedAt, ...body })
  // Deleted elsewhere (another tab): the list reloads with a note instead of an error.
  const gone = async (request: () => Promise<void>) => {
    try {
      await request()
    } catch (err) {
      if (!(err instanceof ApiError && err.problem.code === 'issue.notFound')) throw err
      close()
      onGone()
    }
  }
  const act = (request: () => Promise<void>, from: HTMLElement) => run(() => gone(request), from)
  const errorText = error != null && <p className="error" role="alert">{errorMessage(error)}</p>

  return (
    <li data-id={x.id}>
      <span className="name" dir="auto">{title}</span>
      {x.description && <p className="notes" dir="auto">{x.description}</p>}
      {x.source && <p className="muted">{t('issueFrom', { name: x.source.checklistName, date: fmtDate(x.source.runAt, lng) })}</p>}
      {x.resolvedAt && (
        <p className="muted"><Trans i18nKey="doneOn" values={{ date: fmtDate(x.resolvedAt, lng) }} components={{ d: <time dateTime={x.resolvedAt} /> }} /></p>
      )}

      {!readOnly && mode === 'view' && (
        <div className="actions">
          {x.status === 'Open' ? (
            <button className="done" aria-label={t('markIssueDoneOf', { title })} disabled={busy} onClick={(e) => act(async () => {
              await put({ status: 'Done', resolvedAt: localToday() })
              onSaved('button.reopen', t('issueMarkedDone', { title }))
            }, e.currentTarget)}>{t('markIssueDone')}</button>
          ) : (
            <button className="link reopen" aria-label={t('reopenOf', { title })} disabled={busy} onClick={(e) => act(async () => {
              await put({ status: 'Open', resolvedAt: null })
              onSaved('button.done', t('issueReopened', { title }))
            }, e.currentTarget)}>{t('reopen')}</button>
          )}
          <button className="link edit" aria-label={t('editTask', { name: title })} ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>
          <button className="link" aria-label={t('deleteTask', { name: title })} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'view' && errorText}

      {mode === 'edit' && (
        <IssueForm row={row} initial={{ title, description: x.description ?? '' }} onSubmit={(body) => gone(async () => {
          await put(body)
          close()
          onSaved('button.edit')
        })} />
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteIssue')}</p>
          {errorText}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={(e) => act(async () => {
              await api(url, 'DELETE')
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
