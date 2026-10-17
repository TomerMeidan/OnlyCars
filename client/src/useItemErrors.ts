import { useEffect, useId, useRef, useState, type Key } from 'react'
import { ApiError } from './api'

// The items of a form without item rows: one stable empty array, so the focus effect doesn't rerun on each render.
export const noItems: never[] = []

// Forms with item rows (service items, checklist items, run items), L43: which field and row an API error is about, and focus after rows change.
// `fieldOf` maps an error code to the field it is about; item errors also carry the row's index in the request.
// The error stays on its row by key while other rows move or go, and names the row by where it is now (`n`).
export function useItemErrors<T extends { key: Key }>(items: T[], error: unknown, fieldOf: Record<string, string>) {
  const errorId = `${useId()}error`
  const [errKey, setErrKey] = useState<Key>()
  const formRef = useRef<HTMLFormElement>(null)
  // A selector inside the form to focus after the next items change.
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    const sel = focusNext.current
    focusNext.current = null
    if (sel) formRef.current?.querySelector<HTMLElement>(sel)?.focus()
  }, [items])

  const problem = error instanceof ApiError ? error.problem : undefined
  const bad = fieldOf[problem?.code ?? '']
  // The row the error is about; undefined for a form-level error or once its row is gone.
  const itemKey = problem?.index == null ? undefined : errKey
  const row = items.findIndex((x) => x.key === errKey)
  return {
    formRef,
    errorId,
    bad,
    itemKey,
    n: row < 0 ? undefined : row + 1,
    focus: (selector: string) => { focusNext.current = selector },
    // Call with a failed request's error, before the rows can change.
    failed: (err: unknown) => setErrKey(err instanceof ApiError && err.problem.index != null ? items[err.problem.index]?.key : undefined),
    // aria-describedby for a field: its hint, and the error when it is about this field (and this row, for item fields).
    tie: (name: string, hint?: string, key?: Key) => {
      const hit = bad === name && key === itemKey
      const ids = [hint, hit && errorId].filter(Boolean).join(' ')
      return { 'aria-invalid': hit || undefined, 'aria-describedby': ids || undefined }
    },
  }
}
