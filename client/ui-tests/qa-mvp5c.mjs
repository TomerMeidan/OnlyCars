// QA of MVP5-C (to-dos on a car, Create to-do from flagged run items, dashboard open to-dos, archived read-only) beyond smoke.
// 4 setups (desktop/390px x light/dark x en/he). Usage (API + Vite running): node ui-tests/qa-mvp5c.mjs   ONLY=<setup>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp5c'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()

const setups = [
  { name: 'desktop-light-en', lng: 'en', theme: 'Light', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-dark-he', lng: 'he', theme: 'Dark', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-light-he', lng: 'he', theme: 'Light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-dark-en', lng: 'en', theme: 'Dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []
const LONG_TITLE = 'Replace the rear left suspension bushing and check the anti-roll bar link, both sides, before winter!!'.slice(0, 100)
const LONG_WORD = 'Supercalifragilisticexpialidocious_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_no_spaces_at_all_here'
const LONG_DESC = ('Line one of a long note.\nThe garage said 2.5 bar front, 2.3 bar rear, 450 ml coolant. ' + 'More words here to fill it up. '.repeat(40)).slice(0, 1000)

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+mvp5c-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En', currency: he ? 'ILS' : 'USD' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  const put = async (p, data) => (await req.put(`${BASE}/api${p}`, { headers: H, data })).json()
  const get = async (p) => (await req.get(`${BASE}/api${p}`, { headers: H })).json()
  const del = async (p) => (await req.delete(`${BASE}/api${p}`, { headers: H })).status()
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: 'Km' } })
  const today = new Date().toISOString().slice(0, 10)

  const car = await post('/vehicles', { nickname: he ? 'מאזדה' : 'Mazda', make: 'Mazda', model: '3', year: 2018, initialOdometerKm: 50000 })
  const longCar = await post('/vehicles', { nickname: 'Long', initialOdometerKm: 1000 })
  await post('/vehicles', { nickname: 'Bike', initialOdometerKm: 900 })
  const van = await post('/vehicles', { nickname: 'Old van', initialOdometerKm: 300000 })
  const tpl = await post('/checklist-templates', { name: he ? 'בדיקה חודשית' : 'Monthly quick check', items: [
    { label: 'Lights', type: 'Check' },
    { label: he ? 'לחץ אוויר' : 'Tire pressure', type: 'Number', unit: 'bar', minValue: 2.0, maxValue: 2.6 },
    { label: 'Body damage', type: 'Text' },
    { label: 'Washer fluid', type: 'Check' },
  ] })
  const ids = tpl.items.map((x) => x.id)
  const runBody = { runAt: today, odometerKm: null, items: [
    { templateItemId: ids[0], boolValue: false },
    { templateItemId: ids[1], numberValue: 1.8 },
    { templateItemId: ids[2], textValue: 'Scratch on the rear bumper', isFlagged: true },
    { templateItemId: ids[3], boolValue: true },
  ] }
  const vc = await post(`/vehicles/${car.id}/checklists`, { templateId: tpl.id, intervalKm: null, intervalDays: 30, date: today })
  await post(`/vehicle-checklists/${vc.id}/runs`, runBody)
  // Long: a 100-char title, a 1000-char description, an unbreakable word, a Latin title in Hebrew.
  await post(`/vehicles/${longCar.id}/issues`, { title: LONG_TITLE, description: LONG_DESC })
  await post(`/vehicles/${longCar.id}/issues`, { title: LONG_WORD, description: LONG_WORD })
  const doneL = await post(`/vehicles/${longCar.id}/issues`, { title: 'Wash 2x', description: null })
  await put(`/issues/${doneL.id}`, { title: 'Wash 2x', description: null, status: 'Done', resolvedAt: today })
  // Van: a to-do open, one done, a run with one flagged item turned into a to-do and one not; then archived.
  const vvc = await post(`/vehicles/${van.id}/checklists`, { templateId: tpl.id, intervalKm: 1000, intervalDays: null, date: today })
  const vrun = (await post(`/vehicle-checklists/${vvc.id}/runs`, runBody)).run
  await post(`/vehicles/${van.id}/issues`, { title: 'Fix the door', description: 'Squeaks' })
  await post(`/vehicles/${van.id}/issues`, { title: 'Lights', description: null, sourceRunItemId: vrun.items.find((x) => x.label === 'Lights').id })
  const vd = await post(`/vehicles/${van.id}/issues`, { title: 'Old done', description: null })
  await put(`/issues/${vd.id}`, { title: 'Old done', description: null, status: 'Done', resolvedAt: today })
  await req.post(`${BASE}/api/vehicles/${van.id}/archive`, { headers: H })

  const ctx = await browser.newContext({ timezoneId: 'UTC', viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
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
    // Overflow against the configured viewport width, not innerWidth (which grows with overflow on mobile).
    const ov = await page.evaluate((w) => ({
      doc: document.documentElement.scrollWidth - w,
      wide: [...document.querySelectorAll('main *')].filter((e) => e.checkVisibility() && (e.getBoundingClientRect().right > w + 1 || e.getBoundingClientRect().left < -1))
        .slice(0, 5).map((e) => `${e.tagName}.${e.className}:${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)}`),
    }), s.viewport.width)
    const small = await page.evaluate(() => [...document.querySelectorAll('main :is(a, button, input, select, textarea, summary)')]
      .filter((e) => e.checkVisibility())
      .map((e) => {
        const box = (['checkbox', 'radio'].includes(e.type) && e.closest('label')) || e
        const b = box.getBoundingClientRect()
        return b.height < 44 || b.width < 44 ? `${e.tagName}:${Math.round(b.width)}x${Math.round(b.height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}` : null
      }).filter(Boolean))
    const y = await page.evaluate(() => scrollY)
    await page.screenshot({ path, fullPage: true })
    await page.evaluate((y) => scrollTo(0, y), y)
    await page.waitForTimeout(300)
    r.checks.push({ name: `shot ${label}`, path, ...(ov.doc > 0 && { overflowPx: ov.doc }), ...(ov.wide.length && { wide: ov.wide }), ...(small.length && { under44: small }) })
  }
  const focused = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}.${a.className} ${(a.getAttribute('aria-label') ?? a.textContent).trim().slice(0, 60)}` })
  const idle = () => page.waitForTimeout(800)
  const isSec = page.locator('section[aria-labelledby=todos]')
  const ck = page.locator('section[aria-labelledby=checklists]')
  const card = (id) => page.locator(`.cars > li[data-id="${id}"]`)

  try {
    await page.goto(`${BASE}/login`)
    await page.fill('input[name=email]', email)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('main h1').waitFor()
    await idle()

    // 1. Dashboard: Long has 2 open (Done not counted), Mazda/Bike none; archived van not on the active list.
    await check('dashboard open-to-do links', async () => page.locator('.cars > li').evaluateAll((xs) => xs.map((x) => `${x.querySelector('h2')?.textContent}: ${[...x.querySelectorAll('a')].map((a) => a.textContent).filter((t) => /to-do|מטל/.test(t)).join(',') || 'none'}`)))
    await check('archived van on dashboard', async () => card(van.id).count())
    await shot('01-dashboard')
    await card(longCar.id).locator('a', { hasText: he ? 'מטלות פתוחות' : 'open to-dos' }).click()
    await isSec.locator('.open-issues > li').first().waitFor(); await idle()
    await check('dashboard link -> url', async () => page.url().replace(BASE, ''))

    // 2. Long texts.
    await isSec.scrollIntoViewIfNeeded()
    await shot('02-long-todos')
    await isSec.locator('details > summary').click()
    await check('done summary + date', async () => plain(await isSec.locator('details').textContent()))
    await shot('03-long-done-open')
    // Edit with whitespace title -> server error, text kept.
    await isSec.locator('.open-issues > li').first().locator('button.edit').click()
    await check('edit focus', focused)
    const ef = isSec.locator('form.inline-form')
    await ef.locator('input[name=title]').fill('   ')
    await ef.locator('textarea[name=description]').fill('kept text')
    await ef.locator('.actions > button:not(.link)').click()
    await page.waitForTimeout(700)
    await check('blank title error', async () => `${plain(await ef.locator('[role=alert]').textContent().catch(() => 'no alert'))} | desc=${await ef.locator('textarea').inputValue()} | validity=${await ef.locator('input[name=title]').evaluate((e) => e.validationMessage)}`)
    await shot('04-edit-blank-title')
    await page.keyboard.press('Escape')
    await check('focus after Escape edit', focused)

    // 3. Mazda: loading, empty, Create to-do from flagged items.
    await page.route('**/api/vehicles/*/issues', async (rt) => { await new Promise((ok) => setTimeout(ok, 1500)); await rt.continue().catch(() => {}) })
    await page.goto(`${BASE}/cars/${car.id}`)
    await check('loading', async () => plain(await isSec.locator('[role=status]').textContent({ timeout: 1500 })))
    await page.unroute('**/api/vehicles/*/issues')
    await idle()
    await check('empty state', async () => plain(await isSec.textContent()))
    const hist = ck.locator('details.run-history')
    await hist.locator('> summary').click(); await idle()
    const runRow = hist.locator('.run-list > li').first()
    await runRow.locator('summary').first().click()
    const item = (i) => runRow.locator('.run-items > li').nth(i)
    await check('run items + buttons', async () => runRow.locator('.run-items > li').evaluateAll((xs) => xs.map((x) => `${x.textContent} [${[...x.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).join(',')}]`)))
    await shot('05-run-items')
    await item(1).locator('button.create-issue').click()
    await check('create prefill', async () => `title=${await item(1).locator('input[name=title]').inputValue()} | desc=${await item(1).locator('textarea').inputValue()} | focus=${await focused()}`)
    await shot('06-create-form')
    await item(1).locator('.actions > button:not(.link)').click()
    await item(1).locator('button.to-issue').waitFor(); await idle()
    await check('after create focus', focused)
    await check('top to-do', async () => plain(await isSec.locator('.open-issues > li').first().textContent()))
    await item(2).locator('button.create-issue').click()
    await check('text item prefill', async () => item(2).locator('textarea').inputValue())
    await item(2).locator('.actions > button:not(.link)').click()
    await item(2).locator('button.to-issue').waitFor(); await idle()
    await shot('07-created')
    // To-do deleted elsewhere, then To-do created clicked.
    const runs = await get(`/vehicle-checklists/${vc.id}/runs`)
    const bodyIssue = runs[0].items[2].issueId
    await del(`/issues/${bodyIssue}`)
    await item(2).locator('button.to-issue').click(); await idle()
    await check('To-do created after delete elsewhere', async () => `${(await item(2).locator('button').allTextContents()).join(',')} | focus=${await focused()} | note=${plain(await hist.locator('> [role=status]').textContent().catch(() => 'none'))}`)
    // Manual add with Latin title and units.
    await isSec.locator('button.add').click()
    await isSec.locator('input[name=title]').fill('Replace wiper blades 2x')
    await isSec.locator('textarea[name=description]').fill('450 ml, 2.5 bar, -3 °C')
    await shot('08-add-form')
    await isSec.locator('form .actions > button:not(.link)').click(); await idle()
    await check('after add focus', focused)
    await shot('09-two-open')
    // Done via keyboard: focus visible.
    const first = isSec.locator('.open-issues > li').first()
    await first.locator('button.done').focus()
    await page.keyboard.press('Enter'); await idle()
    await check('after Done', async () => `focus=${await focused()} | status=${plain(await isSec.locator('> p[role=status]').textContent().catch(() => 'none'))} | done=${plain(await isSec.locator('details').textContent())}`)
    await shot('10-done-focus')
    // Delete the run: its to-do stays without From.
    await runRow.locator('button.delete-run').click()
    await runRow.locator('button.danger').click(); await idle(); await page.waitForTimeout(700)
    await check('to-dos after run delete', async () => (await isSec.locator('.issues > li').allTextContents()).map(plain))
    await shot('11-after-run-delete')

    // 4. Dashboard count for Mazda now (1 open: Tire pressure).
    await page.goto(`${BASE}/`); await page.locator('.cars > li').first().waitFor(); await idle()
    await check('Mazda dashboard link', async () => plain(await card(car.id).locator('a', { hasText: he ? 'מטל' : 'to-do' }).textContent().catch(() => 'none')))

    // 5. Archived van: read-only.
    await page.goto(`${BASE}/cars/${van.id}`); await isSec.locator('.issues > li').first().waitFor(); await idle()
    await isSec.locator('details > summary').click()
    await check('archived to-dos buttons', async () => `${plain(await isSec.textContent())} | buttons=${(await isSec.locator('button').allTextContents()).join(',') || 'none'}`)
    await ck.locator('details.run-history > summary').click(); await idle()
    await ck.locator('.run-list > li summary').first().click()
    await check('archived run item buttons', async () => (await ck.locator('.run-items button').allTextContents()).join(',') || 'none')
    await shot('12-archived')
    if (await ck.locator('.run-items button.to-issue').count()) {
      await ck.locator('.run-items button.to-issue').first().click()
      await check('archived To-do created focus', focused)
    }
    // Load error + Retry.
    await page.route('**/api/vehicles/*/issues', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.goto(`${BASE}/cars/${car.id}`); await isSec.locator('[role=alert]').waitFor()
    await check('load error', async () => plain(await isSec.textContent()))
    await shot('13-load-error')
    await page.unroute('**/api/vehicles/*/issues')
  } catch (e) { r.crash = e.message.split('\n')[0]; await shot('crash') }
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
