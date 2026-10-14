import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Route changes before any user input are the first load (including its redirects); those keep the browser's default focus.
// 'click' covers screen readers in browse mode, which activate links with a synthetic click and no pointer or key event.
let userActed = false
for (const type of ['pointerdown', 'keydown', 'click']) addEventListener(type, () => (userActed = true), { once: true, capture: true })

// Sets `<title> · OnlyCars` and, after a client-side navigation, moves focus to the page's h1 so screen readers announce it.
// Pass undefined while the page is still loading; the h1 is focused once it renders.
export function usePage(title: string | undefined) {
  const { key } = useLocation()
  const ready = title != null

  useEffect(() => {
    if (ready) document.title = `${title} · OnlyCars`
  }, [ready, title])

  useEffect(() => {
    if (ready && userActed) document.querySelector<HTMLElement>('main h1')?.focus()
  }, [key, ready])
}
