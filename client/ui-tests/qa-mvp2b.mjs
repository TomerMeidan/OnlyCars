// QA exploration of MVP2-B (task status, remaining line, progress bar, due-soon percent) beyond smoke.mjs.
// Seeds tasks through the API, then checks badges, bars, remaining text, sort, contrast, overflow and the form rules
// in four setups, plus the interaction flows in desktop English. Prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/qa-mvp2b.mjs   (ONLY=<setup substring> to run one setup)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })
const ago = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

const browser = await chromium.launch({ channel: 'chrome' })
const api = await (await browser.newContext()).request
const auth = await (await api.post(`${BASE}/api/auth/register`, {
  data: { email: `qa+mvp2b-${Date.now()}@example.com`, password: 'Passw0rd!' },
})).json()
const headers = { Authorization: `Bearer ${auth.token}` }
const post = async (url, data) => {
  const x = await api.post(`${BASE}/api${url}`, { headers, data })
  if (!x.ok()) throw new Error(`${x.status()} ${url} ${await x.text()}`)
  return x.json()
}
const task = (carId, t) => post(`/vehicles/${carId}/tasks`, { category: 'Other', intervalKm: null, intervalDays: null, ...t })

// Car A: one task per status and remaining-line format. Odometer 50,000.
const carA = await post('/vehicles', { nickname: 'QA status mix', initialOdometerKm: 50000 })
const seeded = {}
for (const t of [
  { name: 'OK both', intervalKm: 10000, lastDoneOdometerKm: 45000, intervalDays: 365, lastDoneDate: ago(30) },
  { name: 'OK days 59', intervalDays: 90, lastDoneOdometerKm: 50000, lastDoneDate: ago(31) },
  { name: 'OK days 60', intervalDays: 90, lastDoneOdometerKm: 50000, lastDoneDate: ago(30) },
  { name: 'Due soon zero km', intervalKm: 10000, lastDoneOdometerKm: 40000, lastDoneDate: ago(1) },
  { name: 'Due soon 1000 km', intervalKm: 10000, lastDoneOdometerKm: 41000, lastDoneDate: ago(1) },
  { name: 'OK 1001 km', intervalKm: 10000, lastDoneOdometerKm: 41001, lastDoneDate: ago(1) },
  { name: 'Due soon days 36', intervalDays: 365, lastDoneOdometerKm: 50000, lastDoneDate: ago(329) },
  { name: 'Overdue km 1', intervalKm: 10000, lastDoneOdometerKm: 39999, lastDoneDate: ago(1) },
  { name: 'Overdue both', intervalKm: 10000, lastDoneOdometerKm: 39700, intervalDays: 30, lastDoneDate: ago(42) },
  { name: 'Overdue km only of two', intervalKm: 10000, lastDoneOdometerKm: 39500, intervalDays: 365, lastDoneDate: ago(165) },
  { name: 'Overdue days 1', intervalDays: 30, lastDoneOdometerKm: 50000, lastDoneDate: ago(31) },
  { name: 'Overdue months', intervalDays: 365, lastDoneOdometerKm: 50000, lastDoneDate: ago(365 + 280) },
  { name: '10k service', intervalKm: 10000, lastDoneOdometerKm: 47000, lastDoneDate: ago(1) },
  { name: '9k service', intervalKm: 10000, lastDoneOdometerKm: 47000, lastDoneDate: ago(1) },
  { name: 'Disabled task', intervalKm: 10000, lastDoneOdometerKm: 30000, lastDoneDate: ago(1) },
]) seeded[t.name] = await task(carA.id, t)
const dis = seeded['Disabled task']
await api.put(`${BASE}/api/vehicles/${carA.id}/tasks/${dis.id}`, { headers, data: { ...dis, isEnabled: false } })

// Car B: the longest remaining line and a long unspaced name. Odometer 2,000,000.
const carB = await post('/vehicles', { nickname: 'QA longest', initialOdometerKm: 2000000 })
const longest = await task(carB.id, { name: 'Longest line', intervalKm: 1000000, lastDoneOdometerKm: 0, intervalDays: 7300, lastDoneDate: ago(7300 + 7290 + 5) })
await task(carB.id, { name: 'X'.repeat(100), intervalKm: 1000000, lastDoneOdometerKm: 0, intervalDays: 7300, lastDoneDate: ago(7300 + 7290 + 5) })

const only = process.env.ONLY
const setups = [
  { name: 'desktop-light-en', lng: 'en', viewport: { width: 1280, height: 800 }, colorScheme: 'light', flows: true },
  { name: 'desktop-dark-he', lng: 'he', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
  { name: 'mobile-light-he', lng: 'he', viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true },
  { name: 'mobile-dark-en', lng: 'en', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
]
const report = { seeded: { longest: { status: longest.status, remainingKm: longest.remainingKm, remainingDays: longest.remainingDays } }, setups: [] }

for (const s of setups.filter((x) => !only || x.name.includes(only))) {
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
  const tasks = page.locator('section[aria-labelledby=maintenance]')
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) { r.checks.push({ label, error: e.message.split('\n')[0] }) }
  }
  const shot = async (label) => {
    await page.waitForTimeout(200)
    const path = `${OUT}/qa2b-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await tasks.evaluate((sec) => [...sec.querySelectorAll('button, select, input:not([type=checkbox]), label.inline')]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).slice(0, 25)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: small }) }
  }
  // Every row: name, badge, remaining line, bar name/value, fill side, and contrast of badge text and bar fill.
  const rows = () => tasks.evaluate((sec) => {
    const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number)
    const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100 }
    const bgOf = (e) => { while (e) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) return c; e = e.parentElement } return 'rgb(255,255,255)' }
    return [...sec.querySelectorAll('.tasks > li')].map((li) => {
      const badge = li.querySelector('.badge.status'); const bar = li.querySelector('[role=progressbar]'); const fill = bar?.firstElementChild
      const br = bar?.getBoundingClientRect(); const fr = fill?.getBoundingClientRect()
      return {
        name: li.querySelector('.name').textContent.slice(0, 30),
        badge: badge?.textContent ?? null,
        remaining: bar ? bar.nextElementSibling.textContent : null,
        barName: bar?.getAttribute('aria-label') ?? null,
        valuenow: bar?.getAttribute('aria-valuenow') ?? null,
        fillFrom: fr && fr.width > 0 && fr.width < br.width - 1 ? (Math.abs(fr.right - br.right) < 1 ? 'right' : Math.abs(fr.left - br.left) < 1 ? 'left' : 'middle') : undefined,
        badgeContrast: badge ? ratio(getComputedStyle(badge).color, bgOf(badge)) : undefined,
        barContrast: fill ? ratio(getComputedStyle(fill).backgroundColor, getComputedStyle(bar).backgroundColor) : undefined,
        numbersInBdi: bar ? [...bar.nextElementSibling.querySelectorAll('bdi')].map((b) => getComputedStyle(b).direction + ':' + b.textContent).join(' ') : undefined,
      }
    })
  })

  await page.goto(`${BASE}/cars/${carA.id}`)
  await tasks.locator('.tasks > li').first().waitFor()
  await check('rows-car-A', async () => ({ dir: await page.evaluate(() => document.documentElement.dir), rows: await rows(), ...(await shot('01-status-mix')) }))
  await check('longest-car-B', async () => {
    await page.goto(`${BASE}/cars/${carB.id}`)
    await tasks.locator('.tasks > li').first().waitFor()
    return { rows: await rows(), ...(await shot('02-longest')) }
  })
  await check('due-soon-field-messages', async () => {
    await tasks.locator('button.add').click()
    await tasks.locator('.picker li:last-child button').click()
    const form = tasks.locator('form').first()
    const pct = form.locator('input[name=dueSoonPercent]')
    const out = { prefill: await pct.inputValue() }
    await form.locator('input[name=name]').fill('Probe')
    await form.locator('input[name=intervalKm]').fill('1000001')
    out.km1000001 = await form.locator('input[name=intervalKm]').evaluate((e) => e.validationMessage)
    await form.locator('input[name=intervalKm]').fill('5000')
    for (const v of ['0', '51', '2.5']) { await pct.fill(v); out[`pct${v}`] = await pct.evaluate((e) => e.validationMessage) }
    await pct.fill('51')
    await form.locator('button:not(.link)').click()
    return { ...out, ...(await shot('03-pct-51')) }
  })

  if (s.flows) await flows(page, tasks, check, shot, rows, r)
  await ctx.close()
}

async function flows(page, tasks, check, shot, rows, r) {
  const form = tasks.locator('form').first()
  let posts = 0
  page.on('request', (q) => ['POST', 'PUT'].includes(q.method()) && q.url().includes('/tasks') && posts++)
  const blocked = async (fill) => {
    const before = posts
    await fill()
    await form.locator('button:not(.link)').click()
    await page.waitForTimeout(300)
    return posts - before
  }
  // Field limits on time interval, per unit, and whether changing only the unit re-checks.
  await check('interval-limits', async () => {
    const time = form.locator('input[name=intervalTime]'); const unit = form.locator('select[name=intervalUnit]')
    const msg = () => time.evaluate((e) => e.validationMessage)
    const out = {}
    for (const [v, u] of [['21', 'years'], ['20', 'years'], ['244', 'months'], ['243', 'months'], ['7301', 'days'], ['7300', 'days']]) {
      await time.fill(v); await unit.selectOption(u); out[`${v} ${u}`] = await msg()
    }
    await time.fill('244'); await unit.selectOption('days'); out['244 then unit days'] = await msg()
    await unit.selectOption('years'); out['244 then unit years'] = await msg()
    await form.locator('input[name=dueSoonPercent]').fill('10')
    out.requestsSentWhileBlocked = await blocked(async () => {})
    await time.fill('')
    return out
  })
  await check('pct-blocked-no-request', async () => {
    const out = {}
    for (const v of ['0', '51', '2.5', '']) out[`sent:${v || 'empty'}`] = await blocked(() => form.locator('input[name=dueSoonPercent]').fill(v))
    return out
  })
  await check('save-disabled-in-flight', async () => {
    await form.locator('input[name=dueSoonPercent]').fill('10')
    await page.route('**/api/vehicles/*/tasks', async (route) => { await new Promise((x) => setTimeout(x, 1200)); await route.continue() })
    await form.locator('button:not(.link)').click()
    const disabled = await form.locator('button:not(.link)').isDisabled()
    await page.waitForResponse((x) => x.request().method() === 'POST')
    await page.unroute('**/api/vehicles/*/tasks')
    return { saveDisabledWhileSaving: disabled }
  })

  // Car C: criterion 4/9 (15% left, 10 -> OK, 20 -> Due soon) and the toggle keeping 20.
  const carC = await post('/vehicles', { nickname: 'QA flows', initialOdometerKm: 50000 })
  const t15 = await task(carC.id, { name: 'Fifteen left', intervalKm: 10000, lastDoneOdometerKm: 41500, lastDoneDate: ago(1) })
  await page.goto(`${BASE}/cars/${carC.id}`)
  const row = tasks.locator('.tasks > li', { hasText: 'Fifteen left' })
  await row.waitFor()
  await check('pct-20-changes-status', async () => {
    const before = await row.locator('.badge.status').textContent()
    await row.locator('button.edit').click()
    const f = row.locator('form')
    const editPrefill = await f.locator('input[name=dueSoonPercent]').inputValue()
    await f.locator('input[name=dueSoonPercent]').fill('20')
    await f.locator('button:not(.link)').click()
    await row.locator('button.edit').waitFor()
    const after = await row.locator('.badge.status').textContent()
    await row.locator('button.edit').click()
    const reopened = await row.locator('form input[name=dueSoonPercent]').inputValue()
    await row.locator('form button.link').click()
    return { before, editPrefill, after, reopened }
  })
  await check('toggle-keeps-pct', async () => {
    const cb = row.locator('input[type=checkbox]')
    const bodies = []
    const on = (q) => q.method() === 'PUT' && bodies.push(q.postDataJSON()?.dueSoonPercent)
    page.on('request', on)
    await cb.click(); await page.waitForResponse((x) => x.request().method() === 'PUT'); await page.waitForTimeout(200)
    const disabledView = { badge: await row.locator('.badge.status').count(), bar: await row.locator('[role=progressbar]').count() }
    await cb.click(); await page.waitForResponse((x) => x.request().method() === 'PUT'); await page.waitForTimeout(200)
    page.off('request', on)
    const stored = (await (await api.get(`${BASE}/api/vehicles/${carC.id}/tasks`, { headers })).json()).find((x) => x.id === t15.id)
    return { sentPct: bodies, disabledView, storedPct: stored.dueSoonPercent, badgeAfter: await row.locator('.badge.status').textContent() }
  })

  // Criterion 8: odometer add, edit, delete moves the row's status without a reload.
  await check('status-follows-odometer', async () => {
    await page.evaluate(() => { window.__noReload = true })
    const badge = () => row.locator('.badge.status').textContent()
    const line = () => row.locator('[role=progressbar] + p').textContent()
    const out = { start: [await badge(), await line()] }
    // Slow the task reload to see whether old rows stay up.
    await page.route('**/api/vehicles/*/tasks', async (route) => { await new Promise((x) => setTimeout(x, 1000)); await route.continue() })
    await page.locator('form.quick input').fill('52000')
    await page.locator('form.quick button').click()
    await page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/odometer'))
    await page.waitForTimeout(400)
    out.duringReload = { rows: await tasks.locator('.tasks > li').count(), loading: await tasks.locator('[role=status]').count(), empty: await tasks.getByText(/no tasks/i).count() }
    await page.waitForResponse((x) => x.request().method() === 'GET' && x.url().endsWith('/tasks'))
    await page.unroute('**/api/vehicles/*/tasks')
    await page.waitForTimeout(300)
    out.afterAdd = [await badge(), await line()]
    out.afterAddShot = (await shot('10-after-odometer-add')).shot
    const hist = page.locator('section[aria-labelledby=odometer-history] .history > li', { hasText: '52,000' })
    await hist.locator('button.edit').click()
    await hist.locator('input[name=valueKm]').fill('51000')
    await hist.locator('form button:not(.link)').click()
    await page.waitForResponse((x) => x.request().method() === 'GET' && x.url().endsWith('/tasks'))
    await page.waitForTimeout(300)
    out.afterEdit = [await badge(), await line()]
    const hist2 = page.locator('section[aria-labelledby=odometer-history] .history > li', { hasText: '51,000' })
    await hist2.locator('button:has-text("Delete")').click()
    await hist2.locator('button.danger').click()
    await page.waitForResponse((x) => x.request().method() === 'GET' && x.url().endsWith('/tasks'))
    await page.waitForTimeout(300)
    out.afterDelete = [await badge(), await line()]
    out.noPageReload = await page.evaluate(() => window.__noReload === true)
    return out
  })
  await check('failed-reload', async () => {
    await page.route('**/api/vehicles/*/tasks', (route) => route.request().method() === 'GET' ? route.fulfill({ status: 500, body: '{}' }) : route.continue())
    await page.locator('form.quick input').fill('50500')
    await page.locator('form.quick button').click()
    await tasks.locator('.error[role=alert]').waitFor({ timeout: 4000 })
    const out = { error: await tasks.locator('.error[role=alert]').textContent(), rowsStillShown: await tasks.locator('.tasks > li').count(), ...(await shot('11-failed-reload')) }
    await page.unroute('**/api/vehicles/*/tasks')
    return out
  })

  // Low (c): a failed toggle's error clears on Edit, toggle again, Delete, Cancel.
  await page.goto(`${BASE}/cars/${carC.id}`)
  await row.waitFor()
  const failToggle = async () => {
    await page.route('**/api/vehicles/*/tasks/*', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue())
    await row.locator('input[type=checkbox]').click()
    await row.locator('[role=alert]').waitFor({ timeout: 3000 })
    await page.unroute('**/api/vehicles/*/tasks/*')
    return row.locator('[role=alert]').textContent()
  }
  await check('row-error-clears', async () => {
    const out = { error: await failToggle(), shot: (await shot('12-row-error')).shot }
    await row.locator('button.edit').click()
    out.afterEdit = await row.locator('[role=alert]').count()
    await row.locator('form button.link').click()
    out.afterCancelEdit = await row.locator('[role=alert]').count()
    await failToggle()
    await row.locator('button.link:not(.edit)').click()
    out.afterDelete = await row.locator('[role=alert]').count()
    await row.locator('button.link', { hasText: /cancel/i }).click()
    await failToggle()
    await page.route('**/api/vehicles/*/tasks/*', async (route) => { await new Promise((x) => setTimeout(x, 800)); await route.continue() })
    await row.locator('input[type=checkbox]').click()
    await page.waitForTimeout(200)
    out.duringToggleAgain = await row.locator('[role=alert]').count()
    await page.waitForResponse((x) => x.request().method() === 'PUT')
    await page.unroute('**/api/vehicles/*/tasks/*')
    return out
  })

  // Edge: odometer corrected below the task's last done -> used 0, remaining equals interval.
  await check('odometer-below-last-done', async () => {
    const carD = await post('/vehicles', { nickname: 'QA below', initialOdometerKm: 50000 })
    await task(carD.id, { name: 'Below', intervalKm: 10000, lastDoneOdometerKm: 50000, lastDoneDate: ago(0) })
    const reading = (await (await api.get(`${BASE}/api/vehicles/${carD.id}/odometer`, { headers })).json())[0]
    const put = await api.put(`${BASE}/api/vehicles/${carD.id}/odometer/${reading.id}`, { headers, data: { valueKm: 45000, readingDate: reading.readingDate, confirmCorrection: true } })
    await page.goto(`${BASE}/cars/${carD.id}`)
    await tasks.locator('.tasks > li').first().waitFor()
    return { correction: put.status(), rows: await rows(), ...(await shot('13-below-last-done')) }
  })

  // Templates load error shows in the picker.
  await check('templates-load-error', async () => {
    await page.route('**/api/task-templates', (route) => route.fulfill({ status: 500, body: '{}' }))
    await page.goto(`${BASE}/cars/${carC.id}`)
    await tasks.locator('button.add').click()
    const out = { pickerError: await tasks.locator('.picker [role=alert]').textContent({ timeout: 3000 }).catch(() => null), ...(await shot('14-templates-error')) }
    await page.unroute('**/api/task-templates')
    return out
  })

  // Archived car: status is read-only.
  await check('archived-car', async () => {
    const carE = await post('/vehicles', { nickname: 'QA archived', initialOdometerKm: 50000 })
    await task(carE.id, { name: 'Archived row', intervalKm: 10000, lastDoneOdometerKm: 39000, lastDoneDate: ago(1) })
    await api.post(`${BASE}/api/vehicles/${carE.id}/archive`, { headers })
    await page.goto(`${BASE}/cars/${carE.id}`)
    await tasks.locator('.tasks > li').first().waitFor()
    return { rows: await rows(), buttons: await tasks.locator('button, input').count(), ...(await shot('15-archived')) }
  })
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
