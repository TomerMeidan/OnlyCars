// QA exploration of MVP3-A (service history) beyond smoke.mjs: en/he, light/dark, km/miles, desktop/390px.
// Usage (API + Vite running): node ui-tests/qa-mvp3a.mjs   ONLY=<setup> to run one setup.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp3a'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()

const setups = [
  { name: 'desktop-light-en-km', lng: 'en', unit: 'Km', theme: 'Light', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-dark-he-mi', lng: 'he', unit: 'Mi', theme: 'Dark', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-dark-he-km', lng: 'he', unit: 'Km', theme: 'Dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-light-en-mi', lng: 'en', unit: 'Mi', theme: 'Light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const mi = s.unit === 'Mi'
  const email = `qa+mvp3a-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const get = async (p) => (await req.get(`${BASE}/api${p}`, { headers: H })).json()
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: s.unit } })
  // 80,466 km shows 49,999 mi, which converts back to 80,465: the drift case.
  const car = await post('/vehicles', { nickname: 'Drift car', initialOdometerKm: 80466 })
  await post(`/vehicles/${car.id}/odometer`, { valueKm: 70000, readingDate: utc(60) })
  for (const [name, category, km] of [['Oil', 'Oil', 72000], ['Brakes', 'Brakes', 60000], ['Air filter', 'Filters', 65000]])
    await post(`/vehicles/${car.id}/tasks`, { name, category, intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: km, lastDoneDate: utc(90) })
  const old = await post('/vehicles', { nickname: 'Old car', initialOdometerKm: 10000 })
  await post(`/vehicles/${old.id}/service-records`, { date: utc(0), odometerKm: 10000, shopName: 'Garage Cohen', totalCost: 99, notes: 'Archived note', taskIds: [] })
  await req.post(`${BASE}/api/vehicles/${old.id}/archive`, { headers: H })

  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))

  const shot = async (label) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby=service-history] :is(button, input:not([type=checkbox]), textarea, label.inline)')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: small }) }
  }
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) {
      const p = `${OUT}/${TAG}-${s.name}-FAIL-${label}.png`
      await page.screenshot({ path: p, fullPage: true }).catch(() => {})
      r.checks.push({ label, error: e.message.split('\n')[0], shot: p })
    }
  }
  const idle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(300))
  const active = () => page.evaluate(() => {
    const a = document.activeElement
    const cs = getComputedStyle(a)
    return { el: `${a.tagName}.${a.className}[${a.getAttribute('name') ?? ''}] ${(a.getAttribute('aria-label') ?? a.textContent).trim().slice(0, 50)}`, outline: `${cs.outlineStyle} ${cs.outlineWidth}` }
  })
  const sec = page.locator('section[aria-labelledby=service-history]')
  const items = () => sec.locator('.services > li')
  const form = sec.locator('form')
  const save = form.locator('.actions button:not(.link)')
  const recordBtn = sec.locator('button.add')
  const localDay = (offset) => page.evaluate((o) => new Date(Date.now() + o * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), offset)
  const odoLabel = () => page.locator('.odometer').first().getAttribute('aria-label')
  const openCar = async (name) => { await page.click('header a.brand'); await page.locator('.cars > li h2 a', { hasText: name }).click(); await sec.waitFor(); await idle() }
  const values = () => form.evaluate((f) => [...new FormData(f)].map(([k, v]) => [k, String(v)]))
  const sentBodies = []
  page.on('request', (q) => q.method() === 'POST' && q.url().endsWith('/service-records') && sentBodies.push(q.postDataJSON()))

  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('a[href="/cars/new"]').waitFor()
  await idle()

  await check('01-empty', async () => {
    await openCar('Drift car')
    const order = await page.locator('main section h2').allTextContents()
    return { sectionText: plain(await sec.textContent()), order, ...(await shot('01-empty')) }
  })

  await check('02-loading-and-error', async () => {
    const held = []
    await page.route('**/service-records', async (rt) => { await new Promise((ok) => held.push(ok)); await rt.continue().catch(() => {}) })
    await page.reload(); await sec.waitFor()
    await page.waitForTimeout(400)
    const loading = plain(await sec.textContent())
    const l = await shot('02-loading')
    held.forEach((ok) => ok()); await page.unroute('**/service-records'); await idle()
    await page.route('**/service-records', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload(); await sec.locator('[role=alert]').waitFor()
    const error = plain(await sec.textContent())
    const e = await shot('03-error')
    await page.unroute('**/service-records')
    await page.reload(); await sec.waitFor(); await idle()
    return { loading, loadingShot: l.shot, error, errorShot: e.shot, recordBtnOnError: await recordBtn.count() }
  })

  await check('03-markdone-then-undo-from-history', async () => {
    const oil = page.locator('.tasks > li').filter({ has: page.locator('.name', { hasText: /^Oil$/ }) })
    await oil.locator('button.done').click()
    await items().first().waitFor({ timeout: 4000 })
    const top = plain(await items().first().textContent())
    const undoBar = await page.locator('.undo').count()
    const sh = await shot('04-markdone')
    await items().first().locator('button.undo-service').click()
    await items().first().locator('button.danger').click()
    await items().first().waitFor({ state: 'detached', timeout: 4000 })
    await idle()
    return { topAfterMarkDone: top, undoBarAfterMarkDone: undoBar, undoBarAfterHistoryUndo: await page.locator('.undo').count(), oilRow: plain(await oil.textContent()), focus: await active(), markDoneShot: sh.shot, ...(await shot('05-after-history-undo')) }
  })

  await check('04-form-defaults-escape-cancel', async () => {
    await recordBtn.click()
    const f1 = await active()
    const defaults = await values()
    const labels = (await form.locator('label, legend').allTextContents()).map(plain)
    const ids = await form.locator('input, textarea').evaluateAll((els) => els.map((e) => `${e.name}:${e.labels?.length ?? 0} labels, describedby=${e.getAttribute('aria-describedby')}`))
    const sh = await shot('06-form-open')
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    const afterEsc = await active()
    await recordBtn.click(); await form.locator('button.link').click(); await page.waitForTimeout(200)
    const afterCancel = await active()
    // Keyboard only: Tab to Record and open it with Enter.
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    const tabbed = await active()
    return { focusOnOpen: f1, defaults, labels, ids, afterEsc, afterCancel, tabbed, ...sh }
  })

  const longShop = (he ? 'מוסך' : 'Garage') + 'W'.repeat(96)
  const longNotes = 'Line one\n' + (he ? 'הערה ארוכה ' : 'Long note ').repeat(40) + 'X'.repeat(500)
  let fullId
  await check('05-failed-then-real-save', async () => {
    await recordBtn.click()
    await form.locator('input[name=shopName]').fill(longShop)
    await form.locator('input[name=totalCost]').fill('1234.5')
    await form.locator('textarea[name=notes]').fill(longNotes)
    await form.getByRole('checkbox', { name: 'Oil', exact: true }).check()
    await form.getByRole('checkbox', { name: 'Brakes', exact: true }).check()
    const typed = JSON.stringify(await values())
    await page.route('**/service-records', (rt) => rt.request().method() === 'POST' ? rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : rt.continue(), { times: 1 })
    await save.click()
    await form.locator('[role=alert]').waitFor()
    const errText = plain(await form.locator('[role=alert]').textContent())
    const kept = JSON.stringify(await values()) === typed
    const focus500 = await active()
    const s500 = await shot('07-save-500')
    const res = page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/service-records'))
    await save.click()
    const rr = await res
    const body = rr.request().postDataJSON()
    fullId = (await rr.json()).record?.id
    await idle()
    const top = items().first()
    return {
      errText, kept, focus500, shot500: s500.shot, status: rr.status(), sentOdometerKm: body.odometerKm, odoAfter: await odoLabel(),
      topIsNew: (await top.getAttribute('data-id')) === fullId, topText: plain(await top.textContent()).slice(0, 200),
      tasks: (await page.locator('.tasks > li').allTextContents()).map(plain),
      topReading: plain(await page.locator('.history li').first().textContent()),
      focusAfterSave: await active(),
      ...(await shot('08-full-record')),
    }
  })

  await check('06-diy-no-cost', async () => {
    await recordBtn.click()
    await save.click(); await idle()
    return { topText: plain(await items().first().textContent()), focus: await active(), ...(await shot('09-diy')) }
  })

  await check('07-backdated-order-error', async () => {
    await recordBtn.click()
    await form.locator('input[name=date]').fill(await localDay(-45))
    await form.locator('input[name=odometerKm]').fill(mi ? '37282' : '60000')
    await form.getByRole('checkbox', { name: 'Air filter', exact: true }).check()
    await save.click()
    await form.locator('[role=alert]').waitFor()
    const err = plain(await form.locator('[role=alert]').textContent())
    const odo = form.locator('input[name=odometerKm]')
    const tied = { invalid: await odo.getAttribute('aria-invalid'), describedby: await odo.getAttribute('aria-describedby') }
    const confirmLabel = plain(await form.locator(':scope > label.inline').textContent())
    const sh = await shot('10-order-error')
    await form.locator(':scope > label.inline input').check()
    await save.click(); await idle()
    const body = sentBodies.at(-1)
    return { err, tied, confirmLabel, errShot: sh.shot, sent: body, last: plain(await items().last().textContent()), airFilter: plain(await page.locator('.tasks > li').filter({ hasText: 'Air filter' }).textContent()), ...(await shot('11-backdated-saved')) }
  })

  await check('08-future-date-server', async () => {
    await recordBtn.click()
    const max = await form.locator('input[name=date]').getAttribute('max')
    await page.route('**/service-records', (rt) => rt.request().method() === 'POST' ? rt.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.futureDate' }) }) : rt.continue(), { times: 1 })
    await save.click()
    await form.locator('[role=alert]').waitFor()
    const err = plain(await form.locator('[role=alert]').textContent())
    const sh = await shot('12-future')
    await form.locator('button.link').click()
    return { max, today: await localDay(0), err, ...sh }
  })

  await check('09-undo-names-and-failed-undo', async () => {
    const names = await sec.locator('button.undo-service').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
    const row = sec.locator(`li[data-id="${fullId}"]`)
    await row.locator('button.undo-service').click()
    const focusConfirm = await active()
    await page.route('**/void', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await row.locator('button.danger').click()
    await row.locator('[role=alert]').waitFor()
    const err = plain(await row.locator('[role=alert]').textContent())
    const focusFail = await active()
    const sh = await shot('13-undo-500')
    const before = await odoLabel()
    await row.locator('button.danger').click()
    await row.waitFor({ state: 'detached', timeout: 4000 }); await idle()
    return { names, focusConfirm, err, focusFail, failShot: sh.shot, odoBefore: before, odoAfter: await odoLabel(), focusAfterUndo: await active(), count: await items().count(), tasks: (await page.locator('.tasks > li').allTextContents()).map(plain), ...(await shot('14-after-undo')) }
  })

  await check('10-archived', async () => {
    await page.goto(`${BASE}/cars/${old.id}`); await sec.waitFor(); await idle()
    return { recordBtn: await recordBtn.count(), undoBtns: await sec.locator('button.undo-service').count(), text: plain(await sec.textContent()), ...(await shot('15-archived')) }
  })
  await ctx.close()
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
