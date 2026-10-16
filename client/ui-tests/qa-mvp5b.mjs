// QA of MVP5-B (checklists on a car, run page, run history, dashboard Start a checklist, template inUse) beyond smoke.
// 4 setups (desktop/390px x light/dark x en/he), one in miles. Usage (API + Vite running): node ui-tests/qa-mvp5b.mjs   ONLY=<setup>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp5b'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()

const setups = [
  { name: 'desktop-light-en', lng: 'en', theme: 'Light', unit: 'Km', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-dark-he', lng: 'he', theme: 'Dark', unit: 'Km', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-light-he', lng: 'he', theme: 'Light', unit: 'Km', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-dark-en-mi', lng: 'en', theme: 'Dark', unit: 'Mi', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+mvp5b-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En', currency: he ? 'ILS' : 'USD' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  const put = async (p, data) => (await req.put(`${BASE}/api${p}`, { headers: H, data })).json()
  const get = async (p) => (await req.get(`${BASE}/api${p}`, { headers: H })).json()
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: s.unit } })
  const today = new Date().toISOString().slice(0, 10)

  // Data: Mazda (50,000 km) with nothing attached; Bike without checklists; Solo with one checklist; Van archived with one.
  const car = await post('/vehicles', { nickname: 'Mazda', make: 'Mazda', model: '3', year: 2018, initialOdometerKm: 50000 })
  await post('/vehicles', { nickname: 'Bike', initialOdometerKm: 900 })
  const solo = await post('/vehicles', { nickname: 'Solo', initialOdometerKm: 1000 })
  const van = await post('/vehicles', { nickname: 'Old van', initialOdometerKm: 300000 })
  const monthly = await post('/checklist-templates', { name: 'Monthly quick check', items: [
    { label: 'Lights', type: 'Check' },
    { label: 'Tire pressure', type: 'Number', unit: 'bar', minValue: 2.0, maxValue: 2.6 },
    { label: 'Outside temp', type: 'Number', unit: '°C', minValue: -5.5, maxValue: 40 },
    { label: 'Body damage', type: 'Text' },
  ] })
  const trip = await post('/checklist-templates', { name: 'Pre-road-trip', items: [{ label: 'Wipers', type: 'Check' }, { label: 'Oil level', type: 'Number', maxValue: 5 }] })
  const longT = await post('/checklist-templates', { name: s.isMobile ? 'Winter preparation inspection' : 'Winter preparation full inspection before the long drive up north to the Golan', items: [{ label: 'Antifreeze', type: 'Check' }] })
  await post(`/vehicles/${solo.id}/checklists`, { templateId: trip.id, intervalKm: null, intervalDays: 7, date: today })
  await post(`/vehicles/${van.id}/checklists`, { templateId: trip.id, intervalKm: 1000, intervalDays: null, date: today })
  await req.post(`${BASE}/api/vehicles/${van.id}/archive`, { headers: H })

  const ctx = await browser.newContext({ timezoneId: 'UTC', viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  r.puts = []; page.on('request', (x) => ['PUT', 'POST', 'DELETE'].includes(x.method()) && r.puts.push(`${x.method()} ${x.url().replace(/.*\/api/, '')} ${x.postData() ?? ''}`.slice(0, 160)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))
  const check = async (name, fn) => {
    try { const v = await fn(); r.checks.push({ name, ok: true, ...(v !== undefined && { value: v }) }) } catch (e) { r.checks.push({ name, ok: false, error: e.message.split('\n')[0] }) }
  }
  const shot = async (label) => {
    await page.waitForTimeout(300)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    const y = await page.evaluate(() => scrollY)
    await page.screenshot({ path, fullPage: true })
    await page.evaluate((y) => scrollTo(0, y), y)
    await page.waitForTimeout(300) // fullPage resizes the viewport; let the layout settle before the next click
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('main :is(a, button, input, select, textarea, summary)')]
      .filter((e) => e.checkVisibility() && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44))
      .map((e) => {
        // Checkboxes and radios count by their label's box.
        const box = (['checkbox', 'radio'].includes(e.type) && e.closest('label')) || e
        const b = box.getBoundingClientRect()
        return b.height < 44 || b.width < 44 ? `${e.tagName}${e.type ? '[' + e.type + ']' : ''}:${Math.round(b.width)}x${Math.round(b.height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}` : null
      }).filter(Boolean))
    r.checks.push({ name: `shot ${label}`, path, ...(overflow > 0 && { overflowPx: overflow }), ...(small.length && { under44: small }) })
  }
  const focused = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}.${a.className} ${(a.getAttribute('aria-label') ?? a.textContent).trim().slice(0, 50)}` })
  const idle = () => page.waitForTimeout(800) // networkidle resolves at once after the first load
  const sec = page.locator('section[aria-labelledby=checklists]')
  const rowOf = (name) => sec.locator('.car-checklists > li', { hasText: name })
  const sform = sec.locator('form.inline-form')
  const ssave = sform.locator('.actions button:not(.link)')
  const runForm = page.locator('main form')
  const item = (i) => runForm.locator('fieldset.item').nth(i)
  const runSave = runForm.locator('> .actions > button:not(.link)')
  const carText = async () => plain(await page.locator('main').textContent())

  try {
    await page.goto(`${BASE}/login`)
    await page.fill('input[name=email]', email)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('main h1').waitFor()
    await idle()

    // 1. Car page: loading then empty state.
    await page.route('**/api/vehicles/*/checklists', async (rt) => { await new Promise((ok) => setTimeout(ok, 1500)); await rt.continue().catch(() => {}) })
    await page.goto(`${BASE}/cars/${car.id}`)
    await check('section loading', async () => plain(await sec.locator('[role=status]').textContent({ timeout: 1500 })))
    await page.unroute('**/api/vehicles/*/checklists')
    await idle()
    await check('empty state', async () => plain(await sec.textContent()))
    // Failed load + Retry
    await page.route('**/api/vehicles/*/checklists', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload(); await sec.locator('[role=alert]').waitFor()
    await check('load error', async () => plain(await sec.locator('.row').last().textContent()))
    await shot('01-section-error')
    await page.unroute('**/api/vehicles/*/checklists')
    await sec.locator('.row button').last().click()
    await idle()
    await check('focus after Retry', focused)
    await shot('02-section-empty')

    // 2. Attach Monthly every 30 days, then Pre-road-trip manual only.
    await sec.locator('button.add').click()
    await check('focus on attach open', focused)
    await check('attach options', async () => (await sform.locator('select[name=templateId] option').allTextContents()).join(' | '))
    await sform.locator('select[name=templateId]').selectOption(monthly.id)
    await sform.locator('input[name=intervalTime]').fill('30')
    await sform.locator('select[name=intervalUnit]').selectOption('days')
    await shot('03-attach-form')
    await ssave.click()
    await rowOf('Monthly').waitFor(); await idle()
    await check('focus after attach', focused)
    await sec.locator('button.add').click()
    await sform.locator('select[name=templateId]').selectOption(trip.id)
    await ssave.click()
    await rowOf('Pre-road').waitFor(); await idle()
    await check('focus after attach manual', focused)
    await check('rows after attach', async () => (await sec.locator('.car-checklists > li').allTextContents()).map(plain))
    // Interval out of range client side.
    await sec.locator('button.add').click()
    await sform.locator('input[name=intervalTime]').fill('11')
    await sform.locator('select[name=intervalUnit]').selectOption('years')
    await sform.locator('input[name=intervalTime]').fill('11')
    await ssave.click()
    await check('11 years msg', async () => plain(await sform.locator('input[name=intervalTime]').evaluate((e) => e.validationMessage)))
    await page.keyboard.press('Escape')
    await check('focus after Escape attach', focused)
    await shot('04-attached')

    // 3. Edit Monthly: add km interval 5000 (or miles); turn Pre-road-trip off and on.
    await rowOf('Monthly').locator('button.edit').click()
    await check('edit prefill', async () => sform.locator('input, select').evaluateAll((xs) => xs.map((x) => `${x.name}=${x.type === 'checkbox' ? x.checked : x.value}`).join(' ')))
    await shot('05-edit-form')
    await sform.locator('input[name=intervalKm]').fill('5000')
    await ssave.click(); await idle()
    await check('focus after edit save', focused)
    await check('Monthly after edit', async () => plain(await rowOf('Monthly').textContent()))
    await rowOf('Pre-road').locator('button.edit').click()
    await sform.locator('input[name=isEnabled]').uncheck()
    await ssave.click(); await idle()
    await check('Pre-road off', async () => `${plain(await rowOf('Pre-road').textContent())} | run links=${await rowOf('Pre-road').locator('a.run').count()}`)
    await shot('06-off')
    await rowOf('Pre-road').locator('button.edit').click()
    await page.keyboard.press('Escape')
    await check('focus after Escape edit', focused)
    await rowOf('Pre-road').locator('button.edit').click()
    await sform.locator('input[name=isEnabled]').check()
    await ssave.click(); await idle()
    // Attach long-named, then remove it (no runs).
    await sec.locator('button.add').click()
    await sform.locator('select[name=templateId]').selectOption(longT.id)
    await ssave.click(); await rowOf('Winter').waitFor(); await idle()
    await shot('07-three')
    await rowOf('Winter').locator('> .actions button.link:not(.edit)').click()
    await check('remove confirm focus', focused)
    await page.keyboard.press('Escape')
    await check('focus after Escape remove', focused)
    await rowOf('Winter').locator('> .actions button.link:not(.edit)').click()
    await rowOf('Winter').locator('button.danger').click()
    await idle()
    await check('after remove', async () => `${await sec.locator('.car-checklists > li').count()} rows, focus=${await focused()}`)
    await sec.locator('button.add').click()
    await check('all attached state', async () => plain(await sec.locator('.inline-form').textContent()))
    await page.keyboard.press('Escape')

    // 4. Run page from the car page.
    await rowOf('Monthly').locator('a.run').click()
    await item(0).waitFor()
    await check('run page title/focus', async () => `${await page.title()} | ${await focused()}`)
    await check('odometer hint', async () => plain(await runForm.locator('label', { has: page.locator('input[name=odometerKm]') }).textContent()))
    await check('range texts', async () => [plain(await item(1).textContent()), plain(await item(2).textContent())])
    await shot('08-run-empty')
    await item(0).locator('input[type=radio]').nth(1).check()
    await check('Not OK reason', async () => plain(await item(0).locator('p.flag').textContent()))
    const num = (i) => item(i).locator('input[type=number]')
    const flagState = async (i) => `${(await item(i).locator('p.flag').count()) ? plain(await item(i).locator('p.flag').textContent()) : 'no flag'} box=${await item(i).locator('input[type=checkbox]').isChecked()} disabled=${await item(i).locator('input[type=checkbox]').isDisabled()}`
    for (const v of ['2', '2.6', '1.99', '2.61', '1.8']) {
      await num(1).fill(v)
      await check(`tire ${v}`, () => flagState(1))
    }
    await check('tire describedby', async () => num(1).evaluate((e) => (e.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent).join(' | ')))
    for (const v of ['-5.5', '-5.51', '40', '40.01']) {
      await num(2).fill(v)
      await check(`temp ${v}`, () => flagState(2))
    }
    await shot('09-run-flags-negative')
    await num(2).fill('-3')
    await item(3).locator('textarea').fill('Scratch on the rear bumper')
    await item(3).locator('input[type=checkbox]').check()
    await check('accessible names', async () => runForm.locator('fieldset.item :is(input, textarea)').evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')).join(' | ')))
    await runForm.locator('textarea[name=notes]').fill('Before the trip')
    // Lower odometer -> correction prompt.
    await runForm.locator('input[name=odometerKm]').fill(s.unit === 'Mi' ? '25000' : '40000')
    await runSave.click()
    await runForm.locator('[role=alert]').waitFor()
    await check('lower reading error', async () => `${plain(await runForm.locator('[role=alert]').textContent())} | focus=${await focused()}`)
    await shot('10-run-lower')
    await runForm.locator('> label.inline input[type=checkbox]').check()
    await runSave.click()
    await sec.locator('> p[role=status]:not(.muted)').waitFor()
    await idle()
    await check('after save: status + focus', async () => `${plain(await sec.locator('> p[role=status]:not(.muted)').textContent())} | focus=${await focused()} | url=${page.url().replace(BASE, '')}`)
    await check('car odometer after correction', async () => (await get(`/vehicles/${car.id}`)).currentOdometerKm)
    await shot('11-after-run')

    // 5. A second run, odometer above, via keyboard save; all OK.
    await rowOf('Monthly').locator('a.run').click()
    await item(0).waitFor()
    await item(0).locator('input[type=radio]').first().check()
    await num(1).fill('2.3')
    await runForm.locator('input[name=odometerKm]').fill(s.unit === 'Mi' ? '33000' : '52000')
    await runSave.click()
    await sec.locator('> p[role=status]:not(.muted)').waitFor(); await idle()
    await check('second run status', async () => plain(await sec.locator('> p[role=status]:not(.muted)').textContent()))
    await check('car odometer now', async () => (await get(`/vehicles/${car.id}`)).currentOdometerKm)
    await check('Monthly row after runs', async () => plain(await rowOf('Monthly').textContent()))
    // Reload: status line gone, data stays.
    await page.reload(); await rowOf('Monthly').waitFor(); await idle()
    await check('after reload status lines', async () => sec.locator('> p[role=status]:not(.muted)').count())

    // 6. History: rename an item, expand, check labels, delete newest.
    const t2 = await get(`/checklist-templates/${monthly.id}`)
    await put(`/checklist-templates/${monthly.id}`, { name: t2.name, items: t2.items.map((x) => ({ id: x.id, label: x.label === 'Lights' ? 'Headlights' : x.label, type: x.type, unit: x.unit, minValue: x.minValue, maxValue: x.maxValue })) })
    await page.reload(); await rowOf('Monthly').waitFor(); await idle()
    const hist = rowOf('Monthly').locator('details.run-history')
    await check('history collapsed', async () => `${plain(await hist.locator('summary').textContent())} open=${await hist.evaluate((e) => e.open)}`)
    await hist.locator('summary').click(); await idle()
    await check('runs listed', async () => (await hist.locator('.run-list > li > details > summary').allTextContents()).map(plain))
    await hist.locator('.run-list > li').nth(1).locator('details > summary').click()
    await check('old run items', async () => (await hist.locator('.run-list > li').nth(1).locator('.run-items li').allTextContents()).map(plain))
    await shot('12-history')
    const pre = rowOf('Pre-road').locator('details.run-history')
    await pre.locator('summary').click(); await idle()
    await check('no runs text', async () => plain(await pre.textContent()))
    await hist.locator('.run-list > li').first().locator('button.delete-run').click()
    await check('delete confirm', async () => `${plain(await hist.locator('.run-list > li').first().locator('.inline-form').textContent())} focus=${await focused()}`)
    await shot('13-delete-confirm')
    await hist.locator('.run-list > li').first().locator('button.danger').click()
    await idle(); await page.waitForTimeout(500)
    await check('after delete', async () => `${await hist.locator('.run-list > li').count()} runs, summary=${plain(await hist.locator('summary').first().textContent())}, focus=${await focused()}`)
    await check('odometer back', async () => (await get(`/vehicles/${car.id}`)).currentOdometerKm)
    // Remove with runs -> hasRuns.
    await rowOf('Monthly').locator('> .actions button.link:not(.edit)').click()
    await rowOf('Monthly').locator('> .inline-form button.danger').click()
    await rowOf('Monthly').locator('> .inline-form [role=alert]').waitFor()
    await check('hasRuns msg', async () => `${plain(await rowOf('Monthly').locator('> .inline-form [role=alert]').textContent())} focus=${await focused()}`)
    await shot('14-hasRuns')
    await page.keyboard.press('Escape')

    // 7. Run page errors via mocks: itemsChanged, invalidValue on item 3, failed load + Retry.
    await rowOf('Monthly').locator('a.run').click(); await item(0).waitFor()
    await item(3).locator('textarea').fill('kept text')
    await page.route('**/api/vehicle-checklists/*/runs', (rt) => rt.request().method() === 'POST' ? rt.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'checklistItem.invalidValue', index: 2, detail: 'x' }) }) : rt.continue())
    await runSave.click(); await runForm.locator('[role=alert]').waitFor()
    await check('invalidValue placement', async () => `in item3=${await item(2).locator('[role=alert]').count()} text=${plain(await runForm.locator('[role=alert]').textContent())} kept=${await item(3).locator('textarea').inputValue()} invalid=${await num(2).getAttribute('aria-invalid')}`)
    await shot('15-run-item-error')
    await page.unroute('**/api/vehicle-checklists/*/runs')
    await page.route('**/api/vehicle-checklists/*/runs', (rt) => rt.request().method() === 'POST' ? rt.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'checklistRun.itemsChanged' }) }) : rt.continue())
    await runSave.click(); await page.waitForTimeout(400)
    await check('itemsChanged', async () => plain(await runForm.locator('[role=alert]').textContent()))
    await page.unroute('**/api/vehicle-checklists/*/runs')
    // Cancel goes back.
    await runForm.locator('> .actions button.link').click(); await idle()
    await check('Cancel -> url', async () => page.url().replace(BASE, ''))
    // Failed load.
    await page.route('**/api/checklist-templates/*', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.goto(`${BASE}/cars/${car.id}`); await rowOf('Monthly').waitFor()
    const runHref = await rowOf('Monthly').locator('a.run').getAttribute('href')
    await page.goto(`${BASE}${runHref}`)
    await page.locator('main [role=alert]').waitFor()
    await check('run load error', async () => plain(await page.locator('main').textContent()))
    await shot('16-run-load-error')
    await page.unroute('**/api/checklist-templates/*')
    await page.locator('main button').last().click(); await item(0).waitFor({ timeout: 4000 }).catch(() => {})
    await check('after Retry form', async () => runForm.locator('fieldset.item').count())
    // Deep link with bad id and archived car.
    await page.goto(`${BASE}/cars/${car.id}/checklists/00000000-0000-0000-0000-000000000000/run`); await idle()
    await check('unknown checklist', async () => plain(await page.locator('main').textContent()))
    const vanCl = (await get(`/vehicles/${van.id}/checklists`))[0]
    await page.goto(`${BASE}/cars/${van.id}/checklists/${vanCl.id}/run`); await idle()
    await check('archived car run', async () => plain(await page.locator('main').textContent()))
    await page.goto(`${BASE}/cars/${van.id}`); await idle()
    await check('archived car section', async () => `${plain(await sec.textContent())} | buttons=${await sec.locator('button:not(summary), a.run').count()}`)

    // 8. Dashboard: Mazda has 2 (picker), Solo 1 (link), Bike and Van none.
    await page.goto(`${BASE}/`); await page.locator('.cars > li').first().waitFor(); await idle()
    const card = (id) => page.locator(`.cars > li[data-id="${id}"]`)
    await check('dashboard start buttons', async () => page.locator('.cars > li').evaluateAll((xs) => xs.map((x) => `${x.querySelector('h2')?.textContent}: ${[...x.querySelectorAll('a, button')].filter((b) => /checklist|רשימת/.test(b.textContent + (b.getAttribute('aria-label') ?? ''))).map((b) => b.tagName + ' ' + (b.getAttribute('aria-label') ?? b.textContent)).join(',') || 'none'}`)))
    const startBtn = card(car.id).locator('button', { hasText: he ? 'ביצוע רשימת בדיקה' : 'Start a checklist' })
    await startBtn.click()
    await check('picker focus + list', async () => `${await focused()} | ${(await card(car.id).locator('.picker li').allTextContents()).map(plain).join(' || ')}`)
    await shot('17-dashboard-picker')
    await page.keyboard.press('Escape')
    await check('focus after Escape picker', focused)
    await startBtn.click()
    await card(car.id).locator('.picker li a').first().click()
    await item(0).waitFor()
    await check('picker opens run', async () => `${page.url().replace(BASE, '')} ${await focused()}`)
    await runForm.locator('> .actions button.link').click(); await idle()
    await check('Cancel from dashboard run', async () => page.url().replace(BASE, ''))
    await card(solo.id).locator('a', { hasText: he ? 'ביצוע' : 'Start' }).click(); await item(0).waitFor()
    await check('single link opens run', async () => page.url().replace(BASE, ''))
    await page.goBack(); await idle()

    // 9. /checklists: delete attached template -> inUse.
    await page.goto(`${BASE}/checklists`); await page.locator('main .checklists li').first().waitFor()
    const tRow = page.locator('main .checklists > li', { hasText: 'Monthly' })
    await tRow.locator('.actions button:not(.edit)').click()
    await tRow.locator('button.danger').click()
    await tRow.locator('[role=alert]').waitFor()
    await check('inUse msg', async () => `${plain(await tRow.locator('[role=alert]').textContent())} rows=${await page.locator('main .checklists > li').count()}`)
    await shot('18-inUse')

    // 10. Record a service: item error still on its row (shared hook).
    await page.goto(`${BASE}/cars/${car.id}`); await idle()
    const svc = page.locator('section[aria-labelledby=service-history]')
    await svc.locator('button.add').click()
    await svc.locator('button.add-part').click()
    await check('focus after add part', focused)
    await svc.locator('button.add-part').click()
    const it2 = svc.locator('fieldset.item').nth(1)
    await svc.locator('fieldset.item').nth(0).locator('input').first().fill('Oil filter')
    await svc.locator('fieldset.item').nth(0).locator('input[type=number]').nth(0).fill('1')
    await svc.locator('fieldset.item').nth(0).locator('input[type=number]').nth(1).fill('10')
    await it2.locator('input').first().fill('   ')
    await it2.locator('input[type=number]').nth(0).fill('1')
    await it2.locator('input[type=number]').nth(1).fill('10')
    await svc.locator('form .actions button:not(.link)').last().click()
    await svc.locator('[role=alert]').first().waitFor()
    await check('service item error on row 2', async () => `row2 alerts=${await it2.locator('[role=alert]').count()} text=${plain(await svc.locator('[role=alert]').first().textContent())} invalid=${await it2.locator('input').first().getAttribute('aria-invalid')}`)
    await svc.locator('fieldset.item').nth(0).locator('button.link').click()
    await check('error follows row after removing row 1', async () => `rows=${await svc.locator('fieldset.item').count()} row1 alert=${plain(await svc.locator('fieldset.item').nth(0).locator('[role=alert]').textContent().catch(() => 'none'))} focus=${await focused()}`)
    await shot('19-service-item-error')
    await page.keyboard.press('Escape')
  } catch (e) { r.crash = e.message.split('\n')[0]; await shot('crash') }
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
