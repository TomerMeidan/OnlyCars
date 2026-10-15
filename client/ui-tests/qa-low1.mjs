// QA of LOW-1 (Low backlog L1-L9) in 4 setups. Usage (API + Vite running): node ui-tests/qa-low1.mjs   ONLY=<setup>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qalow1'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const local = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()

const setups = [
  { name: 'desktop-light-en-km', lng: 'en', unit: 'Km', theme: 'Light', currency: 'ILS', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-dark-he-mi', lng: 'he', unit: 'Mi', theme: 'Dark', currency: 'USD', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-dark-he-km', lng: 'he', unit: 'Km', theme: 'Dark', currency: 'USD', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-light-en-mi', lng: 'en', unit: 'Mi', theme: 'Light', currency: 'EUR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+low1-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => { const x = await req.post(`${BASE}/api${p}`, { headers: H, data }); if (!x.ok()) throw new Error(`${p} ${x.status()} ${await x.text()}`); return x.json() }
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: s.unit, currency: s.currency } })
  const mazda = await post('/vehicles', { nickname: 'Family Mazda', initialOdometerKm: 50000 })
  const task = (name) => post(`/vehicles/${mazda.id}/tasks`, { name, category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 39000, lastDoneDate: utc(400) })
  const oil = await task('Oil'); await task('Brakes'); const wipers = await task('Wipers')
  await post(`/vehicles/${mazda.id}/service-records`, { date: utc(300), odometerKm: 40000, shopName: 'Garage Levi', totalCost: 100, taskIds: [oil.id] })
  const rec = (await post(`/vehicles/${mazda.id}/service-records`, { date: utc(100), odometerKm: 45000, shopName: 'Speedy', taskIds: [],
    items: [{ description: 'Oil filter', brand: 'Mann', partNumber: 'W 712/75', quantity: 1, unitCost: 145.5 }] })).record
  const old = await post('/vehicles', { nickname: 'Old Corolla', initialOdometerKm: 95000 })
  await post(`/vehicles/${old.id}/service-records`, { date: utc(150), odometerKm: 90000, shopName: 'Tyres', totalCost: 50, taskIds: [] })
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

  const shot = async (label) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('main :is(button, input, select, a)')]
      .filter((e) => e.checkVisibility() && e.type !== 'checkbox' && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 25)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: [...new Set(small)].slice(0, 8) }) }
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
  const active = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}.${a.className} [${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)}]` })
  const rows = page.locator('.services > li')
  const summary = async () => plain(await page.locator('main [role=status]').first().textContent())
  const carSel = page.locator('main select').nth(0)

  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('a[href="/cars/new"]').waitFor()
  await idle()

  await check('L1-failed-filter-summary', async () => {
    await page.goto(`${BASE}/history`); await rows.first().waitFor(); await idle()
    const before = { summary: await summary(), rows: await rows.count() }
    await page.route('**/api/service-records?**', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{"title":"boom","status":500}' }), { times: 1 })
    await carSel.selectOption({ label: 'Family Mazda' }); await idle()
    const failed = { summary: await summary(), rows: await rows.count(), alert: plain(await page.locator('main .card [role=alert]').first().textContent().catch(() => '(none)')) }
    const sh = await shot('L1-failed')
    await page.locator('main .card button', { hasText: he ? 'שוב' : 'Retry' }).click(); await idle()
    const retried = { summary: await summary(), rows: await rows.count() }
    await page.locator('main input[type=date]').nth(1).fill(utc(200)); await idle()
    const toOnly = { summary: await summary(), rows: await rows.count() }
    await page.locator('main input[type=date]').nth(0).fill(utc(10)); await idle()
    const blocked = { summary: await summary(), rows: await rows.count() }
    const sh2 = await shot('L1-blocked')
    return { before, failed, retried, toOnly, blocked, ...sh, shot2: sh2.shot }
  })

  await check('L2-L4-filter-layout', async () => {
    await page.goto(`${BASE}/history`); await rows.first().waitFor(); await idle()
    const layout = async () => page.locator('main [role=search]').evaluate((box) => {
      const w = box.clientWidth
      const ls = [...box.querySelectorAll(':scope > label')].map((l) => { const b = l.getBoundingClientRect(); return { t: Math.round(b.top), w: Math.round(b.width), name: l.childNodes[0].textContent.trim() } })
      const lines = Object.values(ls.reduce((a, l) => ((a[l.t] ??= []).push(l), a), {}))
      return lines.map((g) => g.map((l) => `${l.name}:${l.w}`).join(' | ') + (g.length === 1 && g[0].w > w * 0.6 ? ' <ALONE-FULL-WIDTH>' : ''))
    })
    const lay = await layout()
    const sh = await shot('L2-filters')
    await carSel.selectOption({ label: he ? 'Old Corolla (בארכיון)' : 'Old Corolla (archived)' }); await idle()
    // Text width of the shown option against the select's room for text (minus padding and arrow).
    const fit = await carSel.evaluate((el) => {
      const cs = getComputedStyle(el), c = document.createElement('canvas').getContext('2d')
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const text = el.selectedOptions[0].textContent
      return { text, textPx: Math.round(c.measureText(text).width), roomPx: Math.round(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)), selectW: el.clientWidth }
    })
    await carSel.screenshot({ path: `${OUT}/${TAG}-${s.name}-L4-select.png` })
    const sh2 = await shot('L4-archived-selected')
    return { layout: lay, fit, ...sh, shot2: sh2.shot, selectShot: `${OUT}/${TAG}-${s.name}-L4-select.png`, overflow2: sh2.horizontalOverflowPx }
  })

  await check('L3-summary-vs-row', async () => {
    await page.goto(`${BASE}/history?q=speedy`); await rows.first().waitFor(); await idle()
    const rowMoney = await rows.first().evaluate((li) => [...li.querySelectorAll('*')].filter((e) => !e.children.length && /\d[.,]\d\d/.test(e.textContent)).map((e) => e.textContent))
    await page.locator('main [role=status]').first().screenshot({ path: `${OUT}/${TAG}-${s.name}-L3-summary.png` })
    await rows.first().screenshot({ path: `${OUT}/${TAG}-${s.name}-L3-row.png` })
    return { summary: plain(await summary()), summaryRaw: JSON.stringify(await page.locator('main [role=status]').first().textContent()), rowMoney: rowMoney.map((x) => JSON.stringify(x)), shot: `${OUT}/${TAG}-${s.name}-L3-summary.png`, rowShot: `${OUT}/${TAG}-${s.name}-L3-row.png` }
  })

  await check('L5-unknown-vehicle', async () => {
    const log = []
    const onReq = (x) => x.url().includes('/api/') && log.push(`${Date.now() % 100000} REQ ${x.url().replace(/.*\/api/, '')}`)
    const onRes = (x) => x.url().includes('/api/') && log.push(`${Date.now() % 100000} RES ${x.status()} ${x.url().replace(/.*\/api/, '')}`)
    page.on('request', onReq); page.on('response', onRes)
    await page.route('**/api/vehicles?includeArchived=true', async (rt) => { await new Promise((z) => setTimeout(z, 1200)); await rt.fallback() })
    await page.goto(`${BASE}/history?vehicleId=00000000-0000-0000-0000-00000000abcd`); await idle(); await page.waitForTimeout(1500)
    page.off('request', onReq); page.off('response', onRes)
    const alerts = (await page.locator('main [role=alert]').allTextContents()).map(plain)
    return { url: page.url(), tasksRequests: log.filter((l) => l.includes('/tasks')), log, alerts, ...(await shot('L5-unknown')) }
  })

  await page.goto(`${BASE}/cars/${mazda.id}`)
  const sec = page.locator('section[aria-labelledby=service-history]')
  await sec.waitFor(); await idle()
  const addBtn = sec.locator('button.add')
  const row = sec.locator(`li[data-id="${rec.id}"]`)
  const ef = row.locator('form')
  let writes = 0
  page.on('request', (x) => ['POST', 'PUT'].includes(x.method()) && x.url().includes('service-records') && writes++)

  await check('L6-quantity-message', async () => {
    await addBtn.click()
    const f = sec.locator('form').first()
    await f.locator('button.add-part').click()
    const it = f.locator('fieldset.item').first()
    await it.locator('input').first().fill('Bolt')
    const q = it.locator('input[type=number]').first()
    await q.fill('0')
    await f.locator(':scope > .actions button:not(.link)').click()
    const msg = await q.evaluate((i) => i.validationMessage)
    const sh = await shot('L6-quantity')
    await page.keyboard.press('Escape'); await idle()
    return { msg, ...sh }
  })

  await check('L7-future-date', async () => {
    const out = {}
    for (const which of ['record', 'edit']) {
      const w0 = writes
      if (which === 'record') await addBtn.click(); else await row.locator('button.edit-service').click()
      const f = which === 'record' ? sec.locator('form').first() : ef
      await f.locator('input[name=date]').fill(local(-3))
      await f.locator(':scope > .actions button:not(.link)').click(); await page.waitForTimeout(500)
      out[which] = { msg: await f.locator('input[name=date]').evaluate((i) => i.validationMessage), writes: writes - w0, focus: await active() }
      out[which + 'Shot'] = (await shot(`L7-${which}`)).shot
      // back to a valid date clears it
      await f.locator('input[name=date]').fill(local(1))
      out[which].afterFix = await f.locator('input[name=date]').evaluate((i) => i.validationMessage)
      await page.keyboard.press('Escape'); await idle()
    }
    return out
  })

  await check('L9-record-hidden-while-editing', async () => {
    const out = {}
    out.before = await addBtn.isVisible()
    for (const how of ['escape', 'cancel', 'save']) {
      await row.locator('button.edit-service').click()
      await ef.locator('input[name=shopName]').waitFor()
      const during = await addBtn.count()
      if (how === 'escape') await page.keyboard.press('Escape')
      else if (how === 'cancel') await ef.locator(':scope > .actions button.link').click()
      else { await ef.locator('input[name=shopName]').fill('Speedy Two'); await ef.locator(':scope > .actions button:not(.link)').click() }
      await idle()
      out[how] = { recordBtnDuringEdit: during, recordBtnAfter: await addBtn.isVisible(), focus: await active() }
      if (how === 'escape') out.shot = (await row.locator('button.edit-service').click(), await shot('L9-editing')).shot, await page.keyboard.press('Escape'), await idle()
    }
    return out
  })

  await check('L8-task-gone-on-edit', async () => {
    await row.locator('button.edit-service').click()
    const box = (n) => ef.locator('fieldset label.inline', { hasText: n }).locator('input')
    await box('Wipers').waitFor()
    await box('Wipers').check(); await box('Oil').check()
    await ef.locator('input[name=shopName]').fill('Kept shop')
    await ef.locator('textarea[name=notes]').fill('Kept note')
    await req.delete(`${BASE}/api/vehicles/${mazda.id}/tasks/${wipers.id}`, { headers: H })
    const res = page.waitForResponse((x) => x.request().method() === 'PUT')
    await ef.locator(':scope > .actions button:not(.link)').click()
    const status = (await res).status()
    await idle()
    const out = { putStatus: status, formOpen: await ef.isVisible(), alert: plain(await ef.locator('[role=alert]').allTextContents().then((a) => a.join(' / '))),
      wipersBox: await box('Wipers').count(), oilChecked: await box('Oil').isChecked().catch(() => '(none)'), shop: await ef.locator('input[name=shopName]').inputValue(),
      notes: await ef.locator('textarea[name=notes]').inputValue(), focus: await active(), ...(await shot('L8-task-gone')) }
    // the save now goes through
    await ef.locator(':scope > .actions button:not(.link)').click(); await idle()
    out.afterResave = { formOpen: await ef.isVisible().catch(() => false), rowText: plain(await row.textContent()).slice(0, 120) }
    return out
  })
}

console.log(JSON.stringify(report, null, 1))
await browser.close()
