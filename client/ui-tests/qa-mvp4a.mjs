// QA of MVP4-A (dashboard on `/`) beyond smoke: 4 setups (desktop/390px x light/dark x en/he, km/miles), long names,
// large amounts, keyboard focus, lower reading on a card, Show archived, loading/error, no-cars, deep link reload.
// Usage (API + Vite running): node ui-tests/qa-mvp4a.mjs   ONLY=<setup> to run one setup, UI_TZ=UTC for the browser timezone.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp4a'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()

const setups = [
  { name: 'desktop-dark-en-mi', lng: 'en', unit: 'Mi', theme: 'Dark', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-light-he-km', lng: 'he', unit: 'Km', theme: 'Light', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-light-en-km', lng: 'en', unit: 'Km', theme: 'Light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-light-he-mi', lng: 'he', unit: 'Mi', theme: 'Light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-dark-en-km', lng: 'en', unit: 'Km', theme: 'Dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+mvp4a-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En', currency: he ? 'ILS' : 'USD' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  const put = async (p, data) => (await req.put(`${BASE}/api${p}`, { headers: H, data })).json()
  const get = async (p) => (await req.get(`${BASE}/api${p}`, { headers: H })).json()
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: s.unit } })

  const ctx = await browser.newContext({ timezoneId: process.env.UI_TZ, viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))
  const check = async (name, fn) => {
    try { const v = await fn(); r.checks.push({ name, ok: true, ...(v !== undefined && { value: v }) }) } catch (e) { r.checks.push({ name, ok: false, error: e.message.split('\n')[0] }) }
  }
  const shot = async (label) => {
    await page.waitForTimeout(300)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('main :is(a, button, input:not([type=checkbox]), label.inline)')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}`))
    r.checks.push({ name: `shot ${label}`, path, ...(overflow > 0 && { overflowPx: overflow }), ...(small.length && { under44: small }) })
  }

  // 1. No cars: login lands on the empty dashboard.
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('main h1').waitFor()
  await page.waitForLoadState('networkidle')
  await check('no cars text', async () => plain(await page.locator('main').textContent()))
  await shot('01-no-cars')

  // Data: a long-named car with 5 tasks (overdue km, due soon by days, long task name, OK), a bike with none,
  // a car with days-only tasks, an archived car with an overdue task and this month's large record.
  const long = await post('/vehicles', { nickname: 'Grandma’s extremely long-named family station wagon', make: 'Volkswagen', model: 'Passat Variant', year: 2012, initialOdometerKm: 123456 })
  const task = (car, name, intervalKm, intervalDays, lastKm, daysAgo) =>
    post(`/vehicles/${car.id}/tasks`, { name, category: 'Other', intervalKm, intervalDays, dueSoonPercent: 10, lastDoneOdometerKm: lastKm, lastDoneDate: utc(daysAgo) })
  await task(long, 'Oil', 10000, null, 110000, 10) // overdue by 3,456 km
  await task(long, 'Brake fluid replacement and full hydraulic system bleed', null, 365, 123456, 350) // due soon, 15 days
  await task(long, 'Tyres', 40000, 1460, 120000, 30)
  await task(long, 'Wipers', null, 365, 123456, 5)
  const hidden = await task(long, 'Disabled task', 1000, null, 100000, 10)
  await put(`/vehicles/${long.id}/tasks/${hidden.id}`, { name: 'Disabled task', category: 'Other', intervalKm: 1000, intervalDays: null, lastDoneOdometerKm: 100000, lastDoneDate: utc(10), isEnabled: false })
  await post('/vehicles', { nickname: 'Bike', initialOdometerKm: 900 })
  const truck = await post('/vehicles', { nickname: 'Truck', make: 'Ford', model: 'F-150', year: 2020, initialOdometerKm: 20000 })
  await task(truck, 'Inspection', null, 30, 20000, 40) // overdue by 10 days
  const van = await post('/vehicles', { nickname: 'Old van', initialOdometerKm: 300000 })
  await task(van, 'Van oil', 5000, null, 200000, 10)
  await post(`/vehicles/${van.id}/service-records`, { date: utc(0), odometerKm: 300000, shopName: 'Big shop', totalCost: 999999.99 })
  await post(`/vehicles/${long.id}/service-records`, { date: utc(0), odometerKm: 123456, totalCost: 1234.5 })
  await req.post(`${BASE}/api/vehicles/${van.id}/archive`, { headers: H })

  await page.reload()
  await page.locator('.cars > li').first().waitFor()
  await page.waitForLoadState('networkidle')
  const dash = await get('/dashboard')
  await check('API counts', async () => ({ overdue: dash.overdueCount, soon: dash.dueSoonCount, cost: dash.monthTotalCost, n: dash.monthServiceCount, cars: dash.vehicles.map((v) => v.nickname) }))
  await check('card order matches API', async () => {
    const names = await page.locator('.cars > li:not(.archived) h2').allTextContents()
    if (names.join('|') !== dash.vehicles.map((v) => v.nickname).join('|')) throw new Error(`${names} vs ${dash.vehicles.map((v) => v.nickname)}`)
  })
  await check('summary text', async () => plain(await page.locator('main .summary').textContent()))
  await check('long car task rows', async () => (await page.locator(`.cars > li[data-id="${long.id}"] .dash-tasks > li`).allTextContents()).map(plain))
  await check('truck task row', async () => (await page.locator(`.cars > li[data-id="${truck.id}"] .dash-tasks > li`).allTextContents()).map(plain))
  await check('long car odometer label', async () => page.locator(`.cars > li[data-id="${long.id}"] .odometer`).getAttribute('aria-label'))
  await check('disabled task not shown', async () => {
    if ((await page.locator('main').textContent()).includes('Disabled task')) throw new Error('shown')
  })
  await check('html dir', async () => page.getAttribute('html', 'dir'))
  await check('text-align of summary + card', async () => page.evaluate(() => [getComputedStyle(document.querySelector('main .summary')).textAlign, getComputedStyle(document.querySelector('.cars > li')).direction]))
  await shot('02-dashboard')

  // 2. Keyboard: tab to the first Mark done; focus is visible.
  await check('focus ring on Mark done', async () => {
    const btn = page.locator(`.cars > li[data-id="${dash.vehicles[0].id}"] button.done`).first()
    await btn.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const st = await btn.evaluate((e) => ({ focused: document.activeElement === e, outline: getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth + ' ' + getComputedStyle(e).outlineColor, shadow: getComputedStyle(e).boxShadow }))
    return st
  })
  await shot('03-focus-mark-done')
  await check('Mark done by keyboard, focus to Undo', async () => {
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.activeElement?.closest('.undo'), null, { timeout: 5000 })
    return plain(await page.locator('main .summary').textContent())
  })
  await shot('04-after-mark-done')
  await check('Undo by keyboard, focus to Mark done', async () => {
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.activeElement?.matches('button.done'), null, { timeout: 5000 })
    return plain(await page.locator('main .summary').textContent())
  })

  // 3. A lower reading on a card: the error and the correction checkbox on that card.
  const truckCard = page.locator(`.cars > li[data-id="${truck.id}"]`)
  await check('lower reading on a card', async () => {
    await truckCard.locator('.quick input[type=number]').fill('100')
    await truckCard.locator('.quick button').click()
    await truckCard.locator('.quick [role=alert]').waitFor()
    return plain(await truckCard.locator('.quick').textContent())
  })
  await check('empty quick entry blocked', async () => {
    await truckCard.locator('.quick input[type=number]').fill('')
    await truckCard.locator('.quick button').click()
    return truckCard.locator('.quick input[type=number]').evaluate((e) => e.validationMessage)
  })
  await truckCard.scrollIntoViewIfNeeded()
  await shot('05-lower-reading')

  // 4. Show archived.
  await check('show archived', async () => {
    await page.locator('label.inline', { has: page.locator('input[type=checkbox]') }).first().click()
    await page.locator('.cars > li.archived').waitFor()
    return (await page.locator('.cars > li.archived').allTextContents()).map(plain)
  })
  await shot('06-show-archived')
  await page.locator('label.inline', { has: page.locator('input[type=checkbox]') }).first().click()

  // 5. Month link to /history.
  await check('month link to history', async () => {
    const a = page.locator('main .summary a')
    const href = await a.getAttribute('href')
    await a.click()
    await page.waitForURL(/\/history/)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    return { href, history: plain(await page.locator('main').textContent()).slice(0, 220) }
  })
  await shot('07-history-from-month')
  await page.goBack()
  await page.locator('.cars > li').first().waitFor()

  // 6. Loading and error states.
  const isDash = (u) => u.pathname === '/api/dashboard'
  const slow = async (rt) => { await new Promise((res) => setTimeout(res, 1500)); await rt.continue().catch(() => {}) }
  await page.route(isDash, slow)
  await page.reload()
  await page.waitForTimeout(500)
  await shot('08-loading')
  await page.unroute(isDash, slow)
  await page.locator('.cars > li').first().waitFor()
  await page.route(isDash, (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
  await page.reload()
  await page.locator('main [role=alert]').first().waitFor().catch(() => {})
  await check('load error text', async () => plain(await page.locator('main').textContent()))
  await shot('09-load-error')
  await page.unroute(isDash)
  await page.route(isDash, (rt) => rt.abort('internetdisconnected'), { times: 1 })
  await page.reload()
  await page.locator('main [role=alert]').first().waitFor().catch(() => {})
  await check('offline error text', async () => plain(await page.locator('main [role=alert]').first().textContent()))
  await page.getByRole('button', { name: he ? 'ניסיון חוזר' : 'Retry' }).click().catch(() => {})
  await page.locator('.cars > li').first().waitFor().catch(() => {})

  // 7. Failed Mark done on a card.
  await page.route('**/reset', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
  await truckCard.locator('button.done').first().click()
  await truckCard.locator('[role=alert]').first().waitFor().catch(() => {})
  await check('failed Mark done text', async () => plain(await truckCard.locator('[role=alert]').first().textContent()))
  await truckCard.scrollIntoViewIfNeeded()
  await shot('10-mark-done-error')

  // 8. Deep links reload: /cars/new then back to /.
  await check('reload /cars/new then back', async () => {
    await page.goto(`${BASE}/cars/new`)
    await page.locator('main h1').waitFor()
    await page.goBack()
    await page.locator('.cars > li').first().waitFor()
    return page.title()
  })
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
