// QA exploration for MVP1-B: car page quick entry, archived car, malformed ids, only reading,
// date max / future date, too-large value, register currency picker, 390px layouts, keyboard-only edit+delete.
// Usage (API + Vite must be running): node ui-tests/qa-mvp1b.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const report = []
const api = (await browser.newContext()).request
const auth = await (await api.post(`${BASE}/api/auth/register`, {
  data: { email: `qa-1b-${Date.now()}@onlycars.test`, password: 'Passw0rd!' },
})).json()
const headers = { Authorization: `Bearer ${auth.token}` }
const newCar = async (nickname, km) => (await (await api.post(`${BASE}/api/vehicles`, { headers, data: { nickname, initialOdometerKm: km } })).json())
const addReading = async (car, valueKm, readingDate) => (await api.post(`${BASE}/api/vehicles/${car.id}/odometer`, { headers, data: { valueKm, readingDate } })).status()

async function run(name, opts, lng, fn, loggedIn = true) {
  const ctx = await browser.newContext(opts)
  await ctx.addInitScript(([lng, token, user, loggedIn]) => {
    if (!sessionStorage.getItem('qa-init')) {
      sessionStorage.setItem('qa-init', '1')
      localStorage.setItem('i18nextLng', lng)
      if (loggedIn) { localStorage.setItem('token', token); localStorage.setItem('user', user) }
    }
  }, [lng, auth.token, JSON.stringify(auth.user), loggedIn])
  const page = await ctx.newPage()
  const r = { setup: name, checks: [], consoleErrors: [], badResponses: [], apiRequests: [] }
  page.on('console', (m) => m.type() === 'error' && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('request', (x) => x.url().includes('/api/') && r.apiRequests.push(`${x.method()} ${x.url().replace(BASE, '')}`))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(BASE, '')}`))
  const shot = async (label) => {
    await page.waitForLoadState('networkidle').catch(() => {})
    const path = `${OUT}/qa1b-${name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    r.checks.push({ shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }) })
  }
  try { await fn(page, shot, r) } catch (e) { r.checks.push({ error: e.message.split('\n')[0] }) }
  report.push(r)
  await ctx.close()
}

const rows = (page) => page.locator('.history li').allTextContents()
const odo = (page) => page.locator('.odometer').first().getAttribute('aria-label')
const alertText = (page, scope = 'main') => page.locator(`${scope} [role=alert]`).first().textContent({ timeout: 4000 }).catch(() => null)
const desktop = { viewport: { width: 1280, height: 800 }, colorScheme: 'light' }
const mobile = (colorScheme) => ({ viewport: { width: 390, height: 844 }, colorScheme, isMobile: true, hasTouch: true })

// 17: quick entry on /cars/:id updates drum + history without reload.
const quickCar = await newCar('Quick entry car', 50000)
await run('c17-quick-entry-en', desktop, 'en', async (page, shot, r) => {
  await page.goto(`${BASE}/cars/${quickCar.id}`)
  await page.locator('.history li').first().waitFor()
  await page.evaluate(() => { window.__noReload = true })
  const before = { odo: await odo(page), rows: await rows(page) }
  await page.fill('form.quick input', '50500')
  await page.click('form.quick button')
  await page.waitForFunction(() => document.querySelectorAll('.history li').length === 2)
  await page.waitForTimeout(800)
  r.checks.push({ before, after: { odo: await odo(page), rows: await rows(page), inputValue: await page.inputValue('form.quick input') }, noReload: await page.evaluate(() => window.__noReload === true) })
  await shot('after-save')
})

// 18: archived car is read-only.
const archCar = await newCar('Archived car', 70000)
await addReading(archCar, 71000, new Date().toISOString().slice(0, 10))
{
  const s = (await api.post(`${BASE}/api/vehicles/${archCar.id}/archive`, { headers })).status()
  report.push({ setup: 'archive-api', status: s })
}
for (const lng of ['en', 'he']) {
  await run(`c18-archived-${lng}`, desktop, lng, async (page, shot, r) => {
    await page.goto(`${BASE}/cars/${archCar.id}`)
    await page.locator('.history li').first().waitFor()
    r.checks.push({
      rows: await rows(page),
      badge: await page.locator('.badge').textContent().catch(() => null),
      quickEntry: await page.locator('form.quick').count(),
      buttonsInHistory: await page.locator('.history button').count(),
    })
    await shot('archived')
  })
}

// 19/20: malformed ids, zero API requests.
for (const lng of ['en', 'he']) {
  await run(`c19-bad-ids-${lng}`, mobile('light'), lng, async (page, shot, r) => {
    for (const [label, path] of [['abc', '/cars/abc'], ['abc-edit', '/cars/abc/edit'], ['dotdot', '/cars/%2e%2e%2fvehicles'], ['dotdot-edit', '/cars/%2e%2e%2fvehicles/edit']]) {
      r.apiRequests.length = 0
      await page.goto(`${BASE}${path}`)
      await page.waitForLoadState('networkidle')
      r.checks.push({ path, alert: await alertText(page), apiRequests: [...r.apiRequests] })
      await shot(label)
    }
  })
}

// 11: only reading has no Delete; API returns 409.
const onlyCar = await newCar('Only reading car', 42000)
await run('c11-only-reading-en', desktop, 'en', async (page, shot, r) => {
  await page.goto(`${BASE}/cars/${onlyCar.id}`)
  await page.locator('.history li').first().waitFor()
  r.checks.push({ buttons: await page.locator('.history button').allTextContents(), labels: await page.locator('.history button').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label'))) })
  await shot('only-reading')
})
{
  const hist = await (await api.get(`${BASE}/api/vehicles/${onlyCar.id}/odometer`, { headers })).json()
  const del = await api.delete(`${BASE}/api/vehicles/${onlyCar.id}/odometer/${hist[0].id}`, { headers })
  const after = await (await api.get(`${BASE}/api/vehicles/${onlyCar.id}`, { headers })).json()
  const histAfter = await (await api.get(`${BASE}/api/vehicles/${onlyCar.id}/odometer`, { headers })).json()
  report.push({ setup: 'c11-api', deleteStatus: del.status(), body: await del.json().catch(() => null), currentKm: after.currentOdometerKm, readingsAfter: histAfter.length })
}

// 8: date max and future-date error; too-large value 20,000,000.
const dateCar = await newCar('Date car', 30000)
await addReading(dateCar, 31000, '2026-05-01')
{
  const hist = await (await api.get(`${BASE}/api/vehicles/${dateCar.id}/odometer`, { headers })).json()
  const old = hist.find((h) => h.valueKm === 31000) ?? hist.at(-1)
  const tomorrow2 = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10)
  const put = await api.put(`${BASE}/api/vehicles/${dateCar.id}/odometer/${old.id}`, { headers, data: { valueKm: 31000, readingDate: tomorrow2, confirmCorrection: true } })
  const postBig = await api.post(`${BASE}/api/vehicles/${dateCar.id}/odometer`, { headers, data: { valueKm: 20000000 } })
  report.push({ setup: 'c8-api', putFutureWithConfirm: put.status(), putBody: (await put.json().catch(() => ({}))).code, postBig: postBig.status(), postBigCode: (await postBig.json().catch(() => ({}))).code })
}
for (const lng of ['en', 'he']) {
  await run(`c8-date-and-big-${lng}`, desktop, lng, async (page, shot, r) => {
    await page.goto(`${BASE}/cars/${dateCar.id}`)
    await page.locator('.history li').first().waitFor()
    const localToday = await page.evaluate(() => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) })
    // Too-large value via quick entry.
    await page.fill('form.quick input', '20000000')
    await page.click('form.quick button')
    r.checks.push({ quickEntryBigAlert: await alertText(page, 'form.quick') })
    await shot('quick-big')
    // Open edit on the last row (the older reading).
    const row = page.locator('.history li').last()
    await row.locator('.actions button').first().click()
    const date = row.locator('input[name=readingDate]')
    r.checks.push({ dateMax: await date.getAttribute('max'), localToday })
    // Browser blocks a date after max.
    await date.fill('2030-01-01')
    await row.locator('form button:not(.link)').click()
    r.checks.push({ browserValidation: await date.evaluate((e) => e.validationMessage), alertAfterBlocked: await row.locator('[role=alert]').count() })
    await shot('future-blocked')
    // Bypass max to see the server's translated error.
    await date.evaluate((e) => e.removeAttribute('max'))
    await row.locator('form button:not(.link)').click()
    r.checks.push({ futureAlert: await alertText(page, '.history li:last-child') })
    await shot('future-server')
    await date.fill('2026-05-01')
    await row.locator('input[name=valueKm]').fill('20000000')
    await row.locator('form button:not(.link)').click()
    r.checks.push({ editBigAlert: await alertText(page, '.history li:last-child'), bigValidation: await row.locator('input[name=valueKm]').evaluate((e) => e.validationMessage) })
    await shot('edit-big')
  })
}

// 21-23: currency picker in both languages.
for (const lng of ['en', 'he']) {
  await run(`c21-currency-${lng}`, desktop, lng, async (page, shot, r) => {
    await page.goto(`${BASE}/register`)
    const sel = page.locator('select[name=currency]')
    await sel.waitFor()
    const state = async () => ({ value: await sel.inputValue(), options: await sel.locator('option').allTextContents() })
    r.checks.push({ initial: await state() })
    await page.click('header nav button') // switch language before touching
    await page.waitForTimeout(300)
    r.checks.push({ afterSwitchUntouched: await state() })
    await page.click('header nav button') // back
    await page.waitForTimeout(300)
    await sel.selectOption('EUR')
    await page.click('header nav button') // switch after picking
    await page.waitForTimeout(300)
    r.checks.push({ afterPickEURThenSwitch: await state() })
    await shot('after-pick-switch')
    await page.click('header nav button')
    await page.waitForTimeout(300)
    r.checks.push({ afterSwitchBack: await state() })
    await page.goto(`${BASE}/login`)
    await page.locator('input[name=email]').waitFor()
    r.checks.push({ loginHasPicker: await page.locator('select[name=currency]').count() })
  }, false)
}
await run('c27-register-390-he-dark', mobile('dark'), 'he', async (page, shot) => {
  await page.goto(`${BASE}/register`)
  await page.locator('select[name=currency]').waitFor()
  await shot('register')
}, false)

// 26/27: 390px, edit form + delete confirmation open.
const layoutCar = await newCar('Layout car with a fairly long nickname', 120000)
await addReading(layoutCar, 100000, '2026-02-01')
await addReading(layoutCar, 110500.5, '2026-06-15')
for (const [name, lng, scheme] of [['he-light', 'he', 'light'], ['en-dark', 'en', 'dark']]) {
  await run(`c27-390-${name}`, mobile(scheme), lng, async (page, shot, r) => {
    await page.goto(`${BASE}/cars/${layoutCar.id}`)
    await page.locator('.history li').first().waitFor()
    const li = page.locator('.history li')
    await li.nth(0).locator('.actions button').first().click() // edit
    await li.nth(2).locator('.actions button').nth(1).click() // delete confirm
    r.checks.push({ editForm: await page.locator('.history form').count(), deleteConfirm: await li.nth(2).locator('p').textContent(), focused: await page.evaluate(() => document.activeElement?.textContent) })
    await shot('edit-and-delete-open')
    // Trigger an order error in the edit form to show the checkbox.
    await li.nth(0).locator('input[name=valueKm]').fill('1000')
    await li.nth(0).locator('form button:not(.link)').click()
    r.checks.push({ orderAlert: await alertText(page, '.history li:first-child'), checkbox: await li.nth(0).locator('input[type=checkbox]').count() })
    await shot('edit-order-error')
  })
}

// Keyboard-only: edit then delete a reading.
const kbCar = await newCar('Keyboard car', 80000)
await addReading(kbCar, 70000, '2026-03-01')
await addReading(kbCar, 75000, '2026-04-01')
await run('kb-edit-delete-en', desktop, 'en', async (page, shot, r) => {
  await page.goto(`${BASE}/cars/${kbCar.id}`)
  await page.locator('.history li').first().waitFor()
  const focus = () => page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { tag: e.tagName, name: e.getAttribute('aria-label') || e.getAttribute('name') || e.textContent?.trim().slice(0, 30), outline: `${cs.outlineStyle} ${cs.outlineWidth}` } })
  const tabTo = async (label, max = 20) => {
    for (let i = 0; i < max; i++) { await page.keyboard.press('Tab'); const f = await focus(); if (f.name === label) return f }
    throw new Error(`never reached ${label}`)
  }
  r.checks.push({ reachedEdit: await tabTo('Edit reading 75,000 km') })
  await page.keyboard.press('Enter')
  r.checks.push({ focusAfterOpenEdit: await focus() })
  await page.keyboard.press('Control+A')
  await page.keyboard.type('76000')
  await shot('kb-edit-open')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.history form'))
  await page.waitForTimeout(500)
  r.checks.push({ rowsAfterEdit: await rows(page), focusAfterSave: await focus() })
  r.checks.push({ reachedDelete: await tabTo('Delete reading 70,000 km', 30) })
  await page.keyboard.press('Enter')
  r.checks.push({ focusAfterOpenDelete: await focus() })
  await shot('kb-delete-confirm')
  await page.keyboard.press('Shift+Tab')
  r.checks.push({ shiftTabFocus: await focus() })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.history li').length === 2)
  await page.waitForTimeout(500)
  r.checks.push({ rowsAfterDelete: await rows(page), odo: await odo(page), focusAfterDelete: await focus() })
  // Escape on an open edit form?
  await tabTo('Edit reading 76,000 km', 30)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  r.checks.push({ escapeClosesEdit: (await page.locator('.history form').count()) === 0 })
  await shot('kb-done')
})

await browser.close()
console.log(JSON.stringify(report, null, 2))
