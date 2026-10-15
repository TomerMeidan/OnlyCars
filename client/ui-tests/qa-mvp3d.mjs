// QA of MVP3-D (edit a service's date, odometer and tasks) in 4 setups: en/he, light/dark, km/miles, desktop/390px.
// Usage (API + Vite running): node ui-tests/qa-mvp3d.mjs   ONLY=<setup> to run one setup.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp3d'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const local = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
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
  const email = `qa+mvp3d-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  const get = async (p) => (await req.get(`${BASE}/api${p}`, { headers: H })).json()
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: s.unit } })
  const car = await post('/vehicles', { nickname: 'Edit car', initialOdometerKm: 50000 })
  const oilT = await post(`/vehicles/${car.id}/tasks`, { name: 'Oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 41000, lastDoneDate: utc(90) })
  const filT = await post(`/vehicles/${car.id}/tasks`, { name: 'Filter', category: 'Oil', intervalKm: 20000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 30000, lastDoneDate: utc(200) })
  const rec = (await post(`/vehicles/${car.id}/service-records`, { date: utc(30), odometerKm: 48000, shopName: 'Garage Edit', taskIds: [oilT.id] })).record

  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))

  const sec = page.locator('section[aria-labelledby=service-history]')
  const row = sec.locator(`li[data-id="${rec.id}"]`)
  const f = row.locator('form')
  const save = f.locator(':scope > .actions button:not(.link)')
  const shot = async (label) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby=service-history] form :is(button, input:not([type=checkbox]), textarea, label.inline)')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: small }) }
  }
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) {
      const p = `${OUT}/${TAG}-${s.name}-FAIL-${label}.png`
      await page.screenshot({ path: p, fullPage: true }).catch(() => {})
      r.checks.push({ label, error: e.message.split('\n')[0], shot: p })
      await page.keyboard.press('Escape').catch(() => {})
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
  }
  const idle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(400))
  const active = () => page.evaluate(() => {
    const a = document.activeElement
    const cs = getComputedStyle(a)
    return `${a.tagName}.${a.className} [${(a.getAttribute('aria-label') ?? a.textContent).trim().slice(0, 50)}] outline=${cs.outlineStyle} ${cs.outlineWidth}`
  })
  const taskText = (name) => page.locator('.tasks > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) }).textContent().then(plain)
  const state = async () => ({
    row: plain(await row.locator('.task-head').textContent().catch(() => '(no row)')) + ' | ' + plain(await row.locator('p.muted').textContent().catch(() => '')),
    header: await page.locator('.odometer').first().getAttribute('aria-label'),
    topReading: plain(await page.locator('.history li').first().textContent()),
    oil: await taskText('Oil'), filter: await taskText('Filter'),
  })
  const odo = () => f.locator('input[name=odometerKm]')
  const date = () => f.locator('input[name=date]')
  const box = (name) => f.locator('fieldset label.inline', { hasText: name }).locator('input')
  const putWait = () => page.waitForResponse((x) => x.request().method() === 'PUT', { timeout: 5000 })
  const mock = (status, body, delay = 0) => page.route('**/service-records/*', async (rt) => {
    if (rt.request().method() !== 'PUT') return rt.fallback()
    await new Promise((res) => setTimeout(res, delay))
    await rt.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  }, { times: 1 })
  // km or miles typed in the user's unit
  const U = (km, miles) => String(mi ? miles : km)

  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('a[href="/cars/new"]').waitFor()
  await page.goto(`${BASE}/cars/${car.id}`)
  await sec.waitFor(); await idle()
  await page.evaluate(() => { window.__noReload = true })

  await check('01-edit-open-prefilled', async () => {
    await row.locator('button.edit-service').click()
    await f.locator('fieldset input[type=checkbox]').first().waitFor()
    const text = plain(await f.textContent())
    return { date: await date().inputValue(), odometer: await odo().inputValue(), dateMax: await date().getAttribute('max'), odoMax: await odo().getAttribute('max'),
      oilChecked: await box('Oil').isChecked(), filterChecked: await box('Filter').isChecked(), focus: await active(),
      latinInHebrew: he ? text.match(/[A-Za-z]{3,}/g)?.filter((w) => !['Oil', 'Filter', 'Garage', 'Edit'].includes(w)) : undefined,
      formText: text.slice(0, 300), ...(await shot('01-edit-open')) }
  })

  await check('02-escape-cancel-focus', async () => {
    await odo().fill(U(1, 1))
    await page.keyboard.press('Escape')
    const afterEsc = await active()
    await row.locator('button.edit-service').click()
    const reopened = await odo().inputValue()
    await f.locator(':scope > .actions button.link').click()
    return { afterEsc, reopenedOdometer: reopened, afterCancel: await active() }
  })

  await check('03-client-validation', async () => {
    await row.locator('button.edit-service').click()
    let puts = 0
    const count = (q) => q.method() === 'PUT' && puts++
    page.on('request', count)
    await date().fill(local(-2))
    await save.click()
    const futureMsg = await date().evaluate((i) => i.validationMessage)
    const sh = await shot('03-future-date')
    await date().fill(utc(30))
    await odo().fill(U(10_000_001, 6_300_000))
    await save.click()
    const highMsg = await odo().evaluate((i) => i.validationMessage)
    const sh2 = await shot('03-odometer-too-high')
    await odo().fill('-5')
    await save.click()
    const negMsg = await odo().evaluate((i) => i.validationMessage)
    await page.waitForTimeout(300)
    page.off('request', count)
    await f.locator(':scope > .actions button.link').click()
    return { putsSent: puts, futureMsg, highMsg, negMsg, ...sh, shot2: sh2.shot, ...(sh2.under44px && { under44px2: sh2.under44px }) }
  })

  await check('04-date-order-error-and-confirm', async () => {
    const before = await state()
    await row.locator('button.edit-service').click()
    await odo().fill(U(51000, 32000)) // above the 50,000 km reading dated today, while the record stays 30 days ago
    let res = putWait()
    await save.click()
    const r1 = await res
    const alert = f.locator('[role=alert]')
    await alert.waitFor()
    const layout = await f.evaluate((form) => {
      const o = form.querySelector('input[name=odometerKm]')
      const a = form.querySelector('[role=alert]')
      const b = a.nextElementSibling?.querySelector('input[type=checkbox]')
      return { alertRightAfterOdometer: o.closest('label').nextElementSibling === a, checkboxRightAfterAlert: !!b,
        odoDescribedBy: o.getAttribute('aria-describedby') === a.id, odoInvalid: o.getAttribute('aria-invalid') }
    })
    const msg = plain(await alert.textContent())
    const sh = await shot('04-date-order')
    const confirm = f.locator('label.inline:not(fieldset label) input[type=checkbox]')
    const confirmLabel = plain(await f.locator('label.inline:not(fieldset label)').textContent())
    await confirm.check()
    res = putWait()
    await save.click()
    const r2 = await res
    await row.locator('button.edit-service').waitFor(); await idle()
    return { firstStatus: r1.status(), code: (await r1.json()).code, msg, confirmLabel, ...layout, sent: r2.request().postDataJSON(), secondStatus: r2.status(),
      before, after: await state(), focus: await active(), ...sh, savedShot: (await shot('04-confirm-saved')).shot }
  })

  await check('05-edit-date-and-odometer', async () => {
    const before = await state()
    await row.locator('button.edit-service').click()
    await date().fill(local(0))
    await odo().fill(U(52000, 33000))
    let res = putWait()
    await save.click()
    let resp = await res
    let neededConfirm = false
    if (resp.status() === 400) { // same-day as the initial reading
      neededConfirm = (await resp.json()).code
      await f.locator('label.inline:not(fieldset label) input[type=checkbox]').check()
      res = putWait(); await save.click(); resp = await res
    }
    const body = await resp.json()
    await row.locator('button.edit-service').waitFor(); await idle()
    return { status: resp.status(), neededConfirm, sent: resp.request().postDataJSON(), savedKm: body.record?.odometerKm, savedDate: body.record?.date,
      before, after: await state(), noReload: await page.evaluate(() => window.__noReload === true), focus: await active(),
      apiCar: (({ currentOdometerKm, avgKmPerDay }) => ({ currentOdometerKm, avgKmPerDay }))(await get(`/vehicles/${car.id}`)), ...(await shot('05-date-odo-saved')) }
  })

  await check('06-unchanged-save-no-drift', async () => {
    const stored = (await get(`/vehicles/${car.id}/service-records`)).find((x) => x.id === rec.id).odometerKm
    await row.locator('button.edit-service').click()
    const shown = await odo().inputValue()
    await f.locator('input[name=shopName]').fill('Garage Edit 2')
    const res = putWait()
    await save.click()
    const resp = await res
    await row.locator('button.edit-service').waitFor(); await idle()
    await row.locator('button.edit-service').click()
    const shownAgain = await odo().inputValue()
    await page.keyboard.press('Escape')
    return { stored, shown, sentKm: resp.request().postDataJSON().odometerKm, savedKm: (await resp.json()).record?.odometerKm, shownAgain, row: (await state()).row }
  })

  await check('07-tasks-untick-tick', async () => {
    const before = await state()
    await row.locator('button.edit-service').click()
    await box('Oil').uncheck()
    await box('Filter').check()
    const res = putWait()
    await save.click()
    const resp = await res
    await row.locator('button.edit-service').waitFor(); await idle()
    const api = (await resp.json()).tasks?.map((x) => `${x.name}:${x.lastDoneOdometerKm}@${x.lastDoneDate}:${x.status}`)
    return { status: resp.status(), sentTaskIds: resp.request().postDataJSON().taskIds?.length, apiTasks: api, before, after: await state(), noReload: await page.evaluate(() => window.__noReload === true),
      focus: await active(), ...(await shot('07-tasks-saved')) }
  })

  await check('08-older-record-tick-does-not-move', async () => {
    // A record older than Oil's last done (41,000 km, 90 days ago): ticking Oil on it must not move Oil.
    const old = (await post(`/vehicles/${car.id}/service-records`, { date: utc(120), odometerKm: 38000, shopName: 'Old shop', taskIds: [] })).record
    await page.reload(); await sec.waitFor(); await idle()
    const oldRow = sec.locator(`li[data-id="${old.id}"]`)
    const before = await taskText('Oil')
    await oldRow.locator('button.edit-service').click()
    await oldRow.locator('fieldset label.inline', { hasText: 'Oil' }).locator('input').check()
    const res = putWait()
    await oldRow.locator('form > .actions button:not(.link)').click()
    await res; await idle()
    return { oilBefore: before, oilAfter: await taskText('Oil') }
  })

  await check('09-busy-and-500-keeps-values', async () => {
    await row.locator('button.edit-service').click()
    await date().fill(utc(5))
    await odo().fill(U(49500, 30500))
    await box('Oil').check()
    await f.locator('input[name=shopName]').fill('Typed shop')
    await mock(500, {}, 1200)
    await save.click()
    await page.waitForTimeout(300)
    const busy = { saveDisabled: await save.isDisabled(), cancelDisabled: await f.locator(':scope > .actions button.link').isDisabled(), ariaBusy: await save.getAttribute('aria-busy') }
    const shBusy = await shot('09-busy')
    await f.locator('[role=alert]').waitFor()
    const kept = { date: await date().inputValue(), odometer: await odo().inputValue(), oil: await box('Oil').isChecked(), filter: await box('Filter').isChecked(), shop: await f.locator('input[name=shopName]').inputValue() }
    const err = plain(await f.locator('[role=alert]').textContent())
    const sh = await shot('09-save-500')
    await mock(409, { code: 'serviceRecord.alreadyVoided' })
    await save.click()
    await sec.locator('p[role=status]').waitFor()
    const note = plain(await sec.locator('p[role=status]').textContent())
    await idle()
    return { busy, busyShot: shBusy.shot, kept, err, note, formOpenAfter409: await f.count(), focusAfter409: await active(), ...sh, noteShot: (await shot('09-409-note')).shot }
  })

  await check('10-mobile-layout-with-error', async () => {
    await row.locator('button.edit-service').click()
    await odo().fill(U(51000, 32000))
    await date().fill(utc(30))
    await save.click()
    await f.locator('[role=alert]').waitFor()
    const sh = await shot('10-error-layout')
    await page.keyboard.press('Escape')
    return sh
  })

  await ctx.close()
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
