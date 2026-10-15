// QA exploration of MVP3-C (/history: filter and search service records) beyond smoke.mjs, in 4 setups.
// Usage (API + Vite running): node ui-tests/qa-mvp3c.mjs   ONLY=<setup> to run one setup.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp3c'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()

const setups = [
  { name: 'desktop-light-en-km', lng: 'en', unit: 'Km', theme: 'Light', currency: 'ILS', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-dark-he-mi', lng: 'he', unit: 'Mi', theme: 'Dark', currency: 'USD', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-dark-he-km', lng: 'he', unit: 'Km', theme: 'Dark', currency: 'ILS', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-light-en-mi', lng: 'en', unit: 'Mi', theme: 'Light', currency: 'EUR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []
const LONG_SHOP = 'Mega Super Long Name Automotive Service Center And Tyre Warehouse Ltd'
const LONG_PN = 'OEM-15208-65F0A-' + '9'.repeat(34)

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+mvp3c-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => { const x = await req.post(`${BASE}/api${p}`, { headers: H, data }); if (!x.ok()) throw new Error(`${p} ${x.status()} ${await x.text()}`); return x.json() }
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: s.unit, currency: s.currency } })
  // Bulk car: 50 old records, so the whole list has 54 and needs Show more.
  const bulk = await post('/vehicles', { nickname: 'Bulk car', initialOdometerKm: 100000 })
  for (let i = 0; i < 50; i++) await post(`/vehicles/${bulk.id}/service-records`, { date: utc(500 - i), odometerKm: 1000 + i * 100, shopName: `Bulk shop ${i + 1}`, totalCost: 10, taskIds: [] })
  const mazda = await post('/vehicles', { nickname: 'Family Mazda', initialOdometerKm: 50000 })
  const oil = await post(`/vehicles/${mazda.id}/tasks`, { name: 'Oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 39000, lastDoneDate: utc(400) })
  const brakes = await post(`/vehicles/${mazda.id}/tasks`, { name: 'Brakes', category: 'Brakes', intervalKm: 30000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 39000, lastDoneDate: utc(400) })
  await post(`/vehicles/${mazda.id}/service-records`, { date: utc(300), odometerKm: 40000, shopName: 'Garage Levi', totalCost: 100, taskIds: [oil.id] })
  await post(`/vehicles/${mazda.id}/service-records`, { date: utc(200), odometerKm: 42000, shopName: 'Speedy', notes: 'Fixed a rattle', taskIds: [brakes.id],
    items: [{ description: 'Brake pads', brand: 'Brembo', partNumber: 'P 85 020', quantity: 1, unitCost: 250.5 }] })
  await post(`/vehicles/${mazda.id}/service-records`, { date: utc(100), odometerKm: 45000, taskIds: [oil.id],
    items: [{ description: 'Oil filter', brand: 'Mann', partNumber: 'W 712/75', quantity: 1, unitCost: 45.5 }] })
  const old = await post('/vehicles', { nickname: 'Old Corolla', initialOdometerKm: 95000 })
  await post(`/vehicles/${old.id}/service-records`, { date: utc(150), odometerKm: 90000, shopName: LONG_SHOP, notes: 'הערה בעברית about the tyres',
    items: [{ description: 'Tyre', brand: 'Michelin', partNumber: LONG_PN, quantity: 4, unitCost: 120 }] })
  await req.post(`${BASE}/api/vehicles/${old.id}/archive`, { headers: H })

  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))
  let listCalls = 0
  page.on('request', (x) => x.url().includes('/api/service-records') && listCalls++)

  const shot = async (label) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('header a, header button, main :is(button, input, select, a)')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 25)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: [...new Set(small)].slice(0, 8) }) }
  }
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) {
      const p = `${OUT}/${TAG}-${s.name}-FAIL-${label}.png`
      await page.screenshot({ path: p, fullPage: true }).catch(() => {})
      r.checks.push({ label, error: e.message.split('\n')[0], shot: p })
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
  }
  const idle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(400))
  const active = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}.${a.className} ${(a.textContent ?? '').trim().slice(0, 40)}` })
  const rows = page.locator('.services > li')
  const summary = async () => plain(await page.locator('main [role=status]').first().textContent())
  const sel = page.locator('main select')
  const carSel = sel.nth(0), taskSel = sel.nth(1)
  const dates = page.locator('main input[type=date]')
  const search = page.locator('main input[type=search]')
  const more = page.locator('main button.more')
  const qs = () => Object.fromEntries(new URL(page.url()).searchParams)
  const mock = (status, body, opts = {}) => page.route('**/api/service-records?**', async (rt) => { if (opts.delay) await new Promise((z) => setTimeout(z, opts.delay)); await rt.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }) }, { times: opts.times ?? 1 })

  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('a[href="/cars/new"]').waitFor()
  await idle()

  await check('01-header', async () => {
    const link = page.locator('header a[href="/history"]')
    const hdr = await page.locator('header').evaluate((h) => ({ h: Math.round(h.getBoundingClientRect().height), sw: h.scrollWidth - h.clientWidth }))
    await page.locator('header').screenshot({ path: `${OUT}/${TAG}-${s.name}-01-header.png` })
    return { linkText: plain(await link.textContent()), linkVisible: await link.isVisible(), header: hdr, ...(await shot('01-cars')) }
  })

  await check('02-history-page', async () => {
    await page.click('header a[href="/history"]')
    await rows.first().waitFor(); await idle()
    const order = await rows.evaluateAll((ls) => ls.slice(0, 5).map((l) => l.querySelector('a.car')?.textContent + ' | ' + (l.textContent ?? '').slice(0, 80)))
    const btns = await rows.locator('button').allTextContents()
    const archivedRow = rows.filter({ hasText: 'Old Corolla' })
    return { url: page.url(), title: await page.title(), focus: await active(), summary: await summary(), rowCount: await rows.count(),
      firstRows: order.map(plain), rowButtons: btns.map(plain), carHref: await rows.first().locator('a.car').getAttribute('href'),
      archivedTag: plain(await archivedRow.locator('.badge').textContent().catch(() => '(none)')), archivedRowText: plain(await archivedRow.textContent()),
      showMoreVisible: await more.isVisible(), labels: (await page.locator('main [role=search] label').evaluateAll((ls) => ls.map((l) => l.childNodes[0]?.textContent))).map(plain),
      ...(await shot('02-history')) }
  })

  await check('03-show-more', async () => {
    await more.click()
    await page.waitForFunction(() => document.querySelectorAll('.services > li').length > 50)
    await idle()
    return { rowCount: await rows.count(), focus: await active(), focusIs51st: await page.evaluate(() => document.activeElement === document.querySelector('.services > li:nth-child(51) a.car')),
      showMoreVisible: await more.isVisible(), summary: await summary(), ...(await shot('03-show-more')) }
  })

  await check('04-car-task', async () => {
    const hist0 = await page.evaluate(() => history.length)
    await carSel.selectOption({ label: 'Family Mazda' }); await idle()
    const afterCar = { qs: qs(), rows: await rows.count(), summary: await summary(), taskEnabled: await taskSel.isEnabled(), taskOptions: (await taskSel.locator('option').allTextContents()).map(plain), focus: await active() }
    const sh1 = await shot('04-car')
    await taskSel.selectOption({ label: 'Oil' }); await idle()
    const afterTask = { qs: qs(), rows: await rows.count(), summary: await summary(), focus: await active() }
    const sh2 = await shot('04-car-task')
    await carSel.selectOption({ label: 'Bulk car' }); await idle()
    const afterCarChange = { qs: qs(), taskValue: await taskSel.inputValue(), rows: await rows.count(), summary: await summary() }
    await page.goBack(); await idle()
    const afterBack = { qs: qs(), car: await carSel.inputValue() === mazda.id, task: await taskSel.inputValue() === oil.id, rows: await rows.count(), summary: await summary() }
    await page.reload(); await rows.first().waitFor(); await idle()
    const afterReload = { qs: qs(), car: await carSel.inputValue() === mazda.id, task: await taskSel.inputValue() === oil.id, rows: await rows.count(), summary: await summary() }
    return { historyAdded: (await page.evaluate(() => history.length)) - hist0, afterCar, afterTask, afterCarChange, afterBack, afterReload, shot: sh1.shot, shot2: sh2.shot, ...(sh2.horizontalOverflowPx && { overflow: sh2.horizontalOverflowPx }) }
  })

  await check('04b-keyboard-focus', async () => {
    await page.goto(`${BASE}/history`); await rows.first().waitFor(); await idle()
    await carSel.focus(); await page.keyboard.press('ArrowDown'); await idle()
    const car = { qs: qs(), focus: await active() }
    await taskSel.focus(); await page.keyboard.press('ArrowDown'); await idle()
    const task = { qs: qs(), focus: await active() }
    await search.focus(); await page.keyboard.type('oil'); await page.waitForTimeout(400); await idle()
    const typed = { qs: qs(), focus: await active() }
    await dates.nth(0).focus(); await page.keyboard.press('ArrowUp'); await idle()
    const date = { qs: qs(), focus: await active() }
    return { car, task, typed, date, ...(await shot('04b-keyboard')) }
  })

  await check('05-dates', async () => {
    await page.goto(`${BASE}/history`); await rows.first().waitFor(); await idle()
    await dates.nth(0).fill(utc(250)); await idle()
    await dates.nth(1).fill(utc(100)); await idle()
    const inclusive = { qs: qs(), rows: await rows.count(), summary: await summary(), shops: (await rows.locator('a.car').allTextContents()).map(plain), focus: await active() }
    const sh1 = await shot('05-dates')
    const before = listCalls
    await dates.nth(0).fill(utc(50)); await idle()
    const bad = { requests: listCalls - before, alert: plain(await page.locator('main [role=search] .error').textContent().catch(() => '(none)')), invalid: await dates.nth(0).getAttribute('aria-invalid'), rowsKept: await rows.count(), summary: await summary() }
    const sh2 = await shot('05-dates-bad')
    return { inclusive, bad, shot: sh1.shot, badShot: sh2.shot, ...(sh2.horizontalOverflowPx && { overflow: sh2.horizontalOverflowPx }) }
  })

  await check('06-search', async () => {
    await page.goto(`${BASE}/history`); await rows.first().waitFor(); await idle()
    const hist0 = await page.evaluate(() => history.length)
    const before = listCalls
    await search.pressSequentially('w 712', { delay: 40 })
    const duringTyping = listCalls - before
    await page.waitForTimeout(150)
    const at150 = listCalls - before
    await idle()
    const part = { qs: qs(), rows: await rows.count(), summary: await summary(), duringTyping, at150, focus: await active() }
    await search.fill('RATTLE'); await search.press('Enter'); await idle()
    const notes = { qs: qs(), rows: await rows.count(), summary: await summary() }
    const shOne = await shot('06-search-one')
    await search.fill('speedy'); await page.waitForTimeout(500); await idle()
    const shop = { rows: await rows.count() }
    await search.fill('michelin'); await page.waitForTimeout(500); await idle()
    const brand = { rows: await rows.count() }
    const b2 = listCalls
    await search.fill('x'.repeat(101)); await page.waitForTimeout(600)
    const tooLong = { requests: listCalls - b2, alert: plain(await page.locator('main [role=search] .error').textContent().catch(() => '(none)')), invalid: await search.getAttribute('aria-invalid') }
    const shLong = await shot('06-search-too-long')
    return { historyAdded: (await page.evaluate(() => history.length)) - hist0, part, notes, shop, brand, tooLong, shot: shOne.shot, longShot: shLong.shot, ...(shLong.horizontalOverflowPx && { overflow: shLong.horizontalOverflowPx }) }
  })

  await check('07-plural', async () => {
    const out = {}
    for (const [k, url] of [['one', `q=rattle`], ['two', `vehicleId=${mazda.id}&taskId=${oil.id}`], ['three', `vehicleId=${mazda.id}`], ['many', '']]) {
      await page.goto(`${BASE}/history?${url}`); await rows.first().waitFor(); await idle()
      out[k] = await summary()
    }
    return out
  })

  await check('08-no-matches-clear', async () => {
    await page.goto(`${BASE}/history?vehicleId=${mazda.id}&from=${utc(400)}&q=zzzz`); await idle()
    const nm = { summary: await summary(), clearVisible: await page.locator('main button', { hasText: he ? 'ניקוי' : 'Clear' }).isVisible() }
    const sh = await shot('08-no-matches')
    await page.locator('main button', { hasText: he ? 'ניקוי' : 'Clear' }).click(); await idle()
    return { ...nm, afterClear: { url: page.url(), search: await search.inputValue(), car: await carSel.inputValue(), from: await dates.nth(0).inputValue(), rows: await rows.count(), focus: await active() }, ...sh }
  })

  await check('09-errors-500', async () => {
    await page.goto(`${BASE}/history`); await rows.first().waitFor(); await idle()
    await mock(500, { title: 'boom', status: 500 })
    await more.click(); await idle()
    const sm = { rows: await rows.count(), alert: plain(await page.locator('main .card [role=alert]').first().textContent().catch(() => '(none)')), retry: await page.locator('main button', { hasText: he ? 'שוב' : 'Retry' }).isVisible() }
    const sh1 = await shot('09-show-more-500')
    await page.locator('main button', { hasText: he ? 'שוב' : 'Retry' }).click(); await idle()
    sm.afterRetry = { rows: await rows.count(), focus: await active() }
    await mock(500, { title: 'boom', status: 500 })
    await carSel.selectOption({ label: 'Family Mazda' }); await idle()
    const fc = { rows: await rows.count(), summary: await summary(), alert: plain(await page.locator('main .card [role=alert]').first().textContent().catch(() => '(none)')), busy: await page.locator('.services').getAttribute('aria-busy').catch(() => null) }
    const sh2 = await shot('09-filter-500')
    await page.locator('main button', { hasText: he ? 'שוב' : 'Retry' }).click(); await idle()
    fc.afterRetry = { rows: await rows.count(), summary: await summary() }
    // first load failing
    await mock(500, {}, { times: 9 })
    await page.goto(`${BASE}/history`); await idle()
    const first = { summary: await summary(), alert: plain(await page.locator('main .card [role=alert]').first().textContent().catch(() => '(none)')) }
    const sh3 = await shot('09-first-load-500')
    return { showMore: sm, filter: fc, firstLoad: first, shot: sh1.shot, shot2: sh2.shot, shot3: sh3.shot }
  })

  await check('10-loading-empty', async () => {
    await mock(200, { items: [], totalCount: 0, totalCost: 0 }, { delay: 1500, times: 9 })
    await page.goto(`${BASE}/history`)
    await page.waitForTimeout(500)
    const loading = await summary()
    const sh1 = await shot('10-loading')
    await idle(); await page.waitForTimeout(1200)
    const empty = { summary: await summary(), clearVisible: await page.locator('main button.link').isVisible().catch(() => false) }
    const sh2 = await shot('10-empty')
    return { loading, empty, shot: sh1.shot, shot2: sh2.shot }
  })

  await check('11-car-page-link', async () => {
    await page.goto(`${BASE}/cars/${mazda.id}`); await idle()
    const link = page.locator('section[aria-labelledby=service-history] a[href^="/history"]')
    const text = plain(await link.textContent())
    const box = await link.boundingBox()
    await link.click(); await rows.first().waitFor(); await idle()
    return { text, linkH: box && Math.round(box.height), url: page.url(), carSelected: (await carSel.inputValue()) === mazda.id, rows: await rows.count(), focus: await active(), ...(await shot('11-from-car-page')) }
  })

  await check('12-shared-link', async () => {
    const p2 = await ctx.newPage()
    await p2.goto(`${BASE}/history?vehicleId=${mazda.id}&q=brembo`); await p2.locator('.services > li').first().waitFor(); await p2.waitForTimeout(500)
    const out = { search: await p2.locator('main input[type=search]').inputValue(), rows: await p2.locator('.services > li').count(), car: (await p2.locator('main select').first().inputValue()) === mazda.id }
    await p2.close()
    return out
  })

  await check('13-archived-long-row', async () => {
    await page.goto(`${BASE}/history?vehicleId=${old.id}`); await rows.first().waitFor(); await idle()
    return { rowText: plain(await rows.first().textContent()), ...(await shot('13-archived-long')) }
  })
}

console.log(JSON.stringify(report, null, 1))
await browser.close()
