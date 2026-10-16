// QA of MVP5-A (/checklists) beyond smoke: 4 setups (desktop/390px x light/dark x en/he), loading, error/Retry,
// client-side validation (empty, out of range, >2 decimals), server errors (blank name/label, min>max), long names,
// two forms open at once, delete failure, keyboard focus, header at 390px, deep link, back button.
// Usage (API + Vite running): node ui-tests/qa-mvp5a.mjs   ONLY=<setup> to run one setup.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp5a'
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

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+mvp5a-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En', currency: he ? 'ILS' : 'USD' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme } })

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
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('header a, header button, main :is(a, button, input, select)')]
      .filter((e) => e.checkVisibility() && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44))
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}`))
    r.checks.push({ name: `shot ${label}`, path, ...(overflow > 0 && { overflowPx: overflow }), ...(small.length && { under44: small }) })
  }
  const focused = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}.${a.className} ${a.getAttribute('aria-label') ?? a.getAttribute('name') ?? a.textContent.trim().slice(0, 30)}` })
  const form = page.locator('main form').first()
  const item = (i) => form.locator('fieldset.item').nth(i)
  const save = form.locator('> .actions > button:not(.link)')
  const vmsg = (loc) => loc.evaluate((el) => el.validationMessage)
  let posts = 0
  page.on('request', (x) => x.url().includes('/api/checklist-templates') && ['POST', 'PUT'].includes(x.method()) && posts++)

  try {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('main h1').waitFor()
  await page.waitForLoadState('networkidle')

  // 1. Header link and loading state (GET delayed 1.5 s).
  await check('header link', async () => plain(await page.locator('header nav a[href="/checklists"]').textContent()))
  await page.route('**/api/checklist-templates', async (rt) => { await new Promise((ok) => setTimeout(ok, 1500)); await rt.continue().catch(() => {}) })
  await page.click('header nav a[href="/checklists"]')
  await check('loading text', async () => plain(await page.locator('main [role=status]').textContent({ timeout: 1000 })))
  await shot('01-loading')
  await page.waitForLoadState('networkidle')
  await page.unroute('**/api/checklist-templates')
  await check('title', async () => `${await page.title()} | h1=${plain(await page.locator('main h1').textContent())}`)

  // 2. Error and Retry.
  await page.route('**/api/checklist-templates', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
  await page.reload()
  await page.locator('main [role=alert]').waitFor()
  await shot('02-load-error')
  await page.unroute('**/api/checklist-templates')
  await page.locator('main .row button').last().click()
  await check('focus after Retry', focused)
  await page.waitForLoadState('networkidle')
  await shot('03-empty')

  // 3. New form: client validation, before any request.
  await page.locator('main button.add').click()
  await check('focus on open', focused)
  const addItem = form.locator('button.add-item')
  await addItem.click()
  await check('focus after add', focused)
  await save.click()
  await check('empty name msg', async () => plain(await vmsg(form.locator('input[name=name]'))))
  await form.locator('input[name=name]').fill('Monthly quick check')
  await save.click()
  await check('empty label msg', async () => plain(await vmsg(item(0).locator('input').first())))
  await item(0).locator('input').first().fill('Lights')
  await addItem.click()
  await page.keyboard.type('Tire pressure')
  await item(1).locator('select').selectOption('Number')
  const [unit, min, max] = [1, 2, 3].map((n) => item(1).locator('input').nth(n))
  await check('min/max attrs', async () => min.evaluate((el) => `type=${el.type} inputmode=${el.inputMode} step=${el.step} dir=${getComputedStyle(el).direction} align=${getComputedStyle(el).textAlign}`))
  await unit.fill('bar')
  await min.fill('2000000')
  const before = posts
  await save.click()
  await check('out of range msg', async () => plain(await vmsg(min)))
  await min.fill('2.005')
  await save.click()
  await check('3 decimals msg', async () => plain(await vmsg(min)))
  await min.fill('-1000000.01')
  await check('below -1M msg', async () => plain(await vmsg(min)))
  await check('no request sent for client errors', async () => { if (posts !== before) throw new Error(`${posts - before} sent`) })
  await min.fill('-5')
  await max.fill('-10')
  await addItem.click()
  await page.keyboard.type('Notes')
  await item(2).locator('select').selectOption('Text')
  // Min above max: server error on row 2.
  await save.click()
  await item(1).locator('[role=alert]').waitFor()
  await check('min>max msg on row 2', async () => plain(await item(1).locator('[role=alert]').textContent()))
  await shot('04-minmax-error')
  // Moving row 2 up: the error follows the row and renumbers.
  await item(1).locator('button.up').click()
  await check('error follows moved row', async () => `row1 alert: ${plain(await item(0).locator('[role=alert]').textContent())}`)
  await check('focus after move up to top', focused)
  await item(0).locator('button.down').click()
  await max.fill('2.6')
  await min.fill('2.0')
  // Blank-after-trim name: server invalidName shown by the name.
  await form.locator('input[name=name]').fill('   ')
  await save.click()
  await page.waitForTimeout(500)
  await check('blank name server error', async () => `${plain(await form.locator('[role=alert]').first().textContent())} | name invalid=${await form.locator('input[name=name]').getAttribute('aria-invalid')}`)
  await shot('05-blank-name')
  await form.locator('input[name=name]').fill('Monthly quick check')
  await item(2).locator('input').first().fill('   ')
  await save.click()
  await page.waitForTimeout(500)
  await check('blank label server error', async () => plain(await item(2).locator('[role=alert]').textContent({ timeout: 1000 })))
  await item(2).locator('input').first().fill('Notes')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot('06-form-390')
  await page.setViewportSize(s.viewport)
  await save.click()
  await page.locator('main .checklists li').first().waitFor()
  await check('focus after save', focused)

  // 4. Long name template and a zero-item one via the API, then list.
  const long = 'Pre-road-trip inspection before the long summer drive to Eilat with the whole family and the dog!!'
  await req.post(`${BASE}/api/checklist-templates`, { headers: H, data: { name: long, items: [{ label: 'X'.repeat(100), type: 'Number', unit: 'kPa per sq inch', minValue: -1000000, maxValue: 1000000 }] } })
  await req.post(`${BASE}/api/checklist-templates`, { headers: H, data: { name: 'Empty one', items: [] } })
  await page.reload()
  await page.locator('main .checklists li').nth(2).waitFor()
  await check('list order and counts', async () => (await page.locator('main .checklists li').allTextContents()).map(plain).join(' || '))
  await shot('07-list')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot('08-list-390')
  // Edit the long one at 390px.
  await page.locator('main .checklists li', { hasText: 'Pre-road' }).locator('button.edit').click()
  await check('long edit values', async () => form.locator('input').evaluateAll((xs) => xs.map((x) => x.value).join('|').slice(0, 300)))
  await shot('09-edit-long-390')
  await page.keyboard.press('Escape')
  await page.setViewportSize(s.viewport)

  // 5. Two forms at once: New + Edit of a row.
  await page.locator('main button.add').click()
  await page.locator('main .checklists li', { hasText: 'Empty one' }).locator('button.edit').click()
  await check('forms open', async () => page.locator('main form').count())
  await shot('10-two-forms')
  await page.keyboard.press('Escape')
  await check('after Escape, forms', async () => `${await page.locator('main form').count()} focus=${await focused()}`)
  await page.locator('main form input[name=name]').first().focus()
  await page.keyboard.press('Escape')
  await check('after 2nd Escape, forms', async () => `${await page.locator('main form').count()} focus=${await focused()}`)

  // 6. Edit Monthly: keyboard focus visible on a move button; Number -> Text clears.
  await page.locator('main .checklists li', { hasText: 'Monthly' }).locator('button.edit').click()
  await item(0).locator('button.down').focus()
  await page.keyboard.press('Enter')
  await check('focus after keyboard move down', focused)
  await check('focus outline on move button', async () => page.evaluate(() => { const c = getComputedStyle(document.activeElement); return `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}` }))
  await shot('11-edit-focus-move')
  await page.keyboard.press('Escape')

  // 7. Delete failure keeps the confirm with an error; then Cancel.
  await page.route('**/api/checklist-templates/*', (rt) => rt.request().method() === 'DELETE' ? rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : rt.continue())
  const emptyRow = page.locator('main .checklists li', { hasText: 'Empty one' })
  await emptyRow.locator('.actions button:not(.edit)').click()
  await check('focus on confirm', focused)
  await emptyRow.locator('button.danger').click()
  await emptyRow.locator('[role=alert]').waitFor()
  await check('delete failure', async () => `${plain(await emptyRow.locator('[role=alert]').textContent())} focus=${await focused()}`)
  await shot('12-delete-error')
  await page.unroute('**/api/checklist-templates/*')
  await emptyRow.locator('.actions button.link').last().click()
  await check('focus after Cancel', focused)

  // 8. Delete the last row in the list: focus goes where?
  const rows = page.locator('main .checklists > li')
  const lastRow = rows.last()
  const lastName = plain(await lastRow.locator('.name').textContent())
  await lastRow.locator('.actions button:not(.edit)').click()
  await lastRow.locator('button.danger').click()
  await page.waitForTimeout(400)
  await check(`focus after deleting last row (${lastName.slice(0, 20)})`, focused)

  // 9. Deep link reload and back button.
  await page.goto(`${BASE}/checklists`)
  await page.locator('main .checklists li').first().waitFor()
  await page.click('header nav a[href="/settings"]')
  await page.goBack()
  await check('back to checklists', async () => `${page.url()} rows=${await page.locator('main .checklists li').count()}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await check('header at 390', async () => page.evaluate(() => { const h = document.querySelector('header'); return `scrollW=${h.scrollWidth} clientW=${h.clientWidth} h=${Math.round(h.getBoundingClientRect().height)}` }))
  await shot('13-header-390')
  } catch (e) { r.crash = e.message.split(String.fromCharCode(10))[0]; await shot('crash') }
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
