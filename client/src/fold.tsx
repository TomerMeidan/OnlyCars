import { useEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

// The car page's collapsible sections (owner, 2026-11-02): open or closed per section, not per car, remembered in localStorage.
const expanders = new Map<string, () => void>()

// `id` is the section's h2 id; the section takes `section`'s props and its h2 is `heading(label)`.
export function useFold(id: string) {
  const key = `collapsed:${id}`
  const [collapsed, set] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  const setCollapsed = (c: boolean) => {
    set(c)
    try { if (c) localStorage.setItem(key, '1'); else localStorage.removeItem(key) } catch { /* storage blocked: not remembered */ }
  }
  useEffect(() => {
    expanders.set(id, () => setCollapsed(false))
    return () => { expanders.delete(id) }
  })
  return {
    collapsed,
    setCollapsed,
    section: { id: `${id}-section`, className: collapsed ? 'card collapsed' : 'card' },
    // The h2 stays the section's name and focus fallback; the button inside it toggles. `summary` shows only while closed.
    heading: (label: string, summary?: ReactNode) => (
      <>
        <h2 id={id} tabIndex={-1}>
          <button type="button" className="fold" aria-expanded={!collapsed} aria-controls={`${id}-section`} onClick={() => setCollapsed(!collapsed)}>
            {label}
          </button>
        </h2>
        {collapsed && summary && <span className="muted fold-summary">{summary}</span>}
      </>
    ),
  }
}

// Opens the closed section around `el` at once, so focusing `el` next works (from an event handler, not a render).
export function unfold(el: Element | null | undefined) {
  const id = el?.closest('section.collapsed')?.getAttribute('aria-labelledby')
  const expand = id && expanders.get(id)
  if (expand) flushSync(expand)
}
