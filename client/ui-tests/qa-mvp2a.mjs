// QA exploration of MVP2-A (Maintenance section) beyond smoke.mjs: desktop Hebrew, mobile English, validation edge
// cases, sort order, unit conversion, long names. Prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/qa-mvp2a.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const report = []

const api = await (await browser.newContext()).request
const auth = await (await api.post(`${BASE}/api/auth/register`, {
  data: { email: `qa+mvp2a-${Date.now()}@example.com`, password: 'Passw0rd!' },
})).json()
const headers = { Authorization: `Bearer ${auth.token}` }

const only = process.env.ONLY
const setups = [
  { name: 'desktop-light-he', lng: 'he', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'desktop-dark-en', lng: 'en', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
  { name: 'mobile-light-en', lng: 'en', viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true },
  { name: 'mobile-dark-he', lng: 'he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
]

for (const s of setups.filter((x) => !only || x.name.includes(only))) {
  const car = await (await api.post(`${BASE}/api/vehicles`, { headers, data: { nickname: `QA ${s.name}`, initialOdometerKm: 59000 } })).json()
  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript(([lng, token, user]) => {
    localStorage.setItem('i18nextLng', lng)
    localStorage.setItem('token', token)
    localStorage.setItem('user', user)
  }, [s.lng, auth.token, JSON.stringify(auth.user)])
  const page = await ctx.newPage()
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url()}`))
  const tasks = page.locator('section[aria-labelledby=maintenance]')
  const form = tasks.locator('form').first()
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) { r.checks.push({ label, error: e.message.split('\n')[0] }) }
  }
  const shot = async (label) => {
    await page.waitForTimeout(150)
    const path = `${OUT}/qa2a-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    // Visible buttons/checkboxes/selects/inputs in the section shorter than 44px.
    const small = await tasks.evaluate((sec) => [...sec.querySelectorAll('button, select, input, label.inline')]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}${e.className ? '.' + e.className : ''}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).slice(0, 20)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: small }) }
  }
  const alertText = () => form.locator('[role=alert]').textContent({ timeout: 3000 })
  const save = () => form.locator('button:not(.link)').click()
  const openCustom = async () => {
    await tasks.locator('button.add').click()
    await tasks.locator('.picker li:last-child button').click()
  }
  const addCustom = async (name, { km = '', time = '', unit = 'months' } = {}) => {
    await openCustom()
    await form.locator('input[name=name]').fill(name)
    await form.locator('input[name=intervalKm]').fill(km)
    await form.locator('input[name=intervalTime]').fill(time)
    await form.locator('select[name=intervalUnit]').selectOption(unit)
    const res = page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/tasks'))
    await save()
    return (await res).status()
  }
  const names = () => tasks.locator('.tasks > li .name').allTextContents()

  await page.goto(`${BASE}/cars/${car.id}`)
  await tasks.locator('button.add').waitFor()

  await check('picker', async () => {
    await tasks.locator('button.add').click()
    const items = await tasks.locator('.picker li button').allInnerTexts()
    return { count: items.length, items: items.map((x) => x.replace(/\s+/g, ' ')), ...(await shot('01-picker')) }
  })
  await check('escape-closes-picker', async () => {
    await page.keyboard.press('Escape')
    const open = await tasks.locator('.picker').count()
    const focus = await page.evaluate(() => document.activeElement?.className)
    return { pickerStillOpen: open > 0, focus }
  })
  await check('template-oil-form', async () => {
    await tasks.locator('button.add').click()
    await tasks.locator('.picker li:first-child button').click()
    const got = await form.evaluate((f) => Object.fromEntries([...new FormData(f)]))
    return { got, ...(await shot('02-form')) }
  })
  await check('time-interval-21-years', async () => {
    await form.locator('input[name=intervalTime]').fill('21')
    await form.locator('select[name=intervalUnit]').selectOption('years')
    await save()
    return { alert: await alertText(), keptValue: await form.locator('input[name=intervalTime]').inputValue(), ...(await shot('03-21-years')) }
  })
  await check('whitespace-name', async () => {
    await form.locator('input[name=intervalTime]').fill('1')
    await form.locator('input[name=name]').fill('    ')
    await save()
    return { alert: await alertText(), ...(await shot('04-whitespace-name')) }
  })
  await check('km-interval-fraction-native', async () => {
    await form.locator('input[name=name]').fill('Oil')
    await form.locator('input[name=intervalKm]').fill('1.5')
    let posted = 0
    const c = (q) => q.method() === 'POST' && q.url().endsWith('/tasks') && posted++
    page.on('request', c)
    await save()
    await page.waitForTimeout(300)
    page.off('request', c)
    const msg = await form.locator('input[name=intervalKm]').evaluate((e) => e.validationMessage)
    return { posted, validationMessage: msg }
  })
  await check('last-done-above-odometer', async () => {
    await form.locator('input[name=intervalKm]').fill('10000')
    await form.locator('input[name=lastDoneOdometerKm]').fill('59000.5')
    await save()
    return { alert: await alertText(), ...(await shot('05-lastdone-above')) }
  })
  await check('cancel-add', async () => {
    await form.locator('button.link').click()
    return { formsOpen: await tasks.locator('form').count(), focus: await page.evaluate(() => document.activeElement?.className) }
  })

  // Sort: enabled first, then name with a culture-aware compare.
  await check('sort-order', async () => {
    const statuses = []
    for (const n of ['zebra service', 'Alpha check', 'בדיקת אורות', 'alpha brakes', 'Ölwechsel', '10k inspection', '9k inspection']) statuses.push(await addCustom(n, { km: '5000' }))
    return { statuses, order: await names(), ...(await shot('06-sorted')) }
  })
  await check('disable-moves-down', async () => {
    const first = (await names())[0]
    await tasks.locator('.tasks > li').first().locator('input[type=checkbox]').click()
    await page.waitForResponse((x) => x.request().method() === 'PUT')
    await page.waitForTimeout(200)
    return { disabled: first, order: await names(), ...(await shot('07-disabled')) }
  })

  await check('edit-unit-conversion', async () => {
    const row = tasks.locator('.tasks > li', { hasText: 'zebra service' })
    await row.locator('button.edit').click()
    const f = row.locator('form')
    await f.locator('input[name=intervalKm]').fill('')
    await f.locator('input[name=intervalTime]').fill('12')
    await f.locator('select[name=intervalUnit]').selectOption('months')
    const editShot = await shot('09-edit-open')
    const res = page.waitForResponse((x) => x.request().method() === 'PUT')
    await f.locator('button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    await page.waitForTimeout(200)
    return { sentDays: body.intervalDays, sentKm: body.intervalKm, rowInterval: await row.locator('p.muted').first().innerText(), editShot }
  })
  await check('edit-24-months-shows', async () => {
    const row = tasks.locator('.tasks > li', { hasText: 'zebra service' })
    await row.locator('button.edit').click()
    const f = row.locator('form')
    const got = await f.evaluate((x) => Object.fromEntries([...new FormData(x)]))
    await f.locator('input[name=intervalTime]').fill('24')
    await f.locator('button:not(.link)').click()
    await page.waitForResponse((x) => x.request().method() === 'PUT')
    await page.waitForTimeout(200)
    return { reopenedForm: got, rowInterval: await row.locator('p.muted').first().innerText() }
  })
  await check('edit-clear-both-intervals', async () => {
    const row = tasks.locator('.tasks > li', { hasText: 'zebra service' })
    await row.locator('button.edit').click()
    const f = row.locator('form')
    await f.locator('input[name=intervalTime]').fill('')
    await f.locator('button:not(.link)').click()
    const alert = await f.locator('[role=alert]').textContent({ timeout: 3000 })
    const out = { alert, ...(await shot('10-edit-error')) }
    await page.keyboard.press('Escape')
    out.afterEscapeFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    return out
  })
  await check('two-forms-at-once', async () => {
    await tasks.locator('.tasks > li').first().locator('button.edit').click()
    await tasks.locator('button.add').click().catch(() => {})
    return { addVisibleWhileEditing: await tasks.locator('.picker').count() > 0, ...(await shot('11-edit-plus-picker')) }
  })
  await check('delete-confirm', async () => {
    await page.reload()
    await tasks.locator('.tasks > li').first().waitFor()
    const before = await names()
    await tasks.locator('.tasks > li').nth(1).locator('button.link').last().click()
    const sh = await shot('12-delete-confirm')
    await tasks.locator('button.danger').click()
    await page.waitForResponse((x) => x.request().method() === 'DELETE')
    await page.waitForTimeout(200)
    return { deleted: before[1], after: await names(), focus: await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName), sh }
  })
  await check('long-name', async () => {
    const long = s.lng === 'he' ? 'החלפת'.repeat(20) : 'Supercalifragilistic'.repeat(5)
    const st = await addCustom(long, { time: '45', unit: 'days' })
    const row = tasks.locator('.tasks > li', { hasText: long.slice(0, 30) })
    return { status: st, nameLen: long.length, interval: (await row.locator('p.muted').first().innerText()), ...(await shot('08-long-name')) }
  })
  await check('latin-in-he', async () => (s.lng === 'he' ? { latin: (await tasks.innerText()).match(/[A-Za-z]{2,}/g) } : {}))
  report.push(r)
  await ctx.close()
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
