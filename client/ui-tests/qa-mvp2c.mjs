// QA exploration of MVP2-C (Mark done, Add cost or notes, Undo) beyond smoke.mjs.
// Seeds cars and tasks through the API, then drives the UI in desktop-light-en and mobile-dark-he. Prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/qa-mvp2c.mjs   (ONLY=<setup substring> to run one setup)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })
const ago = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

const browser = await chromium.launch({ channel: 'chrome' })
const api = await (await browser.newContext()).request
const auth = await (await api.post(`${BASE}/api/auth/register`, {
  data: { email: `qa+mvp2c-${Date.now()}@example.com`, password: 'Passw0rd!' },
})).json()
const headers = { Authorization: `Bearer ${auth.token}` }
const call = async (method, url, data) => {
  const x = await api.fetch(`${BASE}/api${url}`, { method, headers, data })
  return { status: x.status(), body: await x.text().then((t) => { try { return JSON.parse(t) } catch { return t } }) }
}
const post = async (url, data) => {
  const x = await call('POST', url, data)
  if (x.status >= 400) throw new Error(`${x.status} ${url} ${JSON.stringify(x.body)}`)
  return x.body
}

async function seed(label) {
  const car = await post('/vehicles', { nickname: `QA reset ${label}`, initialOdometerKm: 50000 })
  const t = (x) => post(`/vehicles/${car.id}/tasks`, { category: 'Other', intervalKm: null, intervalDays: null, ...x })
  const tasks = {
    over: await t({ name: 'Overdue oil', intervalKm: 10000, lastDoneOdometerKm: 39000, lastDoneDate: ago(10) }),
    soon: await t({ name: 'Due soon brakes', intervalKm: 10000, lastDoneOdometerKm: 40500, lastDoneDate: ago(10) }),
    ok: await t({ name: 'OK filter', intervalKm: 10000, lastDoneOdometerKm: 48000, lastDoneDate: ago(10) }),
    months: await t({ name: 'Long months', intervalDays: 7300, lastDoneOdometerKm: 50000, lastDoneDate: ago(0) }),
    del: await t({ name: 'Delete me', intervalKm: 20000, lastDoneOdometerKm: 45000, lastDoneDate: ago(10) }),
    off: await t({ name: 'Disabled one', intervalKm: 10000, lastDoneOdometerKm: 30000, lastDoneDate: ago(10) }),
  }
  await call('PUT', `/vehicles/${car.id}/tasks/${tasks.off.id}`, { ...tasks.off, isEnabled: false })
  const arch = await post('/vehicles', { nickname: `QA archived ${label}`, initialOdometerKm: 10000 })
  await post(`/vehicles/${arch.id}/tasks`, { name: 'Archived task', category: 'Other', intervalKm: 5000, intervalDays: null, lastDoneOdometerKm: 1000, lastDoneDate: ago(5) })
  await call('POST', `/vehicles/${arch.id}/archive`)
  const archived = await call('GET', `/vehicles/${arch.id}`)
  if (!archived.body.isArchived) await call('PUT', `/vehicles/${arch.id}`, { ...archived.body, isArchived: true })
  return { car, tasks, arch }
}

const setups = [
  { name: 'desktop-light-en', lng: 'en', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'mobile-dark-he', lng: 'he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
]
const report = { currency: auth.user?.currency, setups: [] }

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const { car, tasks: T, arch } = await seed(s.name)
  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript(([lng, token, user]) => {
    localStorage.setItem('i18nextLng', lng)
    localStorage.setItem('token', token)
    localStorage.setItem('user', user)
  }, [s.lng, auth.token, JSON.stringify(auth.user)])
  const page = await ctx.newPage()
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.setups.push(r)
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url()}`))
  let resets = 0, voids = 0
  page.on('request', (q) => q.method() === 'POST' && (q.url().endsWith('/reset') ? resets++ : q.url().endsWith('/void') && voids++))

  const sec = page.locator('section[aria-labelledby=maintenance]')
  const row = (id) => sec.locator(`li[data-id="${id}"]`)
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) {
      const p = `${OUT}/qa2c-${s.name}-FAIL-${label}.png`
      await page.screenshot({ path: p, fullPage: true }).catch(() => {})
      r.checks.push({ label, error: e.message.split('\n')[0], shot: p, focus: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 150)).catch(() => null) })
      await page.keyboard.press('Escape').catch(() => {})
    }
  }
  const shot = async (label) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/qa2c-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('main button, main a, main input:not([type=checkbox]), main textarea, main label.inline')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).slice(0, 30)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: small }) }
  }
  const state = (id) => row(id).evaluate((li) => ({
    index: [...li.parentElement.children].indexOf(li),
    cls: li.className,
    text: li.querySelector('.bar + p')?.textContent ?? null,
    last: li.querySelectorAll('p.muted')[1]?.textContent,
    bar: li.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'),
    undoBar: !!li.querySelector('.undo'),
  }))
  const focus = () => page.evaluate(() => {
    const a = document.activeElement
    const cs = getComputedStyle(a)
    return { on: `${a.tagName}.${a.className}|${a.getAttribute('aria-label') ?? a.textContent.slice(0, 30)}|${a.closest('li')?.dataset.id ?? ''}`,
      focusVisible: a.matches(':focus-visible'), ring: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.boxShadow !== 'none' ? 'shadow' : ''}`.trim() }
  })
  const history = () => page.locator('.history > li').evaluateAll((lis) => lis.map((li) => `${li.querySelector('.value').textContent.replace(/\s+/g, ' ')} ${li.querySelector('span.muted').textContent} buttons:${li.querySelectorAll('button').length}`))
  const undoBars = () => sec.locator('.undo').count()
  const waitIdle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(300))
  const markDone = async (id) => { await row(id).locator('button.done').click(); await waitIdle() }
  const undo = async () => { await sec.locator('.undo button').click(); await waitIdle() }

  await page.goto(`${BASE}/cars/${car.id}`)
  await row(T.over.id).waitFor()
  await waitIdle()
  await check('initial', async () => ({ dir: await page.evaluate(() => document.documentElement.dir), ...(await shot('01-initial')) }))

  // "about 243 months left" must stay on one line (nbsp between number and unit word).
  await check('about-months-unbroken', async () => row(T.months.id).evaluate((li) => {
    const p = li.querySelector('.bar + p')
    const range = document.createRange(); range.selectNodeContents(p)
    const tops = new Set([...range.getClientRects()].map((x) => Math.round(x.top)))
    return { text: p.textContent, hasNbsp: p.textContent.includes(' '), lines: tops.size, width: Math.round(p.getBoundingClientRect().width) }
  }))

  // Mark done then Undo on each status.
  for (const [k, label] of [['over', 'overdue'], ['soon', 'duesoon'], ['ok', 'ok']]) {
    await check(`mark-done-${label}`, async () => {
      const before = await state(T[k].id)
      const h0 = await history()
      await markDone(T[k].id)
      const after = await state(T[k].id)
      const f = await focus()
      const h1 = await history()
      const sh = label === 'overdue' ? await shot('02-after-mark-done-overdue') : {}
      await undo()
      const undone = await state(T[k].id)
      const f2 = await focus()
      const h2 = await history()
      const sh2 = label === 'overdue' ? { shotUndo: (await shot('03-after-undo-overdue')).shot } : {}
      return { before, after, focusAfterDone: f, historyAfterDone: h1, undone, focusAfterUndo: f2, historyRestored: JSON.stringify(h0) === JSON.stringify(h2), barsAfterUndo: await undoBars(), ...sh, ...sh2 }
    })
  }

  // Keyboard only: Tab from the heading to Mark done on the Due soon row, Enter, then Enter on Undo.
  await check('keyboard-only', async () => {
    await sec.locator('h2').focus()
    let hops = 0
    while (hops++ < 40) {
      await page.keyboard.press('Tab')
      if (await page.evaluate((id) => document.activeElement.matches(`li[data-id="${id}"] button.done`), T.soon.id)) break
    }
    const onDone = await focus()
    await page.keyboard.press('Enter'); await waitIdle()
    const onUndo = await focus()
    const sh = await shot('04-keyboard-undo-focused')
    await page.keyboard.press('Enter'); await waitIdle()
    const back = await focus()
    const sh2 = await shot('05-keyboard-after-undo')
    // Open the cost form by keyboard and close it with Escape.
    await page.keyboard.press('Tab')
    const onCost = await focus()
    await page.keyboard.press('Enter')
    const inForm = await focus()
    await page.keyboard.press('Escape')
    const afterEsc = await focus()
    return { hops, onDone, onUndo, back, onCost, inForm, afterEsc, ...sh, shot2: sh2.shot }
  })

  // Cost form: messages, accepted edge values, notes limit, layout.
  await check('cost-form', async () => {
    await row(T.ok.id).locator('button.done + button').click()
    const form = row(T.ok.id).locator('form')
    const cost = form.locator('input[name=cost]')
    const label = (await form.locator('label').first().textContent())
    const msgs = {}
    const before = resets
    for (const v of ['-1', '1000000.01', '1.234', '0', '1000000', '0.01', '1e3']) {
      await cost.fill(v)
      msgs[v] = await cost.evaluate((e) => e.validationMessage || 'valid')
    }
    await cost.fill('-1')
    await form.locator('button:not(.link)').evaluate((b) => b.scrollIntoView({ block: "center" })) // the plain click after a fullPage shot sometimes missed on desktop
    await form.locator('button:not(.link)').click()
    await page.waitForTimeout(300)
    const notesMax = await form.locator('textarea').evaluate((e) => e.maxLength)
    await form.locator('textarea').fill('N'.repeat(1200))
    const notesLen = (await form.locator('textarea').inputValue()).length
    await cost.fill('')
    const sh = await shot('06-cost-form')
    // Cost 0 with long notes is a valid reset.
    await cost.fill('0')
    const res = page.waitForResponse((x) => x.url().endsWith('/reset'), { timeout: 5000 })
    await form.locator('button:not(.link)').evaluate((b) => b.scrollIntoView({ block: "center" })) // the plain click after a fullPage shot sometimes missed on desktop
    await form.locator('button:not(.link)').click()
    const x = await res
    await waitIdle()
    const sent = x.request().postDataJSON()
    const bar = await undoBars()
    await undo()
    return { costLabel: label, msgs, postsWhileInvalid: resets - before - 1, notesMax, notesLen, status: x.status(), sentCost: sent.cost, sentNotesLen: sent.notes?.length, barShown: bar, ...sh }
  })

  // Empty cost and empty notes from the form.
  await check('cost-form-empty', async () => {
    await row(T.ok.id).locator('button.done + button').click()
    const res = page.waitForResponse((x) => x.url().endsWith('/reset'))
    await row(T.ok.id).locator('form button:not(.link)').click()
    const x = await res
    await waitIdle()
    const sent = x.request().postDataJSON()
    await undo()
    return { status: x.status(), sent }
  })

  // Mark done twice on the same task, then Undo; then try the API for the first reset.
  await check('twice-then-undo-twice', async () => {
    const orig = await state(T.ok.id)
    const ids = []
    page.on('response', async function grab(x) { if (x.url().endsWith('/reset') && x.status() === 201) ids.push((await x.json()).serviceRecordId) })
    await markDone(T.ok.id)
    await markDone(T.ok.id)
    const bars = await undoBars()
    const hist2 = await history()
    await undo()
    const afterUndo1 = await state(T.ok.id)
    const barsLeft = await undoBars()
    const hist1 = await history()
    const voidA = ids[0] ? await call('POST', `/vehicles/${car.id}/service-records/${ids[0]}/void`) : null
    const voidAagain = ids[0] ? await call('POST', `/vehicles/${car.id}/service-records/${ids[0]}/void`) : null
    await page.reload(); await row(T.ok.id).waitFor(); await waitIdle()
    return { orig, bars, hist2, afterUndo1, barsLeft, hist1, voidA: voidA?.status, voidAagain: voidAagain && `${voidAagain.status} ${JSON.stringify(voidAagain.body).slice(0, 80)}`, afterApiVoid: await state(T.ok.id), histFinal: await history() }
  })

  // Undo is dropped by another section action, kept by an odometer update above.
  await check('undo-after-other-action', async () => {
    await markDone(T.over.id)
    await row(T.soon.id).locator('input[type=checkbox]').click(); await waitIdle()
    const afterToggle = await undoBars()
    // Known bug: with the Undo bar showing, the first click on an Enabled checkbox only removes the bar.
    const firstToggleTookEffect = !(await row(T.soon.id).locator('input[type=checkbox]').isChecked())
    await row(T.soon.id).locator('input[type=checkbox]').click(); await waitIdle()
    const overState = await state(T.over.id)
    // Mark done on another row moves the bar.
    await markDone(T.ok.id)
    const barOn = await sec.locator('.undo').evaluate((u) => u.closest('li').dataset.id === undefined ? '?' : u.closest('li').querySelector('.name').textContent)
    // Odometer update outside the section, then Undo.
    const quick = page.locator('form.quick')
    await quick.locator('input').fill('50100')
    await quick.locator('button').click(); await waitIdle()
    const barAfterOdo = await undoBars()
    let undoRes = null
    if (barAfterOdo) {
      const res = page.waitForResponse((x) => x.url().endsWith('/void'))
      await sec.locator('.undo button').click()
      undoRes = (await res).status()
      await waitIdle()
    }
    const odo = await page.locator('.odometer').getAttribute('aria-label')
    return { afterToggle, firstToggleTookEffect, overStateStillOk: overState.cls, barOn, barAfterOdo, undoRes, odo, ok: await state(T.ok.id), history: await history(), ...(await shot('07-undo-after-odometer')) }
  })

  // Reset then delete that task.
  await check('delete-task-with-reset', async () => {
    await markDone(T.del.id)
    const h1 = await history()
    await row(T.del.id).locator('button.link').last().click()
    const res = page.waitForResponse((x) => x.request().method() === 'DELETE')
    await row(T.del.id).locator('button.danger').click()
    const st = (await res).status()
    await waitIdle()
    return { status: st, rowGone: !(await row(T.del.id).count()), historyBefore: h1, historyAfter: await history(), focus: await focus(), bars: await undoBars() }
  })

  // Disabled task and archived car offer no Mark done.
  await check('disabled-and-archived', async () => {
    const disabledButtons = await row(T.off.id).locator('button.done').count()
    await page.goto(`${BASE}/cars/${arch.id}`)
    await sec.locator('.tasks > li').first().waitFor()
    await waitIdle()
    return { disabledButtons, archived: await page.locator('.badge').filter({ hasText: s.lng === 'he' ? 'בארכיון' : 'Archived' }).count(), archivedDoneButtons: await sec.locator('button.done').count(), archivedCostButtons: await sec.locator('button').count(), ...(await shot('08-archived')) }
  })

  // Quick-add odometer on the car list (now sends readingDate).
  await check('car-list-quick-add', async () => {
    await page.goto(`${BASE}/`)
    const li = page.locator('main li').filter({ hasText: car.nickname }).first()
    await li.waitFor()
    const res = page.waitForResponse((x) => x.url().endsWith('/odometer') && x.request().method() === 'POST')
    await li.locator('form.quick input').fill('50250')
    await li.locator('form.quick button').click()
    const x = await res
    await waitIdle()
    return { status: x.status(), sent: x.request().postDataJSON(), odo: await li.locator('.odometer').getAttribute('aria-label'), ...(await shot('09-car-list-quick-add')) }
  })

  // Bar is gone after a reload (by design); undo stays on the row through the cost form of another row?
  await check('reload-drops-bar', async () => {
    await page.goto(`${BASE}/cars/${car.id}`); await row(T.over.id).waitFor(); await waitIdle()
    await markDone(T.over.id)
    const sh = await shot('10-mark-done-again')
    await page.reload(); await row(T.over.id).waitFor(); await waitIdle()
    return { barsAfterReload: await undoBars(), ...sh }
  })

  r.counts = { resets, voids }
  await ctx.close()
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
