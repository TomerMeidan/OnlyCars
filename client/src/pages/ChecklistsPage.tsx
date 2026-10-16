import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api, ApiError, checklistItemTypes, limit, type ChecklistItemType, type ChecklistTemplate } from '../api'
import { errorMessage } from '../i18n'
import { useItemErrors } from '../useItemErrors'
import { usePage } from '../usePage'
import { useRow } from '../useRow'

const MAX_ITEMS = 50

// The form field each API error is about; item errors also by their row's index.
const fieldOf: Record<string, string> = {
  'checklistTemplate.invalidName': 'name',
  'checklistItem.invalidLabel': 'label',
  'checklistItem.invalidType': 'type',
  'checklistItem.numberOnly': 'type',
  'checklistItem.invalidUnit': 'unit',
  'checklistItem.invalidRange': 'range',
}

// An item row as typed, keyed by a local counter (a new row has no id yet).
type Item = { key: number; id: string | null; label: string; type: ChecklistItemType; unit: string; min: string; max: string }
let nextKey = 0
const num = (s: string) => (s === '' ? null : Number(s))

// Name ignoring case (the database's CI collation), then creation time for equal names (a stable sort keeps the list's order), as the API lists them.
// shortcut: a template renamed to an existing name sorts by its old place, not its creation time, and the collation can differ from the browser's on rare characters; send createdAt if that is ever reported.
const byName = (lng: string | undefined) => (a: ChecklistTemplate, b: ChecklistTemplate) => a.name.localeCompare(b.name, lng, { sensitivity: 'accent' })

// /checklists: the user's checklist templates, with an inline form to create one and one per row to edit it.
export default function ChecklistsPage() {
  const { t, i18n } = useTranslation()
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  const form = useRow<'new'>()
  // Selectors to focus after the next list change, the first that matches.
  const focusNext = useRef<string[] | null>(null)
  usePage(t('checklists'))

  const load = () => api<ChecklistTemplate[]>('/checklist-templates')
    .then((ts) => { setTemplates(ts); setError(null) }, (err) => { focusNext.current = null; setError(err) })
    .finally(() => setRetrying(false))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sels = focusNext.current
    focusNext.current = null
    sels?.map((s) => document.querySelector<HTMLElement>(s)).find(Boolean)?.focus()
  }, [templates])

  const saved = (tp: ChecklistTemplate) => {
    focusNext.current = [`.checklists li[data-id="${tp.id}"] button.edit`]
    setTemplates((ts) => {
      const list = ts ?? []
      return (list.some((x) => x.id === tp.id) ? list.map((x) => (x.id === tp.id ? tp : x)) : [...list, tp]).sort(byName(i18n.resolvedLanguage))
    })
  }

  return (
    <>
      <div className="row">
        <h1 tabIndex={-1}>{t('checklists')}</h1>
        {templates && form.mode === 'view' && (
          <button className="add" ref={form.opener('new')} onClick={() => form.open('new')}>{t('newChecklist')}</button>
        )}
      </div>
      {error != null && (
        <div className="row">
          <p className="error" role="alert">{errorMessage(error)}</p>
          {/* aria-disabled, so Retry keeps focus while it retries; a success focuses the h1. */}
          <button aria-disabled={retrying} onClick={() => {
            if (retrying) return
            setRetrying(true)
            focusNext.current = ['main h1']
            load()
          }}>{t('retry')}</button>
        </div>
      )}
      {form.mode === 'new' && (
        <section className="card" aria-labelledby="new-checklist">
          <h2 id="new-checklist">{t('newChecklist')}</h2>
          <TemplateForm row={form} onSaved={(tp) => { form.close(); saved(tp) }} />
        </section>
      )}
      {!templates ? (
        error == null && <div className="card"><p className="muted" role="status">{t('loading')}</p></div>
      ) : templates.length === 0 ? (
        form.mode === 'view' && <div className="card"><p className="muted">{t('noChecklists')}</p></div>
      ) : (
        <ul className="card tasks checklists">
          {templates.map((tp, i) => (
            <TemplateRow key={tp.id} template={tp} onSaved={saved} onDeleted={() => {
              // The row that takes this one's place, then the first row, then New checklist, then the h1 (the New form open).
              focusNext.current = [`.checklists > li:nth-child(${i + 1}) button.edit`, '.checklists > li button.edit', 'main button.add', 'main h1']
              setTemplates((ts) => ts && ts.filter((x) => x.id !== tp.id))
            }} />
          ))}
        </ul>
      )}
    </>
  )
}

function TemplateRow({ template: tp, onSaved, onDeleted }: { template: ChecklistTemplate; onSaved: (tp: ChecklistTemplate) => void; onDeleted: () => void }) {
  const { t } = useTranslation()
  // After Save or Delete the page refocuses (close()); Cancel and Escape go back to the opener.
  const row = useRow<'edit' | 'delete'>()
  const { mode, open, close, busy, error, run, opener } = row
  const url = `/checklist-templates/${encodeURIComponent(tp.id)}`
  const name = tp.name

  if (mode === 'edit') {
    return (
      <li data-id={tp.id}>
        <h2><Trans i18nKey="editHeading" values={{ name }} components={{ n: <bdi /> }} /></h2>
        {/* Deleted elsewhere: the form closes and the row goes, as after a Delete. */}
        <TemplateForm row={row} template={tp} onSaved={(saved) => { close(); onSaved(saved) }} onGone={() => { close(); onDeleted() }} />
      </li>
    )
  }
  return (
    <li data-id={tp.id}>
      <div className="task-head">
        <span className="name" dir="auto">{name}</span>
        <span className="muted">{t('itemCount', { count: tp.itemCount })}</span>
      </div>
      {mode === 'view' && (
        <div className="actions">
          <button className="link edit" aria-label={t('editTask', { name })} ref={opener('edit')} onClick={() => open('edit')}>{t('edit')}</button>
          <button className="link" aria-label={t('deleteTask', { name })} ref={opener('delete')} onClick={() => open('delete')}>{t('delete')}</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="inline-form" onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
          <p>{t('confirmDeleteChecklist')}</p>
          {error != null && <p className="error" role="alert">{errorMessage(error)}</p>}
          <div className="actions">
            <button className="danger" disabled={busy} onClick={(e) => run(async () => {
              // Already deleted elsewhere: it is gone either way.
              await api(url, 'DELETE').catch((err) => { if (!(err instanceof ApiError && err.problem.code === 'checklistTemplate.notFound')) throw err })
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

// New checklist (no template) or edit one. Save sends the whole item list; Cancel and Escape discard.
function TemplateForm({ row, template, onSaved, onGone }: {
  row: { busy: boolean; error: unknown; run: ReturnType<typeof useRow>['run']; open: (m: 'view') => void }
  template?: ChecklistTemplate
  onSaved: (tp: ChecklistTemplate) => void
  onGone?: () => void
}) {
  const { t } = useTranslation()
  const { busy, error, run, open } = row
  const [items, setItems] = useState<Item[]>(() => template?.items.map((i) => ({
    key: nextKey++, id: i.id, label: i.label, type: i.type, unit: i.unit ?? '', min: i.minValue == null ? '' : String(i.minValue), max: i.maxValue == null ? '' : String(i.maxValue),
  })) ?? [])
  const { formRef, errorId, bad, itemKey, n, focus, failed, tie } = useItemErrors(items, error, fieldOf)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const body = {
      name: new FormData(e.currentTarget).get('name'),
      // Unit, min and max go only with a Number item; the API rejects them on the others.
      items: items.map((i) => ({ id: i.id, label: i.label, type: i.type, ...(i.type === 'Number' && { unit: i.unit, minValue: num(i.min), maxValue: num(i.max) }) })),
    }
    const url = template ? `/checklist-templates/${encodeURIComponent(template.id)}` : '/checklist-templates'
    const err = await run(async () => {
      try {
        onSaved(await api<ChecklistTemplate>(url, template ? 'PUT' : 'POST', body))
      } catch (err) {
        if (!(onGone && err instanceof ApiError && err.problem.code === 'checklistTemplate.notFound')) throw err
        onGone()
      }
    }, (e.nativeEvent as SubmitEvent).submitter)
    if (err) failed(err)
  }

  const alert = error != null && <p className="error" role="alert" id={errorId}>{errorMessage(error, n)}</p>
  const errorAt = itemKey ?? (bad === 'name' ? 'name' : 'end')

  const setItem = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const rowSel = (i: number) => `.item:nth-of-type(${i + 1})`
  const add = () => {
    focus(`${rowSel(items.length)} input`)
    setItems([...items, { key: nextKey++, id: null, label: '', type: 'Check', unit: '', min: '', max: '' }])
  }
  // Focus goes to the next row, then the previous one, then Add item.
  const remove = (i: number) => {
    focus(items.length === 1 ? 'button.add-item' : `${rowSel(i < items.length - 1 ? i : i - 1)} input`)
    setItems(items.filter((_, j) => j !== i))
  }
  // Focus follows the moved row: the same button, or the other one once it reaches the end.
  const move = (i: number, by: -1 | 1) => {
    const to = i + by
    const atEnd = to === 0 || to === items.length - 1
    focus(`${rowSel(to)} button.${(by < 0) !== atEnd ? 'up' : 'down'}`)
    const xs = [...items]
    ;[xs[i], xs[to]] = [xs[to], xs[i]]
    setItems(xs)
  }
  // The browser's check, with the translated message, before any request.
  const need = (message: string) => ({
    required: true,
    onInvalid: (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(message),
    onInput: (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(''),
  })

  return (
    <form className="inline-form" ref={formRef} onSubmit={submit} onKeyDown={(e) => !busy && e.key === 'Escape' && open('view')}>
      <label className="wide">
        {t('taskName')}
        <input name="name" dir="auto" maxLength={100} defaultValue={template?.name ?? ''} autoFocus {...need(t('errors.checklistTemplate.invalidName'))} {...tie('name')} />
      </label>
      {errorAt === 'name' && alert}

      <div className="items" role="group" aria-label={t('checklistItems')}>
        {items.map((it, i) => {
          const n = i + 1
          const named = (field: string) => ({ 'aria-label': t('itemField', { n, field }) })
          const range = limit(t('errors.checklistItem.invalidRange', { n }))
          return (
            <fieldset className="item" key={it.key}>
              <legend>{t('item', { n })}</legend>
              <label className="wide">
                {t('taskName')}
                <input dir="auto" maxLength={100} value={it.label} onChange={(e) => setItem(i, { label: e.target.value })}
                  {...need(t('errors.checklistItem.invalidLabel', { n }))} {...named(t('taskName'))} {...tie('label', undefined, it.key)} />
              </label>
              <label className="wide">
                {t('itemType')}
                {/* Leaving Number clears its unit, min and max. */}
                <select value={it.type} onChange={(e) => setItem(i, { type: e.target.value as ChecklistItemType, ...(e.target.value !== 'Number' && { unit: '', min: '', max: '' }) })}
                  {...named(t('itemType'))} {...tie('type', undefined, it.key)}>
                  {checklistItemTypes.map((x) => <option key={x} value={x}>{t(`itemTypes.${x}`)}</option>)}
                </select>
              </label>
              {it.type === 'Number' && (
                <>
                  <label className="num">
                    {t('unit')}
                    <input dir="auto" maxLength={20} value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} {...named(t('unit'))} {...tie('unit', undefined, it.key)} />
                  </label>
                  {/* No inputMode: the decimal keypad has no minus sign on some phones. dir="ltr" keeps the minus before the number in Hebrew. */}
                  <label className="num">
                    {t('minValue')}
                    {/* onInvalid too: the message names the item's number now, not the one it had when typed. */}
                    <input type="number" dir="ltr" min={-1_000_000} max={1_000_000} step={0.01} value={it.min} onInput={range} onInvalid={range}
                      onChange={(e) => setItem(i, { min: e.target.value })} {...named(t('minValue'))} {...tie('range', undefined, it.key)} />
                  </label>
                  <label className="num">
                    {t('maxValue')}
                    <input type="number" dir="ltr" min={-1_000_000} max={1_000_000} step={0.01} value={it.max} onInput={range} onInvalid={range}
                      onChange={(e) => setItem(i, { max: e.target.value })} {...named(t('maxValue'))} {...tie('range', undefined, it.key)} />
                  </label>
                </>
              )}
              <div className="actions">
                <button type="button" className="move up" aria-label={t('moveUp', { n })} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="move down" aria-label={t('moveDown', { n })} disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="link" aria-label={t('removeItem', { n })} disabled={busy} onClick={() => remove(i)}>{t('remove')}</button>
              </div>
              {errorAt === it.key && alert}
            </fieldset>
          )
        })}
        <div className="actions">
          <button type="button" className="link add-item" disabled={busy || items.length >= MAX_ITEMS} onClick={add}>{t('addItem')}</button>
        </div>
      </div>

      {errorAt === 'end' && alert}
      <div className="actions">
        <button disabled={busy}>{t('save')}</button>
        <button type="button" className="link" disabled={busy} onClick={() => open('view')}>{t('cancel')}</button>
      </div>
    </form>
  )
}
