// QA of LOW-2 (Low backlog L13-L26) in 4 setups. Usage (API + Vite running): node ui-tests/qa-low2.mjs   ONLY=<setup>, UI_TZ=<tz>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qalow2'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()
const LONG = { en: 'Replace the timing belt, water pump, and all drive belts and tensioners', he: 'החלפת רצועת טיימינג, משאבת מים וכל הרצועות והמותחנים' }
const WORD = 'Supercalifragilisticexpialidociousmaintenanceitem'

const setups = [
  { name: 'desktop-light-en', lng: 'en', theme: 'Light', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-dark-he', lng: 'he', theme: 'Dark', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-dark-en', lng: 'en', theme: 'Dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-light-he', lng: 'he', theme: 'Light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+low2-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => { const x = await req.post(`${BASE}/api${p}`, { headers: H, data }); if (!x.ok()) throw new Error(`${p} ${x.status()} ${await x.text()}`); return x.json() }
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: 'Km' } })
  const car = await post('/vehicles', { nickname: 'Family Mazda', initialOdometerKm: 50000 })
  const mk = (c, name, last = 39000) => post(`/vehicles/${c.id}/tasks`, { name, category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: last, lastDoneDate: utc(400) })
  const oil = await mk(car, 'Oil')
  const brakes = await mk(car, 'Brakes', 40500)
  const longT = await mk(car, LONG[s.lng], 41000)
  const car2 = await post('/vehicles', { nickname: 'Second car', initialOdometerKm: 20000 })
  const wordT = await mk(car2, WORD, 10000)
  const t2 = await mk(car2, 'Wipers', 11000)
  const rec = (await post(`/vehicles/${car.id}/service-records`, { date: utc(100), odometerKm: 45000, shopName: 'Speedy', taskIds: [] })).record

  const ctx = await browser.newContext({ timezoneId: process.env.UI_TZ, viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  // Focus trace: every focus change and every frame where focus is on body; plus row removals.
  await ctx.addInitScript(() => {
    window.qa = { body: 0, log: [], removed: [] }
    const d = () => { const a = document.activeElement; return `${Math.round(performance.now())} ${a.tagName}.${a.className} undoBar=${!!document.querySelector('.undo')}` }
    const tick = () => { if (window.qa.watch && document.activeElement === document.body) { window.qa.body++; window.qa.log.push('frame ' + d()) } requestAnimationFrame(tick) }
    document.addEventListener('focusin', () => window.qa.watch && window.qa.log.push('focusin ' + d()))
    requestAnimationFrame(tick)
    document.addEventListener('focusout', () => queueMicrotask(() => window.qa.watch && document.activeElement === document.body && window.qa.body++))
    new MutationObserver((ms) => { if (!window.qa.watch) return; for (const m of ms) for (const n of m.removedNodes) if (n.dataset?.id === window.qa.watch) window.qa.removed.push(n.dataset.id) })
      .observe(document, { childList: true, subtree: true })
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [], voidStatuses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))
  const posts = []
  page.on('request', (x) => x.method() === 'POST' && x.url().includes('/api/') && posts.push(x.url().replace(/.*\/api/, '')))
  const t0 = Date.now()
  page.on('requestfinished', async (x) => /\/void$|\/dashboard\?|\/tasks$/.test(x.url()) && r.voidStatuses.push(`${Date.now() - t0}ms ${(await x.response())?.status()} ${x.method()} ${x.url().replace(/.*\/api/, '').replace(/[0-9a-f-]{36}/g, 'ID')} @check${r.checks.length}`))
  page.on('requestfailed', (x) => r.voidStatuses.push(`FAILED ${x.url()} ${x.failure()?.errorText} @check${r.checks.length}`))

  const shot = async (label, loc) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await (loc ?? page).screenshot({ path, ...(loc ? {} : { fullPage: true }) })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }) }
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
  const active = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}.${a.className} [${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)}]` })
  const watch = (id) => page.evaluate((id) => Object.assign(window.qa, { watch: id, body: 0, removed: [], log: [] }), id)
  const watched = () => page.evaluate(() => { const w = { body: window.qa.body, removed: window.qa.removed.length, log: window.qa.log }; window.qa.watch = null; return w })
  const dashCar = (c) => page.locator(`.cars > li[data-id="${c.id}"]`)
  const dashRow = (t) => page.locator(`.dash-tasks > li[data-id="${t.id}"]`)
  const h44 = (loc) => loc.evaluate((e) => Math.round(e.getBoundingClientRect().height))
  const tap = async (loc) => (s.hasTouch ? loc.tap() : loc.click())
  // No actionability wait: a second tap lands wherever the button is, enabled or not.
  const rawTap = async (loc) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; return s.hasTouch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y) }
  const fail500 = (pattern) => page.route(pattern, (rt) => (rt.request().method() === 'POST' ? rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : rt.fallback()), { times: 1 })
  const home = async () => { await page.goto(`${BASE}/`); await dashCar(car).waitFor(); await idle() }

  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('a[href="/cars/new"]').waitFor()
  await idle()

  await check('L25-long-names', async () => {
    await home()
    const geo = async (t) => dashRow(t).evaluate((li) => {
      const n = li.querySelector('.name').getBoundingClientRect(), b = li.querySelector('.badge').getBoundingClientRect(), c = li.closest('.card').getBoundingClientRect()
      const rtl = getComputedStyle(li).direction === 'rtl'
      return { nameLines: Math.round(n.height / parseFloat(getComputedStyle(li.querySelector('.name')).lineHeight || 20)), nameH: Math.round(n.height), badgeTopVsName: Math.round(b.top - n.top),
        badgeBeside: rtl ? b.right <= n.left + 1 : b.left >= n.right - 1, badgeInsideCard: b.left >= c.left && b.right <= c.right, nameInsideCard: n.left >= c.left - 1 && n.right <= c.right + 1, badgeW: Math.round(b.width) }
    })
    const out = { long: await geo(longT), word: await geo(wordT) }
    out.cardShot = (await shot('L25-card-long', dashCar(car))).shot
    out.cardShot2 = (await shot('L25-card-word', dashCar(car2))).shot
    Object.assign(out, await shot('L25-page'))
    if (s.viewport.width > 400) { // also the other width
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300)
      out.at390 = { long: await geo(longT), word: await geo(wordT), ...(await shot('L25-card-long-390', dashCar(car))) }
      await page.setViewportSize(s.viewport)
    }
    return out
  })

  await check('L17-dashboard-undo-focus-and-double-tap', async () => {
    await home()
    const p0 = posts.length
    await tap(dashRow(oil).locator('button.done'))
    await dashRow(oil).locator('.undo button').waitFor(); await idle()
    const afterMark = { focus: await active(), undoH: await h44(dashRow(oil).locator('.undo button')) }
    const sh = await shot('L17-undo-bar', dashCar(car))
    // slow the reload so a second tap lands while busy
    await page.route('**/api/dashboard?**', async (rt) => { await new Promise((z) => setTimeout(z, 700)); await rt.fallback() }, { times: 1 })
    await watch(oil.id)
    const undoBtn = dashRow(oil).locator('.undo button')
    await rawTap(undoBtn); await page.waitForTimeout(80)
    const midAria = await undoBtn.getAttribute('aria-disabled').catch(() => '(gone)')
    await rawTap(undoBtn)
    await page.waitForTimeout(80); await rawTap(undoBtn)
    await undoBtn.waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
    await idle()
    const w = await watched()
    const voids = posts.slice(p0).filter((p) => p.endsWith('/void')).length
    const resets = posts.slice(p0).filter((p) => p.endsWith('/reset')).length
    return { afterMark, midAriaDisabled: midAria, voids, resets, focusBodyFrames: w.body, rowRemovedTimes: w.removed, focusAfter: await active(), undoGone: !(await dashRow(oil).locator('.undo').count()), ...sh }
  })

  await check('dashboard-mark-done-double-tap', async () => {
    await home()
    const p0 = posts.length
    await page.route('**/reset', async (rt) => { await new Promise((z) => setTimeout(z, 600)); await rt.fallback() }, { times: 1 })
    const b = dashRow(brakes).locator('button.done')
    await rawTap(b); await page.waitForTimeout(60); await rawTap(b); await page.waitForTimeout(60); await rawTap(b); await idle()
    const resets = posts.slice(p0).filter((p) => p.endsWith('/reset')).length
    // synthetic: two clicks in the same JS task on Undo
    const p1 = posts.length
    await dashRow(brakes).locator('.undo button').evaluate((e) => { e.click(); e.click() }); await idle()
    return { resetsFromRealDoubleTap: resets, voidsFromSyncDoubleClick: posts.slice(p1).filter((p) => p.endsWith('/void')).length, focus: await active() }
  })

  await check('L24-row-error-cleared-on-reload', async () => {
    await home()
    await fail500('**/reset')
    await tap(dashRow(oil).locator('button.done'))
    const alert = dashRow(oil).locator('[role=alert]')
    await alert.waitFor()
    const msg = plain(await alert.textContent())
    const sh = await shot('L24-row-error', dashCar(car))
    const focus = await active()
    // a reload from elsewhere: quick odometer on the same card
    await dashCar(car).locator('.quick input[type=number]').fill('50100')
    await tap(dashCar(car).locator('.quick button')); await idle()
    return { msg, focusAfterFail: focus, alertAfterReload: await alert.count(), ...sh }
  })

  await check('L23-archive-failure', async () => {
    await home()
    await fail500(`**/vehicles/${car2.id}/archive`)
    const btn = dashCar(car2).locator('.actions button.link').last()
    const label = plain(await btn.textContent())
    await tap(btn)
    const alert = dashCar(car2).locator(':scope > [role=alert], :scope > .error')
    await alert.first().waitFor()
    const out = { label, msg: plain(await alert.first().textContent()), focus: await active(), stillActive: !(await dashCar(car2).getAttribute('class')).includes('archived'),
      pageAlerts: await page.locator('main > [role=alert], main > .row [role=alert]').count(), btnH: await h44(btn), cards: await page.locator('.cars > li').count(), ...(await shot('L23-archive-fail', dashCar(car2))) }
    out.fullShot = (await shot('L23-archive-fail-page')).shot
    // real archive then failed unarchive
    await tap(btn); await idle()
    await page.locator('main label.inline input[type=checkbox]').check(); await idle()
    await fail500(`**/vehicles/${car2.id}/unarchive`)
    const ub = dashCar(car2).locator('.actions button.link').last()
    out.unarchiveLabel = plain(await ub.textContent())
    await tap(ub)
    await dashCar(car2).locator('.error').first().waitFor()
    out.unarchiveMsg = plain(await dashCar(car2).locator('.error').first().textContent())
    out.stillArchived = (await dashCar(car2).getAttribute('class')).includes('archived')
    out.unarchiveShot = (await shot('L23-unarchive-fail', dashCar(car2))).shot
    await tap(ub); await idle()
    out.afterRetryArchived = (await dashCar(car2).getAttribute('class')).includes('archived')
    out.errorAfterRetry = await dashCar(car2).locator('.error').count()
    await page.locator('main label.inline input[type=checkbox]').uncheck(); await idle()
    return out
  })

  await check('car-page-undo', async () => {
    await page.goto(`${BASE}/cars/${car.id}`)
    const sec = page.locator('section[aria-labelledby=maintenance]')
    const row = sec.locator(`li[data-id="${oil.id}"]`)
    await row.waitFor(); await idle()
    // car page Mark done opens a confirm/form? click its done button
    await tap(row.locator('button.done'))
    await idle()
    if (await row.locator('form').count()) { await row.locator('form button:not(.link)').first().click(); await idle() }
    const undoBtn = row.locator('.undo button')
    await undoBtn.waitFor()
    const out = { focusAfterMark: await active(), undoH: await h44(undoBtn), ...(await shot('carpage-undo-bar', row)) }
    const p0 = posts.length
    await page.route('**/void', async (rt) => { await new Promise((z) => setTimeout(z, 600)); await rt.fallback() }, { times: 1 })
    await watch(oil.id)
    await rawTap(undoBtn); await page.waitForTimeout(60); await rawTap(undoBtn); await undoBtn.waitFor({ state: 'detached', timeout: 6000 }).catch(() => {}); await idle()
    const w = await watched()
    return { ...out, voids: posts.slice(p0).filter((p) => p.endsWith('/void')).length, focusBodyFrames: w.body, focusLog: w.log, rowRemoved: w.removed, focusAfterUndo: await active() }
  })

  const sec = page.locator('section[aria-labelledby=service-history]')
  const maint = page.locator('section[aria-labelledby=maintenance]')
  const box = (f, n) => f.locator('fieldset label.inline', { hasText: n }).locator('input')

  await check('L13-L14-task-gone-on-new-record', async () => {
    await page.goto(`${BASE}/cars/${car.id}`); await sec.waitFor(); await idle()
    await sec.locator('button.add').click()
    const f = sec.locator('form').first()
    await box(f, 'Brakes').check()
    await f.locator('input[name=shopName]').fill('Kept shop')
    await f.locator('input[name=odometerKm], input[type=number]').first().fill('50200').catch(() => {})
    await req.delete(`${BASE}/api/vehicles/${car.id}/tasks/${brakes.id}`, { headers: H })
    await f.locator(':scope > .actions button:not(.link)').click(); await idle()
    const out = { formOpen: await f.isVisible(), alert: plain(await f.locator('[role=alert]').allTextContents().then((a) => a.join(' / '))),
      brakesBox: await box(f, 'Brakes').count(), maintHasBrakes: await maint.locator(`li[data-id="${brakes.id}"]`).count(),
      shop: await f.locator('input[name=shopName]').inputValue().catch(() => '(gone)'), focus: await active(), ...(await shot('L13-new-record')) }
    await f.locator(':scope > .actions button:not(.link)').click(); await idle()
    out.resaved = !(await f.isVisible().catch(() => false))
    return out
  })

  await check('L13-L14-task-gone-on-edit', async () => {
    const tmp = await mk(car, 'Temp task', 42000)
    await page.goto(`${BASE}/cars/${car.id}`); await sec.waitFor(); await idle()
    const row = sec.locator(`li[data-id="${rec.id}"]`)
    await row.locator('button.edit-service').click()
    const ef = row.locator('form')
    await box(ef, 'Temp task').check()
    await ef.locator('textarea[name=notes]').fill('Kept note')
    await req.delete(`${BASE}/api/vehicles/${car.id}/tasks/${tmp.id}`, { headers: H })
    await ef.locator(':scope > .actions button:not(.link)').click(); await idle()
    const out = { formOpen: await ef.isVisible(), alert: plain(await ef.locator('[role=alert]').allTextContents().then((a) => a.join(' / '))),
      tmpBox: await box(ef, 'Temp task').count(), maintHasTmp: await maint.locator(`li[data-id="${tmp.id}"]`).count(),
      notes: await ef.locator('textarea[name=notes]').inputValue().catch(() => '(gone)'), focus: await active(), ...(await shot('L13-edit-record')) }
    return out
  })

  await check('L15-history-first-load-fails', async () => {
    const opts = () => page.locator('main select').nth(1).locator('option').count()
    await page.route('**/api/service-records?**', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.goto(`${BASE}/history?vehicleId=${car.id}`); await idle()
    const a = { taskOptions: await opts(), alert: plain(await page.locator('main [role=alert]').first().textContent().catch(() => '(none)')), ...(await shot('L15-records-failed')) }
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    // both fail
    await page.route('**/api/service-records?**', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/vehicles?includeArchived=true', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.goto(`${BASE}/history?vehicleId=${car.id}`); await idle()
    const b = { taskOptionsBefore: await opts(), url: page.url() }
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.locator('main button', { hasText: he ? 'שוב' : 'Retry' }).first().click(); await idle()
    b.taskOptionsAfterRetry = await opts(); b.rows = await page.locator('.services > li').count(); b.urlAfter = page.url(); b.focus = await active()
    return { recordsOnly: a, both: b, ...(await shot('L15-after-retry')) }
  })
}

console.log(JSON.stringify(report, null, 1))
await browser.close()
