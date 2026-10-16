// Focuses an element, first opening the "Done (n)" toggle around it.
export const focusIn = (el: HTMLElement | null | undefined) => {
  el?.closest('details')?.setAttribute('open', '')
  el?.focus()
}

// From the run history's "To-do created": focuses that to-do's Edit (its h2 on an archived car). False if it isn't on the page.
export function focusIssue(id: string) {
  const li = document.querySelector<HTMLElement>(`section[aria-labelledby=todos] li[data-id="${id}"]`)
  if (li) focusIn(li.querySelector<HTMLElement>('button.edit') ?? document.querySelector<HTMLElement>('#todos'))
  return li != null
}
