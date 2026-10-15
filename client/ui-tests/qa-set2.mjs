// QA exploration of SET-2 (km or miles) beyond smoke.mjs: retyped values must not drift, every distance in miles, back to km unchanged.
// Usage (API + Vite running): node ui-tests/qa-set2.mjs   ONLY=<setup> to run one setup.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qaset2'
const K = 1.609344
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()

const setups = [
  { name: 'desktop-light-en', lng: 'en', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'mobile-dark-he', lng: 'he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
]
const report = []

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+set2-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const get = async (p) => (await req.get(`${BASE}/api${p}`, { headers: H })).json()
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  // Drift car: 80,466 km shows 49,999 mi, and 49,999 mi converts back to 80,465. 79,401 km behaves the same (49,337 mi -> 79,400).
  const car = await post('/vehicles', { nickname: 'Drift car', initialOdometerKm: 80466 })
  await post(`/vehicles/${car.id}/odometer`, { valueKm: 80000, readingDate: utc(10) })
  await post(`/vehicles/${car.id}/odometer`, { valueKm: 79401, readingDate: utc(20) })
  await post(`/vehicles/${car.id}/tasks`, { name: 'Oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 72000, lastDoneDate: utc(30) })
  await post(`/vehicles/${car.id}/tasks`, { name: 'Tyres', category: 'Tires', intervalKm: 20000, intervalDays: 365, dueSoonPercent: 10, lastDoneOdometerKm: 60000, lastDoneDate: utc(100) })
  // Mirror car: 80,473 km shows 50,004 mi, and 50,004 mi converts back to 80,474.
  const mirror = await post('/vehicles', { nickname: 'Mirror car', initialOdometerKm: 80473 })
  await post(`/vehicles/${mirror.id}/odometer`, { valueKm: 80000, readingDate: utc(10) })
  const big = await post('/vehicles', { nickname: 'Big car', initialOdometerKm: 9999999 })
  const state = async () => JSON.stringify(await Promise.all([car.id, big.id].flatMap((id) => ['', '/odometer', '/tasks'].map((p) => get(`/vehicles/${id}${p}`)))))

  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  const r = { setup: s.name, checks: [], sent: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))
  // Network log of every write, with its body.
  page.on('request', (q) => ['POST', 'PUT', 'DELETE'].includes(q.method()) && r.sent.push(`${q.method()} ${q.url().replace(/.*\/api/, '').replace(/[0-9a-f-]{36}/g, ':id')} ${q.postData() ?? ''}`))

  const shot = async (label) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button, select, main input:not([type=radio]):not([type=checkbox]), label.inline')]
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
  const radio = (n, v) => page.locator(`input[name=${n}][value=${v}]`)
  const active = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}${a.name ? `[${a.name}=${a.value}${a.checked ? ',checked' : ''}]` : ''}` })
  const settings = async () => { await page.click('header a[href="/settings"]'); await radio('distanceUnit', 'Km').waitFor(); await idle() }
  const openCar = async (name) => { await page.click('header a.brand'); await page.locator('.cars > li h2 a', { hasText: name }).click(); await page.locator('.tasks, .history').first().waitFor(); await idle() }
  const row = (name) => page.locator('.tasks > li').filter({ has: page.locator('.name', { hasText: name }) })
  const hist = () => page.locator('.history > li')
  const lastBody = (m, frag) => { const x = [...r.sent].reverse().find((l) => l.startsWith(m) && l.includes(frag)); return x && JSON.parse(x.slice(x.indexOf('{'))) }
  const alertText = async (loc) => plain(await loc.locator('[role=alert]').first().textContent({ timeout: 3000 }).catch(() => null))

  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('a[href="/cars/new"]').waitFor()
  await idle()
  const before = await state()

  await check('01-settings-to-miles', async () => {
    await settings()
    const k = await shot('01-settings-km')
    await radio('distanceUnit', 'Mi').click(); await idle()
    const radioH = await page.locator('label:has(input[name=distanceUnit])').evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().height)))
    const fs = await page.locator('fieldset:has(input[name=distanceUnit]) > legend').textContent()
    return { kmShot: k.shot, server: (await get('/me')).distanceUnit, put: lastBody('PUT', '/me/settings'), legend: fs, radioHeights: radioH, labels: await page.locator('label:has(input[name=distanceUnit])').allTextContents(), ...(await shot('02-settings-mi')) }
  })

  await check('02-list-in-miles', async () => {
    await page.click('header a.brand'); await page.locator('.cars > li').first().waitFor(); await idle()
    const cars = await page.locator('.cars > li').evaluateAll((ls) => ls.map((l) => ({ name: l.querySelector('h2').textContent, odo: l.querySelector('.odometer').getAttribute('aria-label'), digits: l.querySelector('.odometer').textContent, reading: l.querySelector('.reading').textContent, placeholder: l.querySelector('.quick input')?.placeholder, odoWidth: Math.round(l.querySelector('.odometer').getBoundingClientRect().width), cardWidth: Math.round(l.getBoundingClientRect().width) })))
    return { cars, ...(await shot('03-list-mi')) }
  })

  await check('03-car-page-in-miles', async () => {
    await openCar('Drift car')
    return {
      odo: await page.locator('.odometer').first().getAttribute('aria-label'),
      history: (await page.locator('.history .value').allTextContents()).map(plain),
      editNames: await page.locator('.history button.link').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))),
      tasks: (await page.locator('.tasks > li').allTextContents()).map(plain),
      ...(await shot('04-car-mi')),
    }
  })

  // (a) Retyped as shown: nothing may drift.
  await check('04-edit-reading-date-only', async () => {
    const top = hist().first()
    await top.locator('button.edit').click()
    const input = page.locator('.history input[name=valueKm]')
    const shown = await input.inputValue()
    const label = plain(await page.locator('.history form label').first().textContent())
    await page.locator('.history input[name=readingDate]').fill(utc(1))
    await page.locator('.history form button:not(.link)').click(); await idle()
    const err = await alertText(page.locator('.history'))
    return { shown, label, put: lastBody('PUT', '/odometer/'), err, stored: (await get(`/vehicles/${car.id}`)).currentOdometerKm }
  })

  await check('05-edit-task-unchanged', async () => {
    await row('Oil').locator('button.edit').click()
    const f = row('Oil').locator('form')
    const vals = { interval: await f.locator('input[name=intervalKm]').inputValue(), lastDone: await f.locator('input[name=lastDoneOdometerKm]').inputValue() }
    const labels = (await f.locator('label').allTextContents()).map(plain)
    const sh = await shot('05-task-edit-form')
    await f.locator('button:not(.link)').click(); await idle()
    return { vals, labels, put: lastBody('PUT', '/tasks/'), err: await alertText(row('Oil')), stored: (await get(`/vehicles/${car.id}/tasks`)).find((t) => t.name === 'Oil'), shot: sh.shot, ...(sh.horizontalOverflowPx && { horizontalOverflowPx: sh.horizontalOverflowPx }) }
  })

  await check('06-task-last-done-equals-current', async () => {
    await row('Oil').locator('button.edit').click()
    const f = row('Oil').locator('form')
    await f.locator('input[name=lastDoneOdometerKm]').fill('49999')
    await f.locator('button:not(.link)').click(); await idle()
    return { put: lastBody('PUT', '/tasks/'), err: await alertText(row('Oil')), stored: (await get(`/vehicles/${car.id}/tasks`)).find((t) => t.name === 'Oil').lastDoneOdometerKm, row: plain(await row('Oil').textContent()) }
  })

  await check('07-quick-add-current', async () => {
    const q = page.locator('main > .card .quick')
    await q.locator('input[type=number]').fill('49999')
    await q.locator('button').click(); await idle()
    const first = { post: lastBody('POST', '/odometer'), err: await alertText(q) }
    // Then a lower one, so the confirm shows, and the current value with the box ticked.
    await q.locator('input[type=number]').fill('49000')
    await q.locator('button').click(); await idle()
    const lowerErr = await alertText(q)
    const sh = await shot('06-quick-lower-error')
    await q.locator('input[type=number]').fill('49999')
    await q.locator('input[type=checkbox]').check()
    await q.locator('button').click(); await idle()
    return { first, lowerErr, lowerShot: sh.shot, second: { post: lastBody('POST', '/odometer'), err: await alertText(q) }, stored: (await get(`/vehicles/${car.id}`)).currentOdometerKm }
  })

  await check('08-history-edit-to-neighbours-shown', async () => {
    const editRow = async (text) => { await hist().filter({ hasText: plain(text.toLocaleString(s.lng)) }).first().locator('button.edit').click(); return page.locator('.history form') }
    const save = async (f, v) => { await f.locator('input[name=valueKm]').fill(String(v)); await f.locator('button:not(.link)').click(); await idle() }
    const kmOf = async (id) => (await get(`/vehicles/${id}/odometer`)).map((x) => x.valueKm)
    // Lower neighbour: the 80,000 km reading typed as the older 79,401 km (49,337 mi) is accepted and stores exactly 79,401.
    let f = await editRow(49710)
    await save(f, 49337)
    const res = { lower: { put: lastBody('PUT', '/odometer/'), formOpen: await f.count(), err: await alertText(page.locator('.history')), storedKm: await kmOf(car.id) } }
    res.lowerShot = (await shot('07-history-equal-previous')).shot
    // Higher neighbour (mirror): an 80,000 km reading typed as the next one, 80,473 km (50,004 mi), stores exactly 80,473.
    await openCar('Mirror car')
    f = await editRow(49710)
    await save(f, 50004)
    res.higher = { put: lastBody('PUT', '/odometer/'), formOpen: await f.count(), err: await alertText(page.locator('.history')), storedKm: await kmOf(mirror.id) }
    // A real failure: above the next reading. The error names it in miles; focus comes back and Escape closes the form.
    await hist().nth(1).locator('button.edit').click() // the older of the two 50,004 mi readings
    f = page.locator('.history form')
    await save(f, 50100)
    res.failure = { err: await alertText(page.locator('.history')), focus: await page.evaluate(() => { const a = document.activeElement; return `${a.tagName} ${a.name ?? ''} ${a.textContent.trim().slice(0, 20)}` }) }
    res.failureShot = (await shot('08-history-higher-than-next')).shot
    await page.keyboard.press('Escape')
    res.failure.formOpenAfterEscape = await page.locator('.history form').count()
    res.failure.focusAfterEscape = await page.evaluate(() => document.activeElement.getAttribute('aria-label'))
    await page.locator('.history form button.link').click().catch(() => {})
    await openCar('Drift car')
    return res
  })

  await check('09-delete-reading', async () => {
    const del = hist().last().locator('.actions button.link').nth(1)
    const name = await del.getAttribute('aria-label')
    await del.click()
    await page.locator('.history button.danger').click(); await idle()
    return { name, del: r.sent.filter((l) => l.startsWith('DELETE')).at(-1), history: (await page.locator('.history .value').allTextContents()).map(plain) }
  })

  await check('10-template-picker-and-add', async () => {
    await page.locator('button.add').click()
    const opts = (await page.locator('.picker li button').allTextContents()).map(plain)
    const sh = await shot('09-picker-mi')
    await page.locator('.picker li button').first().click()
    const f = page.locator('section .inline-form').first()
    const vals = { interval: await f.locator('input[name=intervalKm]').inputValue(), lastDone: await f.locator('input[name=lastDoneOdometerKm]').inputValue() }
    await f.locator('button:not(.link)').click(); await idle()
    return { opts, pickerShot: sh.shot, vals, post: lastBody('POST', '/tasks'), err: await alertText(page.locator('section.card').nth(1)) }
  })

  await check('11-custom-task-5000mi-and-last-done-error', async () => {
    await page.locator('button.add').click()
    await page.locator('.picker li button').last().click()
    const f = page.locator('section .inline-form').first()
    await f.locator('input[name=name]').fill('Wash')
    await f.locator('input[name=intervalKm]').fill('5000')
    await f.locator('input[name=lastDoneOdometerKm]').fill('60000')
    await f.locator('button:not(.link)').click(); await idle()
    const lastDoneErr = await alertText(f)
    const sh = await shot('10-last-done-too-high')
    await f.locator('input[name=lastDoneOdometerKm]').fill('49999')
    await f.locator('button:not(.link)').click(); await idle()
    return { lastDoneErr, shot: sh.shot, post: lastBody('POST', '/tasks'), row: plain(await row('Wash').textContent()) }
  })

  await check('12-limits-and-mocked-errors', async () => {
    const out = {}
    await row('Wash').locator('button.edit').click()
    const f = row('Wash').locator('form')
    await f.locator('input[name=intervalKm]').fill('621372')
    await f.locator('button:not(.link)').click()
    out.intervalMax = await f.locator('input[name=intervalKm]').evaluate((e) => e.validationMessage)
    await f.locator('input[name=intervalKm]').fill('621371')
    await page.route('**/tasks/*', (rt) => rt.request().method() === 'PUT' ? rt.fulfill({ status: 400, contentType: 'application/json', body: '{"status":400,"code":"task.invalidInterval"}' }) : rt.continue(), { times: 1 })
    await f.locator('button:not(.link)').click(); await idle()
    out.intervalSent = lastBody('PUT', '/tasks/')?.intervalKm
    out.invalidInterval = await alertText(f)
    await page.keyboard.press('Escape')
    const q = page.locator('main > .card .quick')
    await q.locator('input[type=number]').fill('6213712')
    await q.locator('button').click()
    out.readingMax = await q.locator('input[type=number]').evaluate((e) => e.validationMessage)
    await page.route('**/odometer', (rt) => rt.fulfill({ status: 400, contentType: 'application/json', body: '{"status":400,"code":"odometer.invalidValue"}' }), { times: 1 })
    await q.locator('input[type=number]').fill('6213711')
    await q.locator('button').click(); await idle()
    out.readingSent = lastBody('POST', '/odometer')?.valueKm
    out.invalidValue = await alertText(q)
    out.shot = (await shot('11-mocked-errors')).shot
    await q.locator('input[type=number]').fill('')
    return out
  })

  await check('13-big-car-7-digits', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.click('header a.brand'); await page.locator('.cars > li').first().waitFor(); await idle()
    const list = await shot('12-list-390-mi')
    await openCar('Big car')
    const pg = await shot('13-big-car-390-mi')
    const o = await page.locator('.odometer').first().evaluate((e) => ({ label: e.getAttribute('aria-label'), w: Math.round(e.getBoundingClientRect().width), card: Math.round(e.closest('.card').getBoundingClientRect().width) }))
    await page.setViewportSize(s.viewport)
    return { list, page: pg, odo: o }
  })

  await check('14-car-form-in-miles', async () => {
    await page.click('header a.brand'); await page.click('a[href="/cars/new"]'); await page.locator('input[name=nickname]').waitFor()
    const label = plain(await page.locator('label:has(input[name=initialOdometerKm])').textContent())
    await page.fill('input[name=nickname]', 'Form car')
    await page.fill('input[name=initialOdometerKm]', '50000')
    const sh = await shot('14-car-form-mi')
    await page.click('form button:not(.link)'); await page.locator('.cars').waitFor(); await idle()
    return { label, post: lastBody('POST', '/vehicles '), shot: sh.shot }
  })

  // (c) SET-1 Lows.
  await check('15-low1-arrow-during-save', async () => {
    await settings()
    const out = {}
    for (const [n, v] of [['theme', 'System'], ['distanceUnit', 'Mi'], ['locale', he ? 'He' : 'En']]) {
      await radio(n, v).focus()
      await page.route('**/api/me/settings', async (rt) => { await page.waitForTimeout(900); await rt.continue() }, { times: 1 })
      const key = n === 'locale' ? (he ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown'
      await page.keyboard.press(key)
      await page.waitForTimeout(100)
      const during1 = await active()
      await page.keyboard.press(key)
      await page.waitForTimeout(100)
      const during2 = await active()
      await page.waitForTimeout(1200); await idle()
      out[n] = { during1, during2, after: await active(), server: (await get('/me'))[n] }
      // Put it back for the rest.
      if (n !== 'locale' && (await get('/me'))[n] !== v) { await radio(n, v).click(); await idle() }
      if (n === 'locale' && (await get('/me')).locale !== (he ? 'He' : 'En')) { await radio('locale', he ? 'He' : 'En').click(); await idle() }
    }
    return out
  })

  await check('16-low2-errors-clear', async () => {
    const fail = (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    const alerts = async () => (await page.locator('main [role=alert]').allTextContents()).map(plain)
    const out = {}
    await page.route('**/api/me/settings', fail, { times: 1 })
    await radio('distanceUnit', 'Km').click(); await idle()
    out.unitFail = { checked: await radio('distanceUnit', 'Mi').isChecked(), alerts: await alerts(), shot: (await shot('15-unit-fail')).shot }
    await page.route('**/api/me/settings', fail, { times: 1 })
    await page.click('header nav button.link >> nth=0'); await idle()
    out.afterHeaderFail = await alerts()
    await page.locator('select[name=currency]').selectOption('USD'); await idle()
    out.afterCurrencyOk = await alerts()
    await page.route('**/api/me/settings', fail, { times: 1 })
    await radio('theme', 'Dark').click(); await idle()
    await page.click('header nav button.link >> nth=0'); await idle() // succeeds
    out.afterHeaderOk = await alerts()
    await page.click('header nav button.link >> nth=0'); await idle() // and back
    out.shot = (await shot('16-after-errors')).shot
    return out
  })

  await check('17-back-to-km', async () => {
    const miState = await state()
    await radio('distanceUnit', 'Km').click(); await idle()
    const afterSwitch = await state()
    await page.click('header a.brand'); await page.locator('.cars > li').first().waitFor(); await idle()
    const list = await page.locator('.cars > li').evaluateAll((ls) => ls.map((l) => `${l.querySelector('h2').textContent}: ${l.querySelector('.odometer').getAttribute('aria-label')} | ${l.querySelector('.reading').textContent}`))
    const sh = await shot('17-list-km')
    await openCar('Drift car')
    return {
      unchangedBySwitch: miState === afterSwitch, list, listShot: sh.shot,
      history: (await page.locator('.history .value').allTextContents()).map(plain),
      tasks: (await page.locator('.tasks > li').allTextContents()).map(plain),
      ...(await shot('18-car-km')),
    }
  })

  r.storedKm = { car: (await get(`/vehicles/${car.id}/odometer`)).map((x) => `${x.readingDate} ${x.valueKm} ${x.source}`), tasks: (await get(`/vehicles/${car.id}/tasks`)).map((t) => `${t.name} every ${t.intervalKm} last ${t.lastDoneOdometerKm}`), initialChangedFromSeed: before !== (await state()) }
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
