// UI smoke run: walks the main flows in two setups and prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/smoke.mjs
import { chromium } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { toCsv } from '../src/csv.ts'
import { yearAgo as yearBack } from '../src/api.ts'

// RPT-3: the CSV builder's RFC 4180 quoting, CRLF, BOM and formula guard (text only; numbers stay as they are).
assert.equal(toCsv([['a,b', 'say "hi"', 'x\r\ny', 5, -5], ['=1', '+1', '-1', '@a', '\tt', '\rr', 'ok']]),
  '﻿"a,b","say ""hi""","x\r\ny",5,-5\r\n\'=1,\'+1,\'-1,\'@a,\'\tt,"\'\rr",ok\r\n')
// ; is quoted (semicolon-locale Excel); = after spaces or control characters, full-width forms, and a leading LF are guarded.
assert.equal(toCsv([['a;b', ' =1', ' +1', '　-1', '\x01@a', '＝1', '＋1', '－1', '＠a', '\nx', 'a=1']]),
  '﻿"a;b",\' =1,\' +1,\'　-1,\'\x01@a,\'＝1,\'＋1,\'－1,\'＠a,"\'\nx",a=1\r\n')

// LOW-8: task, service and checklist calls carry ?today=, so mocks and waits match the path alone.
// at() matches on the path only, so at('/service-records') also catches /api/service-records?skip=...
const ats = new Map() // one function per path, so unroute(at(x)) finds the route(at(x))
const at = (end) => ats.get(end) ?? ats.set(end, (u) => u.pathname.endsWith(end)).get(end)
const pathOf = (x) => new URL(x.url()).pathname
// NAV-1: below 40em Reports, Settings, the language switch and Log out are in the More menu: open it if it is there and closed.
// Waits for More at a phone width (it renders just after a resize); signed out there is none.
const more = async (p) => {
  const b = p.locator('header .tabs > button')
  if (p.viewportSize().width <= 640) await b.waitFor({ timeout: 3000 }).catch(() => {})
  if (await b.isVisible() && (await b.getAttribute('aria-expanded')) !== 'true') await b.click()
}
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const setups = [
  { name: 'desktop-light-en', viewport: { width: 1280, height: 800 }, colorScheme: 'light', lng: 'en' },
  { name: 'mobile-dark-he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', lng: 'he', isMobile: true, hasTouch: true },
]
// SMOKE_ALL=1 adds the other two combinations, so QA can check dark English and light Hebrew too.
// UI_TZ (e.g. UTC, Pacific/Kiritimati) sets the browser timezone, so QA can run where the local date differs from the server's UTC date.
// SMOKE_SETUP=<name> runs that one setup only, for quick checks while fixing; the full run stays the check before a push.
if (process.env.SMOKE_SETUP) setups.splice(0, setups.length, ...setups.filter((x) => x.name === process.env.SMOKE_SETUP))
if (process.env.SMOKE_ALL) setups.push(
  { name: 'desktop-dark-he', viewport: { width: 1280, height: 800 }, colorScheme: 'dark', lng: 'he' },
  { name: 'mobile-light-en', viewport: { width: 390, height: 844 }, colorScheme: 'light', lng: 'en', isMobile: true, hasTouch: true },
)

// PWA-1: a fresh production build served by vite preview (it reuses the /api proxy), for the pwa-install step.
const PREVIEW = 'http://localhost:4173'
const vite = ['node_modules/vite/bin/vite.js']
// No DSN, even one from the environment or a .env file: smoke's crash-page must never reach Sentry.
execFileSync(process.execPath, [...vite, 'build', '--logLevel', 'error'], { stdio: 'inherit', env: { ...process.env, VITE_SENTRY_DSN: '' } })
const answers = () => fetch(PREVIEW).then((r) => r.ok, () => false)
// An orphan from an earlier run would answer in place of this build (--strictPort makes ours exit).
if (await answers()) throw new Error(`${PREVIEW} is already in use: stop that process first`)
const preview = spawn(process.execPath, [...vite, 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
// On Windows the child outlives Node: kill it on every exit, a throw and Ctrl-C included. unref: it must not keep Node alive.
preview.unref()
process.on('exit', () => preview.kill())
process.on('SIGINT', () => process.exit(130))
let up = false
for (let i = 0; i < 50 && preview.exitCode === null && !(up = await answers()); i++) await new Promise((r) => setTimeout(r, 200))
if (preview.exitCode !== null || !up) throw new Error(`vite preview did not start on ${PREVIEW} (exit code ${preview.exitCode})`)

const browser = await chromium.launch({ channel: 'chrome' })
const report = []

for (const s of setups) {
  const ctx = await browser.newContext({ timezoneId: process.env.UI_TZ, viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  const run = { setup: s.name, steps: [], consoleErrors: [], badResponses: [] }
  page.on('console', (m) => m.type() === 'error' && run.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => run.consoleErrors.push(String(e)))
  const sentryRequests = []
  ctx.on('request', (r) => /sentry/i.test(new URL(r.url()).host) && sentryRequests.push(new URL(r.url()).host))
  // A signed photo URL's query is a credential: never printed.
  page.on('response', (r) => r.status() >= 400 && run.badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(/\?.*X-Amz-.*/s, '?<signed>')}`))

  // Against the set viewport width: with isMobile, innerWidth grows to fit a too-wide page and hides the overflow.
  // A navigation during the measure destroys its context (L123): wait for the page to settle and measure once more, then fail for real.
  const measure = () => page.evaluate((w) => document.documentElement.scrollWidth - w, page.viewportSize().width)
  const overflowPx = () => measure().catch(async () => { await page.waitForLoadState('load').catch(() => {}); return measure() })
  let n = 0
  async function step(name, fn) {
    const shot = `${OUT}/${s.name}-${String(++n).padStart(2, '0')}-${name}.png`
    try {
      await fn()
      run.steps.push({ step: name, ok: true, screenshot: shot })
    } catch (e) {
      run.steps.push({ step: name, ok: false, error: e.message.split('\n')[0], screenshot: shot })
      console.error(`FAIL ${s.name} ${name}: ${e.message.split('\n')[0]}`) // printed now, so a later crash can't hide it
    }
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({ path: shot, fullPage: true })
    // Page wider than the viewport means horizontal scrolling, a layout bug.
    const overflow = await overflowPx().catch((e) => { Object.assign(run.steps.at(-1), { ok: false, error: `overflow check: ${e.message.split('\n')[0]}` }); return 0 })
    if (overflow > 0) run.steps.at(-1).horizontalOverflowPx = overflow
  }

  const odometer = () => page.locator('.odometer').first().getAttribute('aria-label')
  const digitsOnly = (v) => (v ?? '').replace(/\D/g, '')

  // MVP1-C: page titles, focus after navigation and actions, history button sizes.
  const he = s.lng === 'he'
  const T = he
    ? { login: 'התחברות', register: 'יצירת חשבון', dashboard: 'לוח בקרה', addCar: 'הוספת רכב', editCar: 'עריכת רכב' }
    : { login: 'Log in', register: 'Create account', dashboard: 'Dashboard', addCar: 'Add car', editCar: 'Edit car' }
  const editSel = (v) => `button[aria-label="${he ? `עריכה של הקריאה ${v} ק״מ` : `Edit reading ${v} km`}"]`
  const deleteSel = (v) => `button[aria-label="${he ? `מחיקה של הקריאה ${v} ק״מ` : `Delete reading ${v} km`}"]`
  const active = () => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100))
  async function focusIs(selector, what) {
    try {
      await page.waitForFunction((sel) => document.activeElement?.matches(sel), selector, { timeout: 3000 })
    } catch {
      throw new Error(`${what}: focus is on ${await active()}`)
    }
  }
  async function titleIs(name) {
    const want = `${name} · OnlyCars`
    await page.waitForFunction((w) => document.title === w, want, { timeout: 3000 }).catch(async () => {
      throw new Error(`title "${await page.title()}", want "${want}"`)
    })
  }
  // Criteria 2 and 3: after a client-side navigation, focus is on the new page's h1 and the title is set.
  const arrivedAt = async (name) => {
    await focusIs('main h1', `h1 after navigating to ${name}`)
    await titleIs(name)
  }
  const heightOf = (loc) => loc.evaluate((el) => el.getBoundingClientRect().height)
  async function tall(loc, what) {
    const h = Math.round(await heightOf(loc) * 100) / 100 // 43.99997 is 44 laid out on a fractional pixel
    if (h < 44) throw new Error(`${what} is ${h}px tall`)
  }
  // Every visible link and button on the page is a 44px tap target; a text-link button is also 44px wide (LOW-3 L48).
  async function sweep(what) {
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button')]
      .filter((el) => el.checkVisibility())
      .map((el) => { const r = el.getBoundingClientRect(); return [el.textContent.trim() || el.getAttribute('aria-label'), Math.round(r.height), el.matches('button.link') ? Math.round(r.width) : 44] })
      .filter(([, h, w]) => h < 44 || w < 44))
    if (small.length) throw new Error(`${what} under 44px: ${JSON.stringify(small)}`)
  }
  async function noOverflow(what) {
    const px = await overflowPx()
    if (px > 0) throw new Error(`${px}px horizontal overflow with ${what}`)
  }

  await step('login-page', async () => {
    await page.goto(`${BASE}/login`)
    await page.locator('input[name=email]').waitFor()
    await titleIs(T.login)
    // The first load keeps the browser's default focus. A navigation just after it destroys the context (L185): wait for it, then read again.
    const moved = () => page.evaluate(() => document.activeElement !== document.body)
    if (await moved().catch(async () => { await page.waitForLoadState('load'); await page.locator('input[name=email]').waitFor(); return moved() }))
      throw new Error(`first load moved focus to ${await active()}`)
  })
  let currencyOptions, defaultCurrency, registered
  await step('register', async () => {
    await page.click('a[href="/register"]')
    await arrivedAt(T.register)
    await page.fill('input[name=email]', `ui-${s.name}-${Date.now()}@onlycars.test`)
    await page.fill('input[name=password]', 'Passw0rd!')
    currencyOptions = await page.locator('select[name=currency] option').allTextContents()
    defaultCurrency = await page.inputValue('select[name=currency]')
    const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/register'))
    await page.click('form button:not(.link)')
    registered = await (await response).json()
    await page.locator('a[href="/cars/new"]').waitFor()
    await arrivedAt(T.dashboard)
  })
  await step('register-currency', async () => {
    // The default follows the UI language, and the auth response returns what was saved.
    const expected = s.lng === 'he' ? 'ILS' : 'USD'
    if (defaultCurrency !== expected) throw new Error(`default currency ${defaultCurrency}`)
    if (registered?.user?.currency !== expected) throw new Error(`saved currency ${registered?.user?.currency}`)
    if (registered?.user?.locale !== (s.lng === 'he' ? 'He' : 'En')) throw new Error(`saved locale ${registered?.user?.locale}`)
    if (currencyOptions.map((o) => o.slice(0, 3)).join() !== 'ILS,USD,EUR,GBP') throw new Error(`options: ${currencyOptions}`)
    if (!currencyOptions[0].includes(s.lng === 'he' ? 'שקל' : 'Shekel')) throw new Error(`ILS label: ${currencyOptions[0]}`)
  })
  // MVP3-C: /history, every car's services. Before any car exists, it shows the empty state.
  const HS = he
    ? { title: 'היסטוריית טיפולים', empty: 'עדיין לא נרשמו טיפולים.', noMatches: 'אין טיפולים שתואמים לסינון.', clear: 'ניקוי הסינון', showMore: 'הצגת עוד', retry: 'ניסיון חוזר',
        archived: 'בארכיון', searchAll: 'חיפוש בכל ההיסטוריה', labels: ['חיפוש', 'משימה', 'מתאריך', 'עד תאריך'], allCars: 'כל הרכבים',
        dates: 'תאריך ההתחלה לא יכול להיות אחרי תאריך הסיום.', tooLong: 'יש להזין חיפוש של עד 100 תווים.', generic: 'משהו השתבש. אפשר לנסות שוב.',
        summary: (n, total) => `${n === 1 ? 'טיפול אחד' : n === 2 ? 'שני טיפולים' : `${n.toLocaleString('he')} טיפולים`}, סה״כ ${total}` }
    : { title: 'Service history', empty: 'No services recorded yet.', noMatches: 'No services match these filters.', clear: 'Clear filters', showMore: 'Show more', retry: 'Retry',
        archived: 'Archived', searchAll: 'Search all history', labels: ['Search', 'Task', 'From date', 'To date'], allCars: 'All cars',
        dates: 'The start date must not be after the end date.', tooLong: 'Enter a search of up to 100 characters.', generic: 'Something went wrong. Please try again.',
        summary: (n, total) => `${n.toLocaleString('en')} service${n === 1 ? '' : 's'}, total ${total}` }
  const histStatus = page.locator('main .card > p[role=status]')
  // SRCH-1b: a table row per service; the car is a row of pills (one pressed), the task the only select.
  const histRows = page.locator('main tr.record')
  const filterBar = page.locator('main .filters')
  const carPill = (name) => filterBar.locator('fieldset button').filter({ hasText: name }).first()
  const carPressed = () => filterBar.locator('fieldset button[aria-pressed=true]').textContent().then((x) => x.replace(/[⁦-⁩]/g, '').trim()) // plain() is defined later
  const taskFilter = filterBar.locator('select')
  const fromFilter = filterBar.locator('input[type=date]').nth(0)
  const toFilter = filterBar.locator('input[type=date]').nth(1)
  const searchBox = filterBar.locator('input[type=search]')
  const clearBtn = filterBar.getByRole('button', { name: HS.clear, exact: true })
  await step('history-empty', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.click('header a[href="/spending"]')
    await arrivedAt(HS.title)
    await histStatus.filter({ hasText: HS.empty }).waitFor()
    if (await histRows.count()) throw new Error('rows without records')
    if (await clearBtn.count()) throw new Error('Clear filters shown without filters')
    // Every filter has a visible label and is 44px tall; the task select waits for a car.
    const labels = await filterBar.locator('label').evaluateAll((ls) => ls.map((l) => l.firstChild.textContent.trim()))
    if (labels.join('|') !== HS.labels.join('|')) throw new Error(`labels ${labels}`)
    if ((await carPressed()) !== HS.allCars) throw new Error(`car pill ${await carPressed()}`)
    for (const c of await filterBar.locator('select, input').all()) await tall(c, 'a filter')
    if (!(await taskFilter.isDisabled())) throw new Error('task select enabled without a car')
    await noOverflow('the header and the empty history')
    await sweep('the empty history')
    await page.setViewportSize(s.viewport)
    await page.click('header a.brand')
    await page.locator('a[href="/cars/new"]').waitFor()
  })
  await step('add-car', async () => {
    await page.click('a[href="/cars/new"]')
    await arrivedAt(T.addCar)
    await page.fill('input[name=nickname]', 'Test Corolla')
    // Criterion 9: an initial odometer over 10,000,000 is blocked by the input, and the form keeps its values.
    await page.fill('input[name=initialOdometerKm]', '20000000')
    let posted = 0
    const countPost = (r) => r.method() === 'POST' && r.url().endsWith('/api/vehicles') && posted++
    page.on('request', countPost)
    await page.click('form button:not(.link)')
    await page.waitForTimeout(300)
    page.off('request', countPost)
    if (posted || new URL(page.url()).pathname !== '/cars/new') throw new Error(`20000000 submitted: ${posted} POST, at ${page.url()}`)
    if (!(await page.locator('input[name=initialOdometerKm]').evaluate((el) => el.validity.rangeOverflow))) throw new Error('20000000 not blocked')
    if ((await page.inputValue('input[name=nickname]')) !== 'Test Corolla') throw new Error('form lost its values')
    await page.fill('input[name=make]', 'Toyota')
    await page.fill('input[name=model]', 'Corolla')
    await page.fill('input[name=year]', '2018')
    await page.fill('input[name=plate]', '12-345-67')
    await page.selectOption('select[name=fuelType]', 'Hybrid')
    await page.fill('input[name=initialOdometerKm]', '61000')
    // LOW-3 L36: the first reading is dated with the local date, as quick-add's.
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/vehicles'))
    await page.click('form button:not(.link)')
    const readingDate = (await sent).postDataJSON().readingDate
    const today = await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
    if (readingDate !== today) throw new Error(`new car readingDate ${readingDate}, want ${today}`)
    await page.locator('.cars > li').first().waitFor()
    if (digitsOnly(await odometer()) !== '61000') throw new Error(`odometer shows ${await odometer()}`)
  })
  await step('odometer-update', async () => {
    await page.fill('.quick input[type=number]', '61250')
    // Hold the POST briefly so the in-flight state is observable: a second tap must not add a second reading.
    await page.route('**/odometer', async (r) => { await page.waitForTimeout(500); await r.continue() }, { times: 1 })
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/odometer'))
    await page.click('.quick button')
    // The quick-add dates the reading with the user's local date.
    const readingDate = (await sent).postDataJSON().readingDate
    const today = await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
    if (readingDate !== today) throw new Error(`quick-add readingDate ${readingDate}, want ${today}`)
    if (!(await page.locator('.quick button').isDisabled())) throw new Error('Update button not disabled while saving')
    await page.waitForFunction(() => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === '61250')
    const label = await odometer()
    if (label !== (s.lng === 'he' ? '61,250 ק״מ' : '61,250 km')) throw new Error(`odometer label "${label}"`)
  })
  await step('odometer-lower-rejected', async () => {
    await page.fill('.quick input[type=number]', '60000')
    await page.click('.quick button')
    const text = await page.locator('.quick .error').textContent()
    await page.locator('.quick input[type=checkbox]').waitFor()
    if (!digitsOnly(text).includes('61250')) throw new Error(`error lacks the current reading: "${text}"`)
    if (s.lng === 'he' && /[A-Za-z]/.test(text)) throw new Error(`Hebrew error has Latin letters: "${text}"`)
  })
  await step('odometer-correction-confirmed', async () => {
    await page.check('.quick input[type=checkbox]')
    await page.click('.quick button')
    await page.waitForFunction(() => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === '60000')
  })
  await step('odometer-history', async () => {
    await page.click('.cars > li h2 a')
    await page.locator('.history li').first().waitFor()
    await arrivedAt('Test Corolla')
    const rows = await page.locator('.history li').allTextContents()
    // Newest first: the correction, the update, then the initial reading from add-car.
    const values = await page.locator('.history .value bdi').allTextContents()
    if (values.map(digitsOnly).join() !== '60000,61250,61000') throw new Error(`history values: ${values}`)
    if (s.lng === 'he' && rows.some((r) => /[A-Za-z]/.test(r))) throw new Error(`Hebrew history has Latin letters: ${rows}`)
    const dir = await page.locator('.history').evaluate((el) => getComputedStyle(el).direction)
    if (dir !== (s.lng === 'he' ? 'rtl' : 'ltr')) throw new Error(`history direction is ${dir}`)
  })
  const values = () => page.locator('.history .value bdi').allTextContents().then((v) => v.map(digitsOnly).join())
  const waitFor = async (check, what) => {
    for (let i = 0; i < 50 && !(await check()); i++) await page.waitForTimeout(100)
    if (!(await check())) throw new Error(`${what}: history ${await values()}, odometer ${await odometer()}`)
  }
  await step('back-link-focus-ring', async () => {
    // Criterion 4: a 44px tap target, with the keyboard focus ring on the text only. Shift+Tab from the h1 reaches it.
    await page.keyboard.press('Shift+Tab')
    await focusIs('a.back', 'Shift+Tab from the h1')
    await tall(page.locator('a.back'), 'back link')
    const ring = await page.locator('a.back').evaluate((a) => [getComputedStyle(a).outlineStyle, getComputedStyle(a.firstElementChild).outlineStyle].join())
    if (ring !== 'none,solid') throw new Error(`outline link,text: ${ring}`)
  })
  // Criteria 5 to 8 at 390px wide (the desktop setup narrows for these steps).
  await step('history-buttons-escape-edit', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const row = page.locator('.history li').nth(1)
    await tall(row.locator(editSel('61,250')), 'Edit')
    await tall(row.locator(deleteSel('61,250')), 'Delete')
    await row.locator(editSel('61,250')).click()
    await tall(row.locator('.inline-form button.link'), 'Cancel')
    await noOverflow('the edit form open')
    await page.keyboard.press('Escape')
    await row.locator('form').waitFor({ state: 'detached' })
    await focusIs(editSel('61,250'), 'after Escape')
  })
  await step('history-delete-confirm-danger', async () => {
    const row = page.locator('.history li').nth(1)
    await row.locator(deleteSel('61,250')).click()
    const confirm = row.locator('button.danger')
    await tall(confirm, 'confirm Delete')
    await tall(row.locator('.inline-form button.link'), 'Cancel')
    await noOverflow('the delete confirmation open')
    // Criterion 8: red, with text contrast of at least 4.5:1.
    const ratio = await confirm.evaluate((el) => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const [a, b] = [lum(getComputedStyle(el).color), lum(getComputedStyle(el).backgroundColor)].sort((x, y) => y - x)
      return (a + 0.05) / (b + 0.05)
    })
    if (ratio < 4.5) throw new Error(`confirm Delete contrast ${ratio.toFixed(2)}:1`)
    await page.keyboard.press('Escape')
    await row.locator('.inline-form').waitFor({ state: 'detached' })
    await focusIs(deleteSel('61,250'), 'after Escape on the delete confirmation')
  })
  await step('history-cancel-delete', async () => {
    const row = page.locator('.history li').nth(1)
    await row.locator(deleteSel('61,250')).click()
    await row.locator('.inline-form button.link').click()
    await focusIs(deleteSel('61,250'), 'after Cancel')
  })
  await step('tap-targets-car-page', async () => {
    await sweep('car page at 390px')
  })
  await step('edit-reading', async () => {
    await page.setViewportSize(s.viewport)
    // Lowering 61250 below the 61000 before it needs a correction; editing an older reading keeps the odometer.
    const row = page.locator('.history li').nth(1)
    await row.getByRole('button', { name: s.lng === 'he' ? 'עריכה של הקריאה 61,250 ק״מ' : 'Edit reading 61,250 km' }).click()
    await row.locator('input[name=valueKm]').fill('59000')
    await row.locator('.inline-form button:not(.link)').click()
    const text = await row.locator('.error').textContent()
    if (!digitsOnly(text).includes('61000')) throw new Error(`error lacks the previous reading: "${text}"`)
    if (s.lng === 'he' && /[A-Za-z]/.test(text)) throw new Error(`Hebrew error has Latin letters: "${text}"`)
    await row.locator('input[type=checkbox]').check()
    await row.locator('.inline-form button:not(.link)').click()
    await waitFor(async () => (await values()) === '60000,59000,61000' && digitsOnly(await odometer()) === '60000', 'after edit')
    await focusIs(editSel('59,000'), 'after Save') // criterion 6
  })
  await step('delete-reading', async () => {
    // Deleting the latest reading makes the one before it current.
    const row = page.locator('.history li').first()
    await row.getByRole('button', { name: s.lng === 'he' ? 'מחיקה של הקריאה 60,000 ק״מ' : 'Delete reading 60,000 km' }).click()
    await row.locator('.inline-form button:not(.link)').click()
    await waitFor(async () => (await values()) === '59000,61000' && digitsOnly(await odometer()) === '59000', 'after delete')
    await focusIs(editSel('59,000'), 'after Delete (the next older row)')
  })

  // MVP2-A: maintenance tasks. The odometer is at 59,000 here.
  const TK = he
    ? { add: 'הוספת משימה', belt: 'רצועת טיימינג', custom: 'משימה מותאמת אישית', wash: 'שטיפה', wash2: 'שטיפה וווקס', edit: 'עריכה של ', del: 'מחיקה של ', on: 'פעילה: ', off: 'לא פעילה', beltInterval: 'כל 100,000 ק״מ או 5 שנים', sixMonths: 'כל 6 חודשים', twelveMonths: 'כל 5,000 ק״מ או 12 חודשים', year: 'כל 5,000 ק״מ או שנה' }
    : { add: 'Add task', belt: 'Timing belt', custom: 'Custom task', wash: 'Wash', wash2: 'Wash and wax', edit: 'Edit ', del: 'Delete ', on: 'Enabled: ', off: 'Disabled', beltInterval: 'Every 100,000 km or 5 years', sixMonths: 'Every 6 months', twelveMonths: 'Every 5,000 km or 12 months', year: 'Every 5,000 km or 1 year' }
  const tasks = page.locator('section[aria-labelledby=maintenance]')
  const taskNames = () => tasks.locator('.tasks .name').allTextContents()
  const taskRow = (name) => tasks.locator('.tasks > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const taskBtn = (verb, name) => tasks.getByRole('button', { name: verb + name, exact: true })
  const plain = (s) => s.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()
  const noLatin = (text, what) => { if (he && /[A-Za-z]/.test(text)) throw new Error(`Hebrew ${what} has Latin letters: "${text}"`) }

  // MVP3-A: service history.
  const SV = he
    ? { items: 'חלקים ועבודה', empty: 'עדיין לא נרשמו טיפולים.', record: 'רישום טיפול', diy: 'טיפול עצמי', editOf: 'עריכת הטיפול מ־', deleteOf: 'מחיקת הטיפול מ־', gone: 'הטיפול הזה כבר נמחק.', editHint: 'כדי לשנות את התאריך, הקילומטראז׳ או המשימות', labour: 'עבודה', item2Qty: 'פריט 2: יש להזין כמות בין 0.01 ל־10,000, עם עד 2 ספרות אחרי הנקודה.', taskGone: 'אחת המשימות שסומנו נמחקה, ורשימת המשימות עודכנה. יש לבדוק את הבחירה ולשמור שוב.', item2Hours: 'פריט 2, שעות', item1Part: 'פריט 1, מק״ט', legend: 'משימות שבוצעו', hint: 'בטיפול עצמי יש להשאיר ריק.', future: 'תאריך הטיפול לא יכול להיות בעתיד.', km: 'ק״מ', generic: 'משהו השתבש. אפשר לנסות שוב.', odoLabel: 'קילומטראז׳ במיילים', at59500: 'ב־59,500 ק״מ', at59000: 'ב־59,000 ק״מ' }
    : { items: 'Parts and labour', empty: 'No services recorded yet.', record: 'Record a service', diy: 'DIY', editOf: 'Edit the service from ', deleteOf: 'Delete the service from ', gone: 'This service was already deleted.', editHint: 'To change the date, odometer or tasks', labour: 'Labour', item2Qty: 'Item 2: Enter a quantity above 0 and up to 10,000 with up to 2 decimals.', taskGone: 'A task you ticked was deleted, and the task list has been updated. Check your selection and save again.', item2Hours: 'Item 2, Hours', item1Part: 'Item 1, Part number', legend: 'Tasks done', hint: 'Leave empty for DIY.', future: "The service date can't be in the future.", km: 'km', generic: 'Something went wrong. Please try again.', odoLabel: 'Odometer in miles', at59500: 'at 59,500 km', at59000: 'at 59,000 km' }
  const services = page.locator('section[aria-labelledby=service-history]')
  const serviceItems = () => services.locator('.services > li')
  const recordForm = services.locator('form')
  const recordBtn = services.getByRole('button', { name: SV.record, exact: true })
  const isRecordPost = (r) => r.method() === 'POST' && pathOf(r).endsWith('/service-records')
  await step('service-history-empty', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const empty = services.locator('p.muted', { hasText: SV.empty })
    await empty.waitFor()
    noLatin(await services.textContent(), 'service history')
    // A failed load shows the translated error in the section; the rest of the page stays.
    await page.route(at('/service-records'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    const alert = services.locator('[role=alert]')
    await alert.waitFor()
    await page.unroute(at('/service-records'))
    if ((await alert.textContent()) !== SV.generic) throw new Error(`load error "${await alert.textContent()}"`)
    if (!(await page.locator('.history li').count())) throw new Error('odometer history gone with the service history error')
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 '))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    await page.reload()
    await empty.waitFor()
    await tall(recordBtn, 'Record a service')
    await noOverflow('the empty service history')
    await page.setViewportSize(s.viewport)
  })

  await step('tasks-empty-and-picker', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await tasks.locator('p.muted').filter({ hasText: he ? 'עדיין אין משימות תחזוקה.' : 'No maintenance tasks yet.' }).waitFor()
    // Maintenance first, then To-dos (MVP5-C), Documents (NOT-1), Checklists (MVP5-B), Tires (MVP5-D), the service history and the odometer history.
    const order = await page.evaluate(() => [...document.querySelectorAll('main section h2')].map((h) => h.id).join())
    if (order !== 'maintenance,todos,documents,checklists,tires,service-history,odometer-history') throw new Error(`sections: ${order}`)
    await tasks.getByRole('button', { name: TK.add }).click()
    const options = await tasks.locator('.picker li button').allTextContents()
    if (options.length !== 13) throw new Error(`${options.length} picker options`)
    if (!options.some((o) => plain(o).startsWith(TK.belt) && plain(o).includes(TK.beltInterval))) throw new Error(`no ${TK.belt} option: ${options}`)
    if (plain(options.at(-1)) !== TK.custom) throw new Error(`last option "${options.at(-1)}"`)
    noLatin(options.join(), 'picker')
    await focusIs('.picker li:first-child button', 'picker open')
    await noOverflow('the template picker open')
    await sweep('car page with the picker open')
  })
  await step('task-form-prefill', async () => {
    await tasks.locator('.picker button', { hasText: TK.belt }).click()
    const form = tasks.locator('form')
    await focusIs('form input[name=name]', 'add form open')
    const got = await form.evaluate((f) => Object.fromEntries([...new FormData(f)]))
    const want = { name: TK.belt, category: 'Belts', intervalKm: '100000', intervalTime: '5', intervalUnit: 'years', lastDoneOdometerKm: '59000' }
    for (const [k, v] of Object.entries(want)) if (got[k] !== v) throw new Error(`${k} is "${got[k]}", want "${v}"`)
    const date = form.locator('input[name=lastDoneDate]')
    const today = await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
    if ((await date.inputValue()) !== today || (await date.getAttribute('max')) !== today) throw new Error(`date ${await date.inputValue()}, max ${await date.getAttribute('max')}`)
    await noOverflow('the add form open')
    await sweep('car page with the add form open')
  })
  await step('add-task-template', async () => {
    const res = page.waitForResponse((r) => r.request().method() === 'POST' && pathOf(r).endsWith('/tasks'))
    await tasks.locator('form button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (!body.templateId?.endsWith('09')) throw new Error(`templateId ${body.templateId}`)
    await taskRow(TK.belt).waitFor()
    await focusIs(`button[aria-label="${TK.edit}${TK.belt}"]`, 'after Save')
    const text = plain(await taskRow(TK.belt).textContent())
    if (!text.includes(TK.beltInterval)) throw new Error(`row "${text}"`)
    if (!text.includes(he ? 'ב־59,000 ק״מ' : 'at 59,000 km')) throw new Error(`last done missing: "${text}"`)
    noLatin(text, 'task row')
  })
  await step('add-task-custom', async () => {
    await tasks.getByRole('button', { name: TK.add }).click()
    await tasks.locator('.picker button', { hasText: TK.custom }).click()
    const form = tasks.locator('form')
    if ((await form.locator('input[name=name]').inputValue()) !== '') throw new Error('custom name prefilled')
    await form.locator('input[name=name]').fill(TK.wash)
    // No interval: the client stops it before sending.
    let posted = 0
    const countPost = (r) => r.method() === 'POST' && pathOf(r).endsWith('/tasks') && posted++
    page.on('request', countPost)
    await form.locator('button:not(.link)').click()
    await page.waitForTimeout(300)
    page.off('request', countPost)
    const required = await form.locator('[role=alert]').textContent()
    if (posted || required !== (he ? 'יש להזין מרווח בק״מ, מרווח זמן או את שניהם.' : 'Enter an interval in km, a time interval, or both.')) throw new Error(`${posted} POST, "${required}"`)
    // A last-done km above the odometer: the server's error names the current km, and the input is kept.
    await form.locator('input[name=intervalTime]').fill('6')
    await form.locator('select[name=intervalUnit]').selectOption('months')
    await form.locator('select[name=category]').selectOption('Other')
    await form.locator('input[name=lastDoneOdometerKm]').fill('70000')
    await form.locator('button:not(.link)').click()
    await page.waitForFunction(() => /59/.test(document.querySelector('section[aria-labelledby=maintenance] form [role=alert]')?.textContent ?? ''))
    const err = await form.locator('[role=alert]').textContent()
    if (!plain(err).includes('59,000')) throw new Error(`invalidLastDone: "${err}"`)
    noLatin(err, 'error')
    if ((await form.locator('input[name=name]').inputValue()) !== TK.wash) throw new Error('form lost its input')
    await form.locator('input[name=lastDoneOdometerKm]').fill('58000')
    const res = page.waitForResponse((r) => r.request().method() === 'POST' && pathOf(r).endsWith('/tasks'))
    await form.locator('button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.templateId !== null || body.intervalDays !== 180 || body.intervalKm !== null) throw new Error(`body ${JSON.stringify(body)}`)
    await taskRow(TK.wash).waitFor()
    if (!plain(await taskRow(TK.wash).textContent()).includes(TK.sixMonths)) throw new Error(`row "${await taskRow(TK.wash).textContent()}"`)
    await focusIs(`button[aria-label="${TK.edit}${TK.wash}"]`, 'after Save')
    if ((await taskNames()).join() !== [TK.belt, TK.wash].join()) throw new Error(`order ${await taskNames()}`)
  })
  await step('edit-task', async () => {
    // Escape returns focus to Edit; then a real edit: name, km interval, 6 months to 1 year.
    await taskBtn(TK.edit, TK.wash).click()
    await noOverflow('an edit form open')
    await page.keyboard.press('Escape')
    await taskRow(TK.wash).locator('form').waitFor({ state: 'detached' })
    await focusIs(`button[aria-label="${TK.edit}${TK.wash}"]`, 'after Escape')
    await taskBtn(TK.edit, TK.wash).click()
    const form = taskRow(TK.wash).locator('form')
    await form.locator('input[name=name]').fill(TK.wash2)
    await form.locator('input[name=intervalKm]').fill('5000')
    await form.locator('input[name=intervalTime]').fill('12')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await form.locator('button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.intervalDays !== 360) throw new Error(`12 months sent ${body.intervalDays} days`)
    await taskRow(TK.wash2).waitFor()
    await focusIs(`button[aria-label="${TK.edit}${TK.wash2}"]`, 'after Save')
    // 360 days is shown as 12 months, in the row and in the reopened form; now save 1 year.
    const shown = plain(await taskRow(TK.wash2).textContent())
    if (!shown.includes(TK.twelveMonths)) throw new Error(`row "${shown}"`)
    await taskBtn(TK.edit, TK.wash2).click()
    const prefill = await taskRow(TK.wash2).locator('form').evaluate((f) => Object.fromEntries([...new FormData(f)]))
    if (prefill.intervalTime !== '12' || prefill.intervalUnit !== 'months') throw new Error(`reopened ${prefill.intervalTime} ${prefill.intervalUnit}`)
    await taskRow(TK.wash2).locator('input[name=intervalTime]').fill('1')
    await taskRow(TK.wash2).locator('select[name=intervalUnit]').selectOption('years')
    await taskRow(TK.wash2).locator('form button:not(.link)').click()
    await taskRow(TK.wash2).locator('form').waitFor({ state: 'detached' })
    const text = plain(await taskRow(TK.wash2).textContent())
    if (!text.includes(TK.year)) throw new Error(`row "${text}"`)
  })
  await step('task-date-too-early', async () => {
    // LOW-4 L67, L68: a last done date before 1900 is the server's date.tooEarly, on the date field.
    await taskBtn(TK.edit, TK.wash2).click()
    const form = taskRow(TK.wash2).locator('form')
    const date = form.locator('input[name=lastDoneDate]')
    await date.fill('1899-12-31')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await form.locator('button:not(.link)').click()
    if ((await res).status() !== 400) throw new Error('not a 400')
    const alert = form.locator('[role=alert]')
    await alert.waitFor()
    const min = await page.evaluate((l) => new Date('1900-01-01').toLocaleDateString(l, { dateStyle: 'medium', timeZone: 'UTC' }), s.lng)
    const want = he ? `התאריך לא יכול להיות לפני ${min}.` : `The date can't be before ${min}.`
    if (plain(await alert.textContent()) !== want) throw new Error(`tooEarly "${await alert.textContent()}"`)
    if ((await date.getAttribute('aria-invalid')) !== 'true' || (await date.getAttribute('aria-describedby')) !== (await alert.getAttribute('id'))) throw new Error('tooEarly not on the date')
    // LOW-5 L87: after a failed save, focus is back on the field the error is about, so Escape still closes the form.
    await focusIs('form input[name=lastDoneDate]', 'after date.tooEarly')
    // A 400 on the name (no code): focus goes to the first field, the name.
    await date.fill(await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)))
    const stubbed = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/tasks/'))
    await page.route('**/api/vehicles/*/tasks/*', (r) => r.fulfill({ status: 400, contentType: 'application/problem+json', body: JSON.stringify({ title: 'One or more validation errors occurred.', errors: { Name: ['The Name field is required.'] } }) }), { times: 1 })
    await form.locator('button:not(.link)').click()
    await stubbed
    await focusIs('form input[name=name]', 'after a 400 on the name')
    run.badResponses = run.badResponses.filter((r) => !(r.startsWith('400 ') && r.includes('/tasks/')))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('status of 400'))
    await page.keyboard.press('Escape')
    await form.waitFor({ state: 'detached' })
    await focusIs(`button[aria-label="${TK.edit}${TK.wash2}"]`, 'after Escape from a failed save')
  })
  await step('disable-task', async () => {
    const toggle = tasks.getByRole('checkbox', { name: TK.on + TK.belt })
    await tall(taskRow(TK.belt).locator('label.inline'), 'Enabled toggle')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await toggle.uncheck()
    const body = (await res).request().postDataJSON()
    if (body.isEnabled !== false || body.name !== TK.belt || body.intervalKm !== 100000 || body.intervalDays !== 1825 || !body.lastDoneDate) throw new Error(`PUT body ${JSON.stringify(body)}`)
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor()
    if ((await taskNames()).join() !== [TK.wash2, TK.belt].join()) throw new Error(`disabled not last: ${await taskNames()}`)
    await focusIs(`li[data-id] input[aria-label="${TK.on}${TK.belt}"]`, 'after toggling')
    await toggle.check()
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor({ state: 'detached' })
    // Both OK: the one with more of its interval used comes first (Wash and wax 20%, Timing belt 0%).
    if ((await taskNames()).join() !== [TK.wash2, TK.belt].join()) throw new Error(`re-enabled order: ${await taskNames()}`)
    await toggle.uncheck() // leave it disabled for the screenshot and the archived check
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor()
  })
  await step('toggle-task-fails', async () => {
    // A failed save puts the checkbox back, shows the error, and keeps focus on the checkbox.
    const toggle = tasks.getByRole('checkbox', { name: TK.on + TK.belt })
    await page.route('**/api/vehicles/*/tasks/*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await toggle.click()
    const alert = await taskRow(TK.belt).locator('[role=alert]').textContent()
    if (alert !== (he ? 'משהו השתבש. אפשר לנסות שוב.' : 'Something went wrong. Please try again.')) throw new Error(`alert "${alert}"`)
    if (await toggle.isChecked()) throw new Error('checkbox not put back')
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor()
    await focusIs(`li[data-id] input[aria-label="${TK.on}${TK.belt}"]`, 'after a failed toggle')
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 PUT')) // the forced failure
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    // MVP2-B Low c: the next action on the row clears the old error.
    await taskBtn(TK.edit, TK.belt).click()
    await page.keyboard.press('Escape')
    await focusIs(`button[aria-label="${TK.edit}${TK.belt}"]`, 'after Escape')
    if (await taskRow(TK.belt).locator('[role=alert]').count()) throw new Error('toggle error still shown after Edit')
  })
  await step('delete-task-confirm', async () => {
    await taskBtn(TK.del, TK.wash2).click()
    await tall(taskRow(TK.wash2).locator('button.danger'), 'confirm Delete')
    await noOverflow('the delete confirmation open')
    await sweep('car page with the delete confirmation open')
    await page.keyboard.press('Escape')
    await focusIs(`button[aria-label="${TK.del}${TK.wash2}"]`, 'after Escape on the delete confirmation')
    await taskBtn(TK.del, TK.wash2).click()
  })
  await step('delete-task', async () => {
    const res = page.waitForResponse((r) => r.request().method() === 'DELETE')
    await taskRow(TK.wash2).locator('button.danger').click()
    if ((await res).status() !== 204) throw new Error(`DELETE ${(await res).status()}`)
    await taskRow(TK.wash2).waitFor({ state: 'detached' })
    if ((await taskNames()).join() !== TK.belt) throw new Error(`left ${await taskNames()}`)
    await focusIs(`button[aria-label="${TK.edit}${TK.belt}"]`, 'after Delete (the next row)')
  })
  await step('tasks-load-error', async () => {
    // Every load fails until unrouted: dev StrictMode mounts twice and only the second request's answer counts.
    await page.route(at('/tasks'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    const alert = await tasks.locator('[role=alert]').textContent()
    await page.unroute(at('/tasks'))
    if (alert !== (he ? 'משהו השתבש. אפשר לנסות שוב.' : 'Something went wrong. Please try again.')) throw new Error(`alert "${alert}"`)
    await page.locator('.quick input[type=number]').waitFor()
    await page.locator('.history li').first().waitFor()
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 GET')) // the forced failure
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    await page.reload()
    await taskRow(TK.belt).waitFor()
    await page.setViewportSize(s.viewport)
  })
  await step('templates-load-error', async () => {
    // The tasks load succeeds, so it must not clear the templates error.
    await page.route('**/api/task-templates', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    await taskRow(TK.belt).waitFor()
    await tasks.getByRole('button', { name: TK.add }).click()
    const alert = await tasks.locator('.picker [role=alert]').textContent()
    await page.unroute('**/api/task-templates')
    if (alert !== (he ? 'משהו השתבש. אפשר לנסות שוב.' : 'Something went wrong. Please try again.')) throw new Error(`picker alert "${alert}"`)
    if (plain((await tasks.locator('.picker li button').allTextContents()).join()) !== TK.custom) throw new Error('picker options with no templates')
    await tasks.screenshot({ path: `${OUT}/${s.name}-templates-error.png` })
    await tasks.locator('.picker button.link').click()
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 GET'))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    await page.reload()
    await taskRow(TK.belt).waitFor()
  })
  // MVP2-B: status, remaining and the due-soon threshold. The odometer is at 59,000; the Timing belt is disabled.
  const ST = he ? { Ok: 'תקין', DueSoon: 'בקרוב', Overdue: 'באיחור' } : { Ok: 'OK', DueSoon: 'Due soon', Overdue: 'Overdue' }
  const badge = (name) => taskRow(name).locator('.badge.status').textContent()
  const badgeIs = (name, want) => page.waitForFunction(([n, w]) => [...document.querySelectorAll('.tasks > li')]
    .find((li) => li.querySelector('.name').textContent === n)?.querySelector('.badge.status')?.textContent === w, [name, want], { timeout: 5000 })
    .catch(async () => { throw new Error(`${name} badge "${await badge(name)}", want "${want}"`) })
  const ratio = (fg, bg) => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  }
  await step('task-status-order', async () => {
    const token = await page.evaluate(() => localStorage.getItem('token'))
    const url = `${BASE}/api/vehicles/${new URL(page.url()).pathname.split('/').pop()}/tasks`
    // The browser's date, as the app's (L213); localDate() is defined further down.
    const today = await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
    const add = async (name, intervalKm, lastDoneOdometerKm, intervalDays = null) => {
      // With the client's today, as the app sends it: otherwise the server judges the local date by UTC (L213).
      const r = await page.request.post(`${url}?today=${today}`, { headers: { Authorization: `Bearer ${token}` }, data: { name, category: 'Other', intervalKm, intervalDays, lastDoneOdometerKm, lastDoneDate: today } })
      if (r.status() !== 201) throw new Error(`POST ${name}: ${r.status()}`)
    }
    await add('10k service', 20000, 59000, 365) // OK, 0% used
    await add('9k service', 20000, 59000) // OK, 0% used: sorts before "10k service" (Low a)
    await add('Brakes', 10000, 50500) // OK, 15% left
    await add('Coolant', 10000, 50000) // Due soon, 10% left
    await add('Oil', 10000, 48000) // Overdue by 1,000 km
    await page.reload()
    await taskRow('Oil').waitFor()
    const want = ['Oil', 'Coolant', 'Brakes', '9k service', '10k service', TK.belt]
    if ((await taskNames()).join() !== want.join()) throw new Error(`order ${await taskNames()}`)
    for (const [n, st] of [['Oil', 'Overdue'], ['Coolant', 'DueSoon'], ['Brakes', 'Ok'], ['9k service', 'Ok']]) await badgeIs(n, ST[st])
    if (await taskRow(TK.belt).locator('.badge.status, [role=progressbar]').count()) throw new Error('disabled task has a badge or bar')
    const lines = {
      Oil: he ? 'באיחור של 1,000 ק״מ' : 'Overdue by 1,000 km',
      Coolant: he ? 'עוד 1,000 ק״מ' : '1,000 km left',
      '10k service': he ? 'עוד 20,000 ק״מ או כ־12 חודשים' : '20,000 km or about 12 months left',
    }
    for (const [n, line] of Object.entries(lines)) {
      const text = plain(await taskRow(n).textContent())
      if (!text.includes(line)) throw new Error(`${n}: "${text}" lacks "${line}"`)
    }
    const bar = taskRow('Oil').getByRole('progressbar', { name: he ? 'Oil: נוצלו 110%' : 'Oil: 110% used' })
    const vals = [await bar.getAttribute('aria-valuenow'), await bar.getAttribute('aria-valuetext')].join()
    if (vals !== '100,110%') throw new Error(`Oil valuenow,valuetext ${vals}`)
    // The fill starts at the inline start: the right edge in Hebrew.
    const edges = await taskRow('Coolant').locator('.bar').evaluate((b) => {
      const [t, f] = [b, b.firstElementChild].map((el) => el.getBoundingClientRect())
      return { start: Math.round(getComputedStyle(b).direction === 'rtl' ? t.right - f.right : f.left - t.left), width: Math.round((f.width / t.width) * 100) }
    })
    if (edges.start !== 0 || edges.width !== 90) throw new Error(`Coolant fill ${JSON.stringify(edges)}`)
    // Contrast: badge text 4.5:1 on the card, bar fill 3:1 on its track.
    for (const n of ['Oil', 'Coolant', 'Brakes']) {
      const c = await taskRow(n).evaluate((li) => {
        const css = (el, k) => getComputedStyle(el)[k]
        const bar = li.querySelector('.bar')
        return [css(li.querySelector('.badge.status'), 'color'), css(li.closest('.card'), 'backgroundColor'), css(bar.firstElementChild, 'backgroundColor'), css(bar, 'backgroundColor')]
      })
      if (ratio(c[0], c[1]) < 4.5 || ratio(c[2], c[3]) < 3) throw new Error(`${n} contrast text ${ratio(c[0], c[1]).toFixed(2)}, bar ${ratio(c[2], c[3]).toFixed(2)}`)
    }
    // 390px wide with the longest remaining line (a mocked row), in either language.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route(at('/tasks'), async (r) => {
      const res = await r.fetch()
      const ts = await res.json()
      ts.push({ ...ts[0], id: '00000000-0000-0000-0000-0000000000ff', name: 'Longest', status: 'Overdue', intervalKm: 1, intervalDays: 1, remainingKm: -1000000, remainingDays: -7300, progress: 2 })
      await r.fulfill({ response: res, json: ts })
    })
    await page.reload()
    await taskRow('Longest').waitFor()
    await page.unroute(at('/tasks'))
    const longest = plain(await taskRow('Longest').textContent())
    if (!longest.includes(he ? 'באיחור של 1,000,000 ק״מ וגם כ־243 חודשים' : 'Overdue by 1,000,000 km and about 243 months')) throw new Error(`longest "${longest}"`)
    // MVP2-B Low 2: a non-breaking space keeps each number with its unit word.
    const raw = await taskRow('Longest').textContent()
    if (!raw.includes('1,000,000 ') || !raw.includes('243 ')) throw new Error(`no non-breaking spaces in "${raw}"`)
    await noOverflow('status rows and the longest remaining line')
    await sweep('car page with status rows')
  })
  await step('task-status-after-odometer', async () => {
    await page.setViewportSize(s.viewport)
    await page.evaluate(() => { window.noReload = true })
    // Hold the task reload so the in-between state is visible: the old rows stay.
    await page.route(at('/tasks'), async (r) => { await page.waitForTimeout(700); await r.continue() }, { times: 1 })
    await page.fill('.quick input[type=number]', '61001')
    await page.click('.quick button')
    await page.waitForFunction(() => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === '61001')
    if (!(await taskRow('Coolant').isVisible())) throw new Error('rows hidden while the tasks reload')
    await badgeIs('Coolant', ST.Overdue) // 1,001 km past its 10,000 km interval
    const row = page.locator('.history li').first()
    await row.locator(deleteSel('61,001')).click()
    await row.locator('button.danger').click()
    await badgeIs('Coolant', ST.DueSoon)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('task-due-soon-percent', async () => {
    const msg = he
      ? { pct: 'יש להזין מספר שלם בין 1 ל־50.', km: 'יש להזין מרווח של 1 עד 1,000,000 ק״מ.', time: 'יש להזין מרווח זמן של עד 20 שנה (243 חודשים או 7,300 ימים).' }
      : { pct: 'Enter a whole number from 1 to 50.', km: 'Enter an interval from 1 to 1,000,000 km.', time: 'Enter a time interval of up to 20 years (243 months or 7,300 days).' }
    // The add form starts at 10.
    await tasks.getByRole('button', { name: TK.add }).click()
    await tasks.locator('.picker button', { hasText: TK.custom }).click()
    if ((await tasks.locator('form input[name=dueSoonPercent]').inputValue()) !== '10') throw new Error('add form not at 10')
    await page.keyboard.press('Escape')
    // Brakes has 15% of its km left: OK at 10, Due soon at 20.
    await taskBtn(TK.edit, 'Brakes').click()
    const form = taskRow('Brakes').locator('form')
    if ((await form.locator('input[name=dueSoonPercent]').inputValue()) !== '10') throw new Error('edit form not at the stored 10')
    let sent = 0
    const count = (r) => r.method() === 'PUT' && sent++
    page.on('request', count)
    // Criteria 9 and 10: each blocked on the client with its own message on its own field.
    const cases = [['dueSoonPercent', '0', msg.pct], ['dueSoonPercent', '51', msg.pct], ['dueSoonPercent', '2.5', msg.pct], ['intervalKm', '1000001', msg.km],
      ['intervalTime', '21', msg.time, 'years'], ['intervalTime', '244', msg.time, 'months'], ['intervalTime', '7301', msg.time, 'days']]
    for (const [name, value, text, unit] of cases) {
      if (unit) await form.locator('select[name=intervalUnit]').selectOption(unit)
      const input = form.locator(`input[name=${name}]`)
      await input.fill(value)
      await form.locator('button:not(.link)').click()
      const shown = await input.evaluate((el) => el.validationMessage)
      if (plain(shown) !== text) throw new Error(`${name} ${value}: "${shown}"`)
      await input.fill({ dueSoonPercent: '10', intervalKm: '10000', intervalTime: '' }[name])
    }
    await page.waitForTimeout(300)
    page.off('request', count)
    if (sent) throw new Error(`${sent} PUT sent for blocked values`)
    await form.locator('input[name=dueSoonPercent]').fill('20')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await form.locator('button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.dueSoonPercent !== 20) throw new Error(`PUT body ${JSON.stringify(body)}`)
    await badgeIs('Brakes', ST.DueSoon)
    await taskBtn(TK.edit, 'Brakes').click()
    if ((await form.locator('input[name=dueSoonPercent]').inputValue()) !== '20') throw new Error('edit form not at the stored 20')
    await page.keyboard.press('Escape')
  })
  // MVP2-C: Mark done and Undo, at 390px wide in both setups. The odometer is at 59,000.
  const RS = he
    ? { done: 'סימון כבוצע: ', cost: 'תיעוד עם פרטים: ', marked: 'סומן כבוצע.', service: 'טיפול', generic: 'משהו השתבש. אפשר לנסות שוב.', costMsg: 'יש להזין עלות בין 0 ל־1,000,000, עם עד 2 ספרות אחרי הנקודה.', oilLeft: 'עוד 10,000 ק״מ', oilLate: 'באיחור של 1,000 ק״מ', oilAt: 'ב־48,000 ק״מ' }
    : { done: 'Mark done: ', cost: 'Log with details: ', marked: 'Marked as done.', service: 'Service', generic: 'Something went wrong. Please try again.', costMsg: 'Enter a cost from 0 to 1,000,000 with up to 2 decimals.', oilLeft: '10,000 km left', oilLate: 'Overdue by 1,000 km', oilAt: 'at 48,000 km' }
  const localDate = () => page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const histDay = (offset) => page.evaluate((o) => new Date(Date.now() + o * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), offset)
  const serviceRows = () => page.locator('.history li').filter({ hasText: RS.service })
  const isReset = (r) => r.method() === 'POST' && pathOf(r).endsWith('/reset')
  const forget500 = () => {
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 ')) // the forced failure
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
  }
  await step('reset-task', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    if (await taskRow(TK.belt).locator('button.done').count()) throw new Error('Mark done on a disabled task')
    if (await taskBtn(RS.cost, TK.belt).count()) throw new Error('Add cost or notes on a disabled task')
    // A failed reset: the translated error on the row, the rows kept, focus back on Mark done.
    await page.route(at('/reset'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await taskBtn(RS.done, 'Oil').click()
    const alert = await taskRow('Oil').locator('[role=alert]').textContent()
    if (alert !== RS.generic) throw new Error(`reset error "${alert}"`)
    await focusIs(`button[aria-label="${RS.done}Oil"]`, 'after a failed reset')
    if ((await taskNames()).length !== 6) throw new Error(`rows after a failed reset: ${await taskNames()}`)
    forget500()
    // Criterion 14: a double tap while the first request is held makes one reset.
    let posts = 0
    const count = (r) => isReset(r) && posts++
    page.on('request', count)
    await page.route(at('/reset'), async (r) => { await page.waitForTimeout(500); await r.continue() }, { times: 1 })
    const res = page.waitForResponse((r) => isReset(r.request()))
    await taskBtn(RS.done, 'Oil').click()
    if (!(await taskBtn(RS.done, 'Oil').isDisabled())) throw new Error('Mark done not disabled while saving')
    await taskBtn(RS.done, 'Oil').click({ force: true }).catch(() => {})
    const body = (await res).request().postDataJSON()
    if (body.date !== (await localDate())) throw new Error(`reset date ${body.date}`)
    await badgeIs('Oil', ST.Ok)
    await page.waitForTimeout(300)
    page.off('request', count)
    if (posts !== 1) throw new Error(`${posts} reset POSTs for a double tap`)
    // Criterion 10: OK with a full km left and an empty bar, re-sorted, Undo focused, a Service reading without Edit or Delete.
    const text = plain(await taskRow('Oil').textContent())
    if (!text.includes(RS.oilLeft)) throw new Error(`Oil "${text}"`)
    if ((await taskRow('Oil').getByRole('progressbar').getAttribute('aria-valuenow')) !== '0') throw new Error('bar not empty')
    const want = ['Coolant', 'Brakes', '9k service', '10k service', 'Oil', TK.belt]
    if ((await taskNames()).join() !== want.join()) throw new Error(`order ${await taskNames()}`)
    const bar = taskRow('Oil').getByRole('status')
    if (!plain(await bar.textContent()).startsWith(RS.marked)) throw new Error(`bar "${await bar.textContent()}"`)
    await focusIs('.tasks .undo button', 'after Mark done')
    // Focus moves to Undo in the same render as the bar, so Undo is described by the message too.
    const described = await page.evaluate(() => document.getElementById(document.activeElement.getAttribute('aria-describedby') ?? '')?.textContent)
    if (described !== RS.marked) throw new Error(`Undo described by "${described}"`)
    await serviceRows().first().waitFor()
    if (!digitsOnly(await serviceRows().first().locator('.value').textContent()).startsWith('59000')) throw new Error('Service reading value')
    if (await serviceRows().locator('button').count()) throw new Error('Service reading has Edit or Delete')
    await noOverflow('the Undo bar')
    await sweep('car page with the Undo bar')
  })
  await step('undo-reset', async () => {
    // A failed undo keeps the bar, shows the error on the row, and focus stays on Undo.
    await page.route(at('/void'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await taskRow('Oil').locator('.undo button').click()
    const alert = await taskRow('Oil').locator('[role=alert]').textContent()
    if (alert !== RS.generic) throw new Error(`undo error "${alert}"`)
    if (!(await taskRow('Oil').locator('.undo').isVisible())) throw new Error('bar gone after a failed undo')
    await focusIs('.tasks .undo button', 'after a failed undo')
    forget500()
    await taskRow('Oil').locator('.undo button').click()
    await badgeIs('Oil', ST.Overdue)
    const text = plain(await taskRow('Oil').textContent())
    if (!text.includes(RS.oilLate) || !text.includes(RS.oilAt)) throw new Error(`Oil "${text}"`)
    if ((await taskNames())[0] !== 'Oil') throw new Error(`order ${await taskNames()}`)
    if (await tasks.locator('.undo').count()) throw new Error('bar still shown')
    await focusIs(`button[aria-label="${RS.done}Oil"]`, 'after Undo')
    await serviceRows().first().waitFor({ state: 'detached' })
  })
  await step('reset-with-cost', async () => {
    // SIMP-1: "Log with details" opens Record a service with that task ticked, and only that one; cost limits block on the client.
    await taskBtn(RS.cost, 'Brakes').click()
    await recordForm.locator('fieldset input:checked').waitFor() // the form loads its tasks first
    const ticked = (await recordForm.locator('fieldset label', { has: page.locator('input:checked') }).allTextContents()).map(plain)
    if (JSON.stringify(ticked) !== JSON.stringify(['Brakes'])) throw new Error(`ticked ${ticked}`)
    if (!plain(await recordForm.locator('label', { has: page.locator('input[name=totalCost]') }).textContent()).includes(registered.user.currency)) throw new Error('cost label')
    await noOverflow('the record form opened from a task')
    let posts = 0
    const count = (r) => isRecordPost(r) && posts++
    page.on('request', count)
    for (const v of ['-1', '1000000.01', '1.234']) {
      await recordForm.locator('input[name=totalCost]').fill(v)
      await recordForm.locator('button:not(.link)').click()
      const shown = await recordForm.locator('input[name=totalCost]').evaluate((el) => el.validationMessage)
      if (plain(shown) !== RS.costMsg) throw new Error(`cost ${v}: "${shown}"`)
    }
    await page.waitForTimeout(300)
    page.off('request', count)
    if (posts) throw new Error(`${posts} record POSTs for blocked costs`)
    await recordForm.locator('input[name=totalCost]').fill('120.50')
    await recordForm.locator('textarea[name=notes]').fill('Castrol 5W-30')
    const res = page.waitForResponse((r) => isRecordPost(r.request()))
    await recordForm.locator('button:not(.link)').click()
    const r = await res
    const body = r.request().postDataJSON()
    if (r.status() !== 201 || body.totalCost !== 120.5 || body.taskIds.length !== 1 || body.odometerKm !== 59000) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    await recordForm.waitFor({ state: 'detached' })
    await badgeIs('Brakes', ST.Ok)
    if ((await serviceRows().count()) !== 1) throw new Error(`${await serviceRows().count()} Service readings`)
  })
  await step('toggle-clears-undo', async () => {
    // With the Undo bar showing, the first tap on another task's Enabled both removes the bar and toggles.
    await taskBtn(RS.done, '9k service').click()
    await focusIs('.tasks .undo button', 'after Mark done')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await tasks.getByRole('checkbox', { name: TK.on + '10k service' }).uncheck()
    if ((await res).request().postDataJSON().isEnabled !== false) throw new Error('PUT did not disable')
    await taskRow('10k service').locator('.badge', { hasText: TK.off }).waitFor()
    if (await tasks.locator('.undo').count()) throw new Error('bar still shown after the toggle')
    await tasks.getByRole('checkbox', { name: TK.on + '10k service' }).check()
    await taskRow('10k service').locator('.badge', { hasText: TK.off }).waitFor({ state: 'detached' })
  })
  await step('tasks-reload-error-keeps-rows', async () => {
    // Low 1: a reset reloads the car and then the tasks; that reload fails, and the rows stay with the error above them.
    await page.route(at('/tasks'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    const failed = page.waitForResponse((r) => pathOf(r).endsWith('/tasks') && r.status() === 500)
    await taskBtn(RS.done, 'Coolant').click()
    await failed
    const alert = tasks.locator(':scope > p.error[role=alert]')
    await alert.waitFor()
    await page.unroute(at('/tasks'))
    if ((await alert.textContent()) !== RS.generic) throw new Error(`alert "${await alert.textContent()}"`)
    if ((await taskNames()).length !== 6) throw new Error(`rows ${await taskNames()}`)
    const above = await alert.evaluate((p) => !!(p.compareDocumentPosition(p.parentElement.querySelector('.tasks')) & Node.DOCUMENT_POSITION_FOLLOWING))
    if (!above) throw new Error('error not above the rows')
    await badgeIs('Coolant', ST.Ok)
    forget500()
    await page.reload()
    await taskRow('Coolant').waitFor()
    await page.setViewportSize(s.viewport)
  })
  // Owner, 2026-11-02: each car page section folds from its heading, remembered per section after a reload; Log with details opens a folded Service history.
  await step('car-sections-fold', async () => {
    const toggle = (id) => page.locator(`h2#${id} > button.fold`)
    const expanded = async (id) => (await toggle(id).getAttribute('aria-expanded')) === 'true'
    for (const id of ['maintenance', 'todos', 'documents', 'checklists', 'tires', 'service-history', 'odometer-history']) {
      if (!(await expanded(id))) throw new Error(`${id} not open by default`)
      if ((await toggle(id).getAttribute('aria-controls')) !== `${id}-section`) throw new Error(`${id} aria-controls`)
    }
    await tall(toggle('maintenance'), 'the Maintenance toggle')
    await toggle('maintenance').click()
    await tasks.locator('.tasks').waitFor({ state: 'hidden' })
    if (await tasks.locator('button.add').isVisible()) throw new Error('Add task shown while folded')
    // From the keyboard: Enter on the focused heading button folds Service history.
    await toggle('service-history').focus()
    await page.keyboard.press('Enter')
    if (await expanded('service-history')) throw new Error('Enter did not fold Service history')
    await page.reload()
    await toggle('maintenance').waitFor()
    if (await expanded('maintenance') || await expanded('service-history') || !(await expanded('todos'))) throw new Error('fold state not kept after a reload')
    await noOverflow('folded sections')
    await page.screenshot({ path: `${OUT}/${s.name}-car-sections-folded.png`, fullPage: true })
    if (await tasks.locator('.tasks').isVisible()) throw new Error('tasks shown while folded after a reload')
    await toggle('maintenance').click()
    await taskRow('Brakes').waitFor()
    // Log with details opens the folded Service history, with its form. Brakes: Record a service keeps the last task it was opened with.
    await taskBtn(RS.cost, 'Brakes').click()
    await recordForm.waitFor()
    if (!(await expanded('service-history'))) throw new Error('Log with details left Service history folded')
    await page.keyboard.press('Escape')
    await recordForm.waitFor({ state: 'detached' })
  })
  // MVP3-A at 390px. The odometer is at 59,000; Coolant, 9k service and Brakes (120.50, notes) were marked done today.
  const odometerIs = (v) => page.waitForFunction((v) => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === v, v, { timeout: 5000 })
  const formValues = () => recordForm.evaluate((f) => [...new FormData(f)].map(([k, v]) => [k, String(v)]))
  let garageId
  await step('record-service', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { window.noReload = true })
    // The resets are listed newest first; Brakes' shows DIY, its cost and its notes.
    await serviceItems().nth(2).waitFor()
    if ((await serviceItems().count()) !== 3) throw new Error(`${await serviceItems().count()} records`)
    const brakes = plain(await serviceItems().nth(2).textContent())
    for (const want of [SV.diy, 'Brakes', 'Castrol 5W-30', '120.50']) if (!brakes.includes(want)) throw new Error(`Brakes record lacks "${want}": "${brakes}"`)
    // A Mark done shows up at the top at once.
    await taskBtn(RS.done, '10k service').click()
    await page.waitForFunction(() => document.querySelectorAll('.services > li').length === 4)
    if (!plain(await serviceItems().first().textContent()).includes('10k service')) throw new Error('Mark done not at the top')
    // The form: today (and no later), the car's odometer, the currency, and a fieldset of the enabled tasks.
    await recordBtn.click()
    await focusIs('form input[name=date]', 'record form open')
    const today = await localDate()
    const date = recordForm.locator('input[name=date]')
    if ((await date.inputValue()) !== today || (await date.getAttribute('max')) !== today) throw new Error(`date ${await date.inputValue()}, max ${await date.getAttribute('max')}`)
    if ((await recordForm.locator('input[name=odometerKm]').inputValue()) !== '59000') throw new Error('odometer default')
    if (!plain(await recordForm.locator('label', { has: page.locator('input[name=totalCost]') }).textContent()).includes(registered.user.currency)) throw new Error('cost label')
    if ((await recordForm.locator('fieldset > legend').textContent()) !== SV.legend) throw new Error('no fieldset legend')
    const boxes = (await recordForm.locator('fieldset label').allTextContents()).map(plain)
    if (boxes.length !== 5 || boxes.includes(TK.belt)) throw new Error(`task boxes ${boxes}`)
    for (const label of await recordForm.locator('fieldset label').all()) await tall(label, `"${await label.textContent()}" checkbox row`)
    const shop = recordForm.locator('input[name=shopName]')
    if ((await page.locator(`#${await shop.getAttribute('aria-describedby')}`).textContent()) !== SV.hint) throw new Error('shop hint')
    noLatin(plain(await recordForm.locator('label:not(.inline)').allTextContents().then((l) => l.join())).replace(registered.user.currency, ''), 'form labels')
    await noOverflow('the record form open')
    await sweep('car page with the record form open')
    // Escape and Cancel close it with focus back on Record a service.
    await page.keyboard.press('Escape')
    await recordForm.waitFor({ state: 'detached' })
    await focusIs('section[aria-labelledby=service-history] button.add', 'after Escape')
    await recordBtn.click()
    await recordForm.locator(':scope > .actions button.link').click()
    await focusIs('section[aria-labelledby=service-history] button.add', 'after Cancel')
    await recordBtn.click()
    const longShop = 'Garage' + 'X'.repeat(94)
    const notes = 'Full service. ' + 'n'.repeat(300)
    await shop.fill(longShop)
    await recordForm.locator('input[name=odometerKm]').fill('59500')
    await recordForm.locator('input[name=totalCost]').fill('250.5')
    await recordForm.locator('textarea[name=notes]').fill(notes)
    await recordForm.getByRole('checkbox', { name: 'Oil', exact: true }).check()
    await recordForm.getByRole('checkbox', { name: 'Brakes', exact: true }).check()
    const typed = JSON.stringify(await formValues())
    // A failed save keeps the form and every value, with the error, and focus back on Save.
    await page.route(at('/service-records'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await recordForm.locator('button:not(.link)').click()
    const alert = recordForm.locator('[role=alert]')
    await alert.waitFor()
    if ((await alert.textContent()) !== SV.generic) throw new Error(`save error "${await alert.textContent()}"`)
    await focusIs('section[aria-labelledby=service-history] form button:not(.link)', 'after a failed save')
    if (JSON.stringify(await formValues()) !== typed) throw new Error(`values lost: ${JSON.stringify(await formValues())}`)
    forget500()
    const res = page.waitForResponse((r) => isRecordPost(r.request()))
    await recordForm.locator('button:not(.link)').click()
    const r = await res
    const body = r.request().postDataJSON()
    if (r.status() !== 201 || body.date !== today || body.odometerKm !== 59500 || body.totalCost !== 250.5 || body.taskIds.length !== 2 || body.confirmCorrection !== false) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    garageId = (await r.json()).record.id
    await focusIs(`li[data-id="${garageId}"] button.edit-service`, 'after Save')
    const top = serviceItems().first()
    if ((await top.getAttribute('data-id')) !== garageId) throw new Error('new record not at the top')
    const text = plain(await top.textContent())
    for (const want of [longShop, '250.50', 'Oil', 'Brakes', '59,500', notes]) if (!text.includes(want)) throw new Error(`record lacks "${want.slice(0, 20)}"`)
    // Named by date, odometer and shop, so two services on one day differ.
    for (const [sel, of] of [['button.edit-service', SV.editOf], ['button.delete-service', SV.deleteOf]]) {
      const name = await top.locator(sel).getAttribute('aria-label')
      if (!name.startsWith(of) || !name.endsWith(` ${SV.at59500}, ${longShop}`)) throw new Error(`action name "${name}"`)
    }
    // Both tasks done at 59,500, and the odometer and its history follow, without a reload.
    await odometerIs('59500')
    await badgeIs('Oil', ST.Ok)
    for (const n of ['Oil', 'Brakes']) if (!plain(await taskRow(n).textContent()).includes(SV.at59500)) throw new Error(`${n}: ${plain(await taskRow(n).textContent())}`)
    const reading = plain(await page.locator('.history li').first().textContent())
    if (!reading.includes(RS.service) || !digitsOnly(reading).startsWith('59500')) throw new Error(`top reading "${reading}"`)
    await noOverflow('a long shop name and notes')
    await sweep('car page with service records')
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  let backdatedId
  await step('record-service-backdated', async () => {
    const day = (offset) => page.evaluate((o) => new Date(Date.now() + o * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), offset)
    await recordBtn.click()
    const date = recordForm.locator('input[name=date]')
    const save = recordForm.locator('button:not(.link)')
    // A future date is blocked by the field, before any request.
    let posts = 0
    const count = (r) => isRecordPost(r) && posts++
    page.on('request', count)
    await date.fill(await day(1))
    await save.click()
    if (!(await date.evaluate((el) => el.validity.rangeOverflow))) throw new Error('future date not blocked')
    // LOW-1 L7: the field's message is translated, as the odometer's is.
    if ((await date.evaluate((el) => el.validationMessage)) !== SV.future) throw new Error(`date message "${await date.evaluate((el) => el.validationMessage)}"`)
    await page.waitForTimeout(300)
    page.off('request', count)
    if (posts) throw new Error(`${posts} POSTs for a future date`)
    // If the server rejects one anyway (a device clock ahead), the error is translated and tied to the date.
    await date.fill(await day(0))
    await page.route(at('/service-records'), (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.futureDate' }) }), { times: 1 })
    await save.click()
    const alert = recordForm.locator('[role=alert]')
    await alert.waitFor()
    if ((await alert.textContent()) !== SV.future) throw new Error(`future error "${await alert.textContent()}"`)
    // The spelled-out date is the field's hint, so the error id comes after it (2026-11-03).
    if (!(await date.getAttribute('aria-describedby')).split(' ').includes(await alert.getAttribute('id'))) throw new Error('error not tied to the date')
    // 70,000 a month ago is above the reading after it: the error names it, and the confirm box saves it.
    await date.fill(await day(-30))
    const odo = recordForm.locator('input[name=odometerKm]')
    await odo.fill('70000')
    await recordForm.getByRole('checkbox', { name: 'Coolant', exact: true }).check()
    let res = page.waitForResponse((r) => isRecordPost(r.request()))
    await save.click()
    const problem = await (await res).json()
    if (problem.code !== 'odometer.higherThanNext') throw new Error(`got ${JSON.stringify(problem)}`)
    await alert.filter({ hasText: problem.nextKm.toLocaleString('en') }).waitFor()
    const msg = plain(await alert.textContent())
    if (!msg.includes(`${problem.nextKm.toLocaleString('en')} ${SV.km}`)) throw new Error(`order error "${msg}"`)
    noLatin(msg, 'order error')
    if ((await odo.getAttribute('aria-invalid')) !== 'true') throw new Error('error not tied to the odometer')
    // MVP3-B criterion 11: the error and its confirm box sit right under the odometer field and stay tied to it, here and on desktop.
    if (!(await odo.getAttribute('aria-describedby')).split(' ').includes(await alert.getAttribute('id'))) throw new Error('order error not in the odometer\'s aria-describedby')
    const confirmBox = recordForm.locator(':scope > label.inline')
    await confirmBox.waitFor()
    const underOdometer = async (what) => {
      if ((await odo.evaluate((el) => el.closest('label').nextElementSibling?.getAttribute('role'))) !== 'alert') throw new Error(`${what}: the error doesn't follow the odometer field`)
      const [field, err, box] = await Promise.all([odo, alert, confirmBox].map((l) => l.boundingBox()))
      const gap = err.y - (field.y + field.height)
      if (gap < 0 || gap > 40 || box.y < err.y + err.height - 1) throw new Error(`${what}: error ${gap}px under the odometer, box at ${box.y}`)
    }
    await underOdometer('390px')
    if (!he) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await underOdometer('desktop')
      await page.setViewportSize({ width: 390, height: 844 })
    }
    await recordForm.locator(':scope > label.inline input[type=checkbox]').check()
    res = page.waitForResponse((r) => isRecordPost(r.request()))
    await save.click()
    const r = await res
    if (r.status() !== 201 || r.request().postDataJSON().confirmCorrection !== true) throw new Error(`${r.status()} ${r.request().postData()}`)
    backdatedId = (await r.json()).record.id
    // Older than the rest, it is listed last; Coolant keeps its later last done.
    await focusIs(`li[data-id="${backdatedId}"] button.edit-service`, 'after a backdated save')
    if ((await serviceItems().last().getAttribute('data-id')) !== backdatedId) throw new Error('backdated record not last')
    if (!plain(await taskRow('Coolant').textContent()).includes(SV.at59000)) throw new Error(`Coolant moved: ${plain(await taskRow('Coolant').textContent())}`)
    await odometerIs('59500')
    await noOverflow('the backdated record')
  })
  // MVP3-B at 390px: line items, Edit and Delete. So far: the garage record (59,500 today), the backdated one, and the resets.
  const carId = () => new URL(page.url()).pathname.split('/')[2]
  // Deletes a record as another tab would, through the API.
  const voidElsewhere = async (id) => {
    const token = await page.evaluate(() => localStorage.getItem('token'))
    const r = await page.request.post(`${BASE}/api/vehicles/${carId()}/service-records/${id}/void`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok()) throw new Error(`void elsewhere: ${r.status()}`)
  }
  // Drops one forced or expected failure (a service-records response with this status) from the report.
  const forgetExpected = (status) => {
    const i = run.badResponses.findIndex((r) => r.startsWith(`${status} `) && r.includes('/service-records'))
    if (i >= 0) run.badResponses.splice(i, 1)
    const j = run.consoleErrors.findIndex((e) => e.includes(`status of ${status}`))
    if (j >= 0) run.consoleErrors.splice(j, 1)
  }
  const itemRows = (form) => form.locator('fieldset.item')
  const itemInput = (form, i, n) => itemRows(form).nth(i).locator('input').nth(n)
  // Each row's first label is its description.
  const descSel = (i) => `section[aria-labelledby=service-history] form fieldset.item:nth-of-type(${i + 1}) > label:first-of-type input`
  const sumField = (form) => form.locator('input[readonly]')
  const costDigits = async (row) => digitsOnly(await row.locator(':scope > p').first().locator('bdi').textContent())
  const describedText = (btn) => btn.evaluate((b) => (b.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '(missing)').join(' | '))
  let itemsId
  await step('record-service-items', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await recordBtn.click()
    const addPart = recordForm.locator('button.add-part')
    const addLabour = recordForm.locator('.items > .actions button:not(.add-part)')
    await recordForm.locator('input[name=odometerKm]').fill('59500')
    await recordForm.locator('input[name=shopName]').fill('Garage Cohen')
    // Criterion 16: focus after Add and Remove (the next row, then the previous, then Add part).
    await addPart.click()
    await focusIs(descSel(0), 'after Add part')
    await addLabour.click()
    await focusIs(descSel(1), 'after Add labour')
    if ((await recordForm.locator('input[name=totalCost]').count()) || !(await sumField(recordForm).count())) throw new Error('total still typed with items')
    await addPart.click()
    await itemRows(recordForm).nth(2).locator('button').click()
    await focusIs(descSel(1), 'after removing the last row (the previous row)')
    await itemRows(recordForm).nth(0).locator('button').click()
    await focusIs(descSel(0), 'after removing row 1 (the next row)')
    await itemRows(recordForm).nth(0).locator('button').click()
    await focusIs('section[aria-labelledby=service-history] form button.add-part', 'after removing the only row')
    if (!(await recordForm.locator('input[name=totalCost]').count())) throw new Error('total not typed again without items')
    // The items block is a group named "Parts and labour".
    if ((await recordForm.locator('.items[role=group]').getAttribute('aria-label')) !== SV.items) throw new Error('items group name')
    // An item error stays on the row it was about when an earlier row is removed, and goes with that row.
    for (const n of [0, 1, 2]) { await addPart.click(); await itemInput(recordForm, n, 0).fill(`Part ${n + 1}`); await itemInput(recordForm, n, 4).fill('10') }
    await page.route(at('/service-records'), (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceItem.invalidQuantity', index: 1 }) }), { times: 1 })
    await recordForm.locator('button:not(.link)').click()
    await itemRows(recordForm).nth(1).locator('[role=alert]').waitFor()
    forgetExpected(400)
    await itemRows(recordForm).nth(0).locator('button').click()
    const stayed = itemRows(recordForm).nth(0)
    // It names the row by its number now (Item 1), not the one sent (Item 2).
    if (plain(await stayed.locator('[role=alert]').textContent()) !== SV.item2Qty.replace('2', '1')) throw new Error(`renumbered item error "${await stayed.locator('[role=alert]').textContent()}"`)
    if ((await itemInput(recordForm, 0, 0).inputValue()) !== 'Part 2' || (await stayed.locator('[role=alert]').count()) !== 1 || (await recordForm.locator('[role=alert]').count()) !== 1) throw new Error('item error moved off its row')
    if ((await itemInput(recordForm, 0, 3).getAttribute('aria-describedby')) !== (await stayed.locator('[role=alert]').getAttribute('id'))) throw new Error('item error not tied to its row after a removal')
    await stayed.locator('button').click()
    if ((await recordForm.locator('[role=alert]').count()) || (await recordForm.locator('[aria-invalid]').count())) throw new Error('item error outlived its row')
    await itemRows(recordForm).nth(0).locator('button').click()
    // Criterion 5: a part and a labour row, with the live total while typing.
    const longDesc = 'Oil filter ' + 'Y'.repeat(89)
    const longPart = 'W712/75-' + 'X'.repeat(42)
    await addPart.click()
    for (const [n, v] of [[0, longDesc], [1, 'Mann'], [2, longPart], [3, '2'], [4, '45.5']]) await itemInput(recordForm, 0, n).fill(v)
    if (digitsOnly(await sumField(recordForm).inputValue()) !== '9100') throw new Error(`live total ${await sumField(recordForm).inputValue()}`)
    await addLabour.click()
    for (const [n, v] of [[0, 'Labour'], [1, '1.5'], [2, '200']]) await itemInput(recordForm, 1, n).fill(v)
    if (digitsOnly(await sumField(recordForm).inputValue()) !== '39100') throw new Error(`live total ${await sumField(recordForm).inputValue()}`)
    // A labour row has no brand or part number; every field is named with its row.
    if ((await itemRows(recordForm).nth(1).locator('input').count()) !== 3) throw new Error('labour row fields')
    if (plain(await itemInput(recordForm, 1, 1).getAttribute('aria-label')) !== SV.item2Hours) throw new Error(`hours name "${await itemInput(recordForm, 1, 1).getAttribute('aria-label')}"`)
    if (plain(await itemInput(recordForm, 0, 2).getAttribute('aria-label')) !== SV.item1Part) throw new Error('part number name')
    if (!plain(await itemRows(recordForm).nth(1).locator('legend').textContent()).includes(SV.labour)) throw new Error('labour legend')
    noLatin(plain((await recordForm.locator('fieldset.item label').allTextContents()).join()).replace(new RegExp(registered.user.currency, 'g'), ''), 'item labels')
    await noOverflow('item rows with a long description and part number')
    await sweep('the record form with item rows')
    // Criterion 10: an item error from the server shows on its row, naming it; every typed value stays.
    const itemValues = () => itemRows(recordForm).evaluateAll((fs) => fs.map((f) => [...f.querySelectorAll('input')].map((i) => i.value)))
    const typed = JSON.stringify([await itemValues(), await formValues()])
    await page.route(at('/service-records'), (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceItem.invalidQuantity', index: 1 }) }), { times: 1 })
    const save = recordForm.locator('button:not(.link)')
    await save.click()
    const itemAlert = itemRows(recordForm).nth(1).locator('[role=alert]')
    await itemAlert.waitFor()
    if (plain(await itemAlert.textContent()) !== SV.item2Qty) throw new Error(`item error "${await itemAlert.textContent()}"`)
    const hours = itemInput(recordForm, 1, 1)
    if ((await hours.getAttribute('aria-invalid')) !== 'true' || (await hours.getAttribute('aria-describedby')) !== (await itemAlert.getAttribute('id'))) throw new Error('item error not tied to its field')
    if ((await recordForm.locator('[role=alert]').count()) !== 1) throw new Error('the item error is shown twice')
    if (JSON.stringify([await itemValues(), await formValues()]) !== typed) throw new Error('values lost')
    forgetExpected(400)
    const res = page.waitForResponse((r) => isRecordPost(r.request()))
    await save.click()
    const r = await res
    const body = r.request().postDataJSON()
    const rec = (await r.json()).record
    if (r.status() !== 201 || body.items.length !== 2 || !body.items[1].isLabor || rec.items[1].partNumber !== null || body.totalCost !== null || rec.totalCost !== 391) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    itemsId = rec.id
    await focusIs(`li[data-id="${itemsId}"] button.edit-service`, 'after saving with items')
    // The row shows both items and the total in the user's currency, without a reload.
    const row = services.locator(`li[data-id="${itemsId}"]`)
    const lines = row.locator('.service-items li')
    if ((await lines.count()) !== 2) throw new Error(`${await lines.count()} item lines`)
    const part = plain(await lines.nth(0).textContent())
    for (const want of [longDesc, 'Mann', longPart]) if (!part.includes(want)) throw new Error(`part line lacks "${want.slice(0, 12)}"`)
    const partAmount = await lines.nth(0).locator('.amount').textContent()
    if (digitsOnly(partAmount) !== '24550') throw new Error(`part amount ${partAmount}`)
    if (digitsOnly(await lines.nth(1).locator('.amount').textContent()) !== '1520000' || (await lines.nth(1).locator('.badge').textContent()) !== SV.labour) throw new Error(`labour line ${plain(await lines.nth(1).textContent())}`)
    const sign = new Intl.NumberFormat(s.lng, { style: 'currency', currency: registered.user.currency }).formatToParts(1).find((p) => p.type === 'currency').value
    if (!partAmount.includes(sign)) throw new Error(`amount "${partAmount}" without "${sign}"`)
    if ((await costDigits(row)) !== '39100') throw new Error(`total ${await costDigits(row)}`)
    await noOverflow('a history row with long items')
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('edit-service', async () => {
    const row = services.locator(`li[data-id="${itemsId}"]`)
    const form = row.locator('form')
    const editBtn = `li[data-id="${itemsId}"] button.edit-service`
    // Criterion 12: same date and odometer, different shops, different names; each action described by its row's cost and tasks.
    const names = await services.locator(`li[data-id="${itemsId}"] .actions button, li[data-id="${garageId}"] .actions button`).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
    if (names.length !== 4 || new Set(names).size !== 4) throw new Error(`names ${JSON.stringify(names)}`)
    for (const b of await services.locator('.services > li .actions button').all()) {
      const described = await describedText(b)
      if (!described || described.includes('(missing)')) throw new Error(`"${await b.getAttribute('aria-label')}" described by "${described}"`)
    }
    const garageDesc = plain(await describedText(services.locator(`li[data-id="${garageId}"] button.delete-service`)))
    if (!garageDesc.includes('250.50') || !garageDesc.includes('Oil') || !digitsOnly(await describedText(row.locator('button.edit-service'))).includes('39100')) throw new Error(`described by "${garageDesc}"`)
    // Criterion 6 (MVP3-D: the date, odometer and tasks are fields now, without the old hint).
    // LOW-5 L91: SV.editHint is the hint's opening words, the same in the old plural Hebrew and any impersonal rewording, so this can fail.
    await row.locator('button.edit-service').click()
    await focusIs(`li[data-id="${itemsId}"] form input[name=date]`, 'Edit open')
    if ((await form.locator('input[name=date]').inputValue()) !== (await localDate()) || (await form.locator('input[name=odometerKm]').inputValue()) !== '59500') throw new Error('date or odometer not filled in')
    await form.locator('input[name=taskIds]').first().waitFor() // the tasks load on their own
    if (plain(await form.textContent()).includes(SV.editHint)) throw new Error('old hint still shown')
    if ((await form.locator('input[name=shopName]').inputValue()) !== 'Garage Cohen' || (await itemRows(form).count()) !== 2 || (await itemInput(form, 0, 3).inputValue()) !== '2') throw new Error('edit form not filled in')
    await noOverflow('the edit form')
    await sweep('the edit form open')
    // Escape and Cancel discard the changes, with focus back on the row's Edit.
    await form.locator('input[name=shopName]').fill('Changed')
    await page.keyboard.press('Escape')
    await focusIs(editBtn, 'after Escape on Edit')
    await row.locator('button.edit-service').click()
    if ((await form.locator('input[name=shopName]').inputValue()) !== 'Garage Cohen') throw new Error('Escape kept the change')
    await itemRows(form).nth(0).locator('button').click()
    await form.locator(':scope > .actions button.link').click()
    await focusIs(editBtn, 'after Cancel on Edit')
    if ((await row.locator('.service-items li').count()) !== 2) throw new Error('Cancel kept the removed item')
    // Save updates the row in place: shop, notes, items and the recomputed total.
    await row.locator('button.edit-service').click()
    await form.locator('input[name=shopName]').fill('Cohen and Sons')
    await form.locator('textarea[name=notes]').fill('Filter swapped')
    await itemInput(form, 0, 3).fill('3')
    if (digitsOnly(await sumField(form).inputValue()) !== '43650') throw new Error(`live total ${await sumField(form).inputValue()}`)
    const isPut = (r) => r.request().method() === 'PUT'
    let put = page.waitForResponse(isPut)
    await form.locator('button:not(.link)').click()
    let pr = await put
    if (pr.status() !== 200 || pr.request().postDataJSON().items.length !== 2) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after saving the edit')
    const after = plain(await row.textContent())
    for (const want of ['Cohen and Sons', 'Filter swapped']) if (!after.includes(want)) throw new Error(`row lacks "${want}"`)
    if ((await costDigits(row)) !== '43650') throw new Error(`total ${await costDigits(row)}`)
    // Criterion 7: removing every item makes the total typed again, and the typed total is saved.
    await row.locator('button.edit-service').click()
    await itemRows(form).nth(0).locator('button').click()
    await itemRows(form).nth(0).locator('button').click()
    await form.locator('input[name=totalCost]').fill('80')
    put = page.waitForResponse(isPut)
    await form.locator('button:not(.link)').click()
    pr = await put
    if (pr.status() !== 200 || pr.request().postDataJSON().items.length !== 0 || pr.request().postDataJSON().totalCost !== 80 || (await pr.json()).record.totalCost !== 80) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after saving without items')
    if ((await costDigits(row)) !== '8000' || (await row.locator('.service-items').count())) throw new Error('row not updated to 80 without items')
    // QA Low 3: a (mocked) gone on Save whose record still comes back closes the edit form under the note.
    await row.locator('button.edit-service').click()
    await page.route('**/service-records/*', (r) => (r.request().method() === 'PUT'
      ? r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.notFound' }) }) : r.fallback()), { times: 1 })
    await form.locator('button:not(.link)').click()
    await services.locator('p[role=status]', { hasText: SV.gone }).waitFor()
    await row.locator('button.edit-service').waitFor()
    if (await row.locator('form').count()) throw new Error('edit form stayed open under the gone note')
    forgetExpected(404)
    // Criterion 9 (Edit): deleted in another tab, then saved here; the history reloads with the note and the row drops.
    await row.locator('button.edit-service').click()
    await voidElsewhere(itemsId)
    await form.locator('input[name=shopName]').fill('Too late')
    await form.locator('button:not(.link)').click()
    await services.locator('p[role=status]', { hasText: SV.gone }).waitFor()
    await row.waitFor({ state: 'detached' })
    if (await services.locator('.error').count()) throw new Error('an error shown with the note')
    await focusIs('#service-history', 'after editing a deleted record')
    forgetExpected(409)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('delete-service', async () => {
    const row = services.locator(`li[data-id="${garageId}"]`)
    const del = `li[data-id="${garageId}"] button.delete-service`
    // A confirm step: Cancel focused, Escape back to Delete.
    await row.locator('button.delete-service').click()
    await focusIs(`li[data-id="${garageId}"] .inline-form button.link`, 'Delete confirm open')
    const confirm = row.locator('button.danger')
    await tall(confirm, 'confirm Delete')
    await noOverflow('the Delete confirm open')
    await page.keyboard.press('Escape')
    await focusIs(del, 'after Escape on the Delete confirm')
    // A failed delete keeps the row, with the error on it and focus back on the confirm button.
    await row.locator('button.delete-service').click()
    await page.route(at('/void'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await confirm.click()
    await row.locator('[role=alert]').waitFor()
    if ((await row.locator('[role=alert]').textContent()) !== SV.generic) throw new Error('delete error')
    await focusIs(`li[data-id="${garageId}"] button.danger`, 'after a failed delete')
    forget500()
    await confirm.click()
    await row.waitFor({ state: 'detached' })
    await focusIs('.services > li:first-child button.delete-service', 'after Delete (the next older row)')
    // Oil and Brakes go back, and so do the odometer and its history, without a reload.
    await odometerIs('59000')
    await badgeIs('Oil', ST.Overdue)
    if (!plain(await taskRow('Brakes').textContent()).includes(SV.at59000)) throw new Error('Brakes not back')
    if (digitsOnly(await page.locator('.history li .value').first().textContent()).startsWith('59500')) throw new Error('Service reading still shown')
    // Deleting the oldest row moves focus to the newest.
    await services.locator(`li[data-id="${backdatedId}"] button.delete-service`).click()
    await services.locator(`li[data-id="${backdatedId}"] button.danger`).click()
    await services.locator(`li[data-id="${backdatedId}"]`).waitFor({ state: 'detached' })
    await focusIs('.services > li:first-child button.delete-service', 'after deleting the oldest row')
    // MVP3-A review 1: deleting a Mark done from the history also ends its Undo bar in the tasks (it would answer 409).
    const reset = page.waitForResponse((r) => r.request().method() === 'POST' && pathOf(r).endsWith('/reset'))
    await tasks.locator(`button[aria-label="${RS.done}Oil"]`).click()
    const resetId = (await (await reset).json()).serviceRecordId
    await taskRow('Oil').locator('.undo').waitFor()
    await services.locator(`li[data-id="${resetId}"] button.delete-service`).click()
    await services.locator(`li[data-id="${resetId}"] button.danger`).click()
    await services.locator(`li[data-id="${resetId}"]`).waitFor({ state: 'detached' })
    if (await tasks.locator('.undo').count()) throw new Error('tasks Undo bar outlived the history Delete')
    // Criterion 9 (Delete): deleted in another tab; the (mocked) 404 reloads the history with the note and the row drops.
    const topId = await serviceItems().first().getAttribute('data-id')
    const top = services.locator(`li[data-id="${topId}"]`)
    await top.locator('button.delete-service').click()
    await voidElsewhere(topId)
    await page.route(at('/void'), (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.notFound' }) }), { times: 1 })
    await top.locator('button.danger').click()
    await services.locator('p[role=status]', { hasText: SV.gone }).waitFor()
    await top.waitFor({ state: 'detached' })
    if (await services.locator('.error').count()) throw new Error('an error shown with the note')
    forgetExpected(404)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
    await page.setViewportSize(s.viewport)
  })
  // MVP3-D at 390px: edit a service's date, odometer and tasks. Each step records its own service and deletes it after, so the car ends as it was.
  const atKm = (km) => (he ? `ב־${km.toLocaleString('en')} ק״מ` : `at ${km.toLocaleString('en')} km`)
  const recordAt = async (km, task) => {
    await recordBtn.click()
    await recordForm.locator('input[name=odometerKm]').fill(String(km))
    await recordForm.getByRole('checkbox', { name: task, exact: true }).check()
    const res = page.waitForResponse((r) => isRecordPost(r.request()))
    await recordForm.locator('button:not(.link)').click()
    const id = (await (await res).json()).record.id
    await focusIs(`li[data-id="${id}"] button.edit-service`, 'after recording')
    return id
  }
  const isEditPut = (r) => r.request().method() === 'PUT' && r.url().includes('/service-records/')
  await step('edit-service-date-odometer', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const day = (offset) => page.evaluate((o) => new Date(Date.now() + o * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), offset)
    const cur = Number(digitsOnly(await odometer()))
    const id = await recordAt(cur + 1000, 'Brakes')
    await odometerIs(String(cur + 1000))
    const row = services.locator(`li[data-id="${id}"]`)
    const form = row.locator('form')
    const editBtn = `li[data-id="${id}"] button.edit-service`
    const date = form.locator('input[name=date]')
    const odo = form.locator('input[name=odometerKm]')
    const save = form.locator(':scope > .actions button:not(.link)')
    await row.locator('button.edit-service').click()
    await focusIs(`li[data-id="${id}"] form input[name=date]`, 'Edit open')
    // LOW-1 L9: Record a service is hidden while a row's Edit form is open.
    await recordBtn.waitFor({ state: 'detached', timeout: 2000 }).catch(() => { throw new Error('Record a service shown during Edit') })
    if ((await date.inputValue()) !== (await day(0)) || (await odo.inputValue()) !== String(cur + 1000)) throw new Error('not filled in')
    await form.locator('input[name=taskIds]').first().waitFor()
    if (!(await form.getByRole('checkbox', { name: 'Brakes', exact: true }).isChecked()) || (await form.getByRole('checkbox', { name: 'Oil', exact: true }).isChecked())) throw new Error('task boxes not as linked')
    await noOverflow('the edit form with date, odometer and tasks')
    for (const input of [date, odo]) await tall(input, `${await input.getAttribute('name')} field`)
    // Criterion 7: a future date and an out-of-range odometer are blocked on the field, before any request.
    let puts = 0
    const count = (r) => r.method() === 'PUT' && r.url().includes('/service-records/') && puts++
    page.on('request', count)
    await date.fill(await day(1))
    await save.click()
    if (!(await date.evaluate((el) => el.validity.rangeOverflow))) throw new Error('future date not blocked')
    // LOW-1 L7: the field's message is translated, as the odometer's is.
    if ((await date.evaluate((el) => el.validationMessage)) !== SV.future) throw new Error(`date message "${await date.evaluate((el) => el.validationMessage)}"`)
    await date.fill(await day(0))
    await odo.fill('20000000')
    await save.click()
    if (!(await odo.evaluate((el) => el.validity.rangeOverflow))) throw new Error('odometer not blocked')
    await page.waitForTimeout(300)
    page.off('request', count)
    if (puts) throw new Error(`${puts} PUTs for invalid values`)
    // Criterion 9: a failed save (mocked 500) keeps the form and the typed values, with the error.
    await odo.fill(String(cur + 800))
    await page.route('**/service-records/*', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.fallback()), { times: 1 })
    await save.click()
    await form.locator('[role=alert]').waitFor()
    if ((await form.locator('[role=alert]').textContent()) !== SV.generic || (await odo.inputValue()) !== String(cur + 800)) throw new Error('500 lost the form or its error')
    forgetExpected(500)
    // Criterion 5: the odometer only; the row, the car's odometer and its history follow, focus back on Edit.
    let put = page.waitForResponse(isEditPut)
    await save.click()
    let pr = await put
    let body = pr.request().postDataJSON()
    if (pr.status() !== 200 || body.odometerKm !== cur + 800 || body.date !== (await day(0)) || body.taskIds.length !== 1) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after saving the odometer')
    await recordBtn.waitFor({ timeout: 2000 })
    await odometerIs(String(cur + 800))
    if (!digitsOnly(await row.locator('.value').textContent()).startsWith(String(cur + 800))) throw new Error('row odometer')
    if (!(await page.locator('.history li', { hasText: RS.service }).filter({ hasText: (cur + 800).toLocaleString('en') }).count())) throw new Error('Service reading not moved')
    // Criterion 6: a day earlier and above every reading of today, it breaks date order: the error and the correction box sit under the odometer field.
    await row.locator('button.edit-service').click()
    await date.fill(await day(-1))
    await odo.fill(String(cur + 20000))
    put = page.waitForResponse(isEditPut)
    await save.click()
    const problem = await (await put).json()
    if (problem.code !== 'odometer.higherThanNext') throw new Error(`got ${JSON.stringify(problem)}`)
    const alert = form.locator('[role=alert]')
    await alert.filter({ hasText: problem.nextKm.toLocaleString('en') }).waitFor()
    if ((await odo.evaluate((el) => el.closest('label').nextElementSibling?.getAttribute('role'))) !== 'alert') throw new Error('order error not under the odometer field')
    if (!(await odo.getAttribute('aria-describedby')).split(' ').includes(await alert.getAttribute('id'))) throw new Error('order error not tied to the odometer')
    noLatin(plain(await alert.textContent()), 'order error')
    forgetExpected(400)
    await noOverflow('the edit form with the order error')
    await form.locator(':scope > label.inline input[type=checkbox]').check()
    put = page.waitForResponse(isEditPut)
    await save.click()
    pr = await put
    body = pr.request().postDataJSON()
    if (pr.status() !== 200 || body.confirmCorrection !== true || body.date !== (await day(-1)) || body.odometerKm !== cur + 20000) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after the confirmed correction')
    // Today's reading is the latest again, so the car's odometer falls back to it.
    await odometerIs(String(cur))
    if ((await row.locator('time').getAttribute('datetime')).slice(0, 10) !== (await day(-1))) throw new Error('row date')
    await voidElsewhere(id)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('edit-service-tasks', async () => {
    // Brakes' last done before this record (its remaining distance moves with the odometer, so only this part is compared).
    const lastAt = (name) => taskRow(name).textContent().then((t) => plain(t).match(he ? /ב־[\d,]+ ק״מ/ : /at [\d,]+ km/)?.[0])
    const before = await lastAt('Brakes')
    if (!before) throw new Error('Brakes has no last done')
    const cur = Number(digitsOnly(await odometer()))
    const id = await recordAt(cur + 1000, 'Brakes')
    if (!plain(await taskRow('Brakes').textContent()).includes(atKm(cur + 1000))) throw new Error('Brakes not done at the record')
    // Criterion 8: unticking Brakes makes it fall back; ticking Oil moves it to this, the most recent record.
    const row = services.locator(`li[data-id="${id}"]`)
    const form = row.locator('form')
    const editBtn = `li[data-id="${id}"] button.edit-service`
    // LOW-1 L9: Record a service comes back after Escape and Cancel, with focus on Edit (MVP1-C).
    await row.locator('button.edit-service').click()
    await form.locator('input[name=taskIds]').first().waitFor()
    await recordBtn.waitFor({ state: 'detached', timeout: 2000 }).catch(() => { throw new Error('Record a service shown during Edit') })
    await page.keyboard.press('Escape')
    await focusIs(editBtn, 'after Escape')
    await recordBtn.waitFor({ timeout: 2000 })
    await row.locator('button.edit-service').click()
    await form.locator(':scope > .actions button.link').click()
    await focusIs(editBtn, 'after Cancel')
    await recordBtn.waitFor({ timeout: 2000 })
    // LOW-1 L8: maintenanceTask.notFound (mocked: Oil was deleted meanwhile) reloads the tasks, keeping the form and its other input.
    await row.locator('button.edit-service').click()
    await form.getByRole('checkbox', { name: 'Brakes', exact: true }).uncheck()
    await form.getByRole('checkbox', { name: 'Oil', exact: true }).check()
    await form.locator('input[name=shopName]').fill('Kept shop')
    await page.route('**/service-records/*', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'maintenanceTask.notFound' }) }) : r.fallback()), { times: 1 })
    const reload = page.waitForRequest((q) => q.method() === 'GET' && pathOf(q).endsWith(`/vehicles/${carId()}/tasks`))
    await page.route(at(`/vehicles/${carId()}/tasks`), async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, json: (await res.json()).filter((x) => x.name !== 'Oil') }) }, { times: 2 })
    await form.locator(':scope > .actions button:not(.link)').click()
    await reload
    await form.getByRole('checkbox', { name: 'Oil', exact: true }).waitFor({ state: 'detached' })
    // LOW-2 L13: the Maintenance list drops it too, without a page reload.
    await taskRow('Oil').waitFor({ state: 'detached', timeout: 5000 }).catch(() => { throw new Error('the Maintenance list still shows the deleted task') })
    if ((await form.locator('[role=alert]').textContent()) !== SV.taskGone) throw new Error(`notFound error "${await form.locator('[role=alert]').textContent()}"`)
    await form.locator('[role=alert]').screenshot({ path: `${OUT}/${s.name}-service-task-gone-error.png` }) // LOW-5 L90: a long L79 string, for a read at 390px
    if ((await form.locator('input[name=shopName]').inputValue()) !== 'Kept shop' || (await form.getByRole('checkbox', { name: 'Brakes', exact: true }).isChecked())) throw new Error('notFound lost the input')
    forgetExpected(404)
    await form.locator(':scope > .actions button.link').click()
    await focusIs(editBtn, 'after Cancel')
    await row.locator('button.edit-service').click()
    await form.getByRole('checkbox', { name: 'Brakes', exact: true }).uncheck()
    await form.getByRole('checkbox', { name: 'Oil', exact: true }).check()
    const put = page.waitForResponse(isEditPut)
    await form.locator(':scope > .actions button:not(.link)').click()
    const pr = await put
    const res = await pr.json()
    if (pr.status() !== 200 || pr.request().postDataJSON().taskIds.length !== 1 || res.record.tasks.map((x) => x.name).join() !== 'Oil') throw new Error(`${pr.status()} ${JSON.stringify(res.record)}`)
    await focusIs(`li[data-id="${id}"] button.edit-service`, 'after saving the tasks')
    await badgeIs('Oil', ST.Ok)
    await page.waitForFunction(([w]) => [...document.querySelectorAll('.tasks > li')].some((l) => l.textContent.replace(/[⁦-⁩]/g, '').includes(w)), [atKm(cur + 1000)])
    if (!plain(await taskRow('Oil').textContent()).includes(atKm(cur + 1000))) throw new Error(`Oil: ${plain(await taskRow('Oil').textContent())}`)
    if ((await lastAt('Brakes')) !== before) throw new Error(`Brakes did not fall back to ${before}: ${await lastAt('Brakes')}`)
    const tasksText = plain(await row.locator('p.muted').textContent())
    if (!tasksText.includes('Oil') || tasksText.includes('Brakes')) throw new Error(`row tasks "${tasksText}"`)
    await noOverflow('the edited tasks')
    await voidElsewhere(id)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
    await page.setViewportSize(s.viewport)
  })
  await step('other-users-car-not-found', async () => {
    // A second user's car, created through the API, must not be visible to this user.
    const auth = await page.request.post(`${BASE}/api/auth/register`, {
      data: { email: `other-${s.name}-${Date.now()}@onlycars.test`, password: 'Passw0rd!' },
    })
    const headers = { Authorization: `Bearer ${(await auth.json()).token}` }
    const car = await (await page.request.post(`${BASE}/api/vehicles`, { headers, data: { nickname: 'Not yours' } })).json()
    await page.goto(`${BASE}/cars/${car.id}`)
    const text = await page.locator('main .error').textContent()
    const expected = s.lng === 'he' ? 'הרכב לא נמצא.' : 'This car was not found.'
    if (text !== expected) throw new Error(`not-found text: "${text}"`)
    // The error is the h1 and the title (without the full stop), with the back link, on both car routes.
    for (const path of [`/cars/${car.id}`, '/cars/abc/edit']) {
      await page.goto(`${BASE}${path}`)
      const h1 = await page.locator('main h1').textContent()
      if (h1 !== expected) throw new Error(`${path} h1: "${h1}"`)
      await titleIs(expected.slice(0, -1))
      await page.locator('main > a.back').waitFor()
    }
  })
  await step('api-register-short-password', async () => {
    const res = await page.request.post(`${BASE}/api/auth/register`, {
      data: { email: `short-${s.name}-${Date.now()}@onlycars.test`, password: '1234567' },
    })
    const body = await res.json()
    if (res.status() !== 400 || body.code !== 'auth.passwordTooShort') throw new Error(`got ${res.status()} ${JSON.stringify(body)}`)
  })
  await step('edit-car', async () => {
    await page.click('main > a[href="/"]') // back from the not-found page via the detail page's link
    await page.locator('.cars > li').first().waitFor()
    await arrivedAt(T.dashboard)
    await page.click('a[href$="/edit"]')
    await page.locator('input[name=nickname]').waitFor()
    await arrivedAt(T.editCar)
    await page.fill('input[name=nickname]', 'Renamed Corolla')
    await page.click('form > .actions > button:not(.link)') // Save, not the photo button
    await page.getByRole('heading', { name: 'Renamed Corolla' }).waitFor()
    await arrivedAt(T.dashboard)
  })
  // FILE-1: the car photo. Upload, change and remove go to the real API and R2 (the photo is removed at the end, and again in a finally);
  // the server errors, the archived car and the expired signed URL are mocked.
  const i18nSrc = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8')
  // Looked up in this setup's language block only, and a key() is top-level, so a lookup never depends on match order (L122).
  const heAt = i18nSrc.indexOf('\nconst he')
  const langSrc = he ? i18nSrc.slice(heAt) : i18nSrc.slice(0, heAt)
  const copy = (re) => {
    const m = [...langSrc.matchAll(re)][0]
    if (!m) throw new Error(`no ${s.lng} text for ${re}`)
    return plain(m[2])
  }
  const key = (k) => copy(new RegExp(`^ {2}${k}: (['"])(.*)\\1,$`, 'gm'))
  // A key inside one of `errors`' blocks (file and attachmentFile share key names).
  const inBlock = (block, k) => copy(new RegExp(`^ {4}${block}: \\{[^}]*?^ +${k}: (['"])([^\\n]*)\\1,$`, 'gms'))
  const PH = {
    add: key('addPhoto'), change: key('changePhoto'), uploading: key('uploadingPhoto'), confirm: key('confirmRemovePhoto'),
    tooLarge: inBlock('file', 'tooLarge'), unsupported: inBlock('file', 'unsupportedType'), required: inBlock('file', 'required'), unavailable: inBlock('file', 'storageUnavailable'),
    archived: copy(/vehiclePhoto: \{\s*vehicleArchived: (['"])(.*)\1,/g),
    tooMany: copy(/http: \{ 413: '[^']*', 429: (['"])(.*)\1 \}/g),
    archivedHint: key('photoArchivedHint'), conflict: inBlock('concurrency', 'conflict'),
  }
  let photoCarId, photoAuth
  const photoRequests = []
  page.on('request', (r) => r.url().endsWith('/photo') && photoRequests.push(r.method()))
  // A 64x48 image drawn by the browser, so the API gets a real PNG or JPEG.
  const image = async (type) => Buffer.from((await page.evaluate((type) => {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 48 })
    const x = c.getContext('2d')
    x.fillStyle = type === 'image/png' ? '#c33' : '#36c'
    x.fillRect(0, 0, 64, 48)
    return c.toDataURL(type)
  }, type)).split(',')[1], 'base64')
  const PICK = '.photo-field .actions button:not(.link)'
  const pickText = async () => plain(await page.locator(PICK).textContent())
  // As a user does it: the button opens the file chooser.
  async function choose(file) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(PICK)])
    await chooser.setFiles(file)
  }
  async function photoAlertIs(want, what) {
    let got
    for (const end = Date.now() + 5000; Date.now() < end; await page.waitForTimeout(100)) {
      got = plain((await page.locator('.photo-field p.error[role=alert]').textContent({ timeout: 5000 }).catch(() => '')) ?? '')
      if (got === want) return
    }
    throw new Error(`${what}: "${got}"`)
  }
  const photoLoaded = (sel, end = '') => page.waitForFunction(([sel, end]) => {
    const img = document.querySelector(sel)
    return img?.complete && img.naturalWidth === 64 && new URL(img.src).pathname.endsWith(end)
  }, [sel, end], { timeout: 10000 })
  async function ratioIs16by9(what) {
    const box = await page.locator('main img.car-photo').boundingBox()
    if (Math.abs(box.width / box.height - 16 / 9) > 0.02) throw new Error(`${what}: photo box ${box.width}x${box.height}`)
  }
  await step('photo-client-checks', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const li = page.locator('.cars > li', { hasText: 'Renamed Corolla' })
    photoCarId = await li.getAttribute('data-id')
    photoAuth = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` }
    await li.locator('a[href$="/edit"]').click()
    await arrivedAt(T.editCar)
    if ((await pickText()) !== PH.add) throw new Error(`button "${await pickText()}"`)
    if (await page.locator('.photo-field img').count()) throw new Error('a photo shows before any upload')
    const accept = await page.getAttribute('.photo-field input[type=file]', 'accept')
    if (accept !== 'image/jpeg,image/png,image/webp') throw new Error(`accept "${accept}"`)
    // Too large, empty and a GIF are caught before sending.
    photoRequests.length = 0
    await choose({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(12_000_000) })
    await photoAlertIs(PH.tooLarge, '12 MB file')
    await focusIs(PICK, 'the photo button after the size error')
    await choose({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await photoAlertIs(PH.unsupported, 'a .txt file')
    await choose({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) })
    await photoAlertIs(PH.required, 'empty file')
    await choose({ name: 'car.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
    await photoAlertIs(PH.unsupported, 'GIF')
    if (photoRequests.length) throw new Error(`requests sent: ${photoRequests}`)
    // A text file named .jpg passes the browser's type; the API rejects it by its content.
    const put = page.waitForResponse((r) => r.url().endsWith('/photo'))
    await choose({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('hello, this is not a photo') })
    if ((await put).status() !== 400) throw new Error(`text .jpg: ${(await put).status()}`)
    await photoAlertIs(PH.unsupported, 'text file named .jpg')
    await focusIs(PICK, 'the photo button after the type error')
    await sweep('the edit form at 390px')
    await noOverflow('the photo errors')
  })
  await step('photo-upload-change', async () => {
    await page.setViewportSize(s.viewport)
    const put = () => page.waitForResponse((r) => r.url().endsWith('/photo') && r.request().method() === 'PUT')
    let res = put()
    await choose({ name: 'car.png', mimeType: 'image/png', buffer: await image('image/png') })
    if ((await res).status() !== 200) throw new Error(`upload ${(await res).status()}`)
    await photoLoaded('.photo-field img', '.png')
    await focusIs(PICK, 'the photo button after upload')
    if ((await pickText()) !== PH.change) throw new Error(`button "${await pickText()}"`)
    if (await page.locator('.photo-field p.error').count()) throw new Error('the error stayed after the upload')
    // Change: a JPEG replaces the PNG, and the PNG is gone from storage.
    const old = await page.getAttribute('.photo-field img', 'src')
    res = put()
    await choose({ name: 'car.jpg', mimeType: 'image/jpeg', buffer: await image('image/jpeg') })
    if ((await res).status() !== 200) throw new Error(`change ${(await res).status()}`)
    await photoLoaded('.photo-field img', '.jpg')
    await focusIs(PICK, 'the photo button after change')
    await page.screenshot({ path: `${OUT}/${s.name}-photo-edit-form.png` })
    if ((await page.request.get(old)).status() !== 404) throw new Error('the replaced photo is still stored')
    // After a reload the car page shows it at the top, named by the car, in a 16:9 box, also at 390px.
    await page.goto(`${BASE}/cars/${photoCarId}`)
    await photoLoaded('main .card:first-of-type img.car-photo', '.jpg')
    if ((await page.getAttribute('main img.car-photo', 'alt')) !== 'Renamed Corolla') throw new Error('alt is not the nickname')
    await ratioIs16by9(s.name)
    await page.setViewportSize({ width: 390, height: 844 })
    await ratioIs16by9('390px')
    await noOverflow('the photo at 390px')
    await page.setViewportSize(s.viewport)
  })
  await step('photo-remove', async () => {
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${BASE}/cars/${photoCarId}/edit`)
      await photoLoaded('.photo-field img')
      const removeLink = page.locator('.photo-field .actions button.link')
      await removeLink.click()
      const confirm = plain(await page.locator('.photo-field .inline-form p').textContent())
      if (confirm !== PH.confirm) throw new Error(`confirm "${confirm}"`)
      await focusIs('.photo-field .inline-form button.link', 'Cancel on the confirm')
      await page.keyboard.press('Escape')
      await focusIs('.photo-field .actions button.link', 'Remove photo after Escape')
      await removeLink.click()
      await sweep('the remove confirm at 390px')
      await page.screenshot({ path: `${OUT}/${s.name}-photo-remove-confirm.png` })
      const del = page.waitForResponse((r) => r.url().endsWith('/photo') && r.request().method() === 'DELETE')
      await page.click('.photo-field button.danger')
      if ((await del).status() !== 204) throw new Error(`remove ${(await del).status()}`)
      await page.locator('.photo-field img').waitFor({ state: 'detached' })
      await focusIs(PICK, 'Add photo after remove')
      if ((await pickText()) !== PH.add) throw new Error(`button "${await pickText()}"`)
      await page.goto(`${BASE}/cars/${photoCarId}`)
      await page.getByRole('heading', { name: 'Renamed Corolla' }).waitFor()
      if (await page.locator('main img').count()) throw new Error('the car page still shows a photo')
    } finally {
      // Never leave a test photo in the bucket.
      if (photoCarId) await page.request.delete(`${BASE}/api/vehicles/${photoCarId}/photo`, { headers: photoAuth })
      await page.setViewportSize(s.viewport)
    }
  })
  await step('photo-states', async () => {
    const carUrl = `**/api/vehicles/${photoCarId}`
    const real = await (await page.request.get(`${BASE}/api/vehicles/${photoCarId}`, { headers: photoAuth })).json()
    const png = await image('image/png')
    const problem = (status, code, more) => ({ status, contentType: 'application/problem+json', body: JSON.stringify({ status, code, ...more }) })
    const carWith = (photoUrl, more = {}) => ({ contentType: 'application/json', body: JSON.stringify({ ...real, photoUrl, ...more }) })
    try {
      // Busy while uploading, then the server's errors, translated (mocked).
      await page.goto(`${BASE}/cars/${photoCarId}/edit`)
      await page.locator(PICK).waitFor() // a full load keeps the browser's focus
      await page.route('**/photo', async (r) => { await page.waitForTimeout(600); await r.fulfill(problem(503, 'file.storageUnavailable')) }, { times: 1 })
      await choose({ name: 'car.png', mimeType: 'image/png', buffer: png })
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-busy') === 'true', PICK, { timeout: 3000 })
      if ((await pickText()) !== PH.uploading) throw new Error(`busy button "${await pickText()}"`)
      await photoAlertIs(PH.unavailable, '503')
      if ((await page.getAttribute(PICK, 'aria-busy')) !== 'false') throw new Error('still busy after the error')
      await focusIs(PICK, 'the photo button after the 503')
      await page.route('**/photo', (r) => r.fulfill(problem(400, 'vehiclePhoto.vehicleArchived')), { times: 1 })
      await choose({ name: 'car.png', mimeType: 'image/png', buffer: png })
      await photoAlertIs(PH.archived, '400 archived')
      // A file with no extension (a phone's "IMG_0001") has no browser type: it is sent, and the API decides (mocked: the photo rate limit).
      let sent = null
      await page.route('**/photo', (r) => { sent = r.request().method(); return r.fulfill(problem(429, 'http.429')) }, { times: 1 })
      // From disk, as Playwright gives an in-memory file application/octet-stream instead of the browser's empty type.
      writeFileSync(`${OUT}/IMG_0001`, png)
      await choose(`${OUT}/IMG_0001`)
      await photoAlertIs(PH.tooMany, '429 for the extensionless file')
      if (sent !== 'PUT') throw new Error(`the extensionless file was not sent: ${sent}`)
      await focusIs(PICK, 'the photo button after the 429')
      // L121: application/octet-stream (some browsers' type for an unknown file) is sent too (mocked: a replacement race's 409).
      sent = null
      await page.route('**/photo', (r) => { sent = r.request().method(); return r.fulfill(problem(409, 'concurrency.conflict')) }, { times: 1 })
      await choose({ name: 'photo.bin', mimeType: 'application/octet-stream', buffer: png })
      await photoAlertIs(PH.conflict, '409 for the octet-stream file')
      if (sent !== 'PUT') throw new Error(`the octet-stream file was not sent: ${sent}`)
      // LOW-6 (L116): a 409 on Change or Remove reloads the car, so the other change shows under the message (mocked).
      await page.route('**/__photo/*', (r) => r.request().url().endsWith('/ok.png') ? r.fulfill({ contentType: 'image/png', body: png }) : r.fulfill({ status: 403 }))
      let reloads = 0
      await page.route(carUrl, (r) => { reloads++; return r.fulfill(carWith(`${BASE}/__photo/ok.png`)) }, { times: 1 })
      await page.route('**/photo', (r) => r.fulfill(problem(409, 'concurrency.conflict')), { times: 1 })
      await choose({ name: 'car.png', mimeType: 'image/png', buffer: png })
      await photoAlertIs(PH.conflict, '409 on upload')
      await photoLoaded('.photo-field img', '/ok.png')
      if (reloads !== 1) throw new Error(`${reloads} car requests after the upload 409, want 1`)
      await page.screenshot({ path: `${OUT}/${s.name}-photo-conflict-upload.png` })
      // LOW-8 L142: a remove 409 while the photo is still there (the other change replaced it): the confirm stays with the message and focus on Remove.
      await page.route(carUrl, (r) => { reloads++; return r.fulfill(carWith(`${BASE}/__photo/ok.png`)) }, { times: 1 })
      await page.route('**/photo', (r) => r.fulfill(problem(409, 'concurrency.conflict')), { times: 1 })
      await page.click('.photo-field .actions button.link')
      await page.click('.photo-field button.danger')
      await photoAlertIs(PH.conflict, '409 on remove with the photo kept')
      if (reloads !== 2) throw new Error(`${reloads - 1} car requests after the remove 409 with the photo kept, want 1`)
      await photoLoaded('.photo-field img', '/ok.png')
      if (!(await page.locator('.photo-field .inline-form').count())) throw new Error('the remove confirm closed with the photo still there')
      await focusIs('.photo-field button.danger', 'Remove after the 409 with the photo kept')
      await page.screenshot({ path: `${OUT}/${s.name}-photo-conflict-remove-kept.png` })
      await page.keyboard.press('Escape')
      await page.locator('.photo-field .inline-form').waitFor({ state: 'detached' })
      reloads = 1 // the next case counts from the upload 409 alone
      await page.route(carUrl, (r) => { reloads++; return r.fulfill(carWith(null)) }, { times: 1 })
      await page.route('**/photo', (r) => r.fulfill(problem(409, 'concurrency.conflict')), { times: 1 })
      await page.click('.photo-field .actions button.link')
      await page.click('.photo-field button.danger')
      await photoAlertIs(PH.conflict, '409 on remove')
      await page.locator('.photo-field img').waitFor({ state: 'detached' })
      if (reloads !== 2) throw new Error(`${reloads - 1} car requests after the remove 409, want 1`)
      // The other change removed the photo: no confirm left, focus on Add photo.
      if (await page.locator('.photo-field .inline-form').count()) throw new Error('the remove confirm stays with no photo')
      await focusIs(PICK, 'Add photo after the remove 409')
      await page.screenshot({ path: `${OUT}/${s.name}-photo-conflict-remove.png` })
      await page.unroute('**/__photo/*')
      // An archived car: no Add or Change, but its photo can be removed.
      await page.route('**/__photo/*', (r) => r.request().url().endsWith('/ok.png') ? r.fulfill({ contentType: 'image/png', body: png }) : r.fulfill({ status: 403 }))
      await page.route(carUrl, (r) => r.fulfill(carWith(`${BASE}/__photo/ok.png`, { isArchived: true })))
      await page.reload()
      await photoLoaded('.photo-field img')
      if (await page.locator(PICK).count()) throw new Error('Add or Change shows on an archived car')
      await page.locator('.photo-field .actions button.link').waitFor()
      // L114: the form says why.
      const hint = plain(await page.locator('.photo-field > p.muted').textContent())
      if (hint !== PH.archivedHint) throw new Error(`archived hint "${hint}"`)
      await page.setViewportSize({ width: 390, height: 844 })
      await noOverflow('the archived photo hint at 390px')
      await sweep('the archived photo field at 390px')
      await page.screenshot({ path: `${OUT}/${s.name}-photo-archived-hint.png` })
      await page.setViewportSize(s.viewport)
      await page.unroute(carUrl)
      // An expired signed URL: after the image fails, the car is fetched once more for a fresh one (mocked).
      // Car requests are counted from the first failed image on, as the dev build (StrictMode) loads the page twice.
      let gets = 0, getsAtFail = null
      await page.unroute('**/__photo/*')
      await page.route('**/__photo/*', (r) => {
        if (r.request().url().endsWith('/ok.png')) return r.fulfill({ contentType: 'image/png', body: png })
        getsAtFail ??= gets
        return r.fulfill({ status: 403 })
      })
      await page.route(carUrl, (r) => { gets++; return r.fulfill(carWith(`${BASE}/__photo/${getsAtFail == null ? 'expired' : 'ok'}.png`)) })
      await page.goto(`${BASE}/cars/${photoCarId}`)
      await photoLoaded('main img.car-photo', '/ok.png')
      if (gets - getsAtFail !== 1) throw new Error(`${gets - getsAtFail} car requests after the failed image, want 1`)
      // Still failing after that one reload: no photo, and no more requests.
      await page.unroute(carUrl)
      gets = 0
      getsAtFail = null
      // One URL until the first failure (the dev build loads the car twice), then a new one per request, as the server signs each.
      await page.route(carUrl, (r) => { gets++; return r.fulfill(carWith(`${BASE}/__photo/expired-${getsAtFail == null ? 0 : gets}.png`)) })
      await page.goto(`${BASE}/cars/${photoCarId}`)
      await page.getByRole('heading', { name: 'Renamed Corolla' }).waitFor()
      await page.waitForFunction(() => !document.querySelector('main img'), null, { timeout: 5000 })
      await page.waitForTimeout(500)
      if (gets - getsAtFail !== 1) throw new Error(`${gets - getsAtFail} car requests after the failed image, want 1`)
      // L115: two expired links in one visit (the second a new URL from an upload) each recover with one car request (mocked).
      await page.unroute(carUrl)
      await page.unroute('**/__photo/*')
      let next = 'expired-1'
      gets = 0
      await page.route('**/__photo/*', (r) => {
        const name = new URL(r.request().url()).pathname.split('/').pop().replace('.png', '')
        if (name.startsWith('ok')) return r.fulfill({ contentType: 'image/png', body: png })
        next = name.replace('expired', 'ok')
        return r.fulfill({ status: 403 })
      })
      await page.route(carUrl, (r) => { gets++; return r.fulfill(carWith(`${BASE}/__photo/${next}.png`)) })
      await page.goto(`${BASE}/cars/${photoCarId}/edit`)
      await photoLoaded('.photo-field img', '/ok-1.png')
      await page.route('**/photo', (r) => r.fulfill(carWith(`${BASE}/__photo/expired-2.png`)), { times: 1 })
      const before = gets
      await choose({ name: 'car.png', mimeType: 'image/png', buffer: png })
      await photoLoaded('.photo-field img', '/ok-2.png')
      if (gets - before !== 1) throw new Error(`${gets - before} car requests after the second expired link, want 1`)
    } finally {
      await page.unroute(carUrl)
      await page.unroute('**/__photo/*')
      await page.unroute('**/photo')
    }
  })
  // FILE-2: files on a service record, on the car's newest service. The client checks, a text .pdf, an image and a PDF go to the real
  // API and R2 (3 uploads, with FILE-1's 3 inside the per-user budget of 10); every file is deleted at the end, and again in a finally.
  // The server errors, 10 files, no storage, the archived car, /history and the expired link are mocked.
  // The quota's 400 carries the limit (FILE-2 contract), 1 GiB.
  const quotaBody = (code) => code === 'file.quotaExceeded' && { maxBytes: 1_073_741_824 }
  const AF = {
    add: key('addFile'), uploading: key('uploadingFile'), confirm: key('confirmDeleteFile'),
    tooLarge: inBlock('attachmentFile', 'tooLarge'), unsupported: inBlock('attachmentFile', 'unsupportedType'), unavailable: inBlock('attachmentFile', 'storageUnavailable'),
    // L129: the limit from the mocked maxBytes (1 GiB), not written into the text.
    quota: inBlock('attachmentFile', 'quotaExceeded').replace('{{amount}}', (1).toLocaleString(s.lng)).replace('{{unit}}', key('gb')),
    conflict: inBlock('concurrency', 'conflict'), gone: key('serviceGone'), generic: copy(/^ {4}generic: (['"])(.*)\1,$/gm),
    max: key('filesMax'), newTab: key('opensNewTab'),
    tooMany: inBlock('attachment', 'tooMany'), archived: inBlock('attachment', 'vehicleArchived'), notFound: inBlock('attachment', 'notFound'),
    rate: PH.tooMany,
  }
  let fileRecord, filesPath
  const FILES = () => `.services > li[data-id="${fileRecord.id}"] .files`
  const ADD = () => `${FILES()} button.add-file`
  const fileRequests = []
  page.on('request', (r) => r.url().includes('/attachments') && fileRequests.push(r.method()))
  async function chooseFile(file) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(ADD())])
    await chooser.setFiles(file)
  }
  async function fileAlertIs(want, what) {
    let got
    for (const end = Date.now() + 5000; Date.now() < end; await page.waitForTimeout(100)) {
      got = plain((await page.locator(`${FILES()} p.error[role=alert]`).textContent({ timeout: 5000 }).catch(() => '')) ?? '')
      if (got === want) return
    }
    throw new Error(`${what}: "${got}"`)
  }
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
  const longName = `${'receipt-'.repeat(15)}.png` // 124 characters, no spaces
  const heName = 'חשבונית מס מוסך.pdf'
  async function deleteAllFiles() {
    if (!fileRecord) return
    const rs = await (await page.request.get(`${BASE}/api${filesPath}`, { headers: photoAuth })).json()
    for (const a of rs.find((x) => x.id === fileRecord.id)?.attachments ?? [])
      await page.request.delete(`${BASE}/api${filesPath}/${fileRecord.id}/attachments/${a.id}`, { headers: photoAuth })
  }
  await step('files-client-checks', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    filesPath = `/vehicles/${photoCarId}/service-records`
    const rs = await (await page.request.get(`${BASE}/api${filesPath}`, { headers: photoAuth })).json()
    fileRecord = rs[0]
    if (!fileRecord) throw new Error('the car has no service to attach files to')
    if (fileRecord.attachments?.length !== 0) throw new Error(`attachments ${JSON.stringify(fileRecord.attachments)}`)
    await page.goto(`${BASE}/cars/${photoCarId}`)
    await page.locator(ADD()).waitFor()
    if (plain(await page.locator(ADD()).textContent()) !== AF.add) throw new Error(`button "${await page.locator(ADD()).textContent()}"`)
    if (await page.locator(`${FILES()} ul`).count()) throw new Error('a list shows with no files')
    const accept = await page.getAttribute(`${FILES()} input[type=file]`, 'accept')
    if (accept !== 'image/jpeg,image/png,image/webp,application/pdf') throw new Error(`accept "${accept}"`)
    fileRequests.length = 0
    await chooseFile({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await fileAlertIs(AF.unsupported, 'a .txt file')
    await chooseFile({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(12_000_000) })
    await fileAlertIs(AF.tooLarge, '12 MB file')
    await focusIs(ADD(), 'Add file after the size error')
    if (fileRequests.length) throw new Error(`requests sent: ${fileRequests}`)
    // A text file named .pdf passes the browser's type; the API rejects it by its content.
    const post = page.waitForResponse((r) => r.url().endsWith('/attachments'))
    await chooseFile({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello, this is not a PDF') })
    if ((await post).status() !== 400) throw new Error(`text .pdf: ${(await post).status()}`)
    await fileAlertIs(AF.unsupported, 'text file named .pdf')
    await focusIs(ADD(), 'Add file after the type error')
    await sweep('the car page with a file error at 390px')
    await noOverflow('the file errors')
  })
  await step('files-upload-open-delete', async () => {
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      const post = () => page.waitForResponse((r) => r.url().endsWith('/attachments') && r.request().method() === 'POST')
      let res = post()
      await chooseFile({ name: longName, mimeType: 'image/png', buffer: await image('image/png') })
      if ((await res).status() !== 200) throw new Error(`image upload ${(await res).status()}`)
      await page.locator(`${FILES()} li`).waitFor()
      await focusIs(ADD(), 'Add file after the upload')
      if (await page.locator(`${FILES()} p.error`).count()) throw new Error('the error stayed after the upload')
      res = post()
      await chooseFile({ name: heName, mimeType: 'application/pdf', buffer: pdf })
      if ((await res).status() !== 200) throw new Error(`PDF upload ${(await res).status()}`)
      await page.locator(`${FILES()} li >> nth=1`).waitFor()
      await focusIs(ADD(), 'Add file after the second upload')
      // After a reload both are there, in upload order, with their sizes, opening in a new tab.
      await page.reload()
      await page.locator(`${FILES()} li >> nth=1`).waitFor()
      const names = await page.locator(`${FILES()} li a bdi`).allTextContents()
      if (JSON.stringify(names) !== JSON.stringify([longName, heName])) throw new Error(`names ${JSON.stringify(names)}`)
      for (const a of await page.locator(`${FILES()} li a`).all()) {
        if ((await a.getAttribute('target')) !== '_blank' || (await a.getAttribute('rel')) !== 'noopener noreferrer') throw new Error('a link does not open in a new tab')
      }
      const sizes = (await page.locator(`${FILES()} li > span.muted`).allTextContents()).map(plain)
      if (!sizes.every((x) => /^[\d.,]+ (KB|ק״ב)$/.test(x))) throw new Error(`sizes ${JSON.stringify(sizes)}`)
      // Each signed URL serves its file inline with its type and name (checked without printing the URL).
      for (const [i, type] of [[0, 'image/png'], [1, 'application/pdf']]) {
        const r = await page.request.get(await page.locator(`${FILES()} li a >> nth=${i}`).getAttribute('href'))
        if (r.status() !== 200 || r.headers()['content-type'] !== type || !r.headers()['content-disposition']?.startsWith('inline')) throw new Error(`file ${i}: ${r.status()} ${r.headers()['content-type']}`)
      }
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.click(`${FILES()} li a >> nth=0`)])
      await popup.waitForURL((u) => u.pathname.endsWith('.png'), { timeout: 10000 })
      await popup.close()
      await sweep('the files at 390px')
      await noOverflow('a 124-character and a Hebrew file name')
      await page.screenshot({ path: `${OUT}/${s.name}-files-list-390.png`, fullPage: true })
      // Delete: the confirm, Escape back to Delete, then delete; focus goes to the list.
      const del1 = page.locator(`${FILES()} li >> nth=0`).locator('button.link')
      await del1.click()
      if (plain(await page.locator(`${FILES()} .inline-form p`).textContent()) !== AF.confirm) throw new Error('confirm text')
      await focusIs(`${FILES()} .inline-form button.link`, 'Cancel on the confirm')
      await page.keyboard.press('Escape')
      await focusIs(`${FILES()} li:first-child button.link`, 'Delete after Escape')
      await del1.click()
      await page.screenshot({ path: `${OUT}/${s.name}-files-delete-confirm.png`, fullPage: true })
      const del = page.waitForResponse((r) => r.url().includes('/attachments/') && r.request().method() === 'DELETE')
      await page.click(`${FILES()} button.danger`)
      if ((await del).status() !== 204) throw new Error(`delete ${(await del).status()}`)
      await page.waitForFunction((sel) => document.querySelectorAll(`${sel} li`).length === 1, FILES(), { timeout: 5000 })
      await focusIs(FILES(), 'the list after a delete')
      // The last one: focus goes to Add file.
      await page.locator(`${FILES()} li button.link`).click()
      await page.click(`${FILES()} button.danger`)
      await page.locator(`${FILES()} ul`).waitFor({ state: 'detached' })
      await focusIs(ADD(), 'Add file after the list empties')
    } finally {
      await deleteAllFiles()
      await page.setViewportSize(s.viewport)
    }
  })
  await step('files-states', async () => {
    const listUrl = `**/api${filesPath}`
    const historyGet = (u) => u.pathname === '/api/service-records'
    const problem = (status, code, more) => ({ status, contentType: 'application/problem+json', body: JSON.stringify({ status, code, ...more }) })
    const realList = await (await page.request.get(`${BASE}/api${filesPath}`, { headers: photoAuth })).json()
    const file = (i, url = `https://files.test/__file/${i}.pdf`) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, fileName: `scan-${i}.pdf`, contentType: 'application/pdf', sizeBytes: 1_500_000 + i, url })
    const withFiles = (attachments) => ({ contentType: 'application/json', body: JSON.stringify(realList.map((r) => (r.id === fileRecord.id ? { ...r, attachments } : r))) })
    try {
      await page.route('**/__file/*', (r) => r.fulfill({ contentType: 'text/plain', body: new URL(r.request().url()).pathname }))
      // Busy while uploading, then the server's errors, translated.
      await page.goto(`${BASE}/cars/${photoCarId}`)
      await page.locator(ADD()).waitFor()
      const png = await image('image/png')
      for (const [status, code, want] of [[503, 'file.storageUnavailable', AF.unavailable], [400, 'attachment.tooMany', AF.tooMany], [400, 'attachment.vehicleArchived', AF.archived], [429, 'http.429', AF.rate], [400, 'file.quotaExceeded', AF.quota], [409, 'concurrency.conflict', AF.conflict]]) {
        await page.route('**/attachments', async (r) => { await page.waitForTimeout(600); await r.fulfill(problem(status, code, quotaBody(code))) }, { times: 1 })
        // L121: the 429 one is an application/octet-stream file, sent as any other.
        await chooseFile(code === 'http.429' ? { name: 'r.bin', mimeType: 'application/octet-stream', buffer: png } : { name: 'r.png', mimeType: 'image/png', buffer: png })
        await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-busy') === 'true', ADD(), { timeout: 3000 })
        if (plain(await page.locator(ADD()).textContent()) !== AF.uploading) throw new Error(`busy button "${await page.locator(ADD()).textContent()}"`)
        await fileAlertIs(want, code)
        if ((await page.getAttribute(ADD(), 'aria-busy')) !== 'false') throw new Error(`still busy after ${code}`)
        await focusIs(ADD(), `Add file after ${code}`)
      }
      // L131/L132: a 409 reloads the list (another upload's file shows); when that reload fails too, both messages show, the conflict first.
      await page.route('**/attachments', (r) => r.fulfill(problem(409, 'concurrency.conflict')), { times: 1 })
      await page.route(listUrl, (r) => r.fulfill(withFiles([file(7)])), { times: 1 })
      await chooseFile({ name: 'r.png', mimeType: 'image/png', buffer: png })
      await fileAlertIs(AF.conflict, '409 with a reload')
      await page.locator(`${FILES()} li`).waitFor()
      await page.route('**/attachments', (r) => r.fulfill(problem(409, 'concurrency.conflict')), { times: 1 })
      await page.route(listUrl, (r) => r.fulfill(problem(500, 'http.500')), { times: 1 })
      await chooseFile({ name: 'r.png', mimeType: 'image/png', buffer: png })
      await fileAlertIs(`${AF.conflict} ${AF.generic}`, '409 and a failed reload')
      await focusIs(ADD(), 'Add file after the 409 and a failed reload')
      await page.setViewportSize({ width: 390, height: 844 })
      await noOverflow('two messages at 390px')
      await page.screenshot({ path: `${OUT}/${s.name}-files-conflict-reload-failed.png`, fullPage: true })
      await page.setViewportSize(s.viewport)
      // 10 files, some without storage (no URL): no Add file but the max sentence (L127), those names plain text.
      await page.route(listUrl, (r) => r.fulfill(withFiles([...Array(10)].map((_, i) => file(i, { 1: 'javascript:alert(1)', 3: `http://files.test/__file/${i}.pdf` }[i] ?? (i % 2 ? null : undefined))))))
      await page.reload()
      await page.locator(`${FILES()} li >> nth=9`).waitFor()
      if (await page.locator(ADD()).count()) throw new Error('Add file shows with 10 files')
      if (plain(await page.locator(`${FILES()} > p.muted`).textContent()) !== AF.max) throw new Error('no max sentence at 10 files')
      // L133: a file link's accessible name says it opens a new tab.
      if ((await page.getByRole('link', { name: `scan-0.pdf ${AF.newTab}`, exact: true }).count()) !== 1) throw new Error('the file link does not announce the new tab')
      if ((await page.locator(`${FILES()} li a`).count()) !== 5) throw new Error('files without a URL are links')
      await sweep('10 files')
      await page.screenshot({ path: `${OUT}/${s.name}-files-ten.png`, fullPage: true })
      // A file deleted elsewhere: the message, and it leaves the list.
      await page.route('**/attachments/*', (r) => r.fulfill(problem(404, 'attachment.notFound')), { times: 1 })
      await page.locator(`${FILES()} li >> nth=0`).locator('button.link').click()
      await page.click(`${FILES()} button.danger`)
      await fileAlertIs(AF.notFound, '404 on delete')
      if ((await page.locator(`${FILES()} li`).count()) !== 9) throw new Error('the missing file stayed')
      // An archived car: no Add file, Delete works.
      await page.route(`**/api/vehicles/${photoCarId}`, async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, json: { ...(await res.json()), isArchived: true } }) })
      await page.route(listUrl, (r) => r.fulfill(withFiles([file(1)])))
      await page.reload()
      await page.locator(`${FILES()} li`).waitFor()
      if (await page.locator(ADD()).count()) throw new Error('Add file shows on an archived car')
      await page.route('**/attachments/*', (r) => r.fulfill({ status: 204 }), { times: 1 })
      await page.locator(`${FILES()} li button.link`).click()
      await page.click(`${FILES()} button.danger`)
      await page.locator(`${FILES()} ul`).waitFor({ state: 'detached' })
      await focusIs(FILES(), 'the files group after the last delete on an archived car')
      // L126: after a reload, an archived car's service without files has no Files group.
      await page.route(listUrl, (r) => r.fulfill(withFiles([])))
      await page.reload()
      await page.locator(`.services > li[data-id="${fileRecord.id}"]`).waitFor()
      if (await page.locator(FILES()).count()) throw new Error('an empty Files group on an archived car')
      await page.unroute(`**/api/vehicles/${photoCarId}`)
      // /history: names and Open only.
      await page.route(historyGet, async (r) => {
        const res = await r.fetch()
        const body = await res.json()
        await r.fulfill({ response: res, json: { ...body, items: body.items.map((x) => (x.id === fileRecord.id ? { ...x, attachments: [file(1), file(2, null)] } : x)) } })
      })
      await page.goto(`${BASE}/history?vehicleId=${photoCarId}`)
      await page.locator(`tr.record[data-id="${fileRecord.id}"] button.open`).click()
      await page.locator(FILES()).waitFor()
      if (await page.locator(`${FILES()} button`).count()) throw new Error('/history has file buttons')
      if ((await page.locator(`${FILES()} li a`).count()) !== 1) throw new Error('/history: want one link')
      if ((await page.getByRole('link', { name: `scan-1.pdf ${AF.newTab}`, exact: true }).count()) !== 1) throw new Error('/history: the link does not announce the new tab')
      await page.unroute(historyGet)
    } finally {
      await page.unroute(listUrl)
      await page.unroute('**/attachments')
      await page.unroute('**/attachments/*')
      await page.unroute(`**/api/vehicles/${photoCarId}`)
      await page.unroute(historyGet)
      await page.unroute('**/__file/*')
    }
  })
  await step('files-stale-link', async () => {
    // A link older than 55 minutes: Open fetches the records first and the new tab gets the fresh URL (fake clock, own context).
    const ctx2 = await browser.newContext({ storageState: await ctx.storageState(), viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
    try {
      const p = await ctx2.newPage()
      await p.clock.install()
      const realList = await (await p.request.get(`${BASE}/api${filesPath}`, { headers: photoAuth })).json()
      let gets = 0, fresh = false, gone = false
      await ctx2.route('**/__file/*', (r) => r.fulfill({ contentType: 'text/plain', body: 'ok' }))
      await p.route(`**/api${filesPath}`, (r) => {
        gets++
        const url = `https://files.test/__file/${fresh ? 'fresh' : 'old'}.pdf`
        return r.fulfill(gone ? { contentType: 'application/json', body: JSON.stringify(realList.filter((x) => x.id !== fileRecord.id)) } : { contentType: 'application/json', body: JSON.stringify(realList.map((x) => (x.id === fileRecord.id ? { ...x, attachments: [{ id: '00000000-0000-4000-8000-000000000001', fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes: 9, url }] } : x))) })
      })
      await p.goto(`${BASE}/cars/${photoCarId}`)
      const link = p.locator(`${FILES()} li a`)
      await link.waitFor()
      await p.waitForLoadState('networkidle')
      const loads = gets
      let [tab] = await Promise.all([p.waitForEvent('popup'), link.click()])
      await tab.waitForURL('**/old.pdf', { timeout: 5000 })
      if (gets !== loads) throw new Error(`${gets - loads} reloads on a fresh link`)
      await tab.close()
      fresh = true
      await p.clock.fastForward('56:00')
      ;[tab] = await Promise.all([p.waitForEvent('popup'), link.click()])
      await tab.waitForURL('**/fresh.pdf', { timeout: 5000 })
      if (gets !== loads + 1) throw new Error(`${gets - loads} reloads, want 1`)
      if (!(await link.getAttribute('href')).endsWith('/fresh.pdf')) throw new Error('the link kept the old URL')
      // The record deleted elsewhere meanwhile: the new tab closes, the row leaves the list with the "already deleted" note.
      await tab.close()
      gone = true
      await p.clock.fastForward('56:00')
      ;[tab] = await Promise.all([p.waitForEvent('popup'), link.click()])
      if (!tab.isClosed()) await tab.waitForEvent('close', { timeout: 5000 }) // it may close before the listener is on
      await p.locator(`.services > li[data-id="${fileRecord.id}"]`).waitFor({ state: 'detached', timeout: 5000 })
      const note = plain(await p.locator('section[aria-labelledby=service-history] > p[role=status]').textContent())
      if (note !== AF.gone) throw new Error(`gone note "${note}"`)
      if (await p.locator('.files p.error').count()) throw new Error('a file error shows for a deleted service')
    } finally {
      await ctx2.close()
    }
  })
  // SCAN-1: Scan beside Add file; a skewed page drawn on a canvas, its corners fitted by drag and keyboard; two pages, one offline
  // Save that keeps them, Cancel and Escape ask first; then one PDF upload with 2 pages. At 360 px, in the setup's theme and language.
  await step('scan', async () => {
    const D = 'dialog.scanner'
    const SCAN = () => `${FILES()} button.scan`
    const scannerJs = []
    const onReq = (r) => /Scanner/.test(r.url()) && scannerJs.push(r.url())
    page.on('request', onReq)
    // A light page with text lines, rotated and skewed on a dark background; its corners in 0..1 of the photo.
    const fixture = (angle) => page.evaluate((angle) => {
      const c = Object.assign(document.createElement('canvas'), { width: 1200, height: 900 })
      const x = c.getContext('2d')
      x.fillStyle = '#2b2e30'
      x.fillRect(0, 0, 1200, 900)
      const m = new DOMMatrix().translate(600, 450).rotate(angle).skewX(6)
      x.setTransform(m)
      x.fillStyle = '#d9d4c4'
      x.fillRect(-260, -340, 520, 680)
      x.fillStyle = '#1a1a1a'
      x.font = '28px sans-serif'
      for (let i = 0; i < 9; i++) x.fillText(`Oil change ${i + 1} ... ${120 + i * 7}.00`, -220, -270 + i * 64)
      const corners = [[-260, -340], [260, -340], [260, 340], [-260, 340]].map(([px, py]) => { const p = m.transformPoint({ x: px, y: py }); return [p.x / 1200, p.y / 900] })
      return { jpeg: c.toDataURL('image/jpeg', 0.92).split(',')[1], corners }
    }, angle).then((f) => ({ ...f, file: { name: 'paper.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(f.jpeg, 'base64') } }))
    const pageCount = () => page.locator(`${D} .scan-pages li`).count()
    // Inside the scanner: every button 44px, no sideways scroll.
    async function scannerFits(what) {
      const small = await page.evaluate((d) => [...document.querySelectorAll(`${d} button`)].filter((el) => el.checkVisibility())
        .map((el) => { const r = el.getBoundingClientRect(); return [el.textContent.trim() || el.getAttribute('aria-label'), Math.round(r.height), Math.round(r.width)] })
        .filter(([, h, w]) => h < 44 || w < 44), D)
      if (small.length) throw new Error(`${what}: under 44px ${JSON.stringify(small)}`)
      const over = await page.evaluate((d) => { const el = document.querySelector(d); return el.scrollWidth - el.clientWidth }, D)
      if (over > 0) throw new Error(`${what}: ${over}px sideways scroll`)
    }
    // Fraction of an image's pixels that are near white, near black, and the 4 corners' 5% insets white.
    const tone = (sel) => page.locator(sel).evaluate(async (img) => {
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight })
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0)
      const { data } = x.getImageData(0, 0, c.width, c.height)
      let white = 0, black = 0, chroma = 0
      for (let i = 0; i < data.length; i += 4) {
        const v = (data[i] + data[i + 1] + data[i + 2]) / 3
        if (v > 225) white++
        if (v < 80) black++
        chroma = Math.max(chroma, Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]))
      }
      const at = (fx, fy) => x.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data[0]
      return { white: white / (data.length / 4), black: black / (data.length / 4), corners: [at(0.05, 0.05), at(0.95, 0.05), at(0.95, 0.95), at(0.05, 0.95)], chroma, size: [c.width, c.height] }
    })
    async function dragTo(i, [fx, fy]) {
      const box = await page.locator(`${D} .scan-photo`).boundingBox()
      const h = await page.locator(`${D} button.corner >> nth=${i}`).boundingBox()
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height, { steps: 6 })
      await page.mouse.up()
    }
    const cornerAt = (i) => page.locator(`${D} button.corner >> nth=${i}`).evaluate((el) => [parseFloat(el.style.insetInlineStart) / 100, parseFloat(el.style.insetBlockStart) / 100])
    try {
      await page.setViewportSize({ width: 360, height: 780 })
      await page.goto(`${BASE}/cars/${photoCarId}`)
      await page.locator(SCAN()).waitFor()
      await page.waitForLoadState('networkidle')
      if (scannerJs.length) throw new Error(`the scanner loaded with the page: ${scannerJs}`)
      // Beside Add file, in the same row; named for its service.
      const [add, scan] = [await page.locator(ADD()).boundingBox(), await page.locator(SCAN()).boundingBox()]
      if (Math.abs(add.y - scan.y) > 2) throw new Error('Scan is not beside Add file')
      if (!(await page.getAttribute(SCAN(), 'aria-label'))?.startsWith(plain(key('scanTo')).split('{{')[0])) throw new Error('Scan has no service name')
      const one = await fixture(12)
      let [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(SCAN())])
      if ((await chooser.element().getAttribute('capture')) !== 'environment') throw new Error('Scan does not open the back camera')
      await chooser.setFiles(one.file)
      await page.locator(`${D} button.corner >> nth=3`).waitFor()
      if (!scannerJs.length) throw new Error('no scanner chunk after the Scan tap')
      if ((await page.getAttribute(`${D} .scan-stage`, 'dir')) !== 'ltr') throw new Error('the photo is mirrored in RTL')
      for (const i of [0, 1, 2]) await dragTo(i, one.corners[i])
      // The 4th by keyboard: Shift steps 5%, plain steps 0.5%.
      await page.locator(`${D} button.corner >> nth=3`).focus()
      const [cx, cy] = await cornerAt(3)
      for (const [d, keyName, other] of [[one.corners[3][0] - cx, 'ArrowRight', 'ArrowLeft'], [one.corners[3][1] - cy, 'ArrowDown', 'ArrowUp']]) {
        const k = d >= 0 ? keyName : other, big = Math.trunc(Math.abs(d) / 0.05), small = Math.round((Math.abs(d) - big * 0.05) / 0.005)
        for (let n = 0; n < big; n++) await page.keyboard.press(`Shift+${k}`)
        for (let n = 0; n < small; n++) await page.keyboard.press(k)
      }
      for (const i of [0, 1, 2, 3]) {
        const [x, y] = await cornerAt(i)
        if (Math.hypot(x - one.corners[i][0], y - one.corners[i][1]) > 0.01) throw new Error(`corner ${i} at ${x},${y}, want ${one.corners[i]}`)
      }
      await scannerFits('the corners step')
      await page.screenshot({ path: `${OUT}/${s.name}-scan-corners.png` })
      await page.click(`${D} .actions button:not(.add)`)
      await page.locator(`${D} .scan-pages img`).waitFor()
      // Black and white by default: a straight crop (white to its corners), white paper, black text.
      if (!(await page.locator(`${D} .scan-mode input >> nth=0`).isChecked())) throw new Error('Black and white is not the default')
      const bw = await tone(`${D} .scan-pages img`)
      if (bw.white < 0.8 || bw.black < 0.01 || bw.corners.some((v) => v < 200)) throw new Error(`black and white ${JSON.stringify(bw)}`)
      await scannerFits('the pages step')
      await page.screenshot({ path: `${OUT}/${s.name}-scan-bw.png` })
      await page.locator(`${D} .scan-mode label >> nth=1`).click()
      const col = await tone(`${D} .scan-pages img`)
      if (col.white < 0.5 || col.corners.some((v) => v < 200)) throw new Error(`color ${JSON.stringify(col)}`)
      await page.screenshot({ path: `${OUT}/${s.name}-scan-color.png` })
      await page.locator(`${D} .scan-mode label >> nth=0`).click()
      // Add page with the camera, delete it, add it back with Choose image: 2 pages.
      const two = await fixture(-8)
      await page.click(`${D} .actions button.add`)
      ;[chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`${D} .actions button.add >> nth=0`)])
      await chooser.setFiles(two.file)
      await page.locator(`${D} button.corner >> nth=3`).waitFor()
      await page.click(`${D} .actions button:not(.add)`)
      await page.waitForFunction((d) => document.querySelectorAll(`${d} .scan-pages li`).length === 2, D)
      await page.click(`${D} .scan-pages li >> nth=1 >> button.link`)
      if (await pageCount() !== 1) throw new Error('Delete page did not delete')
      await page.click(`${D} .actions button.add`)
      ;[chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`${D} .actions button.add >> nth=1`)])
      if (await chooser.element().getAttribute('capture')) throw new Error('Choose image opens the camera')
      await chooser.setFiles(two.file)
      await page.locator(`${D} button.corner >> nth=3`).waitFor()
      await page.click(`${D} .actions button:not(.add)`)
      await page.waitForFunction((d) => document.querySelectorAll(`${d} .scan-pages li`).length === 2, D)
      // RTL: the toolbar is mirrored (the title on the right in Hebrew), and so is the page order.
      const [title, cancelBox] = [await page.locator(`${D} .scan-bar h2`).boundingBox(), await page.locator(`${D} .scan-bar button`).boundingBox()]
      if ((title.x > cancelBox.x) !== he) throw new Error(`toolbar direction: title at ${title.x}, Cancel at ${cancelBox.x}`)
      await scannerFits('two pages')
      await page.screenshot({ path: `${OUT}/${s.name}-scan-pages.png` })
      // Offline: Save shows the error inside the scanner and the pages stay.
      await ctx.setOffline(true)
      await page.click(`${D} button.save-scan`)
      await page.locator(`${D} p.error[role=alert]`).waitFor({ timeout: 10000 })
      await ctx.setOffline(false)
      if (await pageCount() !== 2) throw new Error('the pages went with the failed Save')
      await page.screenshot({ path: `${OUT}/${s.name}-scan-offline.png` })
      // Escape and Cancel ask first; Escape again keeps scanning.
      await page.keyboard.press('Escape')
      await page.locator(`${D} .inline-form button.danger`).waitFor()
      if (plain(await page.locator(`${D} .inline-form p`).textContent()) !== plain(key('discardScan_two').replace('{{count, number}}', (2).toLocaleString(s.lng)))) throw new Error('the discard question')
      await page.keyboard.press('Escape')
      await page.locator(`${D} .inline-form`).waitFor({ state: 'detached' })
      await page.click(`${D} .scan-bar button`)
      await page.click(`${D} .inline-form button.link`)
      if (await pageCount() !== 2 || !(await page.locator(D).isVisible())) throw new Error('Keep scanning lost the scan')
      // SCAN-2b: the File name field, with today's default (its rules: scan-name, on a document).
      if ((await page.inputValue(`${D} .scan-name input`)) !== `scan-${await localDate()}`) throw new Error('no File name default on a service')
      // Save: one PDF named for today, with 2 pages, and focus back on Scan.
      const post = page.waitForResponse((r) => r.url().endsWith('/attachments') && r.request().method() === 'POST')
      await page.click(`${D} button.save-scan`)
      if ((await post).status() !== 200) throw new Error(`scan upload ${(await post).status()}`)
      await page.locator(D).waitFor({ state: 'detached' })
      await focusIs(SCAN(), 'Scan after the upload')
      const today = await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
      const saved = (await (await post).json()).attachments.at(-1)
      if (saved.fileName !== `scan-${today}.pdf` || saved.contentType !== 'application/pdf') throw new Error(`saved ${saved.fileName} ${saved.contentType}`)
      if (plain(await page.locator(`${FILES()} li a bdi`).last().textContent()) !== `scan-${today}.pdf`) throw new Error('the scan is not listed')
      const bytes = Buffer.from(await (await page.request.get(saved.url)).body()).toString('latin1')
      if (!bytes.startsWith('%PDF-') || bytes.match(/\/Type \/Page\b/g)?.length !== 2) throw new Error('the PDF is not 2 pages')
      const [tab] = await Promise.all([page.waitForEvent('popup'), page.click(`${FILES()} li a >> nth=-1`)])
      await tab.waitForLoadState().catch(() => {})
      await tab.screenshot({ path: `${OUT}/${s.name}-scan-pdf.png` }).catch(() => {})
      await tab.close()
      // An empty file can't be opened: the message, back at capture; Cancel without pages closes at once.
      ;[chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(SCAN())])
      await chooser.setFiles({ name: 'empty.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) })
      if (plain(await page.locator(`${D} p.error[role=alert]`).textContent()) !== key('scanUnreadable')) throw new Error('no can\'t-open message')
      // Over 25 MB is refused before decoding; the scanner stays usable.
      ;[chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`${D} .actions button.add >> nth=1`)])
      await chooser.setFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(26_000_000) })
      await page.waitForFunction(([sel, want]) => document.querySelector(sel)?.textContent.trim() === want, [`${D} p.error[role=alert]`, key('scanImageTooLarge')], { timeout: 5000 })
      await page.click(`${D} .scan-bar button`)
      await page.locator(D).waitFor({ state: 'detached' })
    } finally {
      page.off('request', onReq)
      await ctx.setOffline(false)
      await deleteAllFiles()
      await page.setViewportSize(s.viewport)
    }
  })
  await step('history-gone-reload', async () => {
    // L130: /history with Show more used twice (150 of 160 rows, mocked), then a row's stale link finds its service gone: 150 rows
    // come back without it, with the note, which has focus (fake clock, own context).
    const ctx2 = await browser.newContext({ storageState: await ctx.storageState(), viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
    try {
      const p = await ctx2.newPage()
      await p.clock.install()
      const base = (await (await p.request.get(`${BASE}/api${filesPath}`, { headers: photoAuth })).json())[0]
      const target = 120
      let rows = [...Array(160)].map((_, i) => ({ ...base, id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
        attachments: i === target ? [{ id: '00000000-0000-4000-8000-000000000001', fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes: 9, url: 'https://files.test/__file/r.pdf' }] : [] }))
      const goneId = rows[target].id
      await ctx2.route('**/__file/*', (r) => r.fulfill({ contentType: 'text/plain', body: 'ok' }))
      await p.route((u) => u.pathname === '/api/service-records', (r) => {
        const skip = Number(new URL(r.request().url()).searchParams.get('skip'))
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: rows.slice(skip, skip + 50), totalCount: rows.length, totalCost: 0 }) })
      })
      // The car's records, which the stale link reloads: the service is gone.
      await p.route(`**/api${filesPath}`, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }))
      await p.goto(`${BASE}/history?vehicleId=${photoCarId}`)
      const items = p.locator('tr.record')
      await items.nth(49).waitFor()
      for (const n of [100, 150]) {
        await p.click('main .card > button.more') // chips and car pills are .more too
        await items.nth(n - 1).waitFor()
      }
      // Opened after the links' 56 minutes: the page stamped them when the rows arrived.
      rows = rows.filter((r) => r.id !== goneId)
      await p.clock.fastForward('56:00')
      await p.locator(`tr.record[data-id="${goneId}"] button.open`).click()
      const [tab] = await Promise.all([p.waitForEvent('popup'), p.locator(`.services > li[data-id="${goneId}"] .files li a`).click()])
      if (!tab.isClosed()) await tab.waitForEvent('close', { timeout: 5000 }) // it may close before the listener is on
      await p.locator(`tr.record[data-id="${goneId}"]`).waitFor({ state: 'detached', timeout: 5000 })
      if ((await items.count()) !== 150) throw new Error(`${await items.count()} rows after the reload, want 150`)
      const NOTE = '.card > p[tabindex="-1"]'
      const note = plain(await p.locator(NOTE).textContent())
      if (note !== key('serviceGoneRefreshed')) throw new Error(`note "${note}"`)
      await p.waitForFunction((sel) => document.activeElement?.matches(sel), NOTE, { timeout: 3000 })
        .catch(async () => { throw new Error(`focus is on ${await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 100))}`) })
      await p.setViewportSize({ width: 390, height: 844 })
      const px = await p.evaluate(() => document.documentElement.scrollWidth - 390)
      if (px > 0) throw new Error(`${px}px horizontal overflow with the note`)
      await p.screenshot({ path: `${OUT}/${s.name}-history-gone-note.png` })
    } finally {
      await ctx2.close()
    }
  })
  // SET-1: settings. Each setup forces the theme opposite to its OS one, at 390px wide.
  // The hint comes from i18n.ts, so copy edits don't break the step.
  const SE = he ? { settings: 'הגדרות', saved: 'נשמר', hint: key('currencyHint') } : { settings: 'Settings', saved: 'Saved', hint: key('currencyHint') }
  const osTheme = s.colorScheme === 'light' ? 'Light' : 'Dark'
  const forced = osTheme === 'Light' ? 'Dark' : 'Light'
  const BG = { Light: 'rgb(231, 237, 234)', Dark: 'rgb(12, 20, 18)' } // --bg
  const looks = () => page.evaluate(() => ({
    attr: document.documentElement.dataset.theme ?? null,
    bg: getComputedStyle(document.documentElement).backgroundColor,
    ink: getComputedStyle(document.body).color,
    surface: getComputedStyle(document.querySelector('.card') ?? document.body).backgroundColor,
  }))
  async function themeIs(theme, when) {
    const l = await looks()
    if (l.attr !== (theme === 'System' ? null : theme.toLowerCase()) || l.bg !== BG[theme === 'System' ? osTheme : theme]) throw new Error(`${when}: ${JSON.stringify(l)}`)
  }
  const radio = (name, v) => page.locator(`input[name=${name}][value=${v}]`)
  const putSettings = () => page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/api/me/settings'))
  const savedShown = () => page.locator('main [role=status]', { hasText: SE.saved }).waitFor({ timeout: 3000 })
  const dirIs = (d) => page.waitForFunction((d) => document.documentElement.dir === d, d, { timeout: 3000 })
  const openSettings = async () => {
    await more(page)
    await page.click('header a[href="/settings"]')
    await radio('theme', 'System').waitFor()
    await arrivedAt(SE.settings)
  }
  await step('settings-theme', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSettings()
    if (!(await radio('theme', 'System').isChecked())) throw new Error('theme not System by default')
    let res = putSettings()
    await radio('theme', forced).click()
    const body = JSON.stringify((await res).request().postDataJSON())
    if (body !== JSON.stringify({ theme: forced })) throw new Error(`PUT body ${body}`)
    await savedShown()
    await themeIs(forced, `${forced} picked`)
    // Applied before the first render, so the reload never shows the OS theme.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await themeIs(forced, 'right after a reload')
    await page.screenshot({ path: `${OUT}/${s.name}-theme-right-after-reload.png` })
    await radio('theme', forced).waitFor()
    if (!(await radio('theme', forced).isChecked())) throw new Error(`${forced} not checked after a reload`)
    res = putSettings()
    await radio('theme', 'System').click()
    await res
    await themeIs('System', 'System picked')
    res = putSettings()
    await radio('theme', forced).click() // kept for the next steps and their screenshots
    await res
    const l = await looks()
    if (ratio(l.ink, l.surface) < 4.5) throw new Error(`${forced} text contrast ${ratio(l.ink, l.surface).toFixed(2)}:1`)
    if ((await page.locator('main fieldset > legend').count()) !== 3) throw new Error('radio groups without fieldset and legend')
    for (const label of await page.locator('main label').all()) await tall(label, `"${await label.textContent()}"`)
    await more(page)
    await tall(page.locator('header a[href="/settings"]'), 'Settings link')
    await page.keyboard.press('Escape')
    await noOverflow(`settings at 390px, ${forced}`)
    await sweep('settings page')
  })
  await step('settings-language', async () => {
    const [own, other] = he ? ['He', 'En'] : ['En', 'He']
    const [ownDir, otherDir] = he ? ['rtl', 'ltr'] : ['ltr', 'rtl']
    let res = putSettings()
    await radio('locale', other).click()
    if ((await res).request().postDataJSON().locale !== other) throw new Error('settings radio did not save the language')
    await dirIs(otherDir)
    await page.locator('main h1', { hasText: he ? 'Settings' : 'הגדרות' }).waitFor()
    await noOverflow(`settings at 390px in the other language, ${forced}`)
    await sweep('settings page in the other language')
    // Settings is the only language switch: the header has none.
    await more(page)
    if (await page.locator('header nav button', { hasText: /^(English|עברית)$/ }).count()) throw new Error('a language switch in the header')
    await page.keyboard.press('Escape')
    res = putSettings()
    await radio('locale', own).click()
    if ((await res).request().postDataJSON().locale !== own) throw new Error('settings radio did not save the language back')
    await dirIs(ownDir)
    // Signed out: no Settings link and no header buttons, and /settings goes to the login page.
    await more(page)
    await page.click('header nav button.link')
    await page.locator('input[name=email]').waitFor()
    if (await page.locator('header a[href="/settings"]').count()) throw new Error('Settings link while signed out')
    if (await page.locator('.tabs').count()) throw new Error('NAV-1: a tab bar while signed out')
    if (await page.locator('header button').count()) throw new Error('a header button while signed out')
    await page.goto(`${BASE}/settings`)
    await page.waitForURL('**/login')
    // The other language signed out (the detector reads ?lng=), so the login below shows the saved one is applied.
    await page.goto(`${BASE}/login?lng=${other.toLowerCase()}`)
    await dirIs(otherDir)
    // Logging in applies the saved language and theme.
    await page.fill('input[name=email]', registered.user.email)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('a[href="/cars/new"]').waitFor()
    await dirIs(ownDir)
    await titleIs(T.dashboard)
    await themeIs(forced, 'after logging in')
  })
  await step('settings-currency', async () => {
    const target = registered.user.currency === 'USD' ? 'EUR' : 'USD'
    await page.evaluate(() => { window.noReload = true })
    await openSettings()
    const select = page.locator('select[name=currency]')
    const hint = page.locator(`#${await select.getAttribute('aria-describedby')}`)
    if (!(await hint.isVisible()) || (await hint.textContent()) !== SE.hint) throw new Error(`hint "${await hint.textContent()}"`)
    const res = putSettings()
    await select.selectOption(target)
    if ((await res).request().postDataJSON().currency !== target) throw new Error('currency not saved')
    await savedShown()
    if (await page.evaluate(() => JSON.parse(localStorage.getItem('user')).currency) !== target) throw new Error('cached user not updated')
    // The cost label follows without a reload.
    await page.click('header a.brand')
    await page.click('.cars > li h2 a')
    await taskBtn(RS.cost, 'Brakes').click()
    const label = plain(await page.locator('section[aria-labelledby=service-history] form label', { has: page.locator('input[name=totalCost]') }).textContent())
    if (!label.includes(target)) throw new Error(`cost label "${label}"`)
    await page.keyboard.press('Escape')
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('settings-save-fails', async () => {
    await openSettings()
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    const themeGroup = page.locator('fieldset', { has: radio('theme', 'System') })
    const select = page.locator('select[name=currency]')
    const focusInTheme = (when) => focusIs('fieldset:has(input[name=theme]) input', `theme group ${when}`)
    // Held, so the in-flight state is visible: the whole page is busy but keeps focus, then the radio goes back with the error next to it.
    let puts = 0
    const count = (r) => r.method() === 'PUT' && puts++
    page.on('request', count)
    await page.route('**/api/me/settings', async (r) => { await page.waitForTimeout(700); await fail(r) }, { times: 1 })
    const before = await select.inputValue()
    await radio('theme', 'System').click()
    if ((await themeGroup.getAttribute('aria-disabled')) !== 'true') throw new Error('theme group not busy while saving')
    if ((await select.getAttribute('aria-disabled')) !== 'true') throw new Error('currency not busy while the theme saves')
    // Changes while busy are ignored. Sent from the page: Playwright's own actions wait out aria-disabled, even with force.
    await select.evaluate((el) => { el.value = 'GBP'; el.dispatchEvent(new Event('change', { bubbles: true })) })
    await radio('theme', forced === 'Dark' ? 'Light' : 'Dark').evaluate((el) => el.click())
    if (!(await radio('theme', 'System').isChecked())) throw new Error(`theme changed while busy: ${await page.evaluate(() => [...document.querySelectorAll('input[name=theme]')].map((i) => i.value + (i.checked ? '*' : '')).join())}`)
    if ((await select.inputValue()) !== before) throw new Error('currency changed while busy')
    await focusInTheme('while saving')
    const alert = themeGroup.locator('[role=alert]')
    await alert.waitFor()
    page.off('request', count)
    if (puts !== 1) throw new Error(`${puts} PUTs while busy`)
    if ((await alert.textContent()) !== RS.generic) throw new Error(`theme error "${await alert.textContent()}"`)
    if (!(await radio('theme', forced).isChecked())) throw new Error('theme radio not put back')
    await themeIs(forced, 'after a failed save')
    await focusInTheme('after a failed save')
    await page.route('**/api/me/settings', fail, { times: 1 })
    await select.focus() // selectOption doesn't move focus
    await select.selectOption('GBP')
    await page.locator('.field [role=alert]').waitFor()
    if ((await select.inputValue()) !== before) throw new Error(`currency not put back: ${await select.inputValue()}`)
    if (await themeGroup.locator('[role=alert]').count()) throw new Error('old theme error still shown')
    await focusIs('select[name=currency]', 'after a failed currency save')
    forget500()
    // Keyboard: an arrow key in the Theme group saves the next theme, and focus stays in the group. Dark is last, and Chrome doesn't wrap.
    await radio('theme', forced).focus()
    let res = putSettings()
    await page.keyboard.press(forced === 'Dark' ? 'ArrowUp' : 'ArrowDown')
    if ((await res).status() !== 200) throw new Error(`PUT ${(await res).status()}`)
    await savedShown()
    await focusInTheme('after a keyboard save')
    // Back to System for the rest of the run.
    res = putSettings()
    await radio('theme', 'System').click()
    if ((await res).status() !== 200) throw new Error(`PUT ${(await res).status()}`)
    await savedShown()
    await themeIs('System', 'System after the failures')
    await page.setViewportSize(s.viewport)
  })
  // SET-2: km or miles, at 390px. A fresh car at 80,467 km (50,000 mi), 500 km in the 10 days before (50 km/day, 31.1 mi/day).
  const UM = he
    ? { mi: 'מייל', km: 'ק״מ', newReading: 'קריאה חדשה במיילים', perDay: '31.1 מייל ליום', perDayKm: '66.1 ק״מ ליום', edit: 'עריכה של הקריאה ', readingLabel: 'קריאה במיילים',
        every6214: 'כל 6,214 מייל', left853: 'עוד 853 מייל', left5000: 'עוד 5,000 מייל', at44739: 'ב־44,739 מייל', every5000: 'כל 5,000 מייל', every8047: 'כל 8,047 ק״מ', beltMi: 'כל 62,137 מייל או 5 שנים',
        intervalLabel: 'מרווח במיילים', initialLabel: 'קילומטראז׳ נוכחי (מייל)', maxReading: 'יש להזין קריאה בין 0 ל־6,213,711 מייל.', maxInterval: 'יש להזין מרווח של 1 עד 621,371 מייל.',
        previous: '(50,100 מייל)', current: '(50,100 מייל)' }
    : { mi: 'mi', km: 'km', newReading: 'New reading in miles', perDay: '31.1 mi/day', perDayKm: '66.1 km/day', edit: 'Edit reading ', readingLabel: 'Reading in miles',
        every6214: 'Every 6,214 mi', left853: '853 mi left', left5000: '5,000 mi left', at44739: 'at 44,739 mi', every5000: 'Every 5,000 mi', every8047: 'Every 8,047 km', beltMi: 'Every 62,137 mi or 5 years',
        intervalLabel: 'Interval in miles', initialLabel: 'Current odometer (mi)', maxReading: 'Enter a reading between 0 and 6,213,711 mi.', maxInterval: 'Enter an interval from 1 to 621,371 mi.',
        previous: '(50,100 mi)', current: 'the current 50,100 mi' }
  const mileCar = () => page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Mile car', exact: true }) })
  const apiCall = async (method, path, data) => {
    const token = await page.evaluate(() => localStorage.getItem('token'))
    const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data })
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`)
    return r.status() === 204 ? null : r.json()
  }
  const carState = async (id) => JSON.stringify(await Promise.all(['', '/odometer', '/tasks'].map((p) => apiCall('GET', `/vehicles/${id}${p}`))))
  let mileCarId
  const unitIs = async (unit) => {
    await openSettings()
    if (await radio('distanceUnit', unit).isChecked()) return
    const res = putSettings()
    await radio('distanceUnit', unit).click()
    if ((await res).request().postDataJSON().distanceUnit !== unit) throw new Error(`PUT did not save ${unit}`)
    await savedShown()
  }
  const odometerLabel = (loc) => loc.locator('.odometer').first().getAttribute('aria-label')
  await step('settings-unit-miles', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { window.noReload = true })
    // LOW-2 L26: dated with the browser's local date, as the app dates its own readings (quick entry below), so they stay in order when that is already tomorrow in UTC.
    // LOW-3 L36: a new car's first reading takes the local date the app sends, as the add-car form does.
    mileCarId = (await apiCall('POST', '/vehicles', { nickname: 'Mile car', initialOdometerKm: 80467, readingDate: await localDate() })).id
    await apiCall('POST', `/vehicles/${mileCarId}/odometer`, { valueKm: 79967, readingDate: await histDay(-10) })
    // Due soon (20%), so the dashboard lists it (only tasks needing attention show there).
    await apiCall('POST', `/vehicles/${mileCarId}/tasks`, { name: 'Mile oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 20, lastDoneOdometerKm: 72000, lastDoneDate: await localDate() })
    if (!(await radio('distanceUnit', 'Km').isChecked())) throw new Error('unit not Km by default')
    // SET-1 QA Low 1: an arrow key while the group saves leaves focus on its checked radio, and sends nothing.
    let puts = 0
    const count = (r) => r.method() === 'PUT' && puts++
    page.on('request', count)
    await page.route('**/api/me/settings', async (r) => { await page.waitForTimeout(700); await r.continue() }, { times: 1 })
    const res = putSettings()
    await radio('distanceUnit', 'Mi').click()
    await page.keyboard.press('ArrowUp')
    await focusIs('input[name=distanceUnit][value=Mi]:checked', 'unit group after an arrow key while saving')
    if ((await res).request().postDataJSON().distanceUnit !== 'Mi') throw new Error('Mi not saved')
    await savedShown()
    page.off('request', count)
    if (puts !== 1) throw new Error(`${puts} PUTs`)
    await focusIs('input[name=distanceUnit][value=Mi]:checked', 'unit group after the save')
    await noOverflow('settings in miles')
    await sweep('settings in miles')
    // Car list: odometer, average and quick-add in miles; 50,100 mi is stored as 80,628 km and shows back unchanged.
    await page.click('header a.brand')
    await mileCar().waitFor()
    if ((await odometerLabel(mileCar())) !== `50,000 ${UM.mi}`) throw new Error(`list odometer "${await odometerLabel(mileCar())}"`)
    if ((await mileCar().locator('.reading .unit').textContent()) !== UM.mi) throw new Error('list unit')
    if (!(await mileCar().locator('.reading').textContent()).includes(UM.perDay)) throw new Error(`average "${await mileCar().locator('.reading').textContent()}"`)
    const quick = mileCar().locator('.quick input[type=number]')
    if ((await quick.getAttribute('placeholder')) !== UM.newReading) throw new Error(`placeholder "${await quick.getAttribute('placeholder')}"`)
    await quick.fill('50100')
    const post = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/odometer'))
    await mileCar().locator('.quick button').click()
    if ((await post).request().postDataJSON().valueKm !== 80628) throw new Error(`POST ${JSON.stringify((await post).request().postDataJSON())}`)
    await page.waitForFunction(() => [...document.querySelectorAll('.odometer')].some((o) => o.getAttribute('aria-label').startsWith('50,100')))
    if ((await apiCall('GET', `/vehicles/${mileCarId}`)).currentOdometerKm !== 80628) throw new Error('not stored as 80,628 km')
    // MVP4-A criterion 7: the dashboard's remaining distance is in miles too.
    const dashRow = plain(await mileCar().locator('.dash-tasks').textContent())
    if (!dashRow.includes(UM.left853)) throw new Error(`dashboard task "${dashRow}"`)
    await noOverflow('the list in miles')
    // Car page: odometer, history and its edit form, tasks, and the template picker.
    await mileCar().locator('h2 a').click()
    await arrivedAt('Mile car')
    if ((await odometerLabel(page.locator('main'))) !== `50,100 ${UM.mi}`) throw new Error(`car odometer "${await odometerLabel(page.locator('main'))}"`)
    const values = await page.locator('.history .value').allTextContents()
    if (values.map(plain).join('|') !== ['50,100', '50,000', '49,689'].map((v) => `${v} ${UM.mi}`).join('|')) throw new Error(`history ${values}`)
    await page.getByRole('button', { name: `${UM.edit}50,000 ${UM.mi}`, exact: true }).click()
    const readingInput = page.locator('.history input[name=valueKm]')
    if ((await readingInput.inputValue()) !== '50000') throw new Error(`edit value ${await readingInput.inputValue()}`)
    if (!plain(await page.locator('.history form label').first().textContent()).startsWith(UM.readingLabel)) throw new Error('reading label')
    // Saved untouched, the reading keeps its exact km.
    const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/odometer/'))
    await page.locator('.history form button:not(.link)').click()
    if ((await put).request().postDataJSON().valueKm !== 80467) throw new Error(`PUT ${JSON.stringify((await put).request().postDataJSON())}`)
    const row = plain(await taskRow('Mile oil').textContent())
    for (const want of [UM.every6214, UM.left853, UM.at44739]) if (!row.includes(want)) throw new Error(`task row lacks "${want}": "${row}"`)
    await taskBtn(TK.edit, 'Mile oil').click()
    const form = taskRow('Mile oil').locator('form')
    if ((await form.locator('input[name=intervalKm]').inputValue()) !== '6214' || (await form.locator('input[name=lastDoneOdometerKm]').inputValue()) !== '44739') throw new Error('edit form not in miles')
    if (!plain(await form.locator('label', { has: page.locator('input[name=intervalKm]') }).textContent()).startsWith(UM.intervalLabel)) throw new Error('interval label')
    await form.locator('input[name=intervalKm]').fill('5000')
    const taskPut = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/tasks/'))
    await form.locator('button:not(.link)').click()
    let body = (await taskPut).request().postDataJSON()
    if (body.intervalKm !== 8047 || body.lastDoneOdometerKm !== 72000) throw new Error(`task PUT ${JSON.stringify(body)}`)
    await page.waitForFunction((w) => document.querySelector('.tasks')?.textContent.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').includes(w), UM.every5000)
    await tasks.getByRole('button', { name: TK.add }).click()
    const options = (await tasks.locator('.picker li button').allTextContents()).map(plain)
    if (!options.some((o) => o.startsWith(TK.belt) && o.includes(UM.beltMi))) throw new Error(`picker ${options}`)
    await tasks.locator('.picker button', { hasText: TK.custom }).click()
    const add = tasks.locator('form')
    await add.locator('input[name=name]').fill('Mile wash')
    await add.locator('input[name=intervalKm]').fill('5000')
    if ((await add.locator('input[name=lastDoneOdometerKm]').inputValue()) !== '50100') throw new Error('add form last done not in miles')
    const taskPost = page.waitForResponse((r) => r.request().method() === 'POST' && pathOf(r).endsWith('/tasks'))
    await add.locator('button:not(.link)').click()
    body = (await taskPost).request().postDataJSON()
    if (body.intervalKm !== 8047 || body.lastDoneOdometerKm !== 80628) throw new Error(`task POST ${JSON.stringify(body)}`)
    await taskRow('Mile wash').waitFor()
    // Just done: the remaining distance adds up with the shown interval (8,047 km is 5,000.2 mi).
    if (!plain(await taskRow('Mile wash').textContent()).includes(UM.left5000)) throw new Error(`new task row: ${await taskRow('Mile wash').textContent()}`)
    await noOverflow('the car page in miles')
    await sweep('the car page in miles')
    // MVP3-A criterion 10: the record form starts at the odometer in miles, and saved unchanged it stores the exact km.
    // 80,629 km shows as 50,101 mi, which converts back to 80,630, so only the kept value sends 80,629.
    const drift = await apiCall('POST', `/vehicles/${mileCarId}/odometer`, { valueKm: 80629, readingDate: await localDate() })
    await page.click('header a.brand')
    await mileCar().locator('h2 a').click()
    await arrivedAt('Mile car')
    await recordBtn.click()
    if ((await recordForm.locator('input[name=odometerKm]').inputValue()) !== '50101') throw new Error('record form odometer not in miles')
    if (!plain(await recordForm.locator('label', { has: page.locator('input[name=odometerKm]') }).textContent()).startsWith(SV.odoLabel)) throw new Error('record odometer label')
    const recordPost = page.waitForResponse((r) => isRecordPost(r.request()))
    await recordForm.locator('button:not(.link)').click()
    if ((await recordPost).request().postDataJSON().odometerKm !== 80629) throw new Error(`record POST ${(await recordPost).request().postData()}`)
    const mileRecord = (await (await recordPost).json()).record.id
    const recordValue = services.locator(`li[data-id="${mileRecord}"] .value`)
    await recordValue.waitFor()
    if (plain(await recordValue.textContent()) !== `50,101 ${UM.mi}`) throw new Error(`record value "${await recordValue.textContent()}"`)
    // MVP3-D criterion 10: Edit starts at the record's 50,101 mi; saved unchanged it keeps 80,629 km and shows back the same.
    await services.locator(`li[data-id="${mileRecord}"] button.edit-service`).click()
    const editOdo = services.locator(`li[data-id="${mileRecord}"] form input[name=odometerKm]`)
    if ((await editOdo.inputValue()) !== '50101') throw new Error(`edit odometer ${await editOdo.inputValue()}`)
    const editPut = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/service-records/'))
    await services.locator(`li[data-id="${mileRecord}"] form > .actions button:not(.link)`).click()
    if ((await editPut).status() !== 200 || (await editPut).request().postDataJSON().odometerKm !== 80629) throw new Error(`edit PUT ${(await editPut).request().postData()}`)
    await focusIs(`li[data-id="${mileRecord}"] button.edit-service`, 'after saving the miles record')
    if (plain(await recordValue.textContent()) !== `50,101 ${UM.mi}`) throw new Error(`edited record value "${await recordValue.textContent()}"`)
    await page.screenshot({ path: `${OUT}/${s.name}-unit-miles-car.png`, fullPage: true })
    await apiCall('POST', `/vehicles/${mileCarId}/service-records/${mileRecord}/void`) // the stored values below are from before it
    await apiCall('DELETE', `/vehicles/${mileCarId}/odometer/${drift.id}`)
    // Back to km: every value as before, no reload, nothing stored changed.
    const stored = await carState(mileCarId)
    await unitIs('Km')
    await page.goBack()
    await taskRow('Mile wash').waitFor()
    if ((await odometerLabel(page.locator('main'))) !== `80,628 ${UM.km}`) throw new Error(`km odometer "${await odometerLabel(page.locator('main'))}"`)
    const kmValues = (await page.locator('.history .value bdi').allTextContents()).join('|')
    if (kmValues !== '80,628|80,467|79,967') throw new Error(`km history ${kmValues}`)
    if (!plain(await taskRow('Mile oil').textContent()).includes(UM.every8047)) throw new Error('km interval')
    if ((await carState(mileCarId)) !== stored) throw new Error('stored values changed with the unit')
    await page.click('header a.brand')
    await mileCar().waitFor()
    if (!(await mileCar().locator('.reading').textContent()).includes(UM.perDayKm)) throw new Error(`km average "${await mileCar().locator('.reading').textContent()}"`)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('settings-unit-errors', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    // SET-1 QA Low 2: each later settings action clears every earlier error.
    await openSettings()
    const alerts = () => page.locator('main [role=alert]')
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    await page.route('**/api/me/settings', fail, { times: 1 })
    await radio('theme', 'Dark').click()
    await page.locator('fieldset:has(input[name=theme]) [role=alert]').waitFor()
    await page.route('**/api/me/settings', fail, { times: 1 })
    await radio('locale', he ? 'En' : 'He').click()
    await page.locator('fieldset:has(input[name=locale]) [role=alert]').waitFor()
    if ((await alerts().count()) !== 1) throw new Error(`${await alerts().count()} alerts after the language save failed`)
    const res = putSettings()
    await radio('distanceUnit', 'Mi').click()
    await res
    await savedShown()
    if (await alerts().count()) throw new Error('old errors still shown after a successful save')
    forget500()
    // Criterion 5: limits in miles, blocked before any request; the server's errors name readings in miles.
    let sent = 0
    const count = (r) => ['POST', 'PUT'].includes(r.method()) && !r.url().endsWith('/me/settings') && sent++
    page.on('request', count)
    const blocked = async (input, submit, want) => {
      await submit.click()
      const msg = plain(await input.evaluate((el) => el.validationMessage))
      if (msg !== want) throw new Error(`"${msg}", want "${want}"`)
    }
    await page.click('header a.brand')
    await page.click('a[href="/cars/new"]')
    await arrivedAt(T.addCar)
    if (!plain(await page.locator('label', { has: page.locator('input[name=initialOdometerKm]') }).textContent()).startsWith(UM.initialLabel)) throw new Error('car form label')
    await page.fill('input[name=nickname]', 'Too far')
    await page.fill('input[name=initialOdometerKm]', '6213712')
    await blocked(page.locator('input[name=initialOdometerKm]'), page.locator('form button:not(.link)'), UM.maxReading)
    await page.click('form button.link')
    await mileCar().waitFor()
    const quick = mileCar().locator('.quick input[type=number]')
    await quick.fill('6213712')
    await blocked(quick, mileCar().locator('.quick button'), UM.maxReading)
    await mileCar().locator('h2 a').click()
    await taskRow('Mile oil').waitFor()
    await taskBtn(TK.edit, 'Mile oil').click()
    const form = taskRow('Mile oil').locator('form')
    await form.locator('input[name=intervalKm]').fill('621372')
    await blocked(form.locator('input[name=intervalKm]'), form.locator('button:not(.link)'), UM.maxInterval)
    await page.waitForTimeout(300)
    page.off('request', count)
    if (sent) throw new Error(`${sent} requests sent for blocked values`)
    await form.locator('input[name=intervalKm]').fill('5000')
    await form.locator('input[name=lastDoneOdometerKm]').fill('60000')
    await form.locator('button:not(.link)').click()
    await form.locator('[role=alert]').waitFor()
    const lastDone = plain(await form.locator('[role=alert]').textContent())
    if (!lastDone.includes(UM.current)) throw new Error(`invalidLastDone "${lastDone}"`)
    noLatin(lastDone, 'error')
    await page.keyboard.press('Escape')
    await page.locator('main > .card .quick input[type=number]').fill('49000')
    await page.locator('main > .card .quick button').click()
    await page.locator('main > .card .quick [role=alert]').waitFor()
    const lower = plain(await page.locator('main > .card .quick [role=alert]').textContent())
    if (!lower.includes(UM.previous)) throw new Error(`lowerThanPrevious "${lower}"`)
    noLatin(lower, 'error')
    // A failed history save puts focus back on Save, so Escape still closes the form.
    await page.getByRole('button', { name: `${UM.edit}50,000 ${UM.mi}`, exact: true }).click()
    await page.route('**/odometer/*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await page.locator('.history form button:not(.link)').click()
    await page.locator('.history form [role=alert]').waitFor()
    await focusIs('.history form button:not(.link)', 'after a failed history save')
    await page.keyboard.press('Escape')
    await page.locator('.history form').waitFor({ state: 'detached' })
    forget500()
    await noOverflow('the car page with errors in miles')
    await page.screenshot({ path: `${OUT}/${s.name}-unit-errors-car.png`, fullPage: true })
    await unitIs('Km')
    await apiCall('POST', `/vehicles/${mileCarId}/archive`) // the steps below expect one car
    await page.setViewportSize(s.viewport)
  })
  await step('tap-targets-list', async () => {
    await page.click('header a.brand')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.cars > li').first().waitFor()
    await tall(page.locator('main > label.inline'), 'Show archived') // MVP2-C QA note (a)
    await sweep('list page at 390px') // the screenshot is taken at 390px; the next step restores the viewport
  })
  await step('archive-car', async () => {
    await page.setViewportSize(s.viewport)
    await page.click('.cars > li .actions button.link')
    await page.locator('.cars > li').waitFor({ state: 'detached' })
    await page.check('main > label.inline input')
    await page.locator('.cars > li.archived', { hasText: 'Renamed Corolla' }).waitFor()
  })
  await step('archived-tasks-read-only', async () => {
    await page.locator('.cars > li.archived', { hasText: 'Renamed Corolla' }).locator('h2 a').click()
    await taskRow(TK.belt).waitFor()
    const controls = await tasks.locator('button:not(.fold), input, select').count() // the heading's fold toggle stays
    if (controls) throw new Error(`${controls} controls on an archived car's tasks`)
    // MVP3-A criterion 11 and MVP3-B criterion 13: the history and its items are shown, without Record, Edit or Delete.
    await apiCall('POST', `/vehicles/${carId()}/service-records`, { date: await localDate(), odometerKm: 59000, items: [{ description: 'Wiper', quantity: 2, unitCost: 30 }] })
    await page.reload()
    await services.locator('.service-items li', { hasText: 'Wiper' }).waitFor()
    if (await services.locator('button:not(.fold), input').count()) throw new Error('Record, Edit or Delete on an archived car')
    await page.click('main > a.back')
    await page.locator('a[href="/cars/new"]').waitFor() // the list hides archived cars again
  })
  // MVP3-C: a third car with a task, three distinct services and 50 older ones, beside the archived Renamed Corolla's.
  const isHistoryGet = (url) => new URL(url).pathname === '/api/service-records'
  const histUser = () => page.evaluate(() => JSON.parse(localStorage.getItem('user')))
  const moneyText = async (v) => { const u = await histUser(); return page.evaluate(([v, lng, c]) => v.toLocaleString(lng, { style: 'currency', currency: c }), [v, s.lng, u.currency]) }
  const summaryIs = async (n, cost) => {
    const want = HS.summary(n, await moneyText(cost))
    await page.waitForFunction((w) => document.querySelector('main .card > p[role=status]')?.textContent.replace(/[⁦-⁩]/g, '').split(' · ')[0] === w, want, { timeout: 5000 })
      .catch(async () => { throw new Error(`summary "${plain(await histStatus.textContent())}", want "${want}"`) })
  }
  // Counts the list requests while fn runs, plus a pause longer than the search's 150 ms.
  const historyGets = async (fn) => {
    let n = 0
    const count = (r) => isHistoryGet(r.url()) && n++
    page.on('request', count)
    await fn()
    await page.waitForTimeout(600)
    page.off('request', count)
    return n
  }
  const longGarage = 'Garage' + 'Y'.repeat(90)
  const longPart = 'P' + '9'.repeat(49)
  let civicId, civicTaskId, histAll
  await step('history-page', async () => {
    civicId = (await apiCall('POST', '/vehicles', { nickname: 'History Civic', initialOdometerKm: 100000 })).id
    civicTaskId = (await apiCall('POST', `/vehicles/${civicId}/tasks`, { name: 'Civic oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 5000, lastDoneDate: await histDay(-300) })).id
    const rec = (body) => apiCall('POST', `/vehicles/${civicId}/service-records`, body)
    for (let i = 0; i < 50; i++) await rec({ date: await histDay(-150 + i), odometerKm: 10000 + i * 100, shopName: `Filler ${i}`, totalCost: 1 })
    await rec({ date: await histDay(-40), odometerKm: 50000, shopName: 'Speedy Garage', notes: 'Fixed a rattle', taskIds: [civicTaskId],
      items: [{ description: 'Oil filter', brand: 'Mann', partNumber: 'W 712/75', quantity: 1, unitCost: 45.5 }] })
    await rec({ date: await histDay(-20), odometerKm: 60000, shopName: longGarage, items: [{ description: 'Brake pads', brand: 'Brembo', partNumber: longPart, quantity: 2, unitCost: 200 }] })
    await rec({ date: await histDay(-10), odometerKm: 70000, notes: 'Topped up washer fluid' })
    histAll = await apiCall('GET', '/service-records?take=100')
    // Criterion 11: a loading line on the first load.
    // Every list GET waits (dev StrictMode loads twice; delaying only the first let the second finish before Loading was seen).
    const slow = async (r) => { await page.waitForTimeout(700); await r.continue().catch(() => {}) } // the request may be gone by then
    const listGet = (url) => isHistoryGet(url.href)
    await page.route(listGet, slow)
    await page.click('header a[href="/spending"]')
    await histStatus.filter({ hasText: he ? 'טוען' : 'Loading' }).waitFor()
    await page.unroute(listGet, slow)
    await arrivedAt(HS.title)
    // Criterion 5: every car's records, newest first, with the count and total of all matches.
    await summaryIs(histAll.totalCount, histAll.totalCost)
    // LOW-1 L3: the Hebrew total sits in a first-strong isolate, as a row's <bdi> amount.
    if (he && !(await histStatus.textContent()).includes(`\u2068${await moneyText(histAll.totalCost)}\u2069`)) throw new Error('summary total not isolated like a row amount')
    if (histAll.totalCount <= 50 || histAll.totalCount > 100) throw new Error(`${histAll.totalCount} records`)
    await histRows.nth(49).waitFor()
    if ((await histRows.count()) !== 50) throw new Error(`${await histRows.count()} rows on the first page`)
    const ids = await histRows.evaluateAll((ls) => ls.map((l) => l.dataset.id))
    if (ids.join() !== histAll.items.slice(0, 50).map((r) => r.id).join()) throw new Error('rows not in the API order')
    const dates = await histRows.locator('time').evaluateAll((ts) => ts.map((t) => t.dateTime))
    if (dates.some((d, i) => i && d > dates[i - 1])) throw new Error(`not newest first: ${dates}`)
    // Criterion 12: each row names its car, linking to it; archived cars carry the tag; no Edit, Delete or Record anywhere.
    const archivedRow = histRows.filter({ hasText: 'Renamed Corolla' }).first()
    if ((await archivedRow.locator('.c-car .badge').textContent()) !== HS.archived) throw new Error('no Archived tag')
    const civicRow = histRows.filter({ hasText: 'Speedy Garage' })
    if (await civicRow.locator('.c-car .badge').count()) throw new Error('Archived tag on an active car')
    // SRCH-1b: the row opens its service card, which links to the car; no Edit, Delete or Record anywhere.
    await civicRow.locator('button.open').click()
    const civicCard = page.locator('main tr.detail')
    if ((await civicCard.locator('a.car').getAttribute('href')) !== `/cars/${civicId}`) throw new Error('car link')
    if (await page.locator('main .results .services button, main .results .services input').count()) throw new Error('the service card has a button')
    // Criterion 13: km and the user's currency, as on the car page.
    const civicText = plain(await civicRow.textContent() + ' ' + await civicCard.textContent())
    for (const want of ['50,000', SV.km, plain(await moneyText(45.5)), 'Civic oil', 'Fixed a rattle', 'W 712/75', 'Mann']) if (!civicText.includes(want)) throw new Error(`row lacks "${want}": ${civicText}`)
    // Criteria 10 and 11: a failed Show more keeps the rows, with the error and Retry; Retry appends the next page and focuses its first row.
    const more = page.getByRole('button', { name: HS.showMore, exact: true })
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await more.click()
    const alert = page.locator('main [role=alert]')
    await alert.waitFor()
    if ((await alert.textContent()) !== HS.generic) throw new Error(`error "${await alert.textContent()}"`)
    if ((await histRows.count()) !== 50) throw new Error('rows lost on a failed Show more')
    // The error and Retry take Show more's place below the rows, with focus on Retry.
    if (!(await page.locator('main .results ~ .row [role=alert]').count())) throw new Error('Show more error not below the rows')
    await focusIs('main .results ~ .row button', 'after a failed Show more')
    forgetExpected(500)
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await page.waitForFunction(() => document.activeElement === document.querySelectorAll('main tr.record button.open')[50], null, { timeout: 3000 })
      .catch(async () => { throw new Error(`after Show more: focus is on ${await active()}`) })
    if ((await histRows.count()) !== histAll.totalCount) throw new Error(`${await histRows.count()} rows after Show more`)
    if (await more.count()) throw new Error('Show more still shown with every match listed')
    if (await alert.count()) throw new Error('error still shown')
    // Criterion 13: miles follow the setting.
    await unitIs('Mi')
    await page.goto(`${BASE}/history?q=Speedy`)
    await summaryIs(1, 45.5)
    if (!plain(await histRows.first().textContent()).includes(`31,069 ${UM.mi}`)) throw new Error(`miles: ${plain(await histRows.first().textContent())}`)
    await unitIs('Km')
    // LOW-2 L15: a failed first load with a car in the URL still fills the Task select (the cars loaded); Retry fills the rows.
    const failList = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    const listUrl = (url) => isHistoryGet(url.href)
    await page.route(listUrl, failList) // every list request: dev StrictMode loads twice
    await page.goto(`${BASE}/history?vehicleId=${civicId}`)
    await alert.waitFor()
    await taskFilter.locator('option', { hasText: 'Civic oil' }).waitFor({ state: 'attached', timeout: 5000 }).catch(() => { throw new Error('Task select empty after a failed first load') })
    if (await histRows.count()) throw new Error('rows after a failed first load')
    await page.unroute(listUrl, failList)
    forgetExpected(500)
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await histRows.first().waitFor()
    if ((await carPressed()) !== 'History Civic' || !(await taskFilter.locator('option', { hasText: 'Civic oil' }).count())) throw new Error('filters lost after Retry')
  })
  await step('history-filter', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/history`)
    await summaryIs(histAll.totalCount, histAll.totalCost)
    const civicAll = await apiCall('GET', `/service-records?vehicleId=${civicId}`)
    const params = () => Object.fromEntries(new URL(page.url()).searchParams)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    // Criterion 6: a car narrows the list and offers its tasks; a task narrows it further; another car resets the task.
    await carPill('History Civic').click()
    await summaryIs(53, civicAll.totalCost)
    if (!same(params(), { vehicleId: civicId })) throw new Error(`URL ${page.url()}`)
    await taskFilter.locator('option', { hasText: 'Civic oil' }).waitFor({ state: 'attached' })
    await taskFilter.selectOption(civicTaskId)
    await summaryIs(1, 45.5)
    if (!same(params(), { vehicleId: civicId, taskId: civicTaskId })) throw new Error(`URL ${page.url()}`)
    const corollaPill = carPill('Renamed Corolla')
    if (!(await corollaPill.textContent()).includes(HS.archived.toLowerCase())) throw new Error('archived car not marked on its pill')
    const corolla = (await apiCall('GET', '/vehicles?includeArchived=true')).find((c) => c.nickname === 'Renamed Corolla').id
    await corollaPill.click()
    await page.waitForURL((u) => u.searchParams.get('vehicleId') === corolla)
    await page.waitForFunction(() => !document.querySelector('main .filters select')?.value, null, { timeout: 2000 }).catch(() => {}) // the URL changes before React renders
    if (params().taskId || (await taskFilter.inputValue()) !== '') throw new Error('task not reset with the car')
    if ((await corollaPill.getAttribute('aria-pressed')) !== 'true' || (await carPill(HS.allCars).getAttribute('aria-pressed')) !== 'false') throw new Error('car pills not pressed as chosen')
    await noOverflow('the car pills')
    // LOW-1 L2: at 1280px no filter sits alone on a row.
    await page.setViewportSize({ width: 1280, height: 800 })
    const tops = await filterBar.locator(':scope > label:not(.wide)').evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().top)))
    if (tops.some((t) => tops.filter((u) => u === t).length < 2)) throw new Error(`a filter alone on its row: ${tops}`)
    await page.setViewportSize({ width: 390, height: 844 })
    // Criterion 9: Back restores the car, the task and their results.
    await page.goBack()
    await summaryIs(1, 45.5)
    if ((await carPressed()) !== 'History Civic' || (await taskFilter.inputValue()) !== civicTaskId) throw new Error('Back did not restore the filters')
    await taskFilter.selectOption('')
    // Criterion 7: the dates are inclusive at both ends; from after to is blocked on the dates, without a request.
    await fromFilter.fill(await histDay(-40))
    await toFilter.fill(await histDay(-10))
    await summaryIs(3, 445.5)
    const fiveAgo = await histDay(-5)
    const sent = await historyGets(() => fromFilter.fill(fiveAgo))
    const dateAlert = filterBar.locator('[role=alert]')
    if (plain(await dateAlert.textContent()) !== HS.dates) throw new Error(`dates message "${await dateAlert.textContent()}"`)
    for (const d of [fromFilter, toFilter]) if ((await d.getAttribute('aria-invalid')) !== 'true' || (await d.getAttribute('aria-describedby')) !== (await dateAlert.getAttribute('id'))) throw new Error('message not tied to the dates')
    if (sent) throw new Error(`${sent} requests with from after to`)
    await fromFilter.fill(await histDay(-40))
    await summaryIs(3, 445.5)
    // Criterion 8: the search applies after a pause, replacing the URL entry; it finds the shop, notes and parts in any case.
    const entries = await page.evaluate(() => history.length)
    for (const [word, n, cost] of [['mann', 1, 45.5], ['RATTLE', 1, 45.5], ['w 712', 1, 45.5], ['brembo', 1, 400], ['speedy', 1, 45.5]]) {
      await searchBox.fill(word)
      await summaryIs(n, cost)
    }
    if ((await page.evaluate(() => history.length)) !== entries) throw new Error('typing pushed history entries')
    // Enter applies at once.
    await searchBox.fill('washer')
    await searchBox.press('Enter')
    await page.waitForURL((u) => u.searchParams.get('q') === 'washer', { timeout: 250 })
    await summaryIs(1, 0)
    // Over 100 characters is blocked on the field, without a request.
    const tooLong = await historyGets(() => searchBox.fill('x'.repeat(101)))
    const searchAlert = filterBar.locator('[role=alert]')
    if (plain(await searchAlert.textContent()) !== HS.tooLong) throw new Error(`search message "${await searchAlert.textContent()}"`)
    if (!(await searchBox.getAttribute('aria-describedby')).split(' ').includes(await searchAlert.getAttribute('id'))) throw new Error('message not tied to the search')
    if (tooLong) throw new Error(`${tooLong} requests for a long search`)
    // A server 400 shows next to its filter.
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.searchTooLong' }) }), { times: 1 })
    const r400 = page.waitForResponse((r) => isHistoryGet(r.url()))
    await searchBox.fill('brembo')
    await r400
    await searchAlert.waitFor()
    if (plain(await searchAlert.textContent()) !== HS.tooLong) throw new Error(`400 message "${await searchAlert.textContent()}"`)
    // Only this 400: forgetExpected would take an earlier, intended one.
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('400 GET') || !isHistoryGet(r.split(' ')[2]))
    const logged = run.consoleErrors.findLastIndex((e) => e.includes('status of 400'))
    if (logged >= 0) run.consoleErrors.splice(logged, 1)
    await searchBox.fill('Brembo') // a new query; the same one again sends nothing
    await summaryIs(1, 400)
    if (await searchAlert.count()) throw new Error('400 message outlived a good search')
    // Criteria 14 and 15: a long shop name and part number at 390px, in both languages, without overflow.
    await histRows.first().locator('button.open').click()
    const row = page.locator('main .results tbody')
    for (const want of [longGarage, longPart]) if (!plain(await row.textContent()).includes(want)) throw new Error(`row lacks ${want.slice(0, 10)}`)
    await noOverflow('a long shop name and part number')
    for (const c of await filterBar.locator('select, input, button').all()) await tall(c, `filter "${await c.evaluate((e) => e.closest('label')?.firstChild.textContent ?? e.textContent)}"`)
    await sweep('the filtered history')
    // Criterion 9: reload keeps every filter and its results.
    const url = page.url()
    await page.reload()
    await summaryIs(1, 400)
    if (page.url() !== url || (await carPressed()) !== 'History Civic' || (await fromFilter.inputValue()) !== (await histDay(-40)) || (await toFilter.inputValue()) !== (await histDay(-10)) || (await searchBox.inputValue()) !== 'Brembo') throw new Error('reload lost the filters')
    await page.screenshot({ path: `${OUT}/${s.name}-history-filtered.png`, fullPage: true })
    // Criterion 11: a failed reload keeps the rows, with the error and Retry.
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await searchBox.fill('')
    const loadAlert = page.locator('main .card [role=alert]')
    await loadAlert.waitFor()
    if ((await loadAlert.textContent()) !== HS.generic || (await histRows.count()) !== 1) throw new Error('a failed reload lost the rows or the error')
    // LOW-1 L1: the stale rows' count and total don't show beside the new filter.
    if (await histStatus.textContent()) throw new Error(`stale summary "${plain(await histStatus.textContent())}"`)
    forgetExpected(500)
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await summaryIs(3, 445.5)
    // Review: the URL holds the search trimmed, and Enter on the same search after a failure retries it.
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await searchBox.fill('  washer  ')
    await loadAlert.waitFor()
    if (params().q !== 'washer') throw new Error(`URL ${page.url()}`)
    forgetExpected(500)
    await searchBox.press('Enter')
    await summaryIs(1, 0)
    if (await loadAlert.count()) throw new Error('error outlived Enter')
    // Criterion 11: no matches, then Clear filters resets every filter and the URL, with focus on the car select.
    await searchBox.fill('nothing-matches-this')
    await histStatus.filter({ hasText: HS.noMatches }).waitFor()
    await clearBtn.click()
    await summaryIs(histAll.totalCount, histAll.totalCost)
    if (new URL(page.url()).search || (await carPressed()) !== HS.allCars || (await fromFilter.inputValue()) || (await toFilter.inputValue()) || (await searchBox.inputValue())) throw new Error('Clear filters left a filter')
    await focusIs('main .filters input[type=search]', 'after Clear filters')
    // Criterion 9: "Search all history" on a car page opens /history with that car.
    await page.goto(`${BASE}/cars/${civicId}`)
    await services.getByRole('link', { name: HS.searchAll, exact: true }).click()
    await arrivedAt(HS.title)
    await summaryIs(53, civicAll.totalCost)
    if ((await carPressed()) !== 'History Civic') throw new Error('car not selected')
    // Review: a car that isn't the user's drops from the URL, with its task, instead of filtering under All cars.
    // LOW-1 L5: no tasks request for it, so no tasks error.
    let taskGets = 0
    const countTasks = (q) => q.url().includes('/tasks') && taskGets++
    page.on('request', countTasks)
    await page.goto(`${BASE}/history?vehicleId=${crypto.randomUUID()}&taskId=${civicTaskId}&q=a`)
    await page.waitForURL((u) => !u.searchParams.has('vehicleId'))
    if (!same(params(), { q: 'a' }) || (await carPressed()) !== HS.allCars) throw new Error(`URL ${page.url()}`)
    await page.waitForLoadState('networkidle')
    page.off('request', countTasks)
    if (taskGets) throw new Error(`${taskGets} tasks requests for an unknown car`)
    if (await filterBar.locator('[role=alert]').count()) throw new Error('an error for an unknown car')
    await page.setViewportSize(s.viewport)
  })
  // SRCH-1b: the live search table. Search Golf's oil task is named in the other language, so only its starter template's
  // name finds it by "oil" and "שמן". The car is archived at the end, so the dashboard steps don't see it.
  await step('search', async () => {
    const tpl = (await apiCall('GET', '/task-templates')).find((x) => x.key === 'oilChange')
    const golf = (await apiCall('POST', '/vehicles', { nickname: 'Search Golf', initialOdometerKm: 10000, readingDate: await histDay(-500) })).id
    try {
      const golfTask = (await apiCall('POST', `/vehicles/${golf}/tasks`, { name: he ? 'Engine oil and filter' : 'שמן מנוע ופילטר שמן', category: 'Oil', templateId: tpl.id,
        intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 10000, lastDoneDate: await histDay(-500) })).id
      const golfRec = (await apiCall('POST', `/vehicles/${golf}/service-records`, { date: await histDay(-400), odometerKm: 20000, shopName: 'Golf Garage', totalCost: 300, taskIds: [golfTask] })).record.id
      const apiIds = async (qs) => (await apiCall('GET', `/service-records?take=50&${qs}`)).items.map((r) => r.id)
      const rowsAre = async (qs, what) => {
        const want = (await apiIds(qs)).join()
        await page.waitForFunction((w) => [...document.querySelectorAll('main tr.record')].map((r) => r.dataset.id).join() === w, want, { timeout: 5000 })
          .catch(() => { throw new Error(`${what}: rows are not the server's answer to ${qs}`) })
      }
      const searching = page.locator('main .results-note > span')
      const listGet = (url) => isHistoryGet(url.href)
      await page.goto(`${BASE}/spending`)
      await rowsAre('', 'first load')
      // Grouped by year and month in date order, with sticky headers.
      if (!(await page.locator('main tr.group.year').count()) || !(await page.locator('main tr.group.month').count())) throw new Error('no year and month headers')
      if ((await page.locator('main tr.group.year > th').evaluate((el) => getComputedStyle(el.closest('tr')).position + getComputedStyle(el).position)).indexOf('sticky') < 0) throw new Error('year header not sticky')

      // Criterion 1: each letter narrows the rows on screen at once, never to none, with Searching… while the slowed answers are out.
      const slow = async (r) => { await new Promise((ok) => setTimeout(ok, 500)); await r.continue().catch(() => {}) }
      await page.route(listGet, slow)
      await page.evaluate(() => {
        const w = (window.rowWatch = { min: Infinity, on: true })
        const tick = () => { w.min = Math.min(w.min, document.querySelectorAll('main tr.record').length); if (w.on) requestAnimationFrame(tick) }
        tick()
      })
      const counts = [await histRows.count()]
      for (const ch of 'oil') {
        await searchBox.press(ch)
        await page.waitForTimeout(60)
        counts.push(await histRows.count())
        if (!(await searching.isVisible())) throw new Error(`no Searching… after "${ch}"`)
      }
      if (counts.some((c, i) => i && c > counts[i - 1]) || counts[3] >= counts[0]) throw new Error(`rows while typing: ${counts}`)
      await rowsAre('q=oil', 'oil')
      await page.unroute(listGet, slow)
      const min = await page.evaluate(() => { window.rowWatch.on = false; return window.rowWatch.min })
      if (!min) throw new Error('the rows went blank while typing')
      await searching.waitFor({ state: 'hidden' })
      if (!(await apiIds(`q=oil&vehicleId=${golf}`)).includes(golfRec)) throw new Error('"oil" did not find the oil change named in the other language')
      if (!(await page.locator('main .results-note > p').textContent())) throw new Error('no Sorted by note')
      // Several words in any order; Hebrew finds the same oil change.
      await searchBox.fill('oil filter')
      await rowsAre('q=oil+filter', 'oil filter')
      const oilFilter = await apiIds('q=oil+filter')
      await searchBox.fill('filter oil')
      await rowsAre('q=filter+oil', 'filter oil')
      if ((await apiIds('q=filter+oil')).join() !== oilFilter.join()) throw new Error('word order changed the matches')
      await searchBox.fill('שמן')
      await rowsAre(`q=${encodeURIComponent('שמן')}`, 'שמן')
      if (!(await apiIds(`q=${encodeURIComponent('שמן')}&vehicleId=${golf}`)).includes(golfRec)) throw new Error('"שמן" did not find the oil change')

      // Criterion 1: a 30-character phrase typed a letter at a time (slower than the debounce, so about one request a letter) gets no 429.
      await searchBox.fill('')
      await rowsAre('', 'cleared')
      const statuses = []
      const onRes = (r) => isHistoryGet(r.url()) && statuses.push(r.status())
      page.on('response', onRes)
      await searchBox.pressSequentially('engine oil and filter changed!', { delay: 200 })
      await page.waitForTimeout(600)
      page.off('response', onRes)
      if (statuses.length > 31 || statuses.some((x) => x !== 200)) throw new Error(`30 letters: ${statuses.length} requests, statuses ${[...new Set(statuses)]}`)
      run.searchRequestsFor30Letters = statuses.length

      // Criterion 3: a chip searches in one tap and shows pressed; again clears.
      await searchBox.fill('')
      const chips = filterBar.locator('.quick[role=group]').first().locator('button')
      const word = he ? 'שמן' : 'oil'
      await chips.first().click()
      await page.waitForURL((u) => u.searchParams.get('q') === word)
      if ((await searchBox.inputValue()) !== word || (await chips.first().getAttribute('aria-pressed')) !== 'true') throw new Error('chip not applied')
      await rowsAre(`q=${encodeURIComponent(word)}`, 'chip')
      await chips.first().click()
      await page.waitForURL((u) => !u.searchParams.has('q'))
      if ((await searchBox.inputValue()) || (await chips.first().getAttribute('aria-pressed')) !== 'false') throw new Error('chip not cleared')
      // Quick ranges set From and To in one tap; a hand-edited date unpresses them; All time clears both.
      const ranges = filterBar.locator('.quick[role=group]').nth(1).locator('button')
      const pressed = () => ranges.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-pressed')).join())
      const pressedIs = async (want, what) => { // the URL changes just before React renders
        for (let i = 0; i < 30 && (await pressed()) !== want; i++) await page.waitForTimeout(100)
        if ((await pressed()) !== want) throw new Error(`${what} pressed ${await pressed()}`)
      }
      const today = await histDay(0)
      await ranges.nth(0).click()
      await page.waitForURL((u) => u.searchParams.get('from') === `${today.slice(0, 4)}-01-01` && u.searchParams.get('to') === today)
      await pressedIs('true,false,false', 'This year')
      const yearAgo = yearBack(today) // its Feb 29 cases: ui-tests/today.test.mjs
      await ranges.nth(1).click()
      await page.waitForURL((u) => u.searchParams.get('from') === yearAgo && u.searchParams.get('to') === today)
      await rowsAre(`from=${yearAgo}&to=${today}`, 'Last 12 months')
      await pressedIs('false,true,false', 'Last 12 months')
      await fromFilter.fill(await histDay(-40))
      await pressedIs('false,false,false', 'hand-edited date')
      await ranges.nth(2).click()
      await page.waitForURL((u) => !u.searchParams.has('from') && !u.searchParams.has('to'))
      await pressedIs('false,false,true', 'All time')

      // Criterion 3: the totals have count, total, average and the last date.
      await searchBox.fill('golf garage')
      await rowsAre('q=golf+garage', 'golf garage')
      const m300 = await moneyText(300)
      const lastDate = await page.evaluate(([d, l]) => new Date(d).toLocaleDateString(l, { dateStyle: 'medium', timeZone: 'UTC' }), [await histDay(-400), s.lng])
      const wantTotals = [HS.summary(1, m300), key('averageIs').replace('{{amount}}', m300), key('lastOn').replace('{{date}}', lastDate)].map(plain).join(' · ')
      await page.waitForFunction((w) => document.querySelector('main .card > p[role=status]')?.textContent.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim() === w, wantTotals, { timeout: 5000 })
        .catch(async () => { throw new Error(`totals "${plain(await histStatus.textContent())}", want "${wantTotals}"`) })
      // Criterion 2: the words are marked in Car and Shop.
      const golfRow = histRows.filter({ hasText: 'Golf Garage' })
      const marks = await golfRow.locator('mark').allTextContents()
      if (marks.join() !== 'Golf,Golf,Garage') throw new Error(`marks ${marks}`)
      // A record with no tasks and no tires opens without a stray "0" (tireCount 0 rendered by &&).
      const wash = (await apiCall('POST', `/vehicles/${golf}/service-records`, { date: await histDay(-390), odometerKm: 20100, shopName: 'Golf Wash', totalCost: 20, taskIds: [],
        items: [{ description: 'Wash', quantity: 1, unitCost: 20, isLabor: false }] })).record.id
      await searchBox.fill('golf wash')
      await rowsAre('q=golf+wash', 'golf wash')
      await page.locator(`main tr.record[data-id="${wash}"] button.open`).click()
      const washCard = page.locator('main tr.detail .services > li')
      await washCard.waitFor()
      if (await washCard.evaluate((li) => [...li.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === '0'))) throw new Error('a "0" in the card of a record without tasks')
      if (await washCard.locator('.tires-bought').count()) throw new Error('a Tires line for a record without tires')
      await searchBox.fill('golf garage')
      await rowsAre('q=golf+garage', 'golf garage again')
      // A row opens its service card and closes again, by tap and by keyboard.
      await golfRow.locator('.c-shop').click()
      const detail = page.locator('main tr.detail')
      await detail.locator('a.car').waitFor()
      if ((await golfRow.locator('button.open').getAttribute('aria-expanded')) !== 'true') throw new Error('row not expanded')
      await golfRow.locator('.c-shop').click()
      await detail.waitFor({ state: 'detached' })
      await golfRow.locator('button.open').focus()
      await page.keyboard.press('Enter')
      await detail.waitFor()
      await page.keyboard.press('Enter')
      await detail.waitFor({ state: 'detached' })

      // Criterion 2: Cost sorts descending, then ascending, with aria-sort; flat (no groups); reload and Back keep it.
      await searchBox.fill('')
      await rowsAre('', 'cleared')
      const head = (name) => page.locator('main .results thead th').filter({ hasText: name })
      const costHead = head(key('colCost'))
      await costHead.locator('button').click()
      await page.waitForURL((u) => u.searchParams.get('sort') === 'cost' && !u.searchParams.has('dir'))
      await rowsAre('sort=cost', 'cost, highest first')
      if ((await costHead.getAttribute('aria-sort')) !== 'descending' || (await head(key('csvDate')).getAttribute('aria-sort')) !== null) throw new Error('aria-sort after one tap')
      if (await page.locator('main tr.group').count()) throw new Error('groups in cost order')
      await costHead.locator('button').click()
      await page.waitForURL((u) => u.searchParams.get('dir') === 'asc')
      await rowsAre('sort=cost&dir=asc', 'cost, lowest first')
      if ((await costHead.getAttribute('aria-sort')) !== 'ascending') throw new Error('aria-sort after two taps')
      await page.reload()
      await rowsAre('sort=cost&dir=asc', 'cost after a reload')
      await page.goBack()
      await rowsAre('sort=cost', 'cost after Back')
      await page.goForward()
      await rowsAre('sort=cost&dir=asc', 'cost after Forward')
      const odoHead = head(key('odometer'))
      await odoHead.locator('button').click()
      await rowsAre('sort=odometer', 'odometer, highest first')
      await odoHead.locator('button').click()
      await rowsAre('sort=odometer&dir=asc', 'odometer, lowest first')
      await costHead.locator('button').click()
      await costHead.locator('button').click()
      await rowsAre('sort=cost&dir=asc', 'cost, lowest first again')

      // Criterion 3: Export CSV has every match (more than the 50 loaded), in the current sort, Hebrew readable.
      const all = []
      for (let total = 1; all.length < total;) {
        const pg = await apiCall('GET', `/service-records?take=100&skip=${all.length}&sort=cost&dir=asc`)
        all.push(...pg.items)
        total = pg.items.length ? pg.totalCount : 0
      }
      if (all.length <= 50) throw new Error(`${all.length} matches: too few to prove the export pages`)
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: key('exportCsv'), exact: true }).click()])
      if (!/^onlycars-search-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename())) throw new Error(`file ${dl.suggestedFilename()}`)
      const csvText = readFileSync(await dl.path(), 'utf8')
      if (!csvText.startsWith('﻿')) throw new Error('no BOM')
      const lines = csvText.slice(1).split('\r\n').filter(Boolean)
      if (lines.length !== all.length + 1) throw new Error(`${lines.length - 1} CSV rows, want ${all.length}`)
      if (!lines[0].startsWith(`${key('csvDate')},${key('car')},${key('whatWasDone')},`)) throw new Error(`header ${lines[0]}`)
      const costs = lines.slice(1).map((l) => l.split(',').at(-1))
      if (costs.join() !== all.map((r) => r.totalCost?.toFixed(2) ?? '').join()) throw new Error('CSV not in the cost order')
      const golfLine = lines.find((l) => l.includes('Golf Garage'))
      if (!golfLine?.includes(he ? 'Engine oil and filter' : 'שמן מנוע ופילטר שמן')) throw new Error(`golf line ${golfLine}`)

      // The export stops at 5,000 rows (50 requests), and says so: here the server is made to report 6,000 matches.
      const exportGet = (u) => isHistoryGet(u.href) && u.searchParams.get('take') === '100'
      const capRequests = []
      const fake = async (r) => {
        capRequests.push(r.request().url())
        const pg = await (await r.fetch({ url: r.request().url().replace(/skip=\d+/, 'skip=0') })).json() // real rows for every fake page
        await r.fulfill({ json: { ...pg, totalCount: 6000, items: Array.from({ length: 100 }, (_, i) => pg.items[i % pg.items.length]) } })
      }
      await page.route(exportGet, fake)
      try {
        const [big] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: key('exportCsv'), exact: true }).click()])
        const bigLines = readFileSync(await big.path(), 'utf8').slice(1).split('\r\n').filter(Boolean)
        if (bigLines.length !== 5001 || capRequests.length !== 50) throw new Error(`capped export: ${bigLines.length - 1} rows in ${capRequests.length} requests`)
        const cut = page.locator('main .export p[role=status]')
        await cut.waitFor()
        if (!(await cut.textContent()).includes((6000).toLocaleString(s.lng))) throw new Error(`cut note "${await cut.textContent()}"`)
      } finally { await page.unroute(exportGet, fake) }

      // The archived car's dashed pill gets the 3px focus ring on Tab, like every pill.
      const archivedPill = filterBar.locator('button.archived-car').first()
      if (await archivedPill.count()) {
        await archivedPill.focus()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        const ring = await archivedPill.evaluate((el) => el.matches(':focus-visible') && getComputedStyle(el).outlineWidth + ' ' + getComputedStyle(el).outlineStyle)
        if (ring !== '3px solid') throw new Error(`archived pill focus ring: ${ring}`)
        await page.screenshot({ path: `${OUT}/${s.name}-archived-focus.png` })
      } else throw new Error('no archived car pill to check')

      // Criterion 4: nothing matches, with Clear in place; Clear keeps the sort.
      await searchBox.fill('nothing-matches-this-search')
      await histStatus.filter({ hasText: HS.noMatches }).waitFor()
      if ((await page.getByRole('button', { name: key('exportCsv'), exact: true }).getAttribute('aria-disabled')) !== 'true') throw new Error('Export CSV enabled with no match')
      await page.locator('main .card').nth(1).getByRole('button', { name: HS.clear, exact: true }).click()
      await page.waitForURL((u) => !u.searchParams.has('q') && u.searchParams.get('sort') === 'cost')

      // Criterion 5: at 360px the two-line cards, no sideways scroll, 44px targets.
      await page.setViewportSize({ width: 360, height: 800 })
      await page.goto(`${BASE}/spending?q=golf`)
      await rowsAre('q=golf', 'golf at 360')
      const top = (sel) => histRows.first().locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().top))
      // Date and cost; the car on its own line; what was done; shop and odometer.
      const [dTop, cTop, carTop, wTop, sTop, oTop] = await Promise.all(['.c-date', '.c-cost', '.c-car', '.c-what', '.c-shop', '.c-odo'].map(top))
      if (Math.abs(dTop - cTop) > 12 || carTop <= dTop || wTop <= carTop || sTop <= wTop || Math.abs(sTop - oTop) > 12) throw new Error(`card lines: date ${dTop}, cost ${cTop}, car ${carTop}, what ${wTop}, shop ${sTop}, odometer ${oTop}`)
      // Car and shop names on one line each, not word by word.
      for (const c of ['.c-car', '.c-shop']) if (await histRows.first().locator(c).evaluate((el) => el.getBoundingClientRect().height > 2.2 * parseFloat(getComputedStyle(el).fontSize))) throw new Error(`${c} wraps at 360px`)
      await noOverflow('the search at 360px')
      await sweep('the search at 360px')
      await page.screenshot({ path: `${OUT}/${s.name}-search-360.png`, fullPage: true })
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(`${BASE}/spending?q=golf`)
      await rowsAre('q=golf', 'golf at 1280')
      await page.screenshot({ path: `${OUT}/${s.name}-search-1280.png`, fullPage: true })
    } finally {
      await page.setViewportSize(s.viewport)
      await apiCall('POST', `/vehicles/${golf}/archive`).catch(() => {})
    }
  })
  // MVP4-A: the dashboard on `/`. A car with four tasks (overdue, due soon, two OK) and one with none, beside History Civic.
  const D = he
    ? { overdue: (n) => ['אין משימות באיחור', 'משימה אחת באיחור', 'שתי משימות באיחור'][n] ?? `${n} משימות באיחור`,
        soon: (n) => ['אין משימות לביצוע בקרוב', 'משימה אחת לביצוע בקרוב', 'שתי משימות לביצוע בקרוב'][n] ?? `${n} משימות לביצוע בקרוב`,
        month: (n, total) => (n ? `החודש: ${total} (${['', 'טיפול אחד', 'שני טיפולים'][n] || `${n} טיפולים`})` : 'החודש: אין טיפולים'),
        all: (n) => `כל המשימות (${n})`, caughtUp: 'אין כרגע משימות לטיפול.', noTasks: 'עדיין אין משימות תחזוקה.', addTask: 'הוספת משימה', status: { Overdue: 'באיחור', DueSoon: 'בקרוב' }, brakesLate: 'באיחור של 500 ק״מ' }
    : { overdue: (n) => (n ? `${n} task${n === 1 ? '' : 's'} overdue` : 'No tasks overdue'), soon: (n) => (n ? `${n} task${n === 1 ? '' : 's'} due soon` : 'No tasks due soon'),
        month: (n, total) => (n ? `This month: ${total} (${n} service${n === 1 ? '' : 's'})` : 'This month: no services'),
        all: (n) => `All tasks (${n})`, caughtUp: 'All caught up: nothing due.', noTasks: 'No maintenance tasks yet.', addTask: 'Add task', status: { Overdue: 'Overdue', DueSoon: 'Due soon' }, brakesLate: 'Overdue by 500 km' }
  const isDashGet = (u) => u.pathname === '/api/dashboard'
  const dashCar = () => page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Dash car', exact: true }) })
  const dashRow = (name) => dashCar().locator('.dash-tasks > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const dashNames = () => dashCar().locator('.dash-tasks .name').allTextContents()
  const cardCounts = async () => (await dashCar().locator('.counts span').allTextContents()).map(plain).join('|')
  const summary = page.locator('main .summary')
  const dashApi = async () => apiCall('GET', `/dashboard?today=${await localDate()}`)
  // The summary shows the API's figures, once the reload lands.
  async function summaryShows(dash) {
    const want = [D.overdue(dash.overdueCount), D.soon(dash.dueSoonCount), D.month(dash.monthServiceCount, await moneyText(dash.monthTotalCost))].join('|')
    await page.waitForFunction((w) => [...document.querySelectorAll('main .summary .counts span, main .summary a')].map((e) => e.textContent.replace(/[⁦-⁩]/g, '')).join('|') === w, want, { timeout: 5000 })
      .catch(async () => { throw new Error(`summary "${plain(await summary.textContent())}", want "${want}"`) })
  }
  let dashCarId, taskIds
  await step('dashboard-summary', async () => {
    // LOW-3 L36: the first readings take the local date, as the app sends it, so the tasks can be last done today too.
    const today = await localDate()
    dashCarId = (await apiCall('POST', '/vehicles', { nickname: 'Dash car', initialOdometerKm: 50000, readingDate: today })).id
    await apiCall('POST', '/vehicles', { nickname: 'Dash bike', initialOdometerKm: 1000, readingDate: today })
    const task = (name, intervalKm, intervalDays, lastKm) =>
      apiCall('POST', `/vehicles/${dashCarId}/tasks`, { name, category: 'Other', intervalKm, intervalDays, dueSoonPercent: 10, lastDoneOdometerKm: lastKm, lastDoneDate: today })
    taskIds = {
      Oil: (await task('Oil', 10000, null, 39000)).id, // overdue by 1,000 km
      Brakes: (await task('Brakes', 20000, null, 31000)).id, // due soon, 1,000 km left
      'Air filter': (await task('Air filter', null, 365, 50000)).id,
      Coolant: (await task('Coolant', 100000, null, 50000)).id,
    }
    // Criterion 8: a slow load shows the placeholder, as tall as the loaded summary.
    // Every request is held (dev StrictMode loads twice); continue fails harmlessly on one the page dropped.
    const slow = async (r) => { await page.waitForTimeout(600); await r.continue().catch(() => {}) }
    await page.route(isDashGet, slow)
    await page.click('header a.brand')
    await summary.locator('[role=status]').waitFor()
    const loadingH = await heightOf(summary)
    await dashCar().waitFor()
    await page.unroute(isDashGet, slow)
    await arrivedAt(T.dashboard)
    const loadedH = await heightOf(summary)
    if (Math.abs(loadedH - loadingH) > 1) throw new Error(`summary ${loadingH}px while loading, ${loadedH}px loaded`)
    // A failed load: a translated error with Retry; Retry loads it and focuses the h1.
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    await page.route(isDashGet, fail)
    await page.reload()
    const alert = page.locator('main > .row [role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    // A Retry that fails again keeps focus on Retry (MVP1-C).
    const retry = page.getByRole('button', { name: HS.retry, exact: true })
    const failed = page.waitForResponse((r) => isDashGet(new URL(r.url())))
    await retry.click()
    await failed
    await page.locator('main > .row button[aria-disabled=false]').waitFor()
    await focusIs('main > .row button', 'Retry after a failed Retry')
    await page.unroute(isDashGet, fail)
    await retry.click()
    await dashCar().waitFor()
    await focusIs('main h1', 'h1 after Retry')
    if (await alert.count()) throw new Error('the error stayed after Retry')
    forget500()
    // Criterion 3: one card per active car in the server's order, then the summary's figures.
    const dash = await dashApi()
    const cars = await apiCall('GET', '/vehicles')
    const want = dash.vehicles.map((v) => cars.find((c) => c.id === v.id).nickname)
    const names = await page.locator('.cars > li:not(.archived) h2').allTextContents()
    if (names.join('|') !== want.join('|')) throw new Error(`cards ${names}, want ${want}`)
    await summaryShows(dash)
    noLatin((await summary.textContent()).replace(/[A-Z]{3}/, ''), 'summary')
    // Only the tasks due soon or overdue, most urgent first (owner, 2026-11-02), with status and remaining; All tasks (4); a car without tasks says so.
    if ((await dashNames()).join('|') !== 'Oil|Brakes') throw new Error(`tasks ${await dashNames()}`)
    if ((await dashRow('Oil').locator('.badge.status').textContent()) !== D.status.Overdue) throw new Error('Oil badge')
    if ((await dashRow('Brakes').locator('.badge.status').textContent()) !== D.status.DueSoon) throw new Error('Brakes badge')
    if (!plain(await dashRow('Oil').textContent()).includes(RS.oilLate)) throw new Error(`Oil row "${plain(await dashRow('Oil').textContent())}"`)
    if ((await cardCounts()) !== `${D.overdue(1)}|${D.soon(1)}`) throw new Error(`card counts ${await cardCounts()}`)
    const all = plain(await dashCar().locator(`.actions a[href="/cars/${dashCarId}"]`).textContent())
    if (all !== D.all(4)) throw new Error(`All tasks link "${all}"`)
    const bike = page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Dash bike', exact: true }) })
    if (!(await bike.textContent()).includes(D.noTasks) || !(await bike.getByRole('link', { name: D.addTask, exact: true }).count())) throw new Error('no-tasks state')
    // Criterion 10: at 390px nothing overflows and the controls are 44px tall.
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the dashboard')
    await sweep('the dashboard')
    await tall(dashCar().locator('.quick input[type=number]'), 'quick entry')
    // Criterion 4: the month links to /history for this month, which shows the same count and total.
    const month = summary.locator('a')
    if ((await month.getAttribute('href')) !== `/spending?from=${dash.month}-01&to=${today}`) throw new Error(`month link ${await month.getAttribute('href')}`)
    await month.click()
    await arrivedAt(HS.title)
    if (dash.monthServiceCount) await summaryIs(dash.monthServiceCount, dash.monthTotalCost)
    await page.goBack()
    await dashCar().waitFor()
    await page.setViewportSize(s.viewport)
  })
  // Counts the moments, at each DOM change and each frame, when focus is on body or the task's row is missing.
  const watchUndo = (id) => page.evaluate((id) => {
    const w = (window.undoWatch = { body: 0, gone: 0, on: true })
    const check = () => {
      if (document.activeElement === document.body) w.body++
      if (!document.querySelector(`.dash-tasks > li[data-id="${id}"]`)) w.gone++
    }
    w.mo = new MutationObserver(check)
    w.mo.observe(document.querySelector('main'), { subtree: true, childList: true, attributes: true })
    const tick = () => { check(); if (w.on) requestAnimationFrame(tick) }
    tick()
  }, id)
  const watched = () => page.evaluate(() => { const w = window.undoWatch; w.on = false; w.mo.disconnect(); return { body: w.body, gone: w.gone } })
  await step('dashboard-mark-done', async () => {
    const before = await dashApi()
    const sent = page.waitForRequest(isReset)
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).click()
    if ((await sent).postDataJSON().date !== (await localDate())) throw new Error('reset not dated with the local date')
    // Criterion 5: focus on the row's Undo; Oil restarts and stays shown with its Undo though it is now OK; the counts drop.
    await focusIs(`li[data-id="${taskIds.Oil}"] .undo button`, 'Undo after Mark done')
    if ((await dashNames()).join('|') !== 'Brakes|Oil') throw new Error(`tasks after Mark done ${await dashNames()}`)
    if (!plain(await dashRow('Oil').textContent()).includes(RS.oilLeft)) throw new Error(`Oil row "${plain(await dashRow('Oil').textContent())}"`)
    if ((await cardCounts()) !== `${D.overdue(0)}|${D.soon(1)}`) throw new Error(`card counts ${await cardCounts()}`)
    const after = await dashApi()
    if (after.overdueCount !== before.overdueCount - 1) throw new Error(`overdue ${before.overdueCount} -> ${after.overdueCount}`)
    await summaryShows(after)
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-undo.png`, fullPage: true })
    // Undo restores it, with focus back on its Mark done. LOW-2 L17: straight there, never on body, and the row never leaves the page.
    await watchUndo(taskIds.Oil)
    await dashRow('Oil').locator('.undo button').click()
    await focusIs(`li[data-id="${taskIds.Oil}"] button.done`, 'Mark done after Undo')
    let w = await watched()
    if (w.body || w.gone) throw new Error(`during Undo: focus on body ${w.body} times, Oil row gone ${w.gone} times`)
    if ((await dashNames()).join('|') !== 'Oil|Brakes') throw new Error(`tasks after Undo ${await dashNames()}`)
    if (!plain(await dashRow('Oil').textContent()).includes(RS.oilLate)) throw new Error('Oil not overdue again')
    await summaryShows(before)
    // LOW-2 review M1: ticking Show archived while Undo is in flight ends the Undo bar.
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).click()
    await focusIs(`li[data-id="${taskIds.Oil}"] .undo button`, 'Undo after Mark done')
    let release
    const held = new Promise((r) => { release = r })
    await page.route(at('/void'), async (r) => { await held; await r.continue() }, { times: 1 })
    await dashRow('Oil').locator('.undo button').click()
    const archived = page.locator('main > label.inline input')
    await archived.check()
    release()
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).waitFor()
    await page.waitForLoadState('networkidle')
    if (await page.locator('.cars .undo').count()) throw new Error('Undo bar outlived the Show archived toggle')
    const reloaded = page.waitForResponse((r) => isDashGet(new URL(r.url())))
    await archived.uncheck()
    await reloaded
    // LOW-2 L22: Undo is 44px at 390px; when the restored task is no longer shown (OK now), focus goes to the car's h2 link.
    await page.setViewportSize({ width: 390, height: 844 })
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).click()
    await focusIs(`li[data-id="${taskIds.Oil}"] .undo button`, 'Undo after Mark done')
    await tall(dashRow('Oil').locator('.undo button'), 'dashboard Undo')
    // The reload after Undo ranks Oil last, as if it had been done elsewhere meanwhile.
    const oilLast = async (r) => {
      const res = await r.fetch()
      const json = await res.json()
      for (const v of json.vehicles) for (const t of v.tasks) if (t.id === taskIds.Oil) Object.assign(t, { status: 'Ok', progress: 0, remainingKm: 10000 })
      await r.fulfill({ response: res, json })
    }
    await page.route(isDashGet, oilLast, { times: 1 })
    await watchUndo(taskIds.Oil)
    await dashRow('Oil').locator('.undo button').click()
    await focusIs(`.cars > li[data-id="${dashCarId}"] h2 a`, 'the car link after Undo')
    w = await watched()
    if (w.body) throw new Error(`during Undo: focus on body ${w.body} times`)
    if (await dashRow('Oil').count()) throw new Error('Oil still shown while OK')
    await page.setViewportSize(s.viewport)
    // LOW-3 L27: Undo whose reload fails: the bar goes, and focus moves to the row's Mark done, not body.
    const markBrakes = () => dashRow('Brakes').getByRole('button', { name: RS.done + 'Brakes', exact: true })
    const pageAlert = page.locator('main > .row [role=alert]')
    await page.route(isDashGet, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await markBrakes().click()
    await pageAlert.waitFor()
    await focusIs(`li[data-id="${taskIds.Brakes}"] .undo button`, 'Undo after Mark done with a failed reload')
    await page.route(isDashGet, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await dashRow('Brakes').locator('.undo button').click()
    await focusIs(`li[data-id="${taskIds.Brakes}"] button.done`, 'Mark done after Undo with a failed reload')
    if (await page.locator('.cars .undo').count()) throw new Error('the Undo bar stayed after Undo')
    // LOW-3 L32(b): Retry while Undo's reload is held: the newer load ends the Undo bar too.
    await page.route(isDashGet, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await markBrakes().click()
    await focusIs(`li[data-id="${taskIds.Brakes}"] .undo button`, 'Undo after Mark done')
    let releaseGet
    const heldGet = new Promise((r) => { releaseGet = r })
    await page.route(isDashGet, async (r) => { await heldGet; await r.continue() }, { times: 1 })
    const voided = page.waitForResponse((r) => pathOf(r).endsWith('/void'))
    await dashRow('Brakes').locator('.undo button').click()
    await voided
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await focusIs('main h1', 'h1 after Retry')
    await pageAlert.waitFor({ state: 'detached' })
    releaseGet()
    await page.waitForLoadState('networkidle')
    if (await page.locator('.cars .undo').count()) throw new Error('a stale Undo bar after a newer load')
    await markBrakes().waitFor()
    forget500()
    // Criterion 8: a failed Mark done shows on that row, keeps the page, and focus returns to Mark done.
    await page.route(at('/reset'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await dashRow('Brakes').getByRole('button', { name: RS.done + 'Brakes', exact: true }).click()
    const alert = dashRow('Brakes').locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== RS.generic) throw new Error(`row error "${await alert.textContent()}"`)
    await focusIs(`li[data-id="${taskIds.Brakes}"] button.done`, 'Mark done after a failure')
    if (await page.locator('main > .row [role=alert]').count()) throw new Error('a page-level error')
    forget500()
  })
  await step('dashboard-quick-odometer', async () => {
    await page.evaluate(() => { window.noReload = true })
    const before = await dashApi()
    // A failed save shows on that card only.
    await page.route((u) => u.pathname === `/api/vehicles/${dashCarId}/odometer`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await dashCar().locator('.quick input[type=number]').fill('51500')
    await dashCar().locator('.quick button').click()
    const alert = dashCar().locator('.quick [role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`quick entry error "${await alert.textContent()}"`)
    if (await page.locator('main > .row [role=alert]').count()) throw new Error('a page-level error')
    forget500()
    const brakesError = dashRow('Brakes').locator('[role=alert]')
    if (!(await brakesError.count())) throw new Error("the failed Mark done's error went without a reload")
    // Criterion 6: the card's odometer and statuses and the summary follow, without a page reload.
    await dashCar().locator('.quick button').click()
    await page.waitForFunction((id) => document.querySelector(`.cars > li[data-id="${id}"] .odometer`)?.getAttribute('aria-label').startsWith('51,500'), dashCarId, { timeout: 5000 })
    if (!plain(await dashRow('Brakes').textContent()).includes(D.brakesLate)) throw new Error(`Brakes row "${plain(await dashRow('Brakes').textContent())}"`)
    if ((await cardCounts()) !== `${D.overdue(2)}|${D.soon(0)}`) throw new Error(`card counts ${await cardCounts()}`)
    const after = await dashApi()
    if (after.overdueCount !== before.overdueCount + 1 || after.dueSoonCount !== before.dueSoonCount - 1) throw new Error('API counts did not follow')
    await summaryShows(after)
    if (await alert.count()) throw new Error('the error stayed after saving')
    // LOW-2 L24: the reload clears the row's Mark done error.
    if (await brakesError.count()) throw new Error("the failed Mark done's error stayed after the reload")
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  // Owner, 2026-11-02: a task marked done stays with its Undo, then goes once Undo is gone; a car with nothing due says so, with All tasks.
  await step('dashboard-caught-up', async () => {
    const calmId = (await apiCall('POST', '/vehicles', { nickname: 'Calm car', initialOdometerKm: 9500, readingDate: await localDate() })).id
    const wash = await apiCall('POST', `/vehicles/${calmId}/tasks`, { name: 'Wash', category: 'Other', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 0, lastDoneDate: await localDate() })
    const calm = page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Calm car', exact: true }) })
    await page.reload()
    await calm.locator('.dash-tasks').waitFor()
    await calm.getByRole('button', { name: RS.done + 'Wash', exact: true }).click()
    await focusIs(`li[data-id="${wash.id}"] .undo button`, 'Undo after Mark done')
    if (await calm.getByText(D.caughtUp).count()) throw new Error('caught up while the Undo row shows')
    // The next load ends Undo: the OK row goes, and the card says it is caught up, with All tasks (1).
    await page.reload()
    await calm.getByText(D.caughtUp).waitFor()
    if (await calm.locator('.dash-tasks').count()) throw new Error('an OK task on the dashboard')
    const all = calm.locator(`.actions a[href="/cars/${calmId}"]`)
    if (!(await all.count()) || plain(await all.textContent()) !== D.all(1)) throw new Error('no All tasks link when caught up')
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-caught-up.png`, fullPage: true })
    await apiCall('POST', `/vehicles/${calmId}/archive`) // the steps below expect the cars they made
    await page.reload()
    await dashCar().waitFor()
  })
  await step('dashboard-long-name', async () => {
    // LOW-2 L25: a long task name wraps beside its status badge, at 390px and 1280px, without overflow.
    const long = 'Replace the timing belt, the water pump and every tensioner and idler pulley on the engine'
    const rename = async (r) => {
      const res = await r.fetch()
      const json = await res.json()
      for (const v of json.vehicles) for (const t of v.tasks) if (t.id === taskIds.Brakes) t.name = long
      await r.fulfill({ response: res, json })
    }
    await page.route(isDashGet, rename)
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      await page.reload()
      const row = dashRow(long)
      await row.waitFor()
      const m = await row.evaluate((li) => {
        const name = li.querySelector('.name'), n = name.getBoundingClientRect(), b = li.querySelector('.badge.status').getBoundingClientRect()
        return { rtl: getComputedStyle(li).direction === 'rtl', line: parseFloat(getComputedStyle(name).lineHeight), n: n.toJSON(), b: b.toJSON() }
      })
      if (m.n.height < 2 * m.line - 1) throw new Error(`the name did not wrap at ${width}px`)
      if (m.b.top > m.n.top + m.line) throw new Error(`the badge is below the name's first line at ${width}px`)
      if (m.rtl ? m.b.right > m.n.left + 1 : m.b.left < m.n.right - 1) throw new Error(`the badge is not beside the name at ${width}px`)
      await noOverflow(`a long task name at ${width}px`)
      await page.screenshot({ path: `${OUT}/${s.name}-dashboard-long-name-${width}.png`, fullPage: true })
    }
    await page.unroute(isDashGet, rename)
    await page.setViewportSize(s.viewport)
    await page.reload()
    await dashCar().waitFor()
  })
  await step('predicted-due', async () => {
    // PRED-1 AC3-AC5: "Around <date>" on tasks with a predicted date, the car page's hint, both following a quick entry and Mark done without a reload.
    const today = await localDate()
    const plus = (n) => new Date(Date.parse(today) + n * 864e5).toISOString().slice(0, 10)
    const P = he
      ? { around: (x) => `בערך ב־${x}`, hint: (v, u) => `התאריכים מחושבים לפי ממוצע של ${v} ${u} ליום`, km: 'ק״מ', mi: 'מייל' }
      : { around: (x) => `Around ${x}`, hint: (v, u) => `Dates based on ${v} ${u} a day`, km: 'km', mi: 'mi' }
    const fmt = (iso) => page.evaluate(([d, l]) => new Date(d).toLocaleDateString(l, { dateStyle: 'medium', timeZone: 'UTC' }), [iso, s.lng])
    const id = (await apiCall('POST', '/vehicles', { nickname: 'Pred car', initialOdometerKm: 50000, readingDate: plus(-100) })).id
    // All three due soon after the 53,000 reading (50%), so the dashboard lists them: it shows only tasks that need attention.
    const task = (name, intervalKm, intervalDays, lastKm) =>
      apiCall('POST', `/vehicles/${id}/tasks`, { name, category: 'Other', intervalKm, intervalDays, dueSoonPercent: 50, lastDoneOdometerKm: lastKm, lastDoneDate: plus(-100) })
    await task('Oil', 5000, null, 49000) // 1,000 km left after the 53,000 reading: 34 days at 30 km a day
    await task('Belt', 100000, null, 0) // 47,000 km left, more than 2 years out: no date
    await task('Wipers', null, 180, 50000) // time only: no date
    const card = page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Pred car', exact: true }) })
    const row = (loc, name) => loc.locator('.tasks > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
    const dates = (loc) => loc.locator('.predicted').allTextContents().then((x) => x.map(plain))
    // One reading, no average: no dates, no hint.
    await page.goto(`${BASE}/cars/${id}`)
    await row(page, 'Oil').waitFor()
    if ((await page.locator('.predicted, .predicted-basis').count())) throw new Error('a date or hint without an average')
    await page.click('header a.brand')
    await card.waitFor()
    await page.evaluate(() => { window.noReload = true })
    if ((await dates(card)).length) throw new Error('a dashboard date without an average')
    // A quick entry sets the average (30 km a day): the Oil row gets its date, the others none.
    await card.locator('.quick input[type=number]').fill('53000')
    await card.locator('.quick button').click()
    const want = P.around(await fmt(plus(34)))
    await page.waitForFunction(([id, w]) => [...document.querySelectorAll(`.cars > li[data-id="${id}"] .predicted`)].some((p) => p.textContent.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim() === w), [id, want], { timeout: 5000 })
      .catch(async () => { throw new Error(`after the quick entry: ${JSON.stringify(await dates(card))}, want "${want}"`) })
    if (JSON.stringify(await dates(card)) !== JSON.stringify([want])) throw new Error(`dashboard dates ${JSON.stringify(await dates(card))}`)
    // AC4: beside Mark done without overlapping it, no overflow.
    const hit = await row(card, 'Oil').evaluate((li) => {
      const a = li.querySelector('.predicted').getBoundingClientRect(), b = li.querySelector('button.done').getBoundingClientRect()
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    })
    if (hit) throw new Error('the date overlaps Mark done')
    await noOverflow('a predicted date on the dashboard')
    // Mark done: 5,000 km left, 167 days.
    await row(card, 'Oil').locator('button.done').click()
    const want2 = P.around(await fmt(plus(167)))
    await page.waitForFunction(([id, w]) => [...document.querySelectorAll(`.cars > li[data-id="${id}"] .predicted`)].some((p) => p.textContent.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim() === w), [id, want2], { timeout: 5000 })
      .catch(async () => { throw new Error(`after Mark done: ${JSON.stringify(await dates(card))}, want "${want2}"`) })
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
    await page.screenshot({ path: `${OUT}/${s.name}-predicted-dashboard.png`, fullPage: true })
    // LOW-10 AC6 (L205): Mark done centred on the whole task, with a date (Oil, which now has Undo) and without (Belt, Wipers);
    // a task without a date keeps its rows (name, progress bar, remaining: 3 since the 2026-11-06 redesign); Undo spans the row.
    const layout = (name) => row(card, name).evaluate((li) => {
      const box = (el) => el.getBoundingClientRect()
      const parts = [...li.children].filter((c) => !c.matches('button.done, .undo, .error')).map(box)
      const top = Math.min(...parts.map((r) => r.top)), bottom = Math.max(...parts.map((r) => r.bottom)), b = box(li.querySelector('button.done'))
      const cs = getComputedStyle(li), undo = li.querySelector('.undo')
      return { off: Math.abs((b.top + b.bottom - top - bottom) / 2), rows: cs.gridTemplateRows.split(' ').length - (undo ? 1 : 0),
        undoShort: undo ? box(li).width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - box(undo).width : 0 }
    })
    for (const w of [...new Set([s.viewport.width, 390, 360])]) {
      await page.setViewportSize({ width: w, height: s.viewport.height })
      for (const [name, rows] of [['Oil', 4], ['Belt', 3], ['Wipers', 3]]) {
        const l = await layout(name)
        if (l.off > 1.5 || l.rows !== rows || l.undoShort > 1) throw new Error(`${name} at ${w}px: ${JSON.stringify(l)}, want ${rows} rows`)
      }
      await noOverflow(`dashboard task rows at ${w}px`)
      await page.screenshot({ path: `${OUT}/${s.name}-mark-done-centred-${w}.png`, fullPage: true })
    }
    await page.setViewportSize(s.viewport)
    // L208: the date text takes no focus, Tab goes through the row's controls in DOM order, and each shows its focus ring.
    const keyPath = async (li, what) => {
      const focusable = await page.locator('.predicted, .predicted-basis').evaluateAll((ps) => ps.some((p) => p.tabIndex >= 0 || p.querySelector('a, button, input, select, textarea, [tabindex]')))
      if (focusable) throw new Error(`${what}: the date text is focusable`)
      const n = await li.evaluate((el) => [...el.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]')].filter((x) => x.tabIndex >= 0).map((x, i) => (x.dataset.k = i)).length)
      await li.locator('[data-k="0"]').focus()
      await page.keyboard.press('Shift+Tab')
      for (let i = 0; i < n; i++) {
        await page.keyboard.press('Tab')
        const f = await page.evaluate(() => {
          const a = document.activeElement, cs = getComputedStyle(a)
          return { k: a.dataset.k, html: a.outerHTML.slice(0, 80), ring: a.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }
        })
        if (f.k !== String(i) || !f.ring) throw new Error(`${what}: Tab ${i + 1} is on ${f.html} (ring ${f.ring})`)
      }
    }
    await keyPath(row(card, 'Oil'), 'dashboard row')
    // Car page: the date on Oil only, and the hint with the average.
    await card.getByRole('link', { name: 'Pred car', exact: true }).click()
    await arrivedAt('Pred car')
    await row(page, 'Oil').locator('.predicted').waitFor()
    if (plain(await row(page, 'Oil').locator('.predicted').textContent()) !== want2) throw new Error('car page date')
    if ((await page.locator('main .tasks .predicted').count()) !== 1) throw new Error('a date on a task without one')
    const hint = async () => plain(await page.locator('.predicted-basis').textContent())
    if ((await hint()) !== P.hint((30).toLocaleString(s.lng, { minimumFractionDigits: 1 }), P.km)) throw new Error(`hint "${await hint()}"`)
    await noOverflow('the hint on the car page')
    await keyPath(row(page, 'Oil'), 'car page row')
    await page.screenshot({ path: `${OUT}/${s.name}-predicted-car.png`, fullPage: true })
    // Miles: the hint in miles, the date unchanged.
    await unitIs('Mi')
    await page.goto(`${BASE}/cars/${id}`)
    await page.locator('.predicted-basis').waitFor()
    if ((await hint()) !== P.hint((18.6).toLocaleString(s.lng, { minimumFractionDigits: 1 }), P.mi)) throw new Error(`miles hint "${await hint()}"`)
    if (plain(await row(page, 'Oil').locator('.predicted').textContent()) !== want2) throw new Error('date changed with the unit')
    await page.screenshot({ path: `${OUT}/${s.name}-predicted-car-miles.png`, fullPage: true })
    await unitIs('Km')
    await apiCall('POST', `/vehicles/${id}/archive`)
    await page.click('header a.brand')
    await dashCar().waitFor()
  })
  await step('car-page-offline', async () => {
    // LOW-10 AC4 (L199): offline, the car page shows the offline message with Retry (at 390px, RTL in Hebrew); back online it loads by itself.
    const offlineMsg = inBlock('offline', 'noConnection')
    const alert = page.locator('main > .row > p[role=alert]')
    const retry = page.locator('main > .row > button', { hasText: key('retry') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { window.noReload = true })
    const url = new URL(await dashCar().getByRole('link', { name: 'Dash car', exact: true }).getAttribute('href'), BASE).href
    await ctx.setOffline(true)
    try {
      await dashCar().getByRole('link', { name: 'Dash car', exact: true }).click()
      await alert.waitFor()
      if (plain(await alert.textContent()) !== offlineMsg) throw new Error(`offline car page "${await alert.textContent()}"`)
      if (plain(await page.locator('main h1').textContent()) !== key('car')) throw new Error(`h1 "${await page.locator('main h1').textContent()}"`)
      await titleIs(key('car'))
      await noOverflow('the offline car page')
      await tall(retry, 'Retry')
      await page.screenshot({ path: `${OUT}/${s.name}-car-offline-390.png`, fullPage: true })
      // Retry while still offline: the message again, focus kept on Retry.
      await retry.click()
      await page.waitForFunction(() => !document.querySelector('main > .row > button[aria-disabled=true]'), null, { timeout: 3000 })
      if (plain(await alert.textContent()) !== offlineMsg) throw new Error('no offline message after Retry')
      await focusIs('main > .row > button', 'Retry after an offline retry')
    } finally {
      await ctx.setOffline(false)
    }
    // Back online: the car loads in place, without a reload or a navigation.
    await page.locator('main .reading').waitFor({ timeout: 5000 })
    if (plain(await page.locator('main h1').textContent()) !== 'Dash car') throw new Error('car not loaded after online')
    if (await alert.count()) throw new Error('the offline message stayed')
    if (page.url() !== url || !(await page.evaluate(() => window.noReload))) throw new Error(`reloaded or moved to ${page.url()}`)
    await focusIs('main h1', 'the h1 after the car loaded')
    await page.screenshot({ path: `${OUT}/${s.name}-car-online-390.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    await page.click('header a.brand')
    await dashCar().waitFor()
  })
  await step('dashboard-edit-link-size', async () => {
    // LOW-7 L113: the car card's Edit link is at least 44 by 44px at 390px.
    await page.setViewportSize({ width: 390, height: 844 })
    const box = await dashCar().locator('.actions a[href$="/edit"]').boundingBox()
    if (!box || box.width < 44 || box.height < 44) throw new Error(`Edit link ${box?.width}x${box?.height}px`)
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-edit-390.png` })
    await page.setViewportSize(s.viewport)
  })
  await step('dashboard-archive-fails', async () => {
    // LOW-2 L23: a failed archive shows a translated error on that card, which stays as it was, with focus back on Archive.
    const bike = page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Dash bike', exact: true }) })
    const bikeId = await bike.getAttribute('data-id')
    const archive = bike.getByRole('button', { name: he ? 'העברה לארכיון' : 'Archive', exact: true })
    await page.route('**/archive', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await archive.click()
    const alert = bike.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`archive error "${await alert.textContent()}"`)
    await focusIs(`.cars > li[data-id="${bikeId}"] .actions button`, 'Archive after a failed archive')
    if (await page.locator('main > .row [role=alert]').count()) throw new Error('a page-level error')
    if ((await bike.getAttribute('class')).includes('archived') || !(await dashCar().count())) throw new Error('the page changed')
    forget500()
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the archive error')
    await tall(archive, 'Archive')
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-archive-error.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    // LOW-3 L29: a reload clears the old archive error.
    const showArchived = page.locator('main > label.inline input')
    await showArchived.check()
    await alert.waitFor({ state: 'detached' })
    await showArchived.uncheck()
    await page.waitForLoadState('networkidle')
    // Archived for real, the card leaves the dashboard. LOW-3 L30: Archive stays disabled until the reload ends; L31: then focus is on the h1.
    let releaseGet
    const heldGet = new Promise((r) => { releaseGet = r })
    await page.route(isDashGet, async (r) => { await heldGet; await r.continue() }, { times: 1 })
    const archived = page.waitForResponse((r) => r.url().endsWith(`/vehicles/${bikeId}/archive`))
    await archive.click()
    await archived
    if (!(await archive.isDisabled())) throw new Error('Archive enabled again before the reload ended')
    releaseGet()
    await bike.waitFor({ state: 'detached' })
    await focusIs('main h1', 'h1 after archiving a card away')
  })
  // MVP5-A: checklist templates on /checklists.
  const CL = he
    ? { title: 'רשימות בדיקה', add: 'רשימת בדיקה חדשה', empty: 'עדיין אין רשימות בדיקה. אפשר ליצור רשימה ולהשתמש בה ברכבים שלך.', addItem: 'הוספת פריט',
        three: '3 פריטים', edit: 'עריכה של ', del: 'מחיקה של ', confirm: 'למחוק את רשימת הבדיקה הזו?', name: 'יש להזין שם של עד 100 תווים.', remove2: 'הסרת פריט ⁦2⁩',
        range: 'פריט 2: יש להזין מינימום ומקסימום בין -1,000,000 ל־1,000,000, עם עד 2 ספרות אחרי הנקודה. המינימום לא יכול להיות גבוה מהמקסימום.',
        up: (n) => `הזזת פריט ⁦${n}⁩ למעלה`, unit: (n) => `פריט ${n}, יחידה`, label1: 'פריט 1: יש להזין שם של עד 100 תווים.',
        range1: 'פריט 1: יש להזין מינימום ומקסימום בין -1,000,000 ל־1,000,000, עם עד 2 ספרות אחרי הנקודה. המינימום לא יכול להיות גבוה מהמקסימום.' }
    : { title: 'Checklists', add: 'New checklist', empty: 'No checklists yet. Create one to use on your cars.', addItem: 'Add item',
        three: '3 items', edit: 'Edit ', del: 'Delete ', confirm: 'Delete this checklist?', name: 'Enter a name of up to 100 characters.', remove2: 'Remove item 2',
        range: 'Item 2: Enter a min and max from -1,000,000 to 1,000,000 with up to 2 decimals, and a min not above the max.',
        up: (n) => `Move item ${n} up`, unit: (n) => `Item ${n}, Unit`, label1: 'Item 1: Enter a name of up to 100 characters.',
        range1: 'Item 1: Enter a min and max from -1,000,000 to 1,000,000 with up to 2 decimals, and a min not above the max.' }
  const clNew = page.getByRole('button', { name: CL.add, exact: true })
  const clForm = page.locator('main form')
  const clSave = clForm.locator('> .actions > button:not(.link)')
  const clRows = page.locator('main .checklists > li')
  const clRow = (name) => clRows.filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const clItem = (i) => clForm.locator('fieldset.item').nth(i)
  const clLabels = () => clForm.locator('fieldset.item').evaluateAll((fs) => fs.map((f) => f.querySelector('input').value).join())
  const clTypes = () => clForm.locator('fieldset.item select').evaluateAll((xs) => xs.map((x) => x.value).join())
  const isTemplateSave = (r) => r.url().includes('/api/checklist-templates') && ['POST', 'PUT'].includes(r.request().method())
  const forget400 = () => {
    run.badResponses = run.badResponses.filter((r) => !(r.startsWith('400 ') && r.includes('/checklist-templates')))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('status of 400'))
  }
  let clIds
  await step('checklists-empty', async () => {
    // Criterion 8: a failed load shows a translated error with Retry; Retry focuses the h1. Every load fails until unrouted (StrictMode loads twice).
    await page.route('**/api/checklist-templates', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.goto(`${BASE}/settings`)
    await page.click('main a[href="/settings/checklists"]') // a click, so the page focuses its h1
    await arrivedAt(CL.title)
    const alert = page.locator('main [role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    await page.unroute('**/api/checklist-templates')
    forget500()
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await focusIs('main h1', 'h1 after Retry')
    // The empty state offers New checklist.
    await page.getByText(CL.empty, { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await tall(clNew, 'New checklist')
    await sweep('the empty checklists page')
    await noOverflow('the empty checklists page')
  })
  await step('checklist-create', async () => {
    // Criterion 11: focus on the name when the form opens; Escape cancels and returns to New checklist.
    await clNew.click()
    await focusIs('main form input[name=name]', 'the name after New checklist')
    await page.keyboard.press('Escape')
    await focusIs('main button.add', 'New checklist after Escape')
    if (await clForm.count()) throw new Error('the form stayed open')
    await clNew.click()
    // Criterion 6: an empty name is stopped by the browser with the translated message, before any request.
    let sent = 0
    const count = (r) => { if (r.url().includes('/api/checklist-templates') && r.method() === 'POST') sent++ }
    page.on('request', count)
    await clSave.click()
    const nameMsg = await clForm.locator('input[name=name]').evaluate((el) => el.validationMessage)
    if (plain(nameMsg) !== CL.name) throw new Error(`name message "${nameMsg}"`)
    await clForm.locator('input[name=name]').fill('Monthly quick check')
    const addItem = clForm.getByRole('button', { name: CL.addItem, exact: true })
    // Criterion 4: a Checkbox, a Number with unit and range, and a Text item; focus goes to each new label.
    await addItem.click()
    await focusIs('main form fieldset.item:nth-of-type(1) input', 'the new label')
    await page.keyboard.type('Lights')
    await addItem.click()
    await focusIs('main form fieldset.item:nth-of-type(2) input', 'the second label')
    await page.keyboard.type('Tire pressure')
    if ((await clItem(1).locator('input').count()) !== 1) throw new Error('unit, min or max shown for a Checkbox item')
    await clItem(1).locator('select').selectOption('Number')
    const [unit, min, max] = [1, 2, 3].map((n) => clItem(1).locator('input').nth(n))
    if (plain(await unit.getAttribute('aria-label')) !== CL.unit(2)) throw new Error(`unit name "${await unit.getAttribute('aria-label')}"`)
    await unit.fill('bar')
    await min.fill('2.0')
    await max.fill('1.5')
    await addItem.click()
    await page.keyboard.type('Notes')
    await clItem(2).locator('select').selectOption('Text')
    page.off('request', count)
    if (sent) throw new Error('a request was sent with an empty name')
    // Min above max: the API's message on that row, tied to min and max; everything typed stays.
    await clSave.click()
    const rowAlert = clItem(1).locator('[role=alert]')
    await rowAlert.waitFor()
    if (plain(await rowAlert.textContent()) !== CL.range) throw new Error(`range error "${await rowAlert.textContent()}"`)
    if ((await min.getAttribute('aria-invalid')) !== 'true' || (await max.getAttribute('aria-describedby')) !== (await rowAlert.getAttribute('id'))) throw new Error('range error not tied to min and max')
    if ((await clForm.locator('[role=alert]').count()) !== 1) throw new Error('the error shows twice')
    forget400()
    await max.fill('2.6')
    // A negative min reads "-5.5" in Hebrew too: min and max are LTR, aligned to the page's start side.
    await min.fill('-5.5')
    const pageDir = await page.evaluate(() => document.documentElement.dir)
    for (const x of [min, max]) {
      const [dir, align] = await x.evaluate((el) => [getComputedStyle(el).direction, getComputedStyle(el).textAlign])
      if (dir !== 'ltr' || align !== (pageDir === 'rtl' ? 'right' : 'start')) throw new Error(`min/max direction ${dir} ${align}`)
    }
    // A failed save keeps the form and what was typed, with a translated error.
    await page.route('**/api/checklist-templates', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await clSave.click()
    await clForm.locator('[role=alert]', { hasText: HS.generic }).waitFor()
    forget500()
    if ((await clLabels()) !== 'Lights,Tire pressure,Notes' || (await max.inputValue()) !== '2.6') throw new Error('values lost after a failed save')
    noLatin(plain((await clForm.locator('label, legend, option').allTextContents()).join()), 'checklist form labels')
    await noOverflow('the checklist form with three items')
    await sweep('the checklist form')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-form.png`, fullPage: true })
    const res = page.waitForResponse(isTemplateSave)
    await clSave.click()
    const r = await res
    const body = r.request().postDataJSON()
    const tp = await r.json()
    if (r.status() !== 201 || body.items[0].unit !== undefined || body.items[1].minValue !== -5.5 || body.items[1].maxValue !== 2.6 || body.items[1].unit !== 'bar') throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    clIds = tp.items.map((i) => i.id)
    // Criterion 11: after Save, focus on the template's Edit.
    await focusIs(`.checklists li[data-id="${tp.id}"] button.edit`, 'Edit after Save')
    if (plain(await clRow('Monthly quick check').locator('.task-head .muted').textContent()) !== CL.three) throw new Error('item count')
    // After a reload the items are there in the same order, with the Number's unit and range (GET's 2.60 shown as 2.6).
    await page.reload()
    await clRow('Monthly quick check').getByRole('button', { name: `${CL.edit}Monthly quick check`, exact: true }).click()
    if ((await clLabels()) !== 'Lights,Tire pressure,Notes' || (await clTypes()) !== 'Check,Number,Text') throw new Error(`after reload ${await clLabels()} ${await clTypes()}`)
    if ([await unit.inputValue(), await min.inputValue(), await max.inputValue()].join() !== 'bar,-5.5,2.6') throw new Error('unit or range after reload')
    await page.keyboard.press('Escape')
    await focusIs('.checklists button.edit', 'Edit after Escape')
  })
  await step('checklist-edit', async () => {
    // Criterion 5: rename, relabel, reorder with the buttons, change a type, remove one and add one.
    await clRow('Monthly quick check').locator('button.edit').click()
    await focusIs('main form input[name=name]', 'the name on Edit')
    await clForm.locator('input[name=name]').fill('Monthly check')
    await clItem(2).locator('input').first().fill('Notes v2')
    await clForm.getByRole('button', { name: CL.up(3), exact: true }).click()
    await focusIs('main form fieldset.item:nth-of-type(2) button.up', 'Move up after moving up')
    await clForm.getByRole('button', { name: CL.up(2), exact: true }).click()
    // At the top its Move up is disabled, so focus moves to its Move down.
    await focusIs('main form fieldset.item:nth-of-type(1) button.down', 'Move down at the top')
    if ((await clLabels()) !== 'Notes v2,Lights,Tire pressure') throw new Error(`order ${await clLabels()}`)
    // Number to Text hides and clears unit, min and max; back to Number they are empty.
    await clItem(2).locator('select').selectOption('Text')
    if ((await clItem(2).locator('input').count()) !== 1) throw new Error('unit, min or max still shown')
    await clItem(2).locator('select').selectOption('Number')
    if ((await clItem(2).locator('input').evaluateAll((xs) => xs.slice(1).map((x) => x.value).join(''))) !== '') throw new Error('unit, min or max not cleared')
    await clItem(2).locator('select').selectOption('Check')
    // Remove Lights: focus goes to the row that took its place.
    await clItem(1).getByRole('button', { name: CL.remove2, exact: true }).click()
    await focusIs('main form fieldset.item:nth-of-type(2) input', 'the next label after Remove')
    await clForm.getByRole('button', { name: CL.addItem, exact: true }).click()
    await page.keyboard.type('Wipers')
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the edit form')
    await sweep('the edit form')
    const res = page.waitForResponse(isTemplateSave)
    await clSave.click()
    const r = await res
    const body = r.request().postDataJSON()
    const tp = await r.json()
    if (r.status() !== 200 || body.items[1].unit !== undefined || body.items.map((i) => i.id ?? '').join() !== `${clIds[2]},${clIds[1]},`) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    if (tp.items[0].id !== clIds[2] || tp.items[1].id !== clIds[1] || !tp.items[2].id) throw new Error('item ids not kept')
    await focusIs(`.checklists li[data-id="${tp.id}"] button.edit`, 'Edit after saving an edit')
    await page.reload()
    await clRow('Monthly check').locator('button.edit').click()
    if ((await clLabels()) !== 'Notes v2,Tire pressure,Wipers' || (await clTypes()) !== 'Text,Check,Check') throw new Error(`after reload ${await clLabels()} ${await clTypes()}`)
    await clForm.locator('> .actions > button.link').click() // Cancel
    await focusIs('.checklists button.edit', 'Edit after Cancel')
  })
  await step('checklist-delete', async () => {
    // A second template, sorted first, so deleting it moves focus to the next row's Edit.
    const token = await page.evaluate(() => localStorage.getItem('token'))
    await page.request.post(`${BASE}/api/checklist-templates`, { headers: { Authorization: `Bearer ${token}` }, data: { name: 'Another check', items: [] } })
    await page.reload()
    await clRow('Another check').waitFor()
    const del = (name) => clRow(name).getByRole('button', { name: `${CL.del}${name}`, exact: true })
    // Criterion 7: Delete asks first, with the red confirm; Escape goes back to Delete.
    await del('Another check').click()
    await clRow('Another check').getByText(CL.confirm, { exact: true }).waitFor()
    const danger = clRow('Another check').locator('button.danger')
    const bg = await danger.evaluate((el) => getComputedStyle(el).backgroundColor)
    const want = await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--danger)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c })
    if (bg !== want) throw new Error(`confirm ${bg}, want ${want}`)
    await page.setViewportSize({ width: 390, height: 844 })
    await sweep('the delete confirm')
    await noOverflow('the delete confirm')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-delete-confirm.png`, fullPage: true })
    await page.keyboard.press('Escape')
    await focusIs('.checklists > li:nth-child(1) .actions button:not(.edit)', 'Delete after Escape')
    await del('Another check').click()
    await danger.click()
    await clRow('Another check').waitFor({ state: 'detached' })
    await focusIs('.checklists > li:nth-child(1) button.edit', 'the next row\'s Edit after Delete')
    // The last one: focus goes to New checklist, and the empty state is back.
    await del('Monthly check').click()
    await clRow('Monthly check').locator('button.danger').click()
    await page.getByText(CL.empty, { exact: true }).waitFor()
    await focusIs('main button.add', 'New checklist after deleting the last')
    await page.reload()
    await page.getByText(CL.empty, { exact: true }).waitFor()
    await page.setViewportSize(s.viewport)
  })
  await step('checklist-low3', async () => {
    // LOW-3 L40: "Beta check" exists; a new "beta check" (equal but for case) sorts after it, as the API lists them.
    await apiCall('POST', '/checklist-templates', { name: 'Alpha check', items: [{ label: 'A', type: 'Check' }] })
    await apiCall('POST', '/checklist-templates', { name: 'Beta check', items: [] })
    await page.reload()
    await clRow('Beta check').waitFor()
    // L46: a Latin name follows its own direction inside the Hebrew row.
    if ((await clRow('Alpha check').locator('.name').getAttribute('dir')) !== 'auto') throw new Error('name without dir=auto')
    const [head, nameBox] = await Promise.all([clRow('Alpha check').locator('.task-head').boundingBox(), clRow('Alpha check').locator('.name').boundingBox()])
    if (Math.abs(he ? head.x + head.width - (nameBox.x + nameBox.width) : nameBox.x - head.x) > 1) throw new Error('the name is not on the start side')
    // L47: each open form has its heading.
    await clNew.click()
    const alpha = page.locator(`.checklists > li[data-id="${await clRow('Alpha check').getAttribute('data-id')}"]`)
    await alpha.locator('button.edit').click()
    const newHead = page.locator('main section > h2')
    if (plain(await newHead.textContent()) !== CL.add) throw new Error(`New heading "${await newHead.textContent()}"`)
    if (plain(await alpha.locator('h2').textContent()) !== `${CL.edit}Alpha check`) throw new Error('no Edit heading')
    await alpha.locator('form > .actions > button.link').click()
    const form = page.locator('main section form')
    const item = (i) => form.locator('fieldset.item').nth(i)
    await form.locator('input[name=name]').fill('beta check')
    // L44: an empty label is stopped by the browser with its translated, numbered message.
    await form.getByRole('button', { name: CL.addItem, exact: true }).click()
    await form.locator('> .actions > button:not(.link)').click()
    const labelMsg = await item(0).locator('input').first().evaluate((el) => el.validationMessage)
    if (plain(labelMsg) !== CL.label1) throw new Error(`empty label message "${labelMsg}"`)
    await item(0).locator('input').first().fill('X')
    await form.getByRole('button', { name: CL.addItem, exact: true }).click()
    await page.keyboard.type('Y')
    await item(1).locator('select').selectOption('Number')
    const [min, max] = [2, 3].map((n) => item(1).locator('input').nth(n))
    await min.fill('3')
    await max.fill('1')
    await form.locator('> .actions > button:not(.link)').click()
    await item(1).locator('[role=alert]').waitFor()
    forget400()
    // L41: a browser message typed as item 2 names item 1 once the row moved up; L44: the API's item error moves with its row and is renumbered.
    await min.fill('1.234')
    await form.getByRole('button', { name: CL.up(2), exact: true }).click()
    const moved = item(0).locator('[role=alert]')
    if (plain(await moved.textContent()) !== CL.range1) throw new Error(`item error after a move "${await moved.textContent()}"`)
    const movedMin = item(0).locator('input').nth(2)
    await form.locator('> .actions > button:not(.link)').click()
    const rangeMsg = await movedMin.evaluate((el) => el.validationMessage)
    if (plain(rangeMsg) !== CL.range1) throw new Error(`range message after a move "${rangeMsg}"`)
    await movedMin.fill('1')
    await item(0).locator('input').nth(3).fill('3')
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the new checklist form with headings')
    await sweep('the new checklist form with headings')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-headings.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    const res = page.waitForResponse(isTemplateSave)
    await form.locator('> .actions > button:not(.link)').click()
    if ((await res).status() !== 201) throw new Error(`save ${(await res).status()}`)
    const names = () => clRows.locator('.name').allTextContents()
    let order // the list refetches after the 201, so poll it
    for (let i = 0; i < 20 && (order = (await names()).join('|')) !== 'Alpha check|Beta check|beta check'; i++) await page.waitForTimeout(200)
    if (order !== 'Alpha check|Beta check|beta check') throw new Error(`order after Save ${order}`)
    await page.reload()
    await clRows.nth(2).waitFor()
    if ((await names()).join('|') !== order) throw new Error(`order after a reload ${(await names()).join('|')}`)
    // L42: Edit-save on a template deleted elsewhere closes the form, removes the row, and focuses the first row's Edit (L39a: it was the last row).
    const last = clRows.nth(2)
    const lastId = await last.getAttribute('data-id')
    await last.locator('button.edit').click()
    await apiCall('DELETE', `/checklist-templates/${lastId}`)
    await last.locator('form > .actions > button:not(.link)').click()
    await page.locator(`.checklists > li[data-id="${lastId}"]`).waitFor({ state: 'detached' })
    await focusIs('.checklists > li:nth-child(1) button.edit', "the first row's Edit after a gone template")
    run.badResponses = run.badResponses.filter((r) => !(r.startsWith('404 ') && r.includes('/checklist-templates/')))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('status of 404'))
    // L39: with the New form open, deleting the last row focuses the first row's Edit, and deleting the only one the h1.
    await clNew.click()
    for (const [name, target] of [['Beta check', '.checklists > li:nth-child(1) button.edit'], ['Alpha check', 'main h1']]) {
      await clRow(name).getByRole('button', { name: `${CL.del}${name}`, exact: true }).click()
      await clRow(name).locator('button.danger').click()
      await clRow(name).waitFor({ state: 'detached' })
      await focusIs(target, `focus after deleting ${name} with the New form open`)
    }
    await form.locator('input[name=name]').press('Escape')
    await page.getByText(CL.empty, { exact: true }).waitFor()
  })
  // MVP5-B: checklists on a car (Dash car), runs, run history, the dashboard's Start a checklist, and a template in use.
  const CK = he
    ? { add: 'הוספת רשימת בדיקה', none: 'עדיין אין רשימות בדיקה לרכב הזה.', noTemplates: 'עדיין אין לך רשימות בדיקה. אפשר ליצור רשימה בדף רשימות הבדיקה.',
        allAttached: 'כל רשימות הבדיקה שלך כבר משויכות לרכב הזה. אפשר ליצור רשימה נוספת.', manual: 'ידני בלבד', ok: 'תקין', off: 'לא פעילה',
        left: 'עוד 5,000 ק״מ או 30 ימים', notRun: 'עדיין לא בוצעה', runOf: (n) => `ביצוע ${n}`, editOf: (n) => `עריכה של ${n}`, removeOf: (n) => `הסרה של ${n} מהרכב`,
        title: (n, c) => `⁨${n}⁩ לרכב ⁨${c}⁩`, notOk: 'לא תקין', notOkReason: 'סומן כבעיה: לא תקין', below: 'סומן כבעיה: מתחת ל־2 bar', range: 'טווח 2 עד 2.6 bar',
        field: (l, f) => `${l}: ${f}`, flag: 'סימון כבעיה', value: 'ערך', saved3: 'הבדיקה נשמרה. סומנו 3 בעיות.', history: (n) => `היסטוריה (${n})`, flagged3: '3 בעיות',
        hasRuns: 'כבר בוצעו בדיקות לפי הרשימה הזו, ולכן אי אפשר להסיר אותה. במקום זה אפשר להשבית אותה.', confirmRun: 'למחוק את הבדיקה הזו? גם קריאת הקילומטראז׳ שלה תימחק.',
        lower: 'הקריאה נמוכה מהקריאה שלפניה', start: 'ביצוע רשימת בדיקה', startOf: (n) => `ביצוע רשימת בדיקה: ${n}`,
        inUse: 'רשימת הבדיקה משויכת לרכב, ולכן אי אפשר למחוק אותה. יש להסיר אותה מהרכב קודם.',
        item2: 'פריט 2: הערך לא מתאים לפריט.', changed: 'רשימת הבדיקה השתנתה מאז שנפתחה.', future: 'התאריך לא יכול להיות בעתיד.', progress: (n) => `נבדקו ${n} מתוך 3` }
    : { add: 'Add a checklist', none: 'No checklists on this car yet.', noTemplates: 'You have no checklists yet. Create one on the Checklists page.',
        allAttached: 'All your checklists are already on this car. Create another one.', manual: 'Manual only', ok: 'OK', off: 'Disabled',
        left: '5,000 km or 30 days left', notRun: 'Not run yet', runOf: (n) => `Run ${n}`, editOf: (n) => `Edit ${n}`, removeOf: (n) => `Remove ${n} from this car`,
        title: (n, c) => `${n} for ${c}`, notOk: 'Not OK', notOkReason: 'Flagged: Not OK', below: 'Flagged: below 2 bar', range: 'Range 2 to 2.6 bar',
        field: (l, f) => `${l}: ${f}`, flag: 'Flag', value: 'Value', saved3: 'Run saved. 3 items flagged.', history: (n) => `History (${n})`, flagged3: '3 flagged',
        hasRuns: "This checklist has runs, so it can't be removed. Turn it off instead.", confirmRun: 'Delete this run? Its odometer reading is deleted with it.',
        lower: 'This reading is lower than the reading before it', start: 'Start a checklist', startOf: (n) => `Start a checklist: ${n}`,
        inUse: "This checklist is on a car, so it can't be deleted. Remove it from the car first.",
        item2: "Item 2: This value doesn't fit the item.", changed: 'This checklist has changed since you opened it.', future: "The date can't be in the future.", progress: (n) => `${n} of 3 checked` }
  const ckSec = page.locator('section[aria-labelledby=checklists]')
  const ckRow = (name) => ckSec.locator('.car-checklists > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const ckForm = ckSec.locator('form')
  // Hebrew names carry bidi isolates around free text, so these compare the name without them.
  async function named(loc, name) {
    await loc.waitFor()
    if (plain(await loc.getAttribute('aria-label')) !== name) throw new Error(`name "${await loc.getAttribute('aria-label')}", want "${name}"`)
    return loc
  }
  const runForm = page.locator('main form')
  const runItem = (i) => runForm.locator('fieldset.item').nth(i)
  const forgetCk = (status, part) => {
    run.badResponses = run.badResponses.filter((r) => !(r.startsWith(`${status} `) && r.includes(part)))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes(`status of ${status}`))
  }
  const ckCarPath = () => `/cars/${dashCarId}`
  let monthlyTpl, monthlyId
  await step('checklist-attach', async () => {
    await page.goto(`${BASE}${ckCarPath()}`)
    // Empty states: none on the car, and no templates yet, with a link to /checklists. Escape goes back to Add a checklist.
    await ckSec.getByText(CK.none, { exact: true }).waitFor()
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    const empty = ckSec.locator('.inline-form p')
    await empty.waitFor()
    if (plain(await empty.textContent()) !== CK.noTemplates || !(await empty.locator('a[href="/settings/checklists"]').count())) throw new Error(`no templates "${await empty.textContent()}"`)
    await page.keyboard.press('Escape')
    await focusIs('section[aria-labelledby=checklists] button.add', 'Add a checklist after Escape')
    monthlyTpl = await apiCall('POST', '/checklist-templates', { name: 'Monthly quick check', items: [
      { label: 'Lights', type: 'Check' }, { label: 'Tire pressure', type: 'Number', unit: 'bar', minValue: 2, maxValue: 2.6 }, { label: 'Notes', type: 'Text' }] })
    await apiCall('POST', '/checklist-templates', { name: 'Pre-road-trip', items: [{ label: 'Spare tire', type: 'Check' }] })
    await page.reload()
    // Criterion 6: Monthly quick check every 5,000 km or 30 days; focus goes to its new Run.
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    await focusIs('section[aria-labelledby=checklists] select[name=templateId]', 'the checklist picker')
    await ckForm.locator('select[name=templateId]').selectOption({ label: 'Monthly quick check' })
    await ckForm.locator('input[name=intervalKm]').fill('5000')
    await ckForm.locator('input[name=intervalTime]').fill('30')
    await ckForm.locator('select[name=intervalUnit]').selectOption('days')
    let res = page.waitForResponse((r) => pathOf(r).endsWith(`/vehicles/${dashCarId}/checklists`) && r.request().method() === 'POST')
    await ckForm.locator('> .actions > button:not(.link)').click()
    const attached = await (await res).json()
    monthlyId = attached.id
    if (attached.intervalKm !== 5000 || attached.intervalDays !== 30 || (await res).request().postDataJSON().date !== (await localDate())) throw new Error(JSON.stringify(attached))
    await focusIs(`li[data-id="${monthlyId}"] a.run`, 'Run after attaching')
    const monthly = ckRow('Monthly quick check')
    if (plain(await monthly.locator('.badge.status').textContent()) !== CK.ok) throw new Error('no OK badge')
    if (!plain(await monthly.textContent()).includes(CK.left)) throw new Error(`row "${plain(await monthly.textContent())}"`)
    if (!plain(await monthly.textContent()).includes(CK.notRun)) throw new Error('last run shown before any run')
    // The second, manual only: no badge. The picker no longer offers the first.
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    if ((await ckForm.locator('select[name=templateId] option').allTextContents()).join() !== 'Pre-road-trip') throw new Error('an attached template is offered')
    res = page.waitForResponse((r) => pathOf(r).endsWith(`/vehicles/${dashCarId}/checklists`) && r.request().method() === 'POST')
    await ckForm.locator('> .actions > button:not(.link)').click()
    const manual = await (await res).json()
    await focusIs(`li[data-id="${manual.id}"] a.run`, 'Run after attaching manual only')
    const trip = ckRow('Pre-road-trip')
    if (await trip.locator('.badge.status').count()) throw new Error('a badge on manual only')
    if (!plain(await trip.textContent()).includes(CK.manual)) throw new Error('manual only not shown')
    // With every template attached, Add says so.
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    await ckSec.getByText(CK.allAttached.split('. ')[0] + '.', { exact: false }).waitFor()
    await page.keyboard.press('Escape')
    // Editing turns it off without a reload: no status, a Disabled badge, no Run; focus back on Edit. Then on again.
    for (const on of [false, true]) {
      await monthly.getByRole('button', { name: CK.editOf('Monthly quick check'), exact: true }).click()
      if ((await ckForm.locator('input[name=intervalTime]').inputValue()) !== '1' || (await ckForm.locator('select[name=intervalUnit]').inputValue()) !== 'months') throw new Error('30 days not shown as 1 month')
      await ckForm.locator('input[name=isEnabled]').setChecked(on)
      await ckForm.locator('> .actions > button:not(.link)').click()
      await focusIs(`li[data-id="${monthlyId}"] button.edit`, 'Edit after saving')
      if ((await monthly.locator('.badge.status').count()) !== (on ? 1 : 0) || (await monthly.locator('a.run').count()) !== (on ? 1 : 0)) throw new Error(`enabled ${on}: status or Run`)
      if (!on && !plain(await monthly.textContent()).includes(CK.off)) throw new Error('no Disabled badge')
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the checklists section')
    await sweep('the checklists section')
    await tall(monthly.locator('details > summary'), 'History')
    await page.screenshot({ path: `${OUT}/${s.name}-checklists-on-car.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
  })
  await step('checklist-run', async () => {
    const before = (await apiCall('GET', `/vehicles/${dashCarId}`)).currentOdometerKm
    await (await named(ckRow('Monthly quick check').locator('a.run'), CK.runOf('Monthly quick check'))).click()
    await arrivedAt(CK.title('Monthly quick check', 'Dash car'))
    if ((await runForm.locator('input[name=runAt]').inputValue()) !== (await localDate())) throw new Error('date is not today')
    if ((await runForm.locator('input[name=odometerKm]').inputValue()) !== '') throw new Error('odometer prefilled')
    // UX-1: the count of answered items follows the answers; a hand flag alone doesn't count.
    const progress = runForm.locator('> p.run-progress')
    const progressIs = async (n) => { if (plain(await progress.textContent()) !== CK.progress(n)) throw new Error(`progress "${await progress.textContent()}", want ${n}`) }
    await progressIs(0)
    // Criterion 7: Not OK flags Lights; 1.8 flags Tire pressure as typed, with the reason tied to the field; Notes flagged by hand.
    const notOk = runItem(0).locator('input[type=radio]').nth(1)
    if (plain(await notOk.getAttribute('aria-label')) !== CK.field('Lights', CK.notOk)) throw new Error(`radio name "${await notOk.getAttribute('aria-label')}"`)
    await notOk.check()
    if (plain(await runItem(0).locator('p.flag').textContent()) !== CK.notOkReason) throw new Error('Not OK reason')
    const value = runItem(1).locator('input[type=number]')
    if (plain(await runItem(1).locator('.muted').textContent()) !== CK.range) throw new Error(`range "${await runItem(1).locator('.muted').textContent()}"`)
    await value.pressSequentially('1.8')
    const reason = runItem(1).locator('p.flag')
    if (plain(await reason.textContent()) !== CK.below) throw new Error(`reason "${await reason.textContent()}"`)
    if (!(await value.getAttribute('aria-describedby')).includes(await reason.getAttribute('id'))) throw new Error('reason not tied to the value')
    const autoFlag = runItem(1).locator('input[type=checkbox]')
    if (!(await autoFlag.isChecked()) || !(await autoFlag.isDisabled())) throw new Error('auto flag not shown as fixed')
    await value.fill('2')
    if (await reason.count()) throw new Error('2.0 (the min) flagged')
    await value.fill('1.8')
    await progressIs(2)
    const hand = runItem(2).locator('input[type=checkbox]')
    if (plain(await hand.getAttribute('aria-label')) !== CK.field('Notes', CK.flag)) throw new Error('flag name')
    await hand.check()
    await progressIs(2)
    await runItem(2).locator('textarea').fill('Scratch')
    await progressIs(3)
    await runForm.locator('textarea[name=notes]').fill('Before the trip')
    // A lower odometer asks for a correction under the field; everything typed stays.
    await runForm.locator('input[name=odometerKm]').fill('40000')
    await runForm.locator('> .actions > button:not(.link)').click()
    const orderAlert = runForm.locator('> [role=alert]')
    await orderAlert.waitFor()
    if (!plain(await orderAlert.textContent()).startsWith(CK.lower)) throw new Error(`order error "${await orderAlert.textContent()}"`)
    await runForm.locator('> label.inline input[type=checkbox]').waitFor()
    forgetCk(400, '/runs')
    // A failed save keeps everything, with a translated error.
    await runForm.locator('input[name=odometerKm]').fill(String(before + 500))
    await page.route(at('/runs'), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await runForm.locator('> .actions > button:not(.link)').click()
    await runForm.locator('[role=alert]', { hasText: HS.generic }).waitFor()
    forget500()
    if ((await value.inputValue()) !== '1.8' || !(await notOk.isChecked()) || !(await hand.isChecked())) throw new Error('answers lost after a failed save')
    // An item error shows inside its item, with the value marked invalid; a changed checklist shows above Save.
    const fail = (body) => page.route(at('/runs'), (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(body) }), { times: 1 })
    await fail({ code: 'checklistItem.invalidValue', index: 1 })
    await runForm.locator('> .actions > button:not(.link)').click()
    const itemAlert = runItem(1).locator('[role=alert]')
    await itemAlert.waitFor()
    if (!plain(await itemAlert.textContent()).startsWith(CK.item2)) throw new Error(`item error "${await itemAlert.textContent()}"`)
    if ((await value.getAttribute('aria-invalid')) !== 'true') throw new Error('the item value is not marked invalid')
    await fail({ code: 'checklistRun.itemsChanged' })
    await runForm.locator('> .actions > button:not(.link)').click()
    const changed = runForm.locator('> [role=alert]')
    await changed.waitFor()
    if (!plain(await changed.textContent()).startsWith(CK.changed) || !(await changed.evaluate((el) => el.nextElementSibling.matches('.actions')))) throw new Error(`itemsChanged "${await changed.textContent()}"`)
    forgetCk(400, '/runs')
    // A future date is stopped in the browser, with the translated message.
    const runAt = runForm.locator('input[name=runAt]')
    let posted = false
    const onPost = (r) => { if (pathOf(r).endsWith('/runs') && r.method() === 'POST') posted = true }
    page.on('request', onPost)
    await runAt.fill(await page.evaluate(() => new Date(Date.now() + 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)))
    await runForm.locator('> .actions > button:not(.link)').click()
    const msg = await runAt.evaluate((el) => el.validationMessage)
    page.off('request', onPost)
    if (msg !== CK.future || posted) throw new Error(`future date: "${msg}", posted ${posted}`)
    await runAt.fill(await localDate())
    // LOW-3 L55: Date and Odometer stacked at 390px; side by side from 600px, their tops aligned.
    const [dateBox, odoBox] = await Promise.all([0, 1].map((i) => runForm.locator('> label').nth(i).boundingBox()))
    if (s.viewport.width >= 600 ? Math.abs(dateBox.y - odoBox.y) > 1 || odoBox.x === dateBox.x : odoBox.y < dateBox.y + dateBox.height) throw new Error(`Date ${JSON.stringify(dateBox)}, Odometer ${JSON.stringify(odoBox)}`)
    await page.setViewportSize({ width: 390, height: 844 })
    // In one read: the header turns into the tab bar just after the resize (NAV-1), moving both labels.
    const [date390, odo390] = await runForm.locator('> label').evaluateAll((ls) => ls.slice(0, 2).map((l) => l.getBoundingClientRect().toJSON()))
    if (odo390.y < date390.y + date390.height) throw new Error('Date and Odometer side by side at 390px')
    await noOverflow('the run form')
    await sweep('the run form')
    for (const r of [notOk, hand]) await tall(r.locator('xpath=..'), 'an item control')
    const [dir, align] = await value.evaluate((el) => [getComputedStyle(el).direction, getComputedStyle(el).textAlign])
    if (dir !== 'ltr' || align !== (he ? 'right' : 'start')) throw new Error(`value direction ${dir} ${align}`)
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-run-form.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    const res = page.waitForResponse((r) => pathOf(r).endsWith('/runs') && r.request().method() === 'POST')
    await runForm.locator('> .actions > button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.items[0].numberValue !== undefined || body.items[1].numberValue !== 1.8 || body.items[1].boolValue !== undefined || body.items[2].isFlagged !== true) throw new Error(JSON.stringify(body))
    // Back on the car: the status line, focus on that Run, the new odometer and last run.
    await page.waitForURL((u) => u.pathname === ckCarPath())
    const status = ckSec.locator('[role=status]', { hasText: CK.saved3.slice(0, 6) })
    await status.waitFor()
    if (plain(await status.textContent()) !== CK.saved3) throw new Error(`status "${await status.textContent()}"`)
    await focusIs(`li[data-id="${monthlyId}"] a.run`, 'Run after saving a run')
    if (digitsOnly(await odometer()) !== String(before + 500)) throw new Error(`odometer ${await odometer()}`)
    // LOW-3 L59: Save went back in history, so one Back leaves the car page (it isn't there twice) and never reopens the saved run form.
    await page.goBack()
    await page.waitForURL((u) => u.pathname !== ckCarPath())
    await page.waitForLoadState('networkidle')
    if (await page.locator('fieldset.item').count()) throw new Error(`Back went to ${page.url()}`)
    await page.goForward()
    await page.waitForURL((u) => u.pathname === ckCarPath())
    const monthly = ckRow('Monthly quick check')
    if (plain(await monthly.textContent()).includes(CK.notRun)) throw new Error('last run not updated')
    // After a reload it is all still there, without the status line.
    await page.reload()
    await monthly.waitFor()
    if (plain(await monthly.locator('details > summary').first().textContent()) !== CK.history(1)) throw new Error('history count')
    if (digitsOnly(await odometer()) !== String(before + 500)) throw new Error('odometer after reload')
    if (await ckSec.locator('[role=status]', { hasText: CK.saved3.slice(0, 6) }).count()) throw new Error('the status line came back after a reload')
  })
  await step('checklist-run-saved-load-fails', async () => {
    // LOW-5 L88 (L71): a run Save goes back to the car page, which fails to load; the next car page, reached in the app, has no "Run saved" note.
    // The Save is stubbed, so no run is added for the later steps.
    await (await named(ckRow('Monthly quick check').locator('a.run'), CK.runOf('Monthly quick check'))).click()
    await arrivedAt(CK.title('Monthly quick check', 'Dash car'))
    await runItem(0).locator('input[type=radio]').first().check()
    await runItem(1).locator('input[type=number]').fill('2.2')
    await page.route(at('/runs'), (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ run: { flaggedCount: 0 } }) }), { times: 1 })
    await page.route(`**/api/vehicles/${dashCarId}`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await runForm.locator('> .actions > button:not(.link)').click()
    await page.waitForURL((u) => u.pathname === ckCarPath())
    await page.locator('main [role=alert]').waitFor()
    forget500()
    // In the app, not a reload, so the in-memory hand-off would still be there if the failed load had kept it.
    await page.click('header a[href="/"]')
    await page.locator(`main a[href="${ckCarPath()}"]`).first().click()
    await page.waitForURL((u) => u.pathname === ckCarPath())
    await ckRow('Monthly quick check').waitFor()
    await page.waitForLoadState('networkidle')
    if (await ckSec.locator('[role=status]', { hasText: CK.saved3.slice(0, 6) }).count()) throw new Error('the Run saved note showed after the failed car page')
  })
  // MVP5-C: Dash car's to-dos, from the run's flagged items (Lights, Tire pressure, Notes) and by hand; the dashboard's open count.
  const IS = he
    ? { empty: 'אין מטלות פתוחות.', create: (l) => `יצירת מטלה: ${l}`, created: (l) => `נוצרה מטלה: ${l}`, from: (n, d) => `מקור: ${n}, ${d}`,
        done: (x) => `סימון כבוצעה: ${x}`, reopen: (x) => `פתיחה מחדש של ${x}`, edit: (x) => `עריכה של ${x}`, del: (x) => `מחיקה של ${x}`,
        doneN: (n) => `בוצעו (${n})`, doneOn: (d) => `בוצעה ב־${d}`, markedDone: (x) => `${x}: סומנה כבוצעה.`, reopened: (x) => `${x}: נפתחה מחדש.`,
        gone: 'המטלה הזו כבר נמחקה, והרשימה עודכנה.', duplicate: 'כבר יש מטלה לפריט הזה.', confirm: 'למחוק את המטלה הזו?',
        open: (n) => (n === 1 ? 'מטלה פתוחה אחת' : n === 2 ? 'שתי מטלות פתוחות' : `${n} מטלות פתוחות`) }
    : { empty: 'No open to-dos.', create: (l) => `Create to-do: ${l}`, created: (l) => `To-do created: ${l}`, from: (n, d) => `From: ${n}, ${d}`,
        done: (x) => `Done: ${x}`, reopen: (x) => `Reopen ${x}`, edit: (x) => `Edit ${x}`, del: (x) => `Delete ${x}`,
        doneN: (n) => `Done (${n})`, doneOn: (d) => `Done on ${d}`, markedDone: (x) => `${x}: marked as done.`, reopened: (x) => `${x}: reopened.`,
        gone: 'This to-do was already deleted. The list has been updated.', duplicate: 'This item already has a to-do.', confirm: 'Delete this to-do?',
        open: (n) => `${n} open to-do${n === 1 ? '' : 's'}` }
  const isSel = 'section[aria-labelledby=todos]'
  const isSec = page.locator(isSel)
  const isRow = (title) => isSec.locator('.issues > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${title}$`) }) })
  const fmtDay = (d) => page.evaluate(([d, l]) => new Date(d).toLocaleDateString(l, { dateStyle: 'medium', timeZone: 'UTC' }), [d, s.lng])
  const isPost = (r) => r.url().endsWith(`/vehicles/${dashCarId}/issues`) && r.request().method() === 'POST'
  const isPut = (r) => r.url().includes('/api/issues/') && r.request().method() === 'PUT'
  const at390 = async (what, shot) => {
    // A field focused through the resize makes Chrome scroll on the next mousedown, so the click after it misses its button.
    await page.evaluate(() => document.activeElement?.matches('input, textarea, select') && document.activeElement.blur())
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow(what)
    await sweep(what)
    await page.screenshot({ path: `${OUT}/${s.name}-${shot}.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
  }
  await step('issue-from-flag', async () => {
    // SIMP-1: saving the run made a to-do per flagged item (Lights and Tire pressure by rule, Notes by hand). They go, so the hand-made path below is tested as before.
    const auto = (await apiCall('GET', `/vehicles/${dashCarId}/issues`)).filter((i) => i.source)
    const titles = auto.filter((i) => i.source.checklistName === 'Monthly quick check').map((i) => i.title).sort()
    if (JSON.stringify(titles) !== JSON.stringify(['Monthly quick check: Lights', 'Monthly quick check: Notes', 'Monthly quick check: Tire pressure'])) throw new Error(`auto to-dos ${JSON.stringify(titles)}`)
    for (const i of auto) await apiCall('DELETE', `/issues/${i.id}`)
    await page.reload()
    // Criterion 5: the empty state first; then Create to-do on Tire pressure, prefilled, with the title changed.
    await isSec.getByText(IS.empty, { exact: true }).waitFor()
    const monthly = ckRow('Monthly quick check')
    await monthly.locator('details.run-history > summary').click()
    const runRow = monthly.locator('.run-list > li')
    await runRow.locator('summary').click()
    const item = (label) => runRow.locator('.run-items > li').filter({ hasText: label })
    const tire = item('Tire pressure')
    const tireId = await tire.getAttribute('data-id')
    const create = await named(tire.locator('button.create-issue'), IS.create('Tire pressure'))
    await create.click()
    const form = tire.locator('form')
    await focusIs(`li[data-id="${tireId}"] form input[name=title]`, 'the title after Create to-do')
    const date = await fmtDay(await localDate())
    const desc = await form.locator('textarea[name=description]').inputValue()
    // In Hebrew: an RLM and isolated parts, so the line is right to left and the date keeps its order though the value starts in Latin (LOW-5 QA).
    const wantDesc = he ? `‏⁨1.8 bar⁩, ⁨Monthly quick check⁩, ⁨${date}⁩` : `1.8 bar, Monthly quick check, ${date}`
    if ((await form.locator('input[name=title]').inputValue()) !== 'Tire pressure' || desc !== wantDesc) throw new Error(`prefilled ${JSON.stringify(desc)}`)
    if (await form.locator('textarea[name=description]').evaluate((el) => el.matches(':dir(rtl)')) !== he) throw new Error('the description is not laid out in the UI direction')
    await page.keyboard.press('Escape')
    await focusIs(`li[data-id="${tireId}"] button.create-issue`, 'Create to-do after Escape')
    await create.click()
    await form.locator('input[name=title]').fill('Inflate the tires')
    await at390('the Create to-do form', 'issue-from-flag-form')
    const res = page.waitForResponse(isPost)
    await form.locator('.actions > button:not(.link)').click()
    const created = await (await res).json()
    if (created.title !== 'Inflate the tires' || created.source?.runItemId !== tireId) throw new Error(JSON.stringify(created))
    // The item shows To-do created, with focus on it; the to-do is at the top of To-dos with its From line.
    await focusIs(`li[data-id="${tireId}"] button.to-issue`, 'To-do created after saving')
    await named(tire.locator('button.to-issue'), IS.created('Tire pressure'))
    const top = isSec.locator('.open-issues > li').first()
    await top.waitFor()
    if (plain(await top.locator('.name').textContent()) !== 'Inflate the tires' || !plain(await top.textContent()).includes(IS.from('Monthly quick check', date))) throw new Error(`to-do "${plain(await top.textContent())}"`)
    // The saved description in the row: right to left in Hebrew, with the date's day at its start (right) and the year at its end (left).
    const notes = await top.locator('p.notes').evaluate((el) => {
      const t = el.firstChild, s = t.data, box = (sub) => { const r = document.createRange(), i = s.lastIndexOf(sub); r.setStart(t, i); r.setEnd(t, i + sub.length); return r.getBoundingClientRect() }
      // Read first in RTL: on an earlier line, or further right on the same line (the text may wrap at 390px).
      const first = (a, b) => { const [p, q] = [box(a), box(b)]; return p.bottom <= q.top + 1 || (Math.abs(p.top - q.top) < 2 && p.x > q.x) }
      const year = String(new Date().getFullYear())
      return { rtl: el.matches(':dir(rtl)'), dayRightOfYear: first(String(new Date().getDate()), year), valueRightOfName: first('1.8', 'Monthly') }
    })
    if (he && !(notes.rtl && notes.dayRightOfYear && notes.valueRightOfName)) throw new Error(`description layout ${JSON.stringify(notes)}`)
    // To-do created moves focus to that to-do.
    await tire.locator('button.to-issue').click()
    await focusIs(`${isSel} li[data-id="${created.id}"] button.edit`, 'the to-do after To-do created')
    // Criterion 8: Lights got a to-do in another tab; Save reloads the history with a note, and Lights shows To-do created.
    const lights = item('Lights')
    const lightsId = await lights.getAttribute('data-id')
    await lights.locator('button.create-issue').click()
    await apiCall('POST', `/vehicles/${dashCarId}/issues`, { title: 'Lights', sourceRunItemId: lightsId })
    await lights.locator('form .actions > button:not(.link)').click()
    await focusIs(`li[data-id="${lightsId}"] button.to-issue`, 'To-do created after a duplicate')
    if (plain(await monthly.locator('details.run-history > [role=status]').textContent()) !== IS.duplicate) throw new Error('no duplicate note')
    forgetCk(409, '/issues')
    await isRow('Lights').waitFor()
    // A reload keeps it all; Notes (no to-do yet) still offers Create to-do.
    await page.reload()
    await monthly.locator('details.run-history > summary').click()
    await runRow.locator('summary').click()
    for (const [l, cls] of [['Tire pressure', 'to-issue'], ['Lights', 'to-issue'], ['Notes', 'create-issue']]) await item(l).locator(`button.${cls}`).waitFor()
    await isSec.locator('.open-issues > li').nth(1).waitFor()
    if ((await isSec.locator('.open-issues > li').count()) !== 2) throw new Error('not 2 open to-dos')
    await at390('the run history with to-dos', 'issue-from-flag')
  })
  await step('issue-manual', async () => {
    // Criterion 8: a failed load shows the translated error with Retry, which focuses the h2.
    const fail500 = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    await page.route('**/issues', (r) => (r.request().method() === 'GET' ? fail500(r) : r.fallback()))
    await page.reload()
    const alert = isSec.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    await page.unroute('**/issues')
    forget500()
    await isSec.getByRole('button', { name: HS.retry, exact: true }).click()
    await focusIs('#todos', 'the To-dos h2 after Retry')
    // Criterion 11: Add focuses the title; Escape goes back to Add.
    const add = isSec.locator('button.add')
    await add.click()
    await focusIs(`${isSel} form input[name=title]`, 'the title after Add a to-do')
    await page.keyboard.press('Escape')
    await focusIs(`${isSel} button.add`, 'Add a to-do after Escape')
    await add.click()
    const form = isSec.locator('form')
    await form.locator('input[name=title]').fill('Wash the car')
    await form.locator('textarea[name=description]').fill('Inside too')
    // A failed save keeps what was typed, with the translated error by the form.
    await page.route('**/issues', fail500, { times: 1 })
    await form.locator('.actions > button:not(.link)').click()
    await form.locator('[role=alert]', { hasText: HS.generic }).waitFor()
    forget500()
    if ((await form.locator('input[name=title]').inputValue()) !== 'Wash the car' || (await form.locator('textarea').inputValue()) !== 'Inside too') throw new Error('typed text lost')
    await at390('the Add a to-do form', 'issue-add-form')
    let res = page.waitForResponse(isPost)
    await form.locator('.actions > button:not(.link)').click()
    const x = await (await res).json()
    await focusIs(`${isSel} li[data-id="${x.id}"] button.edit`, 'the new to-do')
    if ((await isSec.locator('.open-issues > li').first().getAttribute('data-id')) !== x.id) throw new Error('the new to-do is not at the top')
    const row = () => isSec.locator(`li[data-id="${x.id}"]`)
    // Criterion 6: Done moves it under Done (1) with today's date, announced, with focus on its Reopen.
    const today = await localDate()
    res = page.waitForResponse(isPut)
    await (await named(row().locator('button.done'), IS.done('Wash the car'))).click()
    const body = (await res).request().postDataJSON()
    if (body.status !== 'Done' || body.resolvedAt !== today || body.title !== 'Wash the car' || body.description !== 'Inside too') throw new Error(JSON.stringify(body))
    await focusIs(`${isSel} .done-issues li[data-id="${x.id}"] button.reopen`, 'Reopen after Done')
    if (plain(await isSec.locator('details > summary').textContent()) !== IS.doneN(1)) throw new Error('no Done (1)')
    if (!plain(await row().textContent()).includes(IS.doneOn(await fmtDay(today)))) throw new Error(`done row "${plain(await row().textContent())}"`)
    if (plain(await isSec.locator('> [role=status]').textContent()) !== IS.markedDone('Wash the car')) throw new Error('Done not announced')
    await at390('the done to-dos', 'issue-done')
    // Reopen: back in the open list, focus on its Done.
    res = page.waitForResponse(isPut)
    await (await named(row().locator('button.reopen'), IS.reopen('Wash the car'))).click()
    if ((await res).request().postDataJSON().status !== 'Open') throw new Error('Reopen sent no Open')
    await focusIs(`${isSel} .open-issues li[data-id="${x.id}"] button.done`, 'Done after Reopen')
    if (plain(await isSec.locator('> [role=status]').textContent()) !== IS.reopened('Wash the car') || (await isSec.locator('details').count())) throw new Error('Reopen not shown')
    // Edit: prefilled; Save renames it with focus back on Edit.
    await (await named(row().locator('button.edit'), IS.edit('Wash the car'))).click()
    await focusIs(`${isSel} li[data-id="${x.id}"] input[name=title]`, 'the title after Edit')
    await row().locator('input[name=title]').fill('Wash and vacuum')
    await row().locator('form .actions > button:not(.link)').click()
    await focusIs(`${isSel} li[data-id="${x.id}"] button.edit`, 'Edit after saving')
    await isRow('Wash and vacuum').waitFor()
    // Criterion 8: deleted in another tab: Done reloads the list with a note.
    await page.route(`**/issues/${x.id}`, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'issue.notFound' }) }), { times: 1 })
    await row().locator('button.done').click()
    await isSec.locator('> [role=status]', { hasText: IS.gone }).waitFor()
    forgetCk(404, '/issues/')
    // Delete: the red confirm; Escape goes back to Delete; then focus on the next row's Edit.
    const del = await named(row().locator('.actions button:not(.done, .edit)'), IS.del('Wash and vacuum'))
    await del.click()
    await isSec.getByText(IS.confirm, { exact: true }).waitFor()
    await at390('the to-do delete confirm', 'issue-delete-confirm')
    await page.keyboard.press('Escape')
    await focusIs(`${isSel} li[data-id="${x.id}"] .actions button:not(.done, .edit)`, 'Delete after Escape')
    await del.click()
    await row().locator('button.danger').click()
    await row().waitFor({ state: 'detached' })
    await focusIs(`${isSel} .open-issues > li:nth-child(1) button.edit`, "the next row's Edit after Delete")
  })
  await step('checklist-run-history', async () => {
    // The template item is renamed; the run keeps the label it had.
    await apiCall('PUT', `/checklist-templates/${monthlyTpl.id}`, { name: 'Monthly quick check', items: monthlyTpl.items.map((i) => ({ ...i, label: i.label === 'Tire pressure' ? 'Tyre pressure' : i.label })) })
    await page.reload()
    const monthly = ckRow('Monthly quick check')
    await monthly.locator('details.run-history > summary').click()
    const runRow = monthly.locator('.run-list > li')
    await runRow.waitFor()
    if (!plain(await runRow.locator('summary').textContent()).includes(CK.flagged3) || !(await runRow.textContent()).includes('Before the trip')) throw new Error(`run "${plain(await runRow.textContent())}"`)
    await runRow.locator('summary').click()
    const items = (await runRow.locator('.run-items > li').allTextContents()).map(plain)
    if (items.length !== 3 || !(items[1].startsWith('Tire pressure') && items[1].includes('1.8 bar')) || (await runRow.locator('.run-items > li > .flag').count()) !== 3) throw new Error(`items ${JSON.stringify(items)}`)
    // LOW-3 review: the number and unit are separate isolates, so the unit follows the number in the reading direction (left of it in Hebrew).
    const [num, unit] = await Promise.all([/^1\.8$/, /^bar$/].map((v) => runRow.locator('.run-items > li bdi', { hasText: v }).boundingBox()))
    if ((unit.x < num.x) !== (s.lng === 'he')) throw new Error(`unit "bar" at x ${unit.x}, number at x ${num.x}`)
    // LOW-3 L60: Notes gets a to-do, deleted in To-dos on this page; its "To-do created" then says so and turns back into Create to-do.
    const notes = runRow.locator('.run-items > li').filter({ hasText: 'Notes' })
    const notesId = await notes.getAttribute('data-id')
    await notes.locator('button.create-issue').click()
    await notes.locator('form input[name=title]').fill('Fix the scratch')
    await notes.locator('form .actions > button:not(.link)').click()
    await focusIs(`li[data-id="${notesId}"] button.to-issue`, 'To-do created on Notes')
    const scratch = isRow('Fix the scratch')
    await scratch.locator('.actions button:not(.done, .edit)').click()
    await scratch.locator('button.danger').click()
    await scratch.waitFor({ state: 'detached' })
    await notes.locator('button.to-issue').click()
    await focusIs(`li[data-id="${notesId}"] button.create-issue`, 'Create to-do after its to-do was deleted')
    const runNote = monthly.locator('details.run-history > [role=status]')
    if (plain(await runNote.textContent()) !== IS.gone) throw new Error(`gone note "${await runNote.textContent()}"`)
    // Remove with runs: the translated hasRuns message, and the row stays.
    await (await named(monthly.locator(':scope > .actions button:not(.edit)'), CK.removeOf('Monthly quick check'))).click()
    await monthly.locator('button.danger').click()
    const alert = monthly.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== CK.hasRuns) throw new Error(`remove error "${await alert.textContent()}"`)
    forgetCk(409, '/vehicle-checklists/')
    await page.keyboard.press('Escape')
    // Delete the run: the red confirm; Escape goes back to Delete; then the odometer goes back and focus moves to the history.
    await runRow.locator('button.delete-run').click()
    await runRow.getByText(CK.confirmRun, { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the run history')
    await sweep('the run history')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-run-history.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    await page.keyboard.press('Escape')
    await focusIs(`li[data-id="${monthlyId}"] button.delete-run`, 'Delete after Escape')
    const before = digitsOnly(await odometer())
    await runRow.locator('button.delete-run').click()
    await runRow.locator('button.danger').click()
    await runRow.waitFor({ state: 'detached' })
    await focusIs(`li[data-id="${monthlyId}"] details.run-history > summary`, 'History after deleting the last run')
    // LOW-3 L61: deleting a run clears the history's note.
    if (await runNote.count()) throw new Error('the run history note outlived the run delete')
    await page.waitForFunction((b) => document.querySelector('.odometer').getAttribute('aria-label').replace(/\D/g, '') !== b, before, { timeout: 5000 })
    await page.waitForFunction(([id, w]) => document.querySelector(`li[data-id="${id}"] details.run-history > summary`).textContent.replace(/[⁦-⁩]/g, '') === w, [monthlyId, CK.history(0)], { timeout: 5000 })
    // SIMP-1: the run's open to-dos go with it (they were made from its flagged items).
    await isSec.locator('.open-issues > li').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => { throw new Error("the run's open to-dos stayed") })
    // Two to-dos by hand, for the dashboard's open to-do count below.
    for (const title of ['Wash the car', 'Check the wipers']) await apiCall('POST', `/vehicles/${dashCarId}/issues`, { title })
  })
  // FILE-3: photos on a saved run, on Monthly quick check (no runs after checklist-run-history). Two images go to the real API and R2
  // (with FILE-1's and FILE-2's 6 uploads, 8 of this user's 10 per 10 minutes); the run is deleted at the end, with its photos, and
  // again in a finally. Client checks send nothing; the server errors, 10 photos, no storage, the archived car and the stale link are mocked.
  const RF = {
    addPhotos: key('addPhotos'), add: key('addPhoto'), confirm: key('confirmDeletePhoto'), deletedToo: key('photosDeletedToo'), list: key('photos'),
    count: (n) => (n === 2 ? key('photoCount_two') : key('photoCount_other')).replace('{{count, number}}', n.toLocaleString(s.lng)),
    // L137: the type error on a run says photo.
    tooLarge: inBlock('file', 'tooLarge'), unsupported: inBlock('runPhoto', 'unsupportedType'), unavailable: inBlock('file', 'storageUnavailable'),
    tooMany: inBlock('runPhoto', 'tooMany'), quota: AF.quota, max: key('photosMax'), runConfirm: key('confirmDeleteRun'), readingToo: key('runReadingDeletedToo'), conflict: inBlock('concurrency', 'conflict'), rate: PH.tooMany,
    notFound: inBlock('runPhoto', 'notFound'), archived: inBlock('runPhoto', 'vehicleArchived'),
  }
  let photoRunId, photoReading
  const RUNROW = () => `.run-list > li[data-id="${photoRunId}"]`
  const PF = () => `${RUNROW()} .files`
  const PADD = () => `${PF()} button.add-file`
  const runPhotoRequests = []
  page.on('request', (r) => r.url().includes('/checklist-runs/') && r.url().includes('/attachments') && runPhotoRequests.push(r.method()))
  async function choosePhoto(file) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(PADD())])
    await chooser.setFiles(file)
  }
  async function photoErrorIs(want, what) {
    let got
    for (const end = Date.now() + 5000; Date.now() < end; await page.waitForTimeout(100)) {
      got = plain((await page.locator(`${PF()} p.error[role=alert]`).textContent({ timeout: 5000 }).catch(() => '')) ?? '')
      if (got === want) return
    }
    throw new Error(`${what}: "${got}"`)
  }
  const runPhotoName = `${'tyre-photo-'.repeat(11)}.png` // 125 characters, no spaces
  const runPhotoHe = 'צמיג שחוק בצד ימין.jpg'
  await step('run-photos', async () => {
    try {
      // Save a run; the confirmation offers Add photos, which opens that run with focus on its Add photo.
      await page.goto(`${BASE}${ckCarPath()}`)
      await ckRow('Monthly quick check').locator('a.run').click()
      await arrivedAt(CK.title('Monthly quick check', 'Dash car'))
      await runItem(0).locator('input[type=radio]').first().check()
      await runItem(1).locator('input[type=number]').fill('2.2')
      const saved = page.waitForResponse((r) => pathOf(r).endsWith('/runs') && r.request().method() === 'POST')
      await runForm.locator('> .actions > button:not(.link)').click()
      ;({ id: photoRunId, odometerReadingId: photoReading } = (await (await saved).json()).run)
      await page.waitForURL((u) => u.pathname === ckCarPath())
      const addPhotos = ckSec.locator('button.add-photos')
      await addPhotos.waitFor()
      if (plain(await addPhotos.textContent()) !== RF.addPhotos) throw new Error(`button "${await addPhotos.textContent()}"`)
      await tall(addPhotos, 'Add photos')
      await addPhotos.click()
      await focusIs(PADD(), 'Add photo after Add photos')
      // A second tap after the run was closed opens it again.
      await page.locator(`${RUNROW()} summary`).click()
      await page.locator(PADD()).waitFor({ state: 'hidden' })
      await addPhotos.click()
      await focusIs(PADD(), 'Add photo after a second Add photos')
      if (plain(await page.locator(PADD()).textContent()) !== RF.add) throw new Error(`Add photo "${await page.locator(PADD()).textContent()}"`)
      const input = page.locator(`${PF()} input[type=file]`)
      if ((await input.getAttribute('accept')) !== 'image/jpeg,image/png,image/webp' || (await input.getAttribute('capture')) !== null) throw new Error('accept or capture')
      if (await page.locator(`${PF()} ul`).count()) throw new Error('a list shows with no photos')
      if (await page.locator(`${RUNROW()} summary .photo-count`).count()) throw new Error('a count with no photos')
      // Client checks: nothing is sent.
      runPhotoRequests.length = 0
      await choosePhoto({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(12_000_000) })
      await photoErrorIs(RF.tooLarge, '12 MB photo')
      await choosePhoto({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf })
      await photoErrorIs(RF.unsupported, 'a PDF')
      await focusIs(PADD(), 'Add photo after the type error')
      if (runPhotoRequests.length) throw new Error(`requests sent: ${runPhotoRequests}`)
      // Two real uploads, one at a time; focus back on Add photo after each.
      const post = () => page.waitForResponse((r) => r.url().endsWith('/attachments') && r.request().method() === 'POST')
      for (const [i, file] of [[0, { name: runPhotoName, mimeType: 'image/png', buffer: await image('image/png') }], [1, { name: runPhotoHe, mimeType: 'image/jpeg', buffer: await image('image/jpeg') }]]) {
        const res = post()
        await choosePhoto(file)
        if ((await res).status() !== 200) throw new Error(`upload ${i}: ${(await res).status()}`)
        await page.locator(`${PF()} li >> nth=${i}`).waitFor()
        await focusIs(PADD(), `Add photo after upload ${i}`)
      }
      if (await page.locator(`${PF()} p.error`).count()) throw new Error('the error stayed after the uploads')
      // After a reload: the count on the collapsed row, then both photos in order, opening in a new tab.
      await page.reload()
      const monthly = ckRow('Monthly quick check')
      await monthly.locator('details.run-history > summary').click()
      const count = page.locator(`${RUNROW()} summary .photo-count`)
      await count.waitFor()
      if (plain(await count.textContent()) !== RF.count(2)) throw new Error(`count "${await count.textContent()}"`)
      await page.locator(`${RUNROW()} summary`).click()
      const names = await page.locator(`${PF()} li a bdi`).allTextContents()
      if (JSON.stringify(names) !== JSON.stringify([runPhotoName, runPhotoHe])) throw new Error(`names ${JSON.stringify(names)}`)
      if (plain(await page.locator(`${PF()} > span.muted`).textContent()) !== RF.list) throw new Error('the Photos label')
      for (const [i, type] of [[0, 'image/png'], [1, 'image/jpeg']]) {
        const r = await page.request.get(await page.locator(`${PF()} li a >> nth=${i}`).getAttribute('href'))
        if (r.status() !== 200 || r.headers()['content-type'] !== type) throw new Error(`photo ${i}: ${r.status()} ${r.headers()['content-type']}`)
      }
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.click(`${PF()} li a >> nth=0`)])
      await popup.waitForURL((u) => u.pathname.endsWith('.png'), { timeout: 10000 })
      await popup.close()
      await page.setViewportSize({ width: 390, height: 844 })
      await noOverflow('a 125-character and a Hebrew photo name in a run')
      await sweep('a run with photos at 390px')
      await page.screenshot({ path: `${OUT}/${s.name}-run-photos-390.png`, fullPage: true })
      await page.setViewportSize(s.viewport)
      // Delete one: the confirm, then focus goes to the list.
      await page.locator(`${PF()} li >> nth=0`).locator('button.link').click()
      if (plain(await page.locator(`${PF()} .inline-form p`).textContent()) !== RF.confirm) throw new Error('photo confirm text')
      await focusIs(`${PF()} .inline-form button.link`, 'Cancel on the photo confirm')
      const del = page.waitForResponse((r) => r.url().includes('/attachments/') && r.request().method() === 'DELETE')
      await page.click(`${PF()} button.danger`)
      if ((await del).status() !== 204) throw new Error(`photo delete ${(await del).status()}`)
      await page.waitForFunction((sel) => document.querySelectorAll(`${sel} li`).length === 1, PF(), { timeout: 5000 })
      await focusIs(PF(), 'the photos after a delete')
      if (plain(await count.textContent()) !== key('photoCount_one').replace('{{count, number}}', (1).toLocaleString(s.lng))) throw new Error(`count after delete "${await count.textContent()}"`)
      // The run's Delete confirm says its photos go too; afterwards the remaining photo's link is dead.
      const left = await page.locator(`${PF()} li a`).getAttribute('href')
      await page.locator(`${RUNROW()} button.delete-run`).click()
      const confirm = page.locator(`${RUNROW()} > .inline-form p`)
      if (plain(await confirm.textContent()) !== `${RF.runConfirm}${photoReading ? ` ${RF.readingToo}` : ''} ${RF.deletedToo}`) throw new Error(`run confirm "${await confirm.textContent()}"`)
      await page.screenshot({ path: `${OUT}/${s.name}-run-photos-delete-run.png`, fullPage: true })
      await page.click(`${RUNROW()} button.danger`)
      await page.locator(RUNROW()).waitFor({ state: 'detached' })
      photoRunId = null
      const gone = await page.request.get(left)
      if (gone.status() !== 404) throw new Error(`the deleted run's photo: ${gone.status()}`)
    } finally {
      if (photoRunId) await apiCall('DELETE', `/checklist-runs/${photoRunId}`).catch(() => {})
      await page.setViewportSize(s.viewport)
    }
  })
  await step('run-photos-states', async () => {
    const runsUrl = `**/api/vehicle-checklists/${monthlyId}/runs`
    const problem = (status, code, more) => ({ status, contentType: 'application/problem+json', body: JSON.stringify({ status, code, ...more }) })
    photoRunId = '00000000-0000-4000-8000-0000000000aa'
    const photo = (i, url = `https://files.test/__file/${i}.png`) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, fileName: `photo-${i}.png`, contentType: 'image/png', sizeBytes: 1_500_000 + i, url })
    const fakeRun = (attachments) => ({ id: photoRunId, vehicleChecklistId: monthlyId, runAt: '2026-01-10', odometerKm: 50000, odometerReadingId: null, notes: null, flaggedCount: 0, items: [], attachments })
    const withPhotos = (attachments) => ({ contentType: 'application/json', body: JSON.stringify([fakeRun(attachments)]) })
    const openRun = async () => {
      await page.goto(`${BASE}${ckCarPath()}`)
      await ckRow('Monthly quick check').locator('details.run-history > summary').click()
      await page.locator(`${RUNROW()} summary`).click()
    }
    try {
      await page.route('**/__file/*', (r) => r.fulfill({ contentType: 'text/plain', body: 'ok' }))
      await page.route(runsUrl, (r) => r.fulfill(withPhotos([])))
      await openRun()
      await page.locator(PADD()).waitFor()
      // Busy while uploading, then each server error with the run's wording.
      const png = await image('image/png')
      for (const [status, code, want] of [[503, 'file.storageUnavailable', RF.unavailable], [400, 'attachment.tooMany', RF.tooMany], [400, 'file.quotaExceeded', RF.quota], [400, 'attachment.vehicleArchived', RF.archived], [429, 'http.429', RF.rate], [409, 'concurrency.conflict', RF.conflict]]) {
        await page.route('**/checklist-runs/*/attachments', async (r) => { await page.waitForTimeout(600); await r.fulfill(problem(status, code, quotaBody(code))) }, { times: 1 })
        await choosePhoto(code === 'http.429' ? { name: 'r.bin', mimeType: 'application/octet-stream', buffer: png } : { name: 'r.png', mimeType: 'image/png', buffer: png })
        await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-busy') === 'true', PADD(), { timeout: 3000 })
        if (plain(await page.locator(PADD()).textContent()) !== PH.uploading) throw new Error(`busy button "${await page.locator(PADD()).textContent()}"`)
        await photoErrorIs(want, code)
        if ((await page.getAttribute(PADD(), 'aria-busy')) !== 'false') throw new Error(`still busy after ${code}`)
        await focusIs(PADD(), `Add photo after ${code}`)
      }
      // L131/L140: a 409 reloads the runs (another upload's photo shows); when that reload fails too, both messages show, the conflict first.
      await page.route('**/checklist-runs/*/attachments', (r) => r.fulfill(problem(409, 'concurrency.conflict')), { times: 1 })
      await page.route(runsUrl, (r) => r.fulfill(withPhotos([photo(7)])), { times: 1 })
      await choosePhoto({ name: 'r.png', mimeType: 'image/png', buffer: png })
      await photoErrorIs(RF.conflict, '409 with a reload')
      await page.locator(`${PF()} li`).waitFor()
      await page.route('**/checklist-runs/*/attachments', (r) => r.fulfill(problem(409, 'concurrency.conflict')), { times: 1 })
      await page.route(runsUrl, (r) => r.fulfill(problem(500, 'http.500')), { times: 1 })
      await choosePhoto({ name: 'r.png', mimeType: 'image/png', buffer: png })
      await photoErrorIs(`${RF.conflict} ${AF.generic}`, '409 and a failed reload')
      await focusIs(PADD(), 'Add photo after the 409 and a failed reload')
      // L136: the run Delete confirm names the reading and the photos only when the run has them.
      for (const [more, want] of [
        [{}, RF.runConfirm],
        [{ odometerReadingId: '00000000-0000-4000-8000-0000000000bb' }, `${RF.runConfirm} ${RF.readingToo}`],
        [{ attachments: [photo(1)] }, `${RF.runConfirm} ${RF.deletedToo}`],
        [{ odometerReadingId: '00000000-0000-4000-8000-0000000000bb', attachments: [photo(1)] }, `${RF.runConfirm} ${RF.readingToo} ${RF.deletedToo}`],
      ]) {
        await page.route(runsUrl, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ ...fakeRun([]), ...more }]) }))
        await openRun()
        await page.locator(`${RUNROW()} button.delete-run`).click()
        const got = plain(await page.locator(`${RUNROW()} > .inline-form p`).textContent())
        if (got !== want) throw new Error(`run confirm "${got}", want "${want}"`)
      }
      // 10 photos, some without storage or with a non-https URL: no Add photo but the max sentence (L127), those names plain text; long names fit at 390px.
      await page.route(runsUrl, (r) => r.fulfill(withPhotos([...Array(10)].map((_, i) => ({ ...photo(i, { 1: null, 3: `http://files.test/__file/${i}.png` }[i]), ...(i === 4 && { fileName: runPhotoName }), ...(i === 5 && { fileName: runPhotoHe }) })))))
      await openRun()
      await page.locator(`${PF()} li >> nth=9`).waitFor()
      if (await page.locator(PADD()).count()) throw new Error('Add photo shows with 10 photos')
      if (plain(await page.locator(`${PF()} > p.muted`).textContent()) !== RF.max) throw new Error('no max sentence at 10 photos')
      if ((await page.getByRole('link', { name: `photo-0.png ${AF.newTab}`, exact: true }).count()) !== 1) throw new Error('the photo link does not announce the new tab')
      if ((await page.locator(`${PF()} li a`).count()) !== 8) throw new Error('photos without an https URL are links')
      if (plain(await page.locator(`${RUNROW()} summary .photo-count`).textContent()) !== RF.count(10)) throw new Error('count of 10')
      await page.setViewportSize({ width: 390, height: 844 })
      await noOverflow('10 photos with long names')
      await sweep('10 photos')
      await page.screenshot({ path: `${OUT}/${s.name}-run-photos-ten.png`, fullPage: true })
      await page.setViewportSize(s.viewport)
      // A photo deleted elsewhere: the message, and it leaves the list.
      await page.route('**/checklist-runs/*/attachments/*', (r) => r.fulfill(problem(404, 'attachment.notFound')), { times: 1 })
      await page.locator(`${PF()} li >> nth=0`).locator('button.link').click()
      await page.click(`${PF()} button.danger`)
      await photoErrorIs(RF.notFound, '404 on delete')
      if ((await page.locator(`${PF()} li`).count()) !== 9) throw new Error('the missing photo stayed')
      // An archived car: no Add photo, Delete works.
      await page.route(`**/api/vehicles/${dashCarId}`, async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, json: { ...(await res.json()), isArchived: true } }) })
      await page.route(runsUrl, (r) => r.fulfill(withPhotos([photo(1)])))
      await openRun()
      await page.locator(`${PF()} li`).waitFor()
      if (await page.locator(PADD()).count()) throw new Error('Add photo shows on an archived car')
      await page.route('**/checklist-runs/*/attachments/*', (r) => r.fulfill({ status: 204 }), { times: 1 })
      await page.locator(`${PF()} li button.link`).click()
      await page.click(`${PF()} button.danger`)
      await page.locator(`${PF()} ul`).waitFor({ state: 'detached' })
      await focusIs(PF(), 'the photos group after the last delete on an archived car')
      // L126: after a reload, an archived car's run without photos has no Photos group.
      await page.route(runsUrl, (r) => r.fulfill(withPhotos([])))
      await openRun()
      if (await page.locator(PF()).count()) throw new Error('an empty Photos group on an archived car')
      await page.unroute(`**/api/vehicles/${dashCarId}`)
    } finally {
      await page.unroute(runsUrl)
      await page.unroute('**/checklist-runs/*/attachments')
      await page.unroute('**/checklist-runs/*/attachments/*')
      await page.unroute(`**/api/vehicles/${dashCarId}`)
      await page.unroute('**/__file/*')
    }
    // A link older than 55 minutes: Open reloads the runs first and the new tab gets the fresh URL (fake clock, own context).
    const ctx2 = await browser.newContext({ storageState: await ctx.storageState(), viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
    try {
      const p = await ctx2.newPage()
      await p.clock.install()
      let gets = 0, fresh = false
      await ctx2.route('**/__file/*', (r) => r.fulfill({ contentType: 'text/plain', body: 'ok' }))
      await p.route(runsUrl, (r) => { gets++; return r.fulfill(withPhotos([photo(1, `https://files.test/__file/${fresh ? 'fresh' : 'old'}.png`)])) })
      await p.goto(`${BASE}${ckCarPath()}`)
      await p.locator(`li[data-id="${monthlyId}"] details.run-history > summary`).click()
      await p.locator(`${RUNROW()} summary`).click()
      const link = p.locator(`${PF()} li a`)
      await link.waitFor()
      const loads = gets
      fresh = true
      await p.clock.fastForward('56:00')
      const [tab] = await Promise.all([p.waitForEvent('popup'), link.click()])
      await tab.waitForURL('**/fresh.png', { timeout: 5000 })
      if (gets !== loads + 1) throw new Error(`${gets - loads} reloads, want 1`)
      if (!(await link.getAttribute('href')).endsWith('/fresh.png')) throw new Error('the link kept the old URL')
    } finally {
      await ctx2.close()
      photoRunId = null
    }
  })
  await step('dashboard-start-checklist', async () => {
    // Criterion 9: two enabled checklists open a list, most urgent first; Escape goes back to the button.
    await page.click('header a.brand')
    await arrivedAt(T.dashboard)
    const start = dashCar().getByRole('button', { name: CK.start, exact: true })
    await start.click()
    const links = dashCar().locator('.picker a')
    if ((await links.allTextContents()).map(plain).join('|') !== `Monthly quick check${CK.ok}|Pre-road-trip`) throw new Error(`list ${(await links.allTextContents()).join('|')}`)
    await focusIs('.cars .picker a', 'the first checklist')
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the checklist list on a card')
    await sweep('the checklist list on a card')
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-start-checklist.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    await page.keyboard.press('Escape')
    await focusIs(`.cars > li[data-id="${dashCarId}"] .actions button.link`, 'Start a checklist after Escape')
    await start.click()
    await links.nth(1).click()
    await arrivedAt(CK.title('Pre-road-trip', 'Dash car'))
    // Cancel goes back where it came from.
    await runForm.locator('> .actions > button.link').click()
    await arrivedAt(T.dashboard)
    // With one enabled checklist, it opens the run page directly. Not on cars without checklists.
    await apiCall('PUT', `/vehicle-checklists/${monthlyId}`, { intervalKm: 5000, intervalDays: 30, isEnabled: false })
    await page.reload()
    await (await named(dashCar().locator('.actions a[href$="/run"]'), CK.startOf('Pre-road-trip'))).click()
    await arrivedAt(CK.title('Pre-road-trip', 'Dash car'))
    await page.goBack()
    await dashCar().waitFor()
    const others = page.locator('.cars > li').filter({ hasNot: page.getByRole('link', { name: 'Dash car', exact: true }) })
    if (await others.getByText(CK.start).count()) throw new Error('Start a checklist on a car without checklists')
  })
  await step('checklist-past-run', async () => {
    // LOW-3 L57: a real itemsChanged (the template edited while the run form is open), then a run older than the last one leaves the last run alone.
    const trip = (await apiCall('GET', `/vehicles/${dashCarId}/checklists`)).find((c) => c.name === 'Pre-road-trip')
    const tpl = await apiCall('GET', `/checklist-templates/${trip.templateId}`)
    await apiCall('POST', `/vehicle-checklists/${trip.id}/runs`, { runAt: await localDate(), items: tpl.items.map((i) => ({ templateItemId: i.id, boolValue: true, isFlagged: false })) })
    await page.goto(`${BASE}${ckCarPath()}`)
    const row = ckRow('Pre-road-trip')
    const lastRunText = () => row.locator(':scope > p.muted').nth(1).textContent()
    const lastRun = plain(await lastRunText())
    await row.locator('a.run').click()
    await arrivedAt(CK.title('Pre-road-trip', 'Dash car'))
    await apiCall('PUT', `/checklist-templates/${tpl.id}`, { name: tpl.name, items: [...tpl.items, { label: 'Jack', type: 'Check' }] })
    await runForm.locator('> .actions > button:not(.link)').click()
    const changed = runForm.locator('> [role=alert]')
    await changed.waitFor()
    if (!plain(await changed.textContent()).startsWith(CK.changed)) throw new Error(`itemsChanged "${await changed.textContent()}"`)
    forgetCk(400, '/runs')
    await page.reload()
    await runItem(1).waitFor()
    await runForm.locator('input[name=runAt]').fill(await histDay(-10))
    await runForm.locator('> .actions > button:not(.link)').click()
    await page.waitForURL((u) => u.pathname === ckCarPath())
    await focusIs(`li[data-id="${trip.id}"] a.run`, 'Run after saving a past run')
    if (plain(await lastRunText()) !== lastRun || (await row.locator('.badge.status').count())) throw new Error(`last run "${plain(await lastRunText())}", want "${lastRun}"`)
    if (plain(await row.locator('details.run-history > summary').textContent()) !== CK.history(2)) throw new Error('history count')
    // L59: one Back leaves the car page.
    await page.goBack()
    await page.waitForURL((u) => u.pathname === '/')
  })
  await step('checklist-hebrew-unit', async () => {
    // LOW-4 L68: a Hebrew unit follows its number in the reading direction too (left of it in Hebrew, right of it in English).
    const tpl = await apiCall('POST', '/checklist-templates', { name: 'Hebrew unit', items: [{ label: 'Pressure', type: 'Number', unit: 'בר' }] })
    const vc = await apiCall('POST', `/vehicles/${dashCarId}/checklists`, { templateId: tpl.id, intervalKm: null, intervalDays: null, date: await localDate() })
    const r = await apiCall('POST', `/vehicle-checklists/${vc.id}/runs`, { runAt: await localDate(), items: [{ templateItemId: tpl.items[0].id, numberValue: 2.2, isFlagged: false }] })
    await page.goto(`${BASE}${ckCarPath()}`)
    const row = ckRow('Hebrew unit')
    await row.locator('details.run-history > summary').click()
    const runRow = row.locator('.run-list > li')
    await runRow.locator('summary').click()
    const [num, unit] = await Promise.all([/^2\.2$/, /^בר$/].map((v) => runRow.locator('.run-items > li bdi', { hasText: v }).boundingBox()))
    if ((unit.x < num.x) !== he) throw new Error(`unit "בר" at x ${unit.x}, number at x ${num.x}`)
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-hebrew-unit.png`, fullPage: true })
    await apiCall('DELETE', `/checklist-runs/${r.run.id}`)
    await apiCall('DELETE', `/vehicle-checklists/${vc.id}`)
    await apiCall('DELETE', `/checklist-templates/${tpl.id}`)
    await page.goto(`${BASE}/`) // dashboard-open-issues starts on the dashboard
  })
  await step('checklist-last-run-before-attach', async () => {
    // LOW-7 L110: attached today with only an older run: "Last run on" that run's date and "Counting from" today; a run today leaves only "Last run on".
    const tpl = await apiCall('POST', '/checklist-templates', { name: 'Attached late', items: [{ label: 'Lights', type: 'Check' }] })
    const [today, old] = [await localDate(), await histDay(-30)]
    const vc = await apiCall('POST', `/vehicles/${dashCarId}/checklists`, { templateId: tpl.id, intervalKm: null, intervalDays: 60, date: today })
    const runOn = (runAt) => apiCall('POST', `/vehicle-checklists/${vc.id}/runs`, { runAt, items: [{ templateItemId: tpl.items[0].id, boolValue: true, isFlagged: false }] })
    const r1 = await runOn(old)
    if (r1.checklist.latestRunDate !== old || r1.checklist.lastRunDate !== today) throw new Error(`API latestRunDate ${r1.checklist.latestRunDate}, lastRunDate ${r1.checklist.lastRunDate}`)
    const row = ckRow('Attached late')
    const linesAre = async (want, what) => {
      await row.waitFor()
      // The list reloads after a run delete: give it a moment before reading.
      let got
      for (let i = 0; i < 10; i++) {
        got = (await row.locator(':scope > p.muted').allTextContents()).slice(1).map(plain) // after the interval line
        if (got.join('|') === want.join('|')) return
        await page.waitForTimeout(300)
      }
      throw new Error(`${what}: "${got.join('|')}", want "${want.join('|')}"`)
    }
    const lastOn = async (d) => `${he ? 'בוצעה לאחרונה ב־' : 'Last run on '}${await fmtDay(d)}`
    await page.goto(`${BASE}${ckCarPath()}`)
    await linesAre([await lastOn(old), `${he ? 'הספירה התחילה ב־' : 'Counting from '}${await fmtDay(today)}`], 'only an older run')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-counting-from.png`, fullPage: true })
    const r2 = await runOn(today)
    await page.reload()
    await linesAre([await lastOn(today)], 'with a run today')
    // LOW-8 L147: deleting the latest run in the browser brings back the older run's "Last run on" and "Counting from" the attach date.
    const latest = row.locator(`.run-list > li[data-id="${r2.run.id}"]`)
    await row.locator('details.run-history > summary').click()
    await latest.locator('button.delete-run').click()
    await latest.locator('button.danger').click()
    await latest.waitFor({ state: 'detached' })
    await linesAre([await lastOn(old), `${he ? 'הספירה התחילה ב־' : 'Counting from '}${await fmtDay(today)}`], 'after deleting the latest run')
    await apiCall('DELETE', `/checklist-runs/${r1.run.id}`)
    await apiCall('DELETE', `/vehicle-checklists/${vc.id}`)
    await apiCall('DELETE', `/checklist-templates/${tpl.id}`)
    await page.goto(`${BASE}/`) // dashboard-open-issues starts on the dashboard
  })
  await step('dashboard-open-issues', async () => {
    // Criterion 7: Dash car's 2 open to-dos link to its page; after one is marked done it shows 1; other cars show nothing.
    // Already on the dashboard after dashboard-start-checklist.
    await page.reload()
    const link = dashCar().getByRole('link', { name: IS.open(2), exact: true })
    await link.waitFor()
    if ((await link.getAttribute('href')) !== `/cars/${dashCarId}`) throw new Error(`href ${await link.getAttribute('href')}`)
    const others = page.locator('.cars > li').filter({ hasNot: page.getByRole('link', { name: 'Dash car', exact: true }) })
    if (await others.getByText(/open to-do|מטלה פתוחה|מטלות פתוחות/).count()) throw new Error('an open to-do count on a car without to-dos')
    await at390('the dashboard with open to-dos', 'dashboard-open-issues')
    await link.click()
    await arrivedAt('Dash car')
    await isSec.locator('.open-issues > li button.done').first().click()
    await isSec.locator('.done-issues > li').waitFor({ state: 'attached' })
    await page.click('header a.brand')
    await arrivedAt(T.dashboard)
    await dashCar().getByRole('link', { name: IS.open(1), exact: true }).waitFor()
  })
  await step('checklist-template-in-use', async () => {
    // Deleting a template that is on a car: the translated inUse message on its row, which stays.
    await page.goto(`${BASE}/settings`)
    await page.click('main a[href="/settings/checklists"]') // a click, so the page focuses its h1
    await arrivedAt(CL.title)
    const row = clRow('Monthly quick check')
    await row.getByRole('button', { name: `${CL.del}Monthly quick check`, exact: true }).click()
    await row.locator('button.danger').click()
    const alert = row.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== CK.inUse) throw new Error(`in use "${await alert.textContent()}"`)
    forgetCk(409, '/checklist-templates/')
    await page.reload()
    await clRow('Monthly quick check').waitFor()
  })
  // TIRE-2b: a tire per wheel on Dash car: the drawing, Replace (one, a pair, all 4, the spare), checks, rotations, edit and delete, /tires.
  const n0 = (x) => x.toLocaleString('en')
  const POS = he ? { FL: 'קדמי שמאלי', FR: 'קדמי ימני', RL: 'אחורי שמאלי', RR: 'אחורי ימני', Spare: 'גלגל רזרבי' }
    : { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right', Spare: 'Spare' }
  const low = (p) => (he ? POS[p] : { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right', Spare: 'spare' }[p])
  const TI = he
    ? { title: 'צמיגים', noTires: 'עדיין אין צמיגים ברכב הזה.', addTires: 'הוספת צמיגים', replace: 'החלפת צמיגים', noTire: 'אין צמיג', pick: 'אפשר להקיש על גלגל כדי לראות את הצמיג שלו.',
        saved: 'הצמיגים נשמרו.', savedRecord: 'הצמיגים נשמרו. לפתיחת רשומת הטיפול, שם מוסיפים את הקבלה עם הוספת קובץ.', brand: 'יש להזין יצרן של עד 50 תווים.',
        before: (n, p) => `יש להזין קילומטראז׳ של ${n0(n)} ק״מ לפחות, הקילומטראז׳ כשהורכב הצמיג (${low(p)}).`,
        dateBefore: (d, p) => `התאריך לא יכול להיות לפני ${d}, המועד שבו הורכב הצמיג (${low(p)}).`,
        kmOn: (n, u = 'ק״מ') => `${n0(n)} ${u} על הצמיג הזה`, km: (n, u = 'ק״מ') => `${n0(n)} ${u}`, record: (n) => (n === 1 ? 'צמיגים (צמיג אחד)' : n === 2 ? 'צמיגים (שני צמיגים)' : `צמיגים (${n} צמיגים)`), and: (a, b) => `${a} ו${b}`,
        replaceOf: (p) => `החלפת צמיג: ${POS[p]}`, editOf: (p) => `עריכת צמיג: ${POS[p]}`, delOf: (p) => `מחיקת צמיג: ${POS[p]}`, front: 'זוג קדמי', rear: 'זוג אחורי', all: 'כל הארבעה',
        lowTread: 'חריצים שחוקים', bar: (v) => `${v} בר`, mm: (v) => `${v} מ״מ`, newAge: 'פחות מחודש', history: (n) => `היסטוריית צמיגים (${n})`,
        confirmDel: 'למחוק את הצמיג? המחיקה נועדה לתיקון טעות: גם הבדיקות שלו יימחקו, הגלגל יישאר ריק ורשומת הטיפול תישאר.',
        rotated: 'הצמיג הזה הועבר ברוטציה. יש למחוק את הרוטציה קודם.', notLatest: 'אפשר למחוק רק את הרוטציה האחרונה. הרשימה עודכנה.',
        invalidMoves: 'יש להעביר לפחות שני צמיגים, כל אחד לגלגל שצמיג אחר פינה.', notRecorded: 'הגלגלים לא נרשמו', frontToBack: 'מקדימה לאחור',
        archived: 'הרכב בארכיון, ולכן אי אפשר להחליף בו צמיגים או לרשום בדיקות ורוטציות.', selected: (w) => `נבחרו: ${w}` }
    : { title: 'Tires', noTires: 'No tires on this car yet.', addTires: 'Add tires', replace: 'Replace tires', noTire: 'No tire', pick: 'Tap a wheel to see its tire.',
        saved: 'Tires saved.', savedRecord: 'Tires saved. Open the service record to add the receipt with Add file.', brand: 'Enter a brand of up to 50 characters.',
        before: (n, p) => `Enter a reading of at least ${n0(n)} km, the odometer when the ${low(p)} tire went on.`,
        dateBefore: (d, p) => `The date can't be before ${d}, when the ${low(p)} tire went on.`,
        kmOn: (n, u = 'km') => `${n0(n)} ${u} on this tire`, km: (n, u = 'km') => `${n0(n)} ${u}`, record: (n) => `Tires (${n} tire${n === 1 ? '' : 's'})`, and: (a, b) => `${a} and ${b}`,
        replaceOf: (p) => `Replace tire: ${POS[p]}`, editOf: (p) => `Edit tire: ${POS[p]}`, delOf: (p) => `Delete tire: ${POS[p]}`, front: 'Front pair', rear: 'Rear pair', all: 'All 4',
        lowTread: 'Low tread', bar: (v) => `${v} bar`, mm: (v) => `${v} mm`, newAge: 'under a month', history: (n) => `Tire history (${n})`,
        confirmDel: 'Delete this tire? This is for fixing a mistake: its checks are deleted, the wheel is left empty and its service record stays.',
        rotated: 'A rotation moved this tire. Delete that rotation first.', notLatest: 'Only the newest rotation can be deleted. The list has been updated.',
        invalidMoves: 'Move at least two tires, each to a wheel another one left.', notRecorded: 'Wheels not recorded', frontToBack: 'Front to back',
        archived: "This car is archived, so its tires can't be replaced and checks and rotations can't be logged.", selected: (w) => `Selected: ${w}` }
  const tiSec = page.locator('section[aria-labelledby=tires]')
  const tiForm = tiSec.locator('form')
  const tiSave = tiForm.locator('.actions button:not(.link)')
  const wheel = (p) => tiSec.locator(`.wheel-${p}`)
  const wheelName = async (p, loc = wheel(p)) => plain(await loc.getAttribute('aria-label'))
  const card = (p) => tiSec.locator(`.tire-details li[data-position="${p}"]`)
  const isReplace = (r) => r.url().endsWith(`/vehicles/${dashCarId}/tires/replace`) && r.request().method() === 'POST'
  const mocked = (status, code, extra = {}) => (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code, ...extra }) })
  const goTires = async () => { await page.click('header nav a[href="/tires"]'); await arrivedAt(TI.title) }
  const recordCount = async () => (await apiCall('GET', `/vehicles/${dashCarId}/service-records`)).length
  const tiresOn = async () => Object.fromEntries((await apiCall('GET', `/vehicles/${dashCarId}/tires`)).current.map((x) => [x.position, x]))
  let carKm
  await step('tires-empty', async () => {
    // Criterion 4: no tires: Add tires, every wheel "No tire"; criterion 1: front left on the left in Hebrew too, wheels by keyboard.
    carKm = (await apiCall('GET', `/vehicles/${dashCarId}`)).currentOdometerKm
    await page.goto(`${BASE}${ckCarPath()}`)
    await tiSec.getByText(TI.noTires, { exact: true }).waitFor()
    await tiSec.getByRole('button', { name: TI.addTires, exact: true }).waitFor()
    if (await tiSec.locator('.tire-groups').count()) throw new Error('pair buttons without tires')
    for (const p of ['FL', 'FR', 'RL', 'RR', 'Spare']) if ((await wheelName(p)) !== `${POS[p]}: ${TI.noTire}`) throw new Error(`${p} "${await wheelName(p)}"`)
    const x = async (p) => (await wheel(p).boundingBox()).x
    if (!((await x('FL')) < (await x('FR')) && (await x('RL')) < (await x('RR')))) throw new Error('the left wheels are not on the left')
    // Reached by the keyboard, so the focus ring shows.
    await wheel('FR').focus()
    await page.keyboard.press('Shift+Tab')
    await focusIs('section[aria-labelledby=tires] .wheel-FL', 'the front left wheel after Shift+Tab')
    await page.keyboard.press('Enter')
    if ((await wheel('FL').getAttribute('aria-pressed')) !== 'true') throw new Error('Enter did not select the wheel')
    if ((await wheel('FL').evaluate((el) => getComputedStyle(el).outlineStyle)) === 'none') throw new Error('no focus ring on the wheel')
    if (plain(await tiSec.locator('.tire-car [role=status]').textContent()) !== TI.selected(POS.FL)) throw new Error('selection not announced')
    await card('FL').getByText(TI.noTire, { exact: true }).waitFor()
    // A failed load shows the error with Retry.
    await page.route(`**/vehicles/${dashCarId}/tires`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    const alert = tiSec.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    await page.unroute(`**/vehicles/${dashCarId}/tires`)
    forget500()
    await tiSec.getByRole('button', { name: HS.retry, exact: true }).click()
    await tiSec.getByText(TI.noTires, { exact: true }).waitFor()
    await at390('the car page without tires', 'tires-empty')
  })
  await step('tires-add', async () => {
    // Four tires entered as already on the car: no cost or shop on empty wheels, so no service record (criterion 4).
    const before = await recordCount()
    const add = tiSec.getByRole('button', { name: TI.addTires, exact: true })
    await add.click()
    await focusIs('section[aria-labelledby=tires] select[name=positions]', 'the wheels after Add tires')
    if ((await tiForm.locator('select[name=positions]').inputValue()) !== 'FL,FR,RL,RR') throw new Error('not all 4')
    if ((await tiForm.locator('input[name=date]').inputValue()) !== (await localDate())) throw new Error('date not today')
    if (Number(await tiForm.locator('input[name=odometer]').inputValue()) !== carKm) throw new Error('odometer not the car one')
    await page.keyboard.press('Escape')
    await focusIs('section[aria-labelledby=tires] button.add-tires', 'Add tires after Escape')
    await add.click()
    await tiSave.click()
    if (plain(await tiForm.locator('input[name=brand]').evaluate((el) => el.validationMessage)) !== TI.brand) throw new Error('brand message')
    await tiForm.locator('input[name=date]').fill(await histDay(-400))
    await tiForm.locator('input[name=odometer]').fill(String(carKm - 2000))
    await tiForm.locator('input[name=brand]').fill('Michelin')
    await tiForm.locator('input[name=model]').fill('Primacy 4')
    await tiForm.locator('input[name=size]').fill('205/55 R16')
    await tiForm.locator('input[name=dotCode]').fill('DOT XY 2124')
    await at390('the replace form', 'tires-form')
    const res = page.waitForResponse(isReplace)
    await tiSave.click()
    const r = await res
    const body = r.request().postDataJSON()
    if (r.status() !== 200 || body.positions.join() !== 'FL,FR,RL,RR' || body.cost !== null || body.shopName !== null || body.purchaseDate !== (await histDay(-400))) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    await focusIs('section[aria-labelledby=tires] .tire-saved', 'the saved message')
    if (plain(await tiSec.locator('.tire-saved').textContent()) !== TI.saved) throw new Error('saved message')
    if ((await recordCount()) !== before) throw new Error('a service record for tires put on empty wheels')
    for (const p of ['FL', 'FR', 'RL', 'RR']) if (!(await wheelName(p)).startsWith(`${POS[p]}: Michelin Primacy 4, `) || !(await wheelName(p)).includes(TI.km(2000))) throw new Error(`${p} "${await wheelName(p)}"`)
    if ((await wheelName('Spare')) !== `${POS.Spare}: ${TI.noTire}`) throw new Error('spare')
  })
  await step('tires-replace-one', async () => {
    // Criterion 2: the front left alone, prefilled from the old tire; errors on their fields; one record with the cost, shown as Tires in history.
    const year = (await localDate()).slice(0, 4)
    const tiresCost = async () => (await apiCall('GET', `/reports/costs?year=${year}`)).byCategory.find((c) => c.category === 'Tires')?.total ?? 0
    const cost0 = await tiresCost()
    await wheel('FL').click()
    const c = plain(await card('FL').textContent())
    if (!c.includes('Michelin Primacy 4') || !c.includes(TI.kmOn(2000)) || !c.includes('DOT XY 2124')) throw new Error(`card "${c}"`)
    if ((await card('FL').locator('[dir=auto]').count()) < 3) throw new Error('brand, size or DOT without dir=auto')
    await (await named(card('FL').locator('button.replace-one'), TI.replaceOf('FL'))).click()
    if ((await tiForm.locator('select[name=positions]').inputValue()) !== 'FL') throw new Error('not the front left')
    for (const [f, want] of [['brand', 'Michelin'], ['model', 'Primacy 4'], ['size', '205/55 R16'], ['dotCode', '']]) {
      if ((await tiForm.locator(`input[name=${f}]`).inputValue()) !== want) throw new Error(`${f} prefilled "${await tiForm.locator(`input[name=${f}]`).inputValue()}"`)
    }
    const odo = tiForm.locator('input[name=odometer]')
    const date = tiForm.locator('input[name=date]')
    const alert = tiForm.locator('[role=alert]')
    await odo.fill(String(carKm - 2001))
    await tiSave.click()
    await alert.waitFor()
    if (plain(await alert.textContent()) !== TI.before(carKm - 2000, 'FL') || (await odo.getAttribute('aria-invalid')) !== 'true') throw new Error(`odometer error "${await alert.textContent()}"`)
    await odo.fill(String(carKm))
    await date.fill(await histDay(-401))
    await tiSave.click()
    const want = TI.dateBefore(await fmtDay(await histDay(-400)), 'FL')
    await alert.filter({ hasText: want.slice(0, 15) }).waitFor()
    if (plain(await alert.textContent()) !== want || (await date.getAttribute('aria-invalid')) !== 'true') throw new Error(`date error "${await alert.textContent()}"`)
    forgetCk(400, '/tires/replace')
    await date.fill(await localDate())
    await tiForm.locator('input[name=brand]').fill('Pirelli')
    await tiForm.locator('input[name=model]').fill('Cinturato P7')
    await tiForm.locator('input[name=cost]').fill('720.5')
    await tiForm.locator('input[name=shop]').fill('Tire shop')
    const res = page.waitForResponse(isReplace)
    await tiSave.click()
    const saved = await (await res).json()
    const recordId = saved.current.find((x) => x.position === 'FL').serviceRecordId
    if (!recordId) throw new Error('no service record')
    await focusIs('section[aria-labelledby=tires] .tire-saved', 'the saved message')
    if (plain(await tiSec.locator('.tire-saved').textContent()) !== TI.savedRecord) throw new Error(`saved "${await tiSec.locator('.tire-saved').textContent()}"`)
    if (!(await wheelName('FL')).startsWith(`${POS.FL}: Pirelli Cinturato P7, ${TI.newAge}, ${TI.km(0)}`)) throw new Error(`FL "${await wheelName('FL')}"`)
    // The old tire is in Tire history with its km; the record shows as Tires, with the cost, and counts under Tires.
    await tiSec.locator('details:has(.removed-tires) > summary').click()
    const old = plain(await tiSec.locator('.removed-tires > li').first().textContent())
    if (!old.includes('Michelin Primacy 4') || !old.includes(POS.FL) || !old.includes(TI.kmOn(2000))) throw new Error(`history "${old}"`)
    // The link opens the record and focuses its Add file, where the receipt goes.
    const row = page.locator(`#service-${recordId}`)
    await row.waitFor({ state: 'attached' })
    await tiSec.locator('.tire-saved a').click()
    await focusIs(`#service-${recordId} button.add-file`, 'Add file on the record after its link')
    const rt = plain(await row.textContent())
    if (!rt.includes('Tire shop') || !rt.includes(TI.record(1)) || !rt.includes('720.5')) throw new Error(`record "${rt}"`)
    if ((await tiresCost()) !== cost0 + 720.5) throw new Error(`Tires cost ${await tiresCost()}, want ${cost0 + 720.5}`)
    await card('FL').locator('a', { hasText: he ? 'רשומת הרכישה' : 'Purchase record' }).waitFor()
    await at390('the car page tires', 'tires-car')
  })
  await step('tires-replace-groups', async () => {
    // The pair buttons open Replace for their wheels, prefilled from the first; the spare alone after All 4.
    await page.goto(`${BASE}${ckCarPath()}`)
    const front = tiSec.getByRole('button', { name: TI.front, exact: true })
    await front.click()
    if ((await front.getAttribute('aria-pressed')) !== 'true' || (await tiForm.locator('select[name=positions]').inputValue()) !== 'FL,FR') throw new Error('front pair')
    if ((await tiForm.locator('input[name=brand]').inputValue()) !== 'Pirelli') throw new Error('not prefilled from the front left')
    if ((await tiSec.locator('.tire-details > li').count()) !== 2) throw new Error('both front tires not shown')
    await page.keyboard.press('Escape')
    await focusIs('section[aria-labelledby=tires] .tire-groups button[aria-pressed=true]', 'Front pair after Escape')
    for (const [name, positions, brand] of [[TI.rear, 'RL,RR', 'Michelin'], [TI.all, 'FL,FR,RL,RR', 'Pirelli']]) {
      await tiSec.getByRole('button', { name, exact: true }).click()
      if ((await tiForm.locator('select[name=positions]').inputValue()) !== positions || (await tiForm.locator('input[name=brand]').inputValue()) !== brand) throw new Error(`${name} form`)
      await tiForm.locator('input[name=brand]').fill(positions === 'RL,RR' ? 'Nokian' : 'Bridgestone')
      await tiForm.locator('input[name=cost]').fill('100')
      const res = page.waitForResponse(isReplace)
      await tiSave.click()
      if ((await res).status() !== 200) throw new Error(`${name} failed`)
      await tiSec.locator('.tire-saved').waitFor()
    }
    for (const p of ['FL', 'FR', 'RL', 'RR']) if (!(await wheelName(p)).includes('Bridgestone')) throw new Error(`${p} "${await wheelName(p)}"`)
    if (plain(await tiSec.locator('details:has(.removed-tires) > summary').textContent()) !== TI.history(7)) throw new Error('not 7 tires in history')
    // The spare from its own wheel, with no cost or shop: no record.
    const before = await recordCount()
    await wheel('Spare').click()
    await card('Spare').locator('button.add-tire').click()
    if ((await tiForm.locator('select[name=positions]').inputValue()) !== 'Spare') throw new Error('not the spare')
    await tiForm.locator('input[name=brand]').fill('Kenda')
    await tiSave.click()
    await tiSec.locator('.tire-saved').waitFor()
    if (!(await wheelName('Spare')).startsWith(`${POS.Spare}: Kenda`) || (await recordCount()) !== before) throw new Error('spare')
    await tiSec.getByRole('button', { name: he ? 'גלגל רזרבי' : 'Spare', exact: true }).waitFor()
  })
  await step('tires-miles', async () => {
    // Km on a tire in miles; the car's odometer, left as shown in miles, goes back as its exact km.
    const mi = (km) => Math.round(km / 1.609344)
    await unitIs('Mi')
    await page.goto(`${BASE}${ckCarPath()}`)
    await tiSec.locator('.wheel-FL').waitFor()
    if (!(await wheelName('FL')).includes(TI.km(0, UM.mi))) throw new Error(`FL in miles "${await wheelName('FL')}"`)
    await tiSec.getByRole('button', { name: TI.replace, exact: true }).click()
    if (Number(await tiForm.locator('input[name=odometer]').inputValue()) !== mi(carKm)) throw new Error('odometer not in miles')
    await tiForm.locator('input[name=brand]').fill('X')
    await page.route('**/tires/replace', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    const req = page.waitForRequest((r) => r.url().endsWith('/tires/replace'))
    await tiSave.click()
    if ((await req).postDataJSON().odometerKm !== carKm) throw new Error(`sent ${(await req).postDataJSON().odometerKm}`)
    await tiForm.locator('[role=alert]').filter({ hasText: HS.generic }).waitFor()
    forget500()
    await unitIs('Km')
  })
  const TC = he
    ? { logCheck: 'רישום בדיקה', logRotation: 'רישום רוטציה', noChecks: 'עדיין אין בדיקות.', notRotated: 'עדיין לא בוצעה רוטציה.', last: (d) => `בדיקה אחרונה: ${d}`,
        empty: 'יש להזין לחץ או עומק חריצים לגלגל אחד לפחות.', duplicate: 'כבר יש בדיקה של הצמיג הזה בתאריך הזה. כדי לרשום אותה מחדש, יש למחוק אותה קודם.',
        delCheck: (d) => `מחיקת הבדיקה מ־${d}`, delRot: (d) => `מחיקת הרוטציה מ־${d}`, lastRot: (d, n) => `רוטציה אחרונה: ${d}, לפני ${n0(n)} ק״מ` }
    : { logCheck: 'Log a check', logRotation: 'Log a rotation', noChecks: 'No checks yet.', notRotated: 'Not rotated yet.', last: (d) => `Last check: ${d}`,
        empty: 'Enter a pressure or a tread depth for at least one wheel.', duplicate: 'There is already a check of this tire on this date. Delete it to log it again.',
        delCheck: (d) => `Delete the check from ${d}`, delRot: (d) => `Delete the rotation from ${d}`, lastRot: (d, n) => `Last rotation: ${d}, ${n0(n)} km ago` }
  const lastCheck = tiSec.locator('.last-check')
  const checkRows = tiSec.locator('.checks > li')
  const rotRows = tiSec.locator('.rotations > li')
  const isCheckPost = (r) => r.url().endsWith('/tires/checks') && r.request().method() === 'POST'
  const isRotPost = (r) => r.url().endsWith('/tires/rotations') && r.request().method() === 'POST'
  await step('tires-check', async () => {
    // Criterion 3: a row per wheel with a tire; the values on the drawing; a 409 on the date; a low tread marks its wheel.
    await page.goto(`${BASE}${ckCarPath()}`)
    await lastCheck.getByText(TC.noChecks, { exact: true }).waitFor()
    await tiSec.getByRole('button', { name: TC.logCheck, exact: true }).click()
    await focusIs('section[aria-labelledby=tires] input[name=date]', 'the date after Log a check')
    if ((await tiForm.locator('fieldset.item').count()) !== 5) throw new Error('not a row per tire')
    await tiSave.click()
    const alert = tiForm.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== TC.empty) throw new Error(`empty "${await alert.textContent()}"`)
    forgetCk(400, '/checks')
    await tiForm.locator('input[name=pFL]').fill('2.4')
    await tiForm.locator('input[name=pRR]').fill('2.25')
    await tiForm.locator('input[name=tRR]').fill('6.5')
    await at390('the check form', 'tires-check-form')
    const res = page.waitForResponse(isCheckPost)
    await tiSave.click()
    if ((await res).status() !== 201) throw new Error('check failed')
    await focusIs('section[aria-labelledby=tires] .last-check', 'Last check after Save')
    if (plain(await lastCheck.textContent()) !== TC.last(await fmtDay(await localDate()))) throw new Error(`last check "${await lastCheck.textContent()}"`)
    if (!(await wheelName('FL')).endsWith(TI.bar('2.4')) || !(await wheelName('RR')).endsWith(`${TI.bar('2.25')}, ${TI.mm('6.5')}`)) throw new Error(`values "${await wheelName('RR')}"`)
    // The same tire on the same date: 409 on the date.
    await tiSec.getByRole('button', { name: TC.logCheck, exact: true }).click()
    await tiForm.locator('input[name=pFL]').fill('2.3')
    await tiSave.click()
    await alert.waitFor()
    if (plain(await alert.textContent()) !== TC.duplicate || (await tiForm.locator('input[name=date]').getAttribute('aria-invalid')) !== 'true') throw new Error(`duplicate "${await alert.textContent()}"`)
    forgetCk(409, '/checks')
    // The rear left at 2.5 mm joins today's check: under 3 mm, so its wheel needs attention.
    await tiForm.locator('input[name=pFL]').fill('')
    await tiForm.locator('input[name=tRL]').fill('2.5')
    await tiSave.click()
    await tiSec.locator('.wheel-RL.attention').waitFor()
    if (!(await wheelName('RL')).endsWith(`${TI.mm('2.5')}, ${TI.lowTread}`)) throw new Error(`RL "${await wheelName('RL')}"`)
    // Its warning line shows whichever wheels are selected.
    await tiSec.locator('.tire-side .low-tread', { hasText: POS.RL }).waitFor()
    await at390('the car page with a low tread', 'tires-check')
    await tiSec.locator('details:has(.checks) > summary').click()
    if (!plain(await checkRows.first().textContent()).includes(`${POS.RL}: ${TI.mm('2.5')}`)) throw new Error(`check row "${await checkRows.first().textContent()}"`)
  })
  await step('tires-rotation', async () => {
    // Criterion 3: no move is a clear 400; Front to back moves the tires on the drawing; deleting it moves them back; a 409 shows its text.
    const before = await tiresOn()
    await tiSec.getByRole('button', { name: TC.logRotation, exact: true }).click()
    await focusIs('section[aria-labelledby=tires] input[name=date]', 'the date after Log a rotation')
    await tiSave.click()
    const alert = tiForm.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== TI.invalidMoves) throw new Error(`no moves "${await alert.textContent()}"`)
    forgetCk(400, '/rotations')
    await tiForm.getByRole('button', { name: TI.frontToBack, exact: true }).click()
    if ((await tiForm.locator('select[name=toFL]').inputValue()) !== 'RL' || (await tiForm.locator('select[name=toRR]').inputValue()) !== 'FR') throw new Error('Front to back')
    await at390('the rotation form', 'tires-rotation-form')
    const res = page.waitForResponse(isRotPost)
    await tiSave.click()
    const r = await res
    if (r.status() !== 201 || r.request().postDataJSON().moves.length !== 4) throw new Error(`${r.status()} ${r.request().postData()}`)
    await focusIs('section[aria-labelledby=tires] .last-rotation', 'Last rotation after Save')
    if (plain(await tiSec.locator('.last-rotation').textContent()) !== TC.lastRot(await fmtDay(await localDate()), 0)) throw new Error('last rotation')
    const after = await tiresOn()
    if (after.FL.id !== before.RL.id || after.RR.id !== before.FR.id) throw new Error('tires not moved')
    // The low rear-left tire is now on the front left, on the drawing too.
    await tiSec.locator('.wheel-FL.attention').waitFor()
    await tiSec.locator('details:has(.rotations) > summary').click()
    // A migrated rotation, without moves, says so (mocked as an older one); only the newest has Delete.
    const old = { id: crypto.randomUUID(), date: await histDay(-30), odometerKm: carKm - 1000, notes: null, moves: [] }
    await page.route(`**/vehicles/${dashCarId}/tires/rotations`, async (rt) => {
      if (rt.request().method() !== 'GET') return rt.fallback()
      const res = await rt.fetch()
      await rt.fulfill({ response: res, json: [...(await res.json()), old] })
    })
    await page.reload()
    await tiSec.locator('details:has(.rotations) > summary').click()
    if (!plain(await rotRows.nth(1).textContent()).includes(TI.notRecorded) || (await rotRows.nth(1).locator('button').count())) throw new Error('migrated rotation')
    await page.unroute(`**/vehicles/${dashCarId}/tires/rotations`)
    const del = await named(rotRows.first().locator('button.link'), TC.delRot(await fmtDay(await localDate())))
    await page.route('**/api/tire-rotations/*', mocked(409, 'tireRotation.notLatest'), { times: 1 })
    await del.click()
    await rotRows.first().locator('button.danger').click()
    await rotRows.first().locator('[role=alert]').waitFor()
    if (plain(await rotRows.first().locator('[role=alert]').textContent()) !== TI.notLatest) throw new Error('notLatest message')
    forgetCk(409, '/tire-rotations')
    await rotRows.first().locator('button.danger').click()
    await tiSec.getByText(TC.notRotated, { exact: true }).waitFor()
    const back = await tiresOn()
    if (back.FL.id !== before.FL.id || back.RL.id !== before.RL.id) throw new Error('tires not moved back')
    await tiSec.locator('.wheel-RL.attention').waitFor()
    // Deleting the check (the whole date) clears the values and the warning.
    await tiSec.locator('details:has(.checks) > summary').click()
    await (await named(checkRows.first().locator('button.link'), TC.delCheck(await fmtDay(await localDate())))).click()
    await checkRows.first().locator('button.danger').click()
    await lastCheck.getByText(TC.noChecks, { exact: true }).waitFor()
    if (await tiSec.locator('.wheel.attention, .low-tread').count()) throw new Error('a warning after deleting the check')
  })
  await step('tires-edit-delete', async () => {
    // Edit a tire's details; Delete it (a 409 first), which leaves the wheel empty.
    await page.goto(`${BASE}${ckCarPath()}`)
    await wheel('Spare').click()
    await (await named(card('Spare').locator('button.edit'), TI.editOf('Spare'))).click()
    await focusIs('section[aria-labelledby=tires] input[name=brand]', 'Brand on Edit')
    await page.keyboard.press('Escape')
    await focusIs('section[aria-labelledby=tires] .tire-details button.edit', 'Edit after Escape')
    await card('Spare').locator('button.edit').click()
    await tiForm.locator('input[name=dotCode]').fill('DOT AB 0125')
    const res = page.waitForResponse((r) => r.url().includes('/api/tires/') && r.request().method() === 'PUT')
    await tiSave.click()
    const r = await res
    if (r.status() !== 200 || r.request().postDataJSON().brand !== 'Kenda') throw new Error(`${r.status()} ${r.request().postData()}`)
    await focusIs('section[aria-labelledby=tires] .tire-details button.edit', 'Edit after Save')
    await card('Spare').getByText('DOT AB 0125', { exact: true }).waitFor()
    const del = await named(card('Spare').locator('button.delete'), TI.delOf('Spare'))
    await del.click()
    if (plain(await card('Spare').locator('.inline-form p').textContent()) !== TI.confirmDel) throw new Error('confirm text')
    await page.route('**/api/tires/*', mocked(409, 'tire.rotated'), { times: 1 })
    await card('Spare').locator('button.danger').click()
    await card('Spare').locator('[role=alert]').waitFor()
    if (plain(await card('Spare').locator('[role=alert]').textContent()) !== TI.rotated) throw new Error('rotated message')
    forgetCk(409, '/api/tires/')
    await card('Spare').locator('button.danger').click()
    await card('Spare').locator('button.add-tire').waitFor()
    await focusIs('section[aria-labelledby=tires] .tire-details button.add-tire', 'Add a tire after Delete')
    if ((await wheelName('Spare')) !== `${POS.Spare}: ${TI.noTire}`) throw new Error('spare not empty')
  })
  await step('tires-page', async () => {
    // /tires: each active car's drawing; a wheel shows its tire without actions; the name links to the car.
    await goTires()
    const sec = page.locator('main section').filter({ has: page.getByRole('link', { name: 'Dash car', exact: true }) })
    await sec.locator('.wheel-FL').click()
    const c = plain(await sec.locator('.tire-details > li').textContent())
    if (!c.includes('Bridgestone')) throw new Error(`card "${c}"`)
    if (await sec.locator('.tire-details button').count()) throw new Error('actions on /tires')
    await at390('the tires page', 'tires-list')
    await sec.getByRole('link', { name: 'Dash car', exact: true }).click()
    await arrivedAt('Dash car')
  })
  await step('tires-archived', async () => {
    // Criterion 4: an archived car's tires, checks and history show, with no Replace, Log, Edit or Delete.
    const day = await localDate()
    const id = (await apiCall('POST', '/vehicles', { nickname: 'Tire archive', initialOdometerKm: 1000, readingDate: day })).id
    await apiCall('POST', `/vehicles/${id}/tires/replace`, { positions: ['FL', 'FR', 'RL', 'RR'], date: day, odometerKm: 1000, brand: 'Nokian', season: 'Winter' })
    await apiCall('POST', `/vehicles/${id}/tires/checks`, { measuredAt: day, items: [{ position: 'FL', pressureBar: 2.5 }] })
    await apiCall('POST', `/vehicles/${id}/archive`)
    await page.goto(`${BASE}/cars/${id}`)
    await tiSec.locator('.wheel-FL').click()
    await card('FL').getByText('Nokian', { exact: true }).waitFor()
    if (await tiSec.locator('button.replace-tires, .tire-groups, button.log-check, button.log-rotation, .tire-details button').count()) throw new Error('an action on an archived car')
    if ((await tiSec.locator('.checks > li').count()) !== 1 || (await tiSec.locator('.checks button').count())) throw new Error('checks missing, or Delete on them')
    // The archived message, mocked, for a read at 390px.
    await page.goto(`${BASE}${ckCarPath()}`)
    await tiSec.getByRole('button', { name: TI.replace, exact: true }).click()
    await tiForm.locator('input[name=brand]').fill('X')
    await page.route('**/tires/replace', mocked(400, 'tire.vehicleArchived'), { times: 1 })
    await tiSave.click()
    await tiForm.locator('[role=alert]').waitFor()
    if (plain(await tiForm.locator('[role=alert]').textContent()) !== TI.archived) throw new Error('archived message')
    // The spare named inside a sentence: "the spare tire", not "the spare tire tire".
    await page.route('**/tires/replace', mocked(400, 'tire.odometerBeforeFitted', { fittedOdometerKm: 1000, position: 'Spare' }), { times: 1 })
    await tiSave.click()
    await tiForm.locator('[role=alert]').filter({ hasText: he ? 'יש להזין' : 'Enter a' }).waitFor()
    if (plain(await tiForm.locator('[role=alert]').textContent()) !== TI.before(1000, 'Spare')) throw new Error(`spare message "${await tiForm.locator('[role=alert]').textContent()}"`)
    forgetCk(400, '/tires/replace')
    await page.keyboard.press('Escape')
  })
  // RPT-1: /reports, for a fresh user so every figure is known. The records are last year's, so none is in the future.
  const RP = he
    ? { title: 'דוחות', empty: 'עדיין אין עלויות טיפולים.', goCars: 'מעבר לרכבים', notFound: 'הרכב לא נמצא.', allCars: 'כל הרכבים', vanArchived: 'Report Van (בארכיון)',
        unpriced: 'לטיפול אחד אין עלות', noTask: 'ללא משימה', oil: 'שמן', brakes: 'בלמים', driven: 'מרחק נסיעה', perKm: 'עלות לק״מ', perMi: 'עלות למייל',
        tco: 'עלות בעלות כוללת', addPrice: 'הוספת מחיר רכישה', notEnough: 'אין מספיק קריאות קילומטראז׳', badYear: 'יש לבחור שנה בין 1900 לשנה הנוכחית.', thisYear: 'הצגת השנה הנוכחית' }
    : { title: 'Reports', empty: 'No service costs yet.', goCars: 'Go to the cars', notFound: 'This car was not found.', allCars: 'All cars', vanArchived: 'Report Van (archived)',
        unpriced: '1 service has no cost', noTask: 'No task', oil: 'Oil', brakes: 'Brakes', driven: 'Distance driven', perKm: 'Cost per km', perMi: 'Cost per mile',
        tco: 'Total cost of ownership', addPrice: 'Add a purchase price', notEnough: 'Not enough odometer readings', badYear: 'Choose a year from 1900 to this year.', thisYear: 'Show this year' }
  const yearSel = 'main .filters select >> nth=0'
  const rpCarSel = 'main .filters select >> nth=1'
  const rpFig = (scope, label) => scope.locator('.figures > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
  const rpText = async (scope, label) => plain(await rpFig(scope, label).textContent())
  const rpCar = (name) => page.locator('main .car-costs').filter({ has: page.locator('h3', { hasText: name }) })
  const rpMoney = async (v) => plain(await moneyText(v))
  // Cost per km and per mile keep up to 4 decimals.
  const rpMoney4 = async (v) => plain(await page.evaluate(([v, l, c]) => v.toLocaleString(l, { style: 'currency', currency: c, maximumFractionDigits: 4 }), [v, s.lng, (await histUser()).currency]))
  const rpIs = async (scope, label, want) => { const got = await rpText(scope, label); if (got !== plain(want)) throw new Error(`${label}: "${got}", want "${plain(want)}"`) }
  const rpCats = page.locator('main section', { has: page.locator('.categories') })
  let ly, rpA, rpV, rpN
  await step('reports-empty', async () => {
    // Criterion 7: no priced records says so and links to the cars; the year defaults to the local one.
    await more(page)
    await page.click('header nav button.link')
    await page.locator('input[name=email]').waitFor()
    await page.goto(`${BASE}/register`)
    await page.fill('input[name=email]', `ui-rpt-${s.name}-${Date.now()}@onlycars.test`)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('a[href="/cars/new"]').waitFor()
    await more(page)
    await page.click('header a[href="/spending"]')
    await page.click('.subnav a[href="/spending/reports"]')
    await arrivedAt(RP.title)
    await page.getByText(RP.empty, { exact: true }).waitFor()
    await page.locator('main .report a[href="/"]', { hasText: RP.goCars }).waitFor()
    // RPT-3 criterion 6: no export buttons in the empty state.
    if (await page.locator('main .export button').count()) throw new Error('export buttons in the empty state')
    ly = await page.evaluate(() => new Date().getFullYear() - 1)
    if ((await page.inputValue(yearSel)) !== String(ly + 1)) throw new Error(`year ${await page.inputValue(yearSel)}`)
  })
  await step('reports-year', async () => {
    rpA = (await apiCall('POST', '/vehicles', { nickname: 'Report Corolla', initialOdometerKm: 40000, readingDate: `${ly}-01-01`, purchasePrice: 20000 })).id
    const task = async (name) => (await apiCall('POST', `/vehicles/${rpA}/tasks`, { name, category: name, intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 40000, lastDoneDate: `${ly}-01-01` })).id
    await apiCall('POST', `/vehicles/${rpA}/service-records`, { date: `${ly}-03-10`, odometerKm: 50000, totalCost: 300, taskIds: [await task('Oil'), await task('Brakes')] })
    rpV = (await apiCall('POST', '/vehicles', { nickname: 'Report Van', initialOdometerKm: 10000, readingDate: `${ly}-01-01` })).id
    await apiCall('POST', `/vehicles/${rpV}/service-records`, { date: `${ly}-03-20`, odometerKm: 13000, totalCost: 100.5 })
    await apiCall('POST', `/vehicles/${rpV}/service-records`, { date: `${ly}-07-05`, odometerKm: 13000 })
    await apiCall('POST', `/vehicles/${rpV}/archive`)
    rpN = (await apiCall('POST', '/vehicles', { nickname: 'Report New', initialOdometerKm: 500 })).id
    // Criterion 7: this year has no records: 12 months of 0, not an error.
    await page.reload()
    const months = page.locator('main .months > div')
    await months.nth(11).waitFor()
    if ((await months.count()) !== 12) throw new Error(`${await months.count()} months`)
    const zero = await rpMoney(0)
    if ((await months.locator('dd').allTextContents()).some((t) => plain(t) !== zero)) throw new Error('a month of this year is not 0')
    // Criterion 5: the year goes to the URL and survives a reload.
    await page.selectOption(yearSel, String(ly))
    await page.waitForURL((u) => u.searchParams.get('year') === String(ly))
    await rpCats.waitFor()
    await page.reload()
    await rpCats.waitFor()
    if ((await page.inputValue(yearSel)) !== String(ly)) throw new Error('year lost on reload')
    // Criterion 4: 300 on Oil and Brakes is 150 each; the Van's record with no task is No task.
    for (const [label, v] of [[RP.brakes, 150], [RP.oil, 150], [RP.noTask, 100.5]]) await rpIs(rpCats, label, await rpMoney(v))
    const summary = plain(await page.locator('main .report section >> nth=0').locator('p >> nth=0').textContent())
    if (summary !== plain(HS.summary(3, await moneyText(400.5)))) throw new Error(`summary "${summary}"`)
    await page.getByText(RP.unpriced, { exact: true }).waitFor()
    if ((await page.locator('main .by-car > div').count()) !== 2) throw new Error('by car rows')
    // A month's total opens /history for that month, with the same total.
    const march = await page.evaluate(([y, l]) => new Date(y, 2, 1).toLocaleDateString(l, { month: 'long' }), [ly, s.lng])
    await months.filter({ has: page.locator('dt', { hasText: march }) }).locator('dd a').click()
    await arrivedAt(HS.title)
    if (new URL(page.url()).search !== `?from=${ly}-03-01&to=${ly}-03-31`) throw new Error(`history URL ${page.url()}`)
    await summaryIs(2, 400.5)
  })
  await step('reports-car', async () => {
    await page.goBack()
    await rpCats.waitFor()
    const opts = await page.locator(rpCarSel).locator('option').allTextContents()
    if (opts.length !== 4 || opts[0] !== RP.allCars || opts[3] !== RP.vanArchived) throw new Error(`car options ${opts}`)
    // Criterion 5: the car goes to the URL with the year; By car goes away and All time holds that car only.
    await page.selectOption(rpCarSel, rpA)
    await page.waitForURL((u) => u.searchParams.get('vehicleId') === rpA && u.searchParams.get('year') === String(ly))
    await page.waitForFunction(() => document.querySelectorAll('main .car-costs').length === 1 && !document.querySelector('main .by-car'), null, { timeout: 5000 })
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll('main .car-costs').length === 1, null, { timeout: 5000 })
    if ((await page.inputValue(rpCarSel)) !== rpA) throw new Error('car lost on reload')
    await rpIs(rpCats, RP.oil, await rpMoney(150))
    // Criterion 7: a stale car shows vehicle.notFound and a way back to All cars.
    await page.goto(`${BASE}/reports?year=${ly}&vehicleId=00000000-0000-0000-0000-000000000001`)
    const alert = page.locator('main [role=alert]')
    if (plain(await alert.textContent()) !== RP.notFound) throw new Error(`stale car "${await alert.textContent()}"`)
    await page.getByRole('button', { name: RP.allCars, exact: true }).click()
    await page.waitForURL((u) => !u.searchParams.has('vehicleId') && u.searchParams.get('year') === String(ly))
    await page.locator('main .by-car').waitFor()
    await focusIs('main h1', 'h1 after All cars')
    forgetCk(404, '/reports/costs')
    // Not a car id at all (model binding's 400): the same message and way back.
    await page.goto(`${BASE}/reports?year=${ly}&vehicleId=abc`)
    if (plain(await alert.textContent()) !== RP.notFound) throw new Error(`non-guid car "${await alert.textContent()}"`)
    await page.getByRole('button', { name: RP.allCars, exact: true }).click()
    await page.locator('main .by-car').waitFor()
    forgetCk(400, '/reports/costs')
    // A bad year in the URL: its message and a way to this year.
    // LOW-7 L112: and the Year box shows its "No year" option, not the current one: not a number, or a number the API refuses.
    for (const bad of ['1800', '2025abc']) {
      await page.goto(`${BASE}/reports?year=${bad}`)
      if (plain(await alert.textContent()) !== RP.badYear) throw new Error(`bad year ${bad}: "${await alert.textContent()}"`)
      const shownYear = await page.locator(yearSel).evaluate((el) => el.selectedOptions[0]?.textContent ?? '')
      if ((await page.inputValue(yearSel)) !== '' || plain(shownYear) !== key('noYear')) throw new Error(`Year box "${shownYear}" for the year ${bad}`)
    }
    await page.getByRole('button', { name: RP.thisYear, exact: true }).click()
    await page.locator('main .months').waitFor()
    if ((await page.inputValue(yearSel)) !== String(ly + 1)) throw new Error('not this year')
    forgetCk(400, '/reports/costs')
  })
  await step('reports-all-time', async () => {
    // Criterion 6, km: distance and cost per km; TCO, or a link to add the purchase price; no km driven, no cost per km.
    await page.goto(`${BASE}/reports?year=${ly}`)
    const corolla = rpCar('Report Corolla')
    await corolla.waitFor()
    await rpIs(corolla, RP.driven, `10,000 ${UM.km}`)
    await rpIs(corolla, RP.perKm, await rpMoney4(0.03))
    await rpIs(corolla, RP.tco, await rpMoney(20300))
    const van = rpCar('Report Van')
    await rpIs(van, RP.perKm, await rpMoney4(0.0335))
    const add = rpFig(van, RP.tco).locator('a')
    if ((await add.getAttribute('href')) !== `/cars/${rpV}/edit` || plain(await add.textContent()) !== RP.addPrice) throw new Error('Add a purchase price link')
    await rpIs(rpCar('Report New'), RP.perKm, RP.notEnough)
    // A chosen car with no costs still shows its All time figures, not the empty state.
    await page.goto(`${BASE}/reports?year=${ly}&vehicleId=${rpN}`)
    await rpCar('Report New').waitFor()
    if (await page.getByText(RP.empty, { exact: true }).count()) throw new Error('empty state with a car chosen')
  })
  await step('reports-miles', async () => {
    // Criterion 6, miles: distance in miles and cost per mile.
    await unitIs('Mi')
    await page.goto(`${BASE}/reports?year=${ly}`)
    const corolla = rpCar('Report Corolla')
    await corolla.waitFor()
    await rpIs(corolla, RP.driven, `6,214 ${UM.mi}`)
    await rpIs(corolla, RP.perMi, await rpMoney4(0.03 * 1.609344))
    await unitIs('Km')
  })
  await step('reports-loading-error', async () => {
    // Criterion 7: a loading line, then an error with Retry; Retry focuses the h1.
    const costs = '**/api/reports/costs?**'
    const slow = async (r) => { await page.waitForTimeout(700); await r.continue().catch(() => {}) }
    await page.route(costs, slow)
    await page.goto(`${BASE}/reports?year=${ly}`)
    await page.locator('main .filters [role=status]', { hasText: he ? 'טוען' : 'Loading' }).waitFor()
    await page.unroute(costs, slow)
    await rpCats.waitFor()
    await page.route(costs, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    const alert = page.locator('main [role=alert]')
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    await page.unroute(costs)
    forget500()
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await rpCats.waitFor()
    await focusIs('main h1', 'h1 after Retry')
    // Criterion 9: 390px, no sideways scroll, 44px targets.
    await at390('the reports page', 'reports-390')
  })
  await step('reports-year-and-links', async () => {
    // LOW-5 L95: a year with leading zeros is that year: one option, and the request and figures are that year's.
    const asked = []
    const onReq = (r) => r.url().includes('/api/reports/costs?') && asked.push(new URL(r.url()).searchParams.get('year'))
    page.on('request', onReq)
    await page.goto(`${BASE}/reports?year=0${ly}`)
    await rpCats.waitFor()
    page.off('request', onReq)
    const opts = await page.locator(yearSel).locator('option').allTextContents()
    if ([...new Set(asked)].join() !== String(ly) || opts.filter((o) => o.includes(String(ly))).length !== 1 || (await page.inputValue(yearSel)) !== String(ly)) throw new Error(`asked ${asked}, options ${opts}, value ${await page.inputValue(yearSel)}`)
    await rpIs(rpCats, RP.oil, await rpMoney(150))
    // L96 (RPT-1 M2): while a new car loads, the old figures keep their own links (All cars: no vehicleId); then the new ones carry the car.
    const costs = '**/api/reports/costs?**'
    const slow = async (r) => { await page.waitForTimeout(1500); await r.continue().catch(() => {}) }
    await page.route(costs, slow)
    await page.selectOption(rpCarSel, rpA)
    await page.locator('main .report[aria-busy=true]').waitFor()
    const hrefs = () => page.locator('main .report a[href^="/spending"]').evaluateAll((as) => as.filter((a) => !a.closest('.by-car')).map((a) => a.getAttribute('href'))) // By car links name their own car
    const old = await hrefs()
    if (!old.length || old.some((h) => h.includes('vehicleId=')) || !(await page.locator('main .by-car').count())) throw new Error(`links while loading ${old}`)
    await page.unroute(costs, slow)
    await page.locator('main .report[aria-busy=false]').waitFor()
    const fresh = await hrefs()
    const now = fresh.filter((h) => !h.includes(`vehicleId=${rpA}`))
    if (!fresh.length || now.length) throw new Error(`${fresh.length} links after loading, without the car ${now}`) // LOW-7 L108: no links is a failure too
  })
  // RPT-2: the charts. Bar sizes as a share of their slot, rounded to 2 decimals; x is each month's left edge.
  const rpCharts = () => page.evaluate(() => {
    const r2 = (v) => Math.round(v * 100) / 100
    const mc = document.querySelector('main .month-chart'), cc = document.querySelector('main .category-chart')
    return {
      busy: document.querySelector('main .report')?.getAttribute('aria-busy'),
      hidden: [mc, cc].filter(Boolean).every((c) => c.getAttribute('aria-hidden') === 'true') && !document.querySelector('main .month-chart [tabindex], main .category-chart a'),
      months: mc && [...mc.children].map((c) => ({ h: r2(c.querySelector('span').offsetHeight / c.firstElementChild.clientHeight), px: c.querySelector('span').offsetHeight, x: c.getBoundingClientRect().left })),
      // The shown month labels, in screen order: none may overlap the next one or leave the chart.
      labels: mc && (() => {
        const box = mc.getBoundingClientRect()
        const ls = [...mc.querySelectorAll(':scope > div > span')].filter((l) => getComputedStyle(l).visibility === 'visible').map((l) => l.getBoundingClientRect()).sort((p, q) => p.left - q.left)
        return { shown: ls.length, edge: ls.some((l) => l.left < box.left - 0.5 || l.right > box.right + 0.5), overlap: ls.some((l, i) => ls[i + 1] && l.right > ls[i + 1].left) }
      })(),
      categories: cc && [...cc.children].map((c) => {
        const row = c.getBoundingClientRect(), bar = c.querySelector('span').getBoundingClientRect()
        return { text: c.textContent, w: r2(bar.width / row.width), px: c.querySelector('span').offsetWidth, fromStart: document.dir === 'rtl' ? Math.abs(bar.right - row.right) < 1 : Math.abs(bar.left - row.left) < 1 }
      }),
      rows: [...document.querySelectorAll('main .categories dt')].map((d) => d.textContent),
      hasCategories: !!document.querySelector('main .categories'),
    }
  })
  const chartsAre = async (want, when) => {
    // Polls, since a filter change renders the new figures a moment after the URL changes.
    for (let i = 0; ; i++) {
      const got = await rpCharts()
      const months = got.months?.map((m) => m.h).join() ?? null
      const cats = got.categories?.map((c) => `${plain(c.text)}=${c.w}`).join() ?? null // name and amount are separate grid items, so no space
      if (got.busy === 'false' && months === want.months && cats === want.categories && got.hidden) return got
      if (i === 50) throw new Error(`${when}: months ${months}, categories ${cats}, hidden ${got.hidden}, busy ${got.busy}`)
      await page.waitForTimeout(100)
    }
  }
  await step('reports-charts', async () => {
    // Criteria 1 and 2: last-but-one year, 100 in March with no task and 300 in July on Oil and Brakes.
    const py = ly - 1
    const rpC = (await apiCall('POST', '/vehicles', { nickname: 'Report Chart', initialOdometerKm: 1000, readingDate: `${py}-01-01` })).id
    const task = async (name) => (await apiCall('POST', `/vehicles/${rpC}/tasks`, { name, category: name, intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 1000, lastDoneDate: `${py}-01-01` })).id
    await apiCall('POST', `/vehicles/${rpC}/service-records`, { date: `${py}-03-10`, odometerKm: 2000, totalCost: 100 })
    await apiCall('POST', `/vehicles/${rpC}/service-records`, { date: `${py}-07-10`, odometerKm: 3000, totalCost: 300, taskIds: [await task('Oil'), await task('Brakes')] })
    await page.goto(`${BASE}/reports?year=${py}`)
    await page.locator('main .month-chart').waitFor()
    const m = (marchJuly) => Array.from({ length: 12 }, (_, i) => marchJuly[i] ?? 0).join()
    const [first, second] = (await rpCharts()).rows // the API's order for the 150 tie
    const got = await chartsAre({ months: m({ 2: 0.33, 6: 1 }), categories: `${first}${await rpMoney(150)}=1,${second}${await rpMoney(150)}=1,${RP.noTask}${await rpMoney(100)}=0.67` }, `${py}, all cars`)
    if (![first, second].includes(RP.oil) || ![first, second].includes(RP.brakes)) throw new Error(`category rows ${got.rows}`)
    if ((await page.locator('main .months > div').count()) !== 12) throw new Error('month rows changed')
    // Criterion 4: January at the right in Hebrew, at the left in English; category bars grow from the inline start.
    if ((got.months[0].x > got.months[11].x) !== he) throw new Error(`January at x ${got.months[0].x}, December at ${got.months[11].x}`)
    if (!got.categories.every((c) => c.fromStart)) throw new Error('a category bar does not start at the inline start')
    // Criterion 6: month labels don't overlap; at 390px every other one shows, also with 20px text, and nothing scrolls sideways.
    if (got.labels.overlap || got.labels.edge || got.labels.shown !== (s.viewport.width > 640 ? 12 : 6)) throw new Error(`labels ${JSON.stringify(got.labels)}`)
    await at390('the reports charts', 'reports-charts-390')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px' })
    const narrow = await rpCharts()
    await noOverflow('the reports charts with 20px text')
    await page.evaluate(() => { document.documentElement.style.fontSize = '' })
    await page.setViewportSize(s.viewport)
    if (narrow.labels.overlap || narrow.labels.edge || narrow.labels.shown !== 6) throw new Error(`labels at 390px with 20px text ${JSON.stringify(narrow.labels)}`)
    // LOW-5 L102: --muted (the bars and month names) on the card is at least 4.5:1, in the light and the dark theme.
    const ratios = await page.evaluate(() => {
      const lum = (c) => c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
      const root = document.documentElement, was = root.getAttribute('data-theme')
      const out = ['light', 'dark'].map((theme) => {
        root.setAttribute('data-theme', theme)
        const [a, b] = [lum(getComputedStyle(document.querySelector('main .month-chart span[style]')).backgroundColor), lum(getComputedStyle(document.querySelector('main .month-chart').closest('.card')).backgroundColor)]
        return `${theme} ${Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100}`
      })
      if (was == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', was)
      return out
    })
    if (ratios.some((r) => Number(r.split(' ')[1]) < 4.5)) throw new Error(`--muted on the card: ${ratios}`)
    // LOW-5 L101: at 390px with the web fonts blocked, the wider fallback font still fits: labels apart, inside the chart, no sideways scroll.
    const fonts = /fonts\.(googleapis|gstatic)\.com/
    const before = run.consoleErrors.length
    await page.route(fonts, (r) => r.abort())
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.locator('main .month-chart').waitFor()
    if (await page.evaluate(() => [...document.fonts].some((f) => f.status === 'loaded'))) throw new Error('a web font loaded')
    const fallback = await rpCharts()
    await noOverflow('the reports charts without web fonts')
    await page.screenshot({ path: `${OUT}/${s.name}-reports-charts-no-webfonts-390.png`, fullPage: true })
    await page.unroute(fonts)
    run.consoleErrors.splice(before, Infinity, ...run.consoleErrors.slice(before).filter((e) => !e.includes('net::ERR_FAILED')))
    await page.setViewportSize(s.viewport)
    await page.reload()
    await page.locator('main .month-chart').waitFor()
    if (fallback.labels.overlap || fallback.labels.edge || fallback.labels.shown !== 6) throw new Error(`labels at 390px without web fonts ${JSON.stringify(fallback.labels)}`)
    // Criterion 3: the Car filter redraws: the Corolla has nothing that year, so no month chart and no category section.
    await page.selectOption(rpCarSel, rpA)
    const none = await chartsAre({ months: null, categories: null }, `${py}, Corolla`)
    if (none.hasCategories) throw new Error('category section for a year with no costs')
    // And the Year filter: the Corolla's 300 in March on Oil and Brakes.
    await page.selectOption(yearSel, String(ly))
    await page.locator('main .category-chart').waitFor()
    const [a, b] = (await rpCharts()).rows
    await chartsAre({ months: m({ 2: 1 }), categories: `${a}${await rpMoney(150)}=1,${b}${await rpMoney(150)}=1` }, `${ly}, Corolla`)
    // A tiny amount keeps a 2px bar, so it doesn't look like 0: 0.5 in May with no task, against 300.
    await apiCall('POST', `/vehicles/${rpA}/service-records`, { date: `${ly}-05-10`, odometerKm: 50000, totalCost: 0.5 })
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll('main .category-chart > div').length === 3, null, { timeout: 5000 })
    const tiny = await chartsAre({ months: m({ 2: 1, 4: 0.02 }), categories: `${a}${await rpMoney(150)}=1,${b}${await rpMoney(150)}=1,${RP.noTask}${await rpMoney(0.5)}=${(await rpCharts()).categories?.[2]?.w}` }, `${ly}, Corolla, tiny`)
    if (tiny.months[4].px !== 2 || tiny.categories[2].px !== 2) throw new Error(`tiny bars ${tiny.months[4].px}px and ${tiny.categories[2].px}px`)
  })
  // RPT-3: CSV export and print. A year of its own with 3 records on two cars, so the whole file is known.
  const XP = he
    ? { csv: 'ייצוא ל־CSV', busy: 'קובץ ה־CSV בהכנה…', pdf: 'הדפסה או שמירה כ־PDF', failed: 'ייצוא ה־CSV נכשל.', diy: 'טיפול עצמי', allCars: 'כל הרכבים',
        header: (u) => `תאריך,רכב,קילומטראז׳ (${u === 'mi' ? 'מייל' : 'ק״מ'}),מוסך,משימות,עלות כוללת,מטבע,הערות`, line: (y, car, date) => `שנת ${y}, ${car}, הודפס ב־${date}` }
    : { csv: 'Export CSV', busy: 'Preparing the CSV…', pdf: 'Print or save as PDF', failed: 'The CSV was not exported.', diy: 'DIY', allCars: 'All cars',
        header: (u) => `Date,Car,Odometer (${u}),Shop,Tasks,Total cost,Currency,Notes`, line: (y, car, date) => `Year ${y}, ${car}, printed ${date}` }
  const xBtns = page.locator('main .filters .export button')
  const xState = () => xBtns.evaluateAll((bs) => bs.slice(0, 2).map((b) => `${b.textContent}:${b.getAttribute('aria-disabled')}`).join('|'))
  const xStateIs = async (want, when) => {
    await page.waitForFunction(([w]) => [...document.querySelectorAll('main .filters .export button')].slice(0, 2).map((b) => `${b.textContent}:${b.getAttribute('aria-disabled')}`).join('|') === w, [want], { timeout: 5000 })
      .catch(async () => { throw new Error(`${when}: buttons ${await xState()}, want ${want}`) })
  }
  const xReady = () => xStateIs(`${XP.csv}:false|${XP.pdf}:false`, 'ready')
  let downloads = 0
  page.on('download', () => downloads++)
  const exportCsv = async () => {
    await xReady()
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), xBtns.first().click()])
    const buf = readFileSync(await dl.path())
    if (buf[0] !== 0xef || buf[1] !== 0xbb || buf[2] !== 0xbf) throw new Error('no UTF-8 BOM')
    const text = buf.toString('utf8').slice(1)
    if (/[^\r]\n/.test(text) || !text.endsWith('\r\n')) throw new Error('lines do not end in CRLF')
    return { name: dl.suggestedFilename(), lines: text.split('\r\n').slice(0, -1) }
  }
  const ey = ly - 2
  let xA, xB, xM, xCur
  const xRows = (u) => {
    const odo = (km) => (u === 'mi' ? Math.round(km / 1.609344) : km)
    return [
      `${ey}-02-01,Export One,${odo(1500)},Garage,"Oil; Brakes",12.50,${xCur},"Oil, ""synthetic"""`,
      `${ey}-03-01,Export Car/2,${odo(2000)},${XP.diy},,,${xCur},החלפת שמן`,
      `${ey}-04-01,Export One,${odo(2500)},Shop,,100.00,${xCur},'=SUM(A1)`,
    ]
  }
  const sameTasks = (l) => l.replace('Brakes; Oil', 'Oil; Brakes') // the API's task order isn't promised
  const linesAre = (got, want, what) => { if (got.map(sameTasks).join('\n') !== want.join('\n')) throw new Error(`${what}:\n${got.join('\n')}\nwant\n${want.join('\n')}`) }
  await step('reports-csv', async () => {
    // Criteria 1 and 4: oldest first, quoting, no cost empty, ' before =, the header in the UI language, Hebrew kept.
    xCur = (await histUser()).currency
    xA = (await apiCall('POST', '/vehicles', { nickname: 'Export One', initialOdometerKm: 1000, readingDate: `${ey}-01-01` })).id
    xB = (await apiCall('POST', '/vehicles', { nickname: 'Export Car/2', initialOdometerKm: 1000, readingDate: `${ey}-01-01` })).id
    const task = async (name) => (await apiCall('POST', `/vehicles/${xA}/tasks`, { name, category: name, intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 1000, lastDoneDate: `${ey}-01-01` })).id
    await apiCall('POST', `/vehicles/${xA}/service-records`, { date: `${ey}-02-01`, odometerKm: 1500, totalCost: 12.5, shopName: 'Garage', notes: 'Oil, "synthetic"', taskIds: [await task('Oil'), await task('Brakes')] })
    await apiCall('POST', `/vehicles/${xB}/service-records`, { date: `${ey}-03-01`, odometerKm: 2000, notes: 'החלפת שמן' })
    await apiCall('POST', `/vehicles/${xA}/service-records`, { date: `${ey}-04-01`, odometerKm: 2500, totalCost: 100, shopName: 'Shop', notes: '=SUM(A1)' })
    await page.goto(`${BASE}/reports?year=${ey}`)
    const all = await exportCsv()
    if (all.name !== `onlycars-${ey}.csv`) throw new Error(`file name ${all.name}`)
    linesAre(all.lines, [XP.header('km'), ...xRows('km')], 'all cars, km')
    // Criterion 3: miles for the odometer only; costs and currency unchanged.
    await unitIs('Mi')
    await page.goto(`${BASE}/reports?year=${ey}`)
    linesAre((await exportCsv()).lines, [XP.header('mi'), ...xRows('mi')], 'all cars, miles')
    await unitIs('Km')
    // Criterion 2: a chosen car has only its records and its name, made filename-safe.
    await page.goto(`${BASE}/reports?year=${ey}&vehicleId=${xB}`)
    const one = await exportCsv()
    if (one.name !== `onlycars-${ey}-Export-Car-2.csv`) throw new Error(`car file name ${one.name}`)
    linesAre(one.lines, [XP.header('km'), xRows('km')[1]], 'one car')
  })
  await step('reports-csv-paging', async () => {
    // Criterion 2: 101 records is two pages, and every one is in the file, oldest first.
    xM = (await apiCall('POST', '/vehicles', { nickname: 'Export Many', initialOdometerKm: 1000, readingDate: `${ey}-01-01` })).id
    const day = (i) => new Date(Date.UTC(ey, 0, 2 + i)).toISOString().slice(0, 10)
    for (let i = 0; i < 101; i++) await apiCall('POST', `/vehicles/${xM}/service-records`, { date: day(i), odometerKm: 1010 + i * 10, totalCost: 1 })
    await page.goto(`${BASE}/reports?year=${ey}&vehicleId=${xM}`)
    const skips = []
    const onReq = (r) => r.url().includes('/api/service-records?') && skips.push(new URL(r.url()).searchParams.get('skip'))
    page.on('request', onReq)
    const many = await exportCsv()
    page.off('request', onReq)
    if (skips.join() !== '0,100') throw new Error(`pages fetched at skip ${skips}`)
    if (many.name !== `onlycars-${ey}-Export-Many.csv` || many.lines.length !== 102) throw new Error(`${many.name}: ${many.lines.length} lines`)
    if (many.lines[1] !== `${day(0)},Export Many,1010,${XP.diy},,1.00,${xCur},` || !many.lines[101].startsWith(`${day(100)},Export Many,2010,`)) throw new Error(`first ${many.lines[1]}, last ${many.lines[101]}`)
  })
  await step('reports-export-states', async () => {
    // Criterion 6: busy while building; a failed page shows the error with Retry and downloads nothing; Retry downloads.
    const recs = '**/api/service-records?**'
    const slow = async (r) => { await page.waitForTimeout(700); await r.continue().catch(() => {}) }
    await page.route(recs, slow)
    await xReady()
    const dl = page.waitForEvent('download', { timeout: 15000 })
    await xBtns.first().click()
    await xStateIs(`${XP.busy}:true|${XP.pdf}:false`, 'building the CSV')
    await focusIs('main .filters .export button:first-child', 'the CSV button while busy')
    await dl
    await page.unroute(recs, slow)
    await page.route(recs, (r) => (r.request().url().includes('skip=100') ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.continue()))
    const before = downloads
    await xBtns.first().click()
    const alert = page.locator('main .filters .export [role=alert]')
    if (plain(await alert.textContent()) !== `${XP.failed} ${HS.generic}`) throw new Error(`CSV error "${await alert.textContent()}"`)
    await focusIs('main .filters .export button:first-child', 'the CSV button after a failed export') // LOW-8 L147
    await page.waitForTimeout(300)
    if (downloads !== before) throw new Error('a failed export downloaded a file')
    await page.unroute(recs)
    forget500()
    const retried = page.waitForEvent('download', { timeout: 15000 })
    await page.locator('main .filters .export [role=alert] + button', { hasText: HS.retry }).click()
    if ((await (await retried).suggestedFilename()) !== `onlycars-${ey}-Export-Many.csv`) throw new Error('Retry file name')
    await alert.waitFor({ state: 'detached' })
    // Both buttons disabled while the report loads and after it failed.
    const costs = '**/api/reports/costs?**'
    const slowCosts = async (r) => { await page.waitForTimeout(700); await r.continue().catch(() => {}) }
    await page.route(costs, slowCosts)
    await page.selectOption(rpCarSel, '') // All cars; the chosen car has no other year
    await xStateIs(`${XP.csv}:true|${XP.pdf}:true`, 'while the report loads')
    await page.unroute(costs, slowCosts)
    await page.route(costs, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    await page.locator('main [role=alert]').waitFor()
    await xStateIs(`${XP.csv}:true|${XP.pdf}:true`, 'after a report error')
    await page.unroute(costs)
    forget500()
    // Criterion 7: real buttons, in tab order after the filters, with a visible focus ring; 44px and no sideways scroll at 390px.
    await page.goto(`${BASE}/reports?year=${ey}`)
    await xReady()
    await page.focus(rpCarSel)
    await page.keyboard.press('Tab')
    await focusIs('main .filters .export button:first-child', 'Export CSV after the Car filter')
    await page.keyboard.press('Tab')
    await focusIs('main .filters .export button:nth-child(2)', 'Export PDF after Export CSV')
    if ((await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)) !== 'solid') throw new Error('no focus ring')
    await at390('the reports export buttons', 'reports-export-390')
  })
  await step('reports-export-one-at-a-time', async () => {
    // LOW-5 L104: a filter change mid-export leaves the CSV button busy until that export ends; a click meanwhile starts nothing; one download.
    const recs = '**/api/service-records?**'
    const slow = async (r) => { await page.waitForTimeout(1000); await r.continue().catch(() => {}) }
    await page.goto(`${BASE}/reports?year=${ey}&vehicleId=${xM}`)
    await xReady()
    await page.route(recs, slow)
    const before = downloads
    const dl = page.waitForEvent('download', { timeout: 15000 })
    await xBtns.first().click()
    const csvBusy = () => page.waitForFunction((w) => { const b = document.querySelector('main .filters .export button'); return b?.textContent === w && b.getAttribute('aria-disabled') === 'true' }, XP.busy, { timeout: 3000 })
    await csvBusy()
    await page.selectOption(rpCarSel, '')
    await page.locator('main .by-car').waitFor()
    await csvBusy().catch(() => { throw new Error('the CSV button is not busy after the filter change') })
    await xBtns.first().click({ force: true }) // force: Playwright waits out aria-disabled, which would click after the export ends
    await csvBusy()
    if ((await (await dl).suggestedFilename()) !== `onlycars-${ey}-Export-Many.csv`) throw new Error('not the first export\'s file')
    await xReady()
    await page.waitForTimeout(2500) // a second export would need two slow pages
    await page.unroute(recs, slow)
    if (downloads !== before + 1) throw new Error(`${downloads - before} downloads`)
  })
  await step('reports-export-busy-fails-after-filter', async () => {
    // LOW-7 L111: at 390px both export buttons keep their boxes while the CSV is busy. L107: an export that fails after a filter change shows its error.
    const recs = '**/api/service-records?**'
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/reports?year=${ey}&vehicleId=${xM}`)
    await xReady()
    const boxes = () => xBtns.evaluateAll((bs) => bs.slice(0, 2).map((b) => { const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join() }).join('|'))
    const ready = await boxes()
    await page.route(recs, async (r) => { await page.waitForTimeout(1000); await r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }).catch(() => {}) })
    const before = downloads
    await xBtns.first().click()
    await xStateIs(`${XP.busy}:true|${XP.pdf}:false`, 'building the CSV')
    const busy = await boxes()
    await page.screenshot({ path: `${OUT}/${s.name}-reports-export-busy-390.png`, fullPage: true })
    if (busy !== ready) throw new Error(`buttons moved while busy: ${ready} to ${busy}`)
    await page.selectOption(rpCarSel, '')
    await page.locator('main .by-car').waitFor()
    const alert = page.locator('main .filters .export [role=alert]')
    await alert.waitFor({ timeout: 5000 }).catch(() => { throw new Error('no CSV error after a filter change mid-export') })
    if (plain(await alert.textContent()) !== `${XP.failed} ${HS.generic}`) throw new Error(`CSV error "${await alert.textContent()}"`)
    if (downloads !== before) throw new Error('a failed export downloaded a file')
    await page.unroute(recs)
    forget500()
    await page.setViewportSize(s.viewport)
  })
  await step('reports-export-leave', async () => {
    // LOW-5 L106: leaving /reports mid-export downloads nothing.
    const recs = '**/api/service-records?**'
    const slow = async (r) => { await page.waitForTimeout(1000); await r.continue().catch(() => {}) }
    await page.goto(`${BASE}/reports?year=${ey}&vehicleId=${xM}`)
    await xReady()
    await page.route(recs, slow)
    const before = downloads
    await xBtns.first().click()
    await xStateIs(`${XP.busy}:true|${XP.pdf}:false`, 'building the CSV')
    await page.click('header a[href="/"]')
    await arrivedAt(T.dashboard)
    await page.waitForTimeout(3000) // both slow pages answer meanwhile
    await page.unroute(recs, slow)
    if (downloads !== before) throw new Error('a download followed after leaving /reports')
  })
  await step('reports-print', async () => {
    // Criterion 5: Export PDF opens the print dialog (stubbed: a real one blocks the page).
    await page.goto(`${BASE}/reports?year=${ey}`)
    await page.evaluate(() => { window.printed = 0; window.print = () => window.printed++ })
    await xReady()
    await xBtns.nth(1).click()
    if ((await page.evaluate(() => window.printed)) !== 1) throw new Error('print not called')
    await page.emulateMedia({ media: 'print' })
    const got = await page.evaluate(() => {
      const css = (sel, p) => { const el = document.querySelector(sel); return el && getComputedStyle(el)[p] }
      return {
        hidden: ['header', 'main .filters', 'main button'].filter((sel) => [...document.querySelectorAll(sel)].some((el) => el.checkVisibility())),
        line: document.querySelector('main .print-only')?.checkVisibility() ? document.querySelector('main .print-only').textContent : null,
        colors: [css('html', 'backgroundColor'), css('main .card', 'backgroundColor'), css('main h2', 'color'), css('main .figures dd', 'color')].join(),
        bar: [css('main .month-chart span[style]', 'backgroundColor'), css('main .month-chart span[style]', 'printColorAdjust')].join(),
        link: css('main .report a', 'textDecorationLine'),
        dir: getComputedStyle(document.querySelector('main')).direction,
      }
    })
    if (got.hidden.length) throw new Error(`printed: ${got.hidden}`)
    const date = await page.evaluate((l) => new Date().toLocaleDateString(l, { dateStyle: 'medium' }), s.lng)
    if (plain(got.line ?? '') !== XP.line(ey, XP.allCars, date)) throw new Error(`print line "${got.line}"`)
    // LOW-5 L103: the date is the one when printing starts: the clock moves 3 days on, then beforeprint.
    const later = await page.evaluate((l) => {
      const D = Date, at = D.now() + 3 * 86_400_000
      window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [at])) } static now() { return at } }
      try { dispatchEvent(new Event('beforeprint')) } finally { window.Date = D }
      return new D(at).toLocaleDateString(l, { dateStyle: 'medium' })
    }, s.lng)
    const printed = plain(await page.locator('main .print-only').textContent())
    if (later === date || printed !== XP.line(ey, XP.allCars, later)) throw new Error(`after beforeprint "${printed}", want the date ${later}`)
    if (got.colors !== 'rgb(255, 255, 255),rgb(255, 255, 255),rgb(0, 0, 0),rgb(0, 0, 0)') throw new Error(`print colors ${got.colors}`)
    if (!got.bar.endsWith(',exact') || got.bar.startsWith('rgba(0, 0, 0, 0)')) throw new Error(`chart bar ${got.bar}`)
    if (got.link !== 'none' || got.dir !== (he ? 'rtl' : 'ltr')) throw new Error(`link ${got.link}, direction ${got.dir}`)
    await page.screenshot({ path: `${OUT}/${s.name}-reports-print.png`, fullPage: true })
    await page.pdf({ path: `${OUT}/${s.name}-reports.pdf` })
    // With a car chosen, the line names it.
    await page.goto(`${BASE}/reports?year=${ey}&vehicleId=${xB}`)
    await page.locator('main .categories, main .car-costs').first().waitFor()
    const carLine = plain(await page.locator('main .print-only').textContent())
    if (carLine !== XP.line(ey, 'Export Car/2', date)) throw new Error(`car print line "${carLine}"`)
    await page.emulateMedia({ media: null })
  })
  // NOT-1: car documents, the dashboard's Reminders, snooze and lead days, as a fresh user so the reminders are only these.
  const NT = he
    ? { types: { Insurance: 'ביטוח', Inspection: 'טסט', Registration: 'רישיון רכב', Licence: 'רישיון נהיגה' },
        empty: 'כדי לקבל תזכורת לפני שהתוקף פג, אפשר להוסיף ביטוח, טסט, רישיון רכב או רישיון נהיגה.',
        in: (n) => `התוקף יפוג בעוד ${n} ימים`, today: 'התוקף פג היום', ago: (n) => `התוקף פג לפני ${n} ימים`, on: 'בתוקף עד ',
        nothing: 'אין כרגע שום דבר שדורש תשומת לב.', snoozed: 'תזכורת אחת נדחתה', choices: ['יום', 'שבוע', 'חודש'], until: 'Oil change, Doc car: התזכורת נדחתה עד ', undo: 'ביטול הדחייה',
        overdue: 'באיחור', oilLate: 'באיחור של 2,000 ק״מ', snoozeOf: (n) => `דחייה: ${n}, Doc car`, retry: 'ניסיון חוזר',
        tooLate: 'התאריך לא יכול להיות אחרי ', tooEarly: 'התאריך לא יכול להיות לפני ',
        tooMany: 'אפשר להוסיף לרכב עד 50 מסמכים. כדי להוסיף מסמך, יש למחוק אחד מהם.',
        notFound: 'התזכורת הזו כבר לא קיימת. ייתכן שהפריט נמחק או שהרכב הועבר לארכיון.',
        leadErr: 'יש להזין מספר ימים בין 1 ל־365.', leadLimit: 'יש להזין מספר שלם של ימים בין 1 ל־365.' }
    : { types: { Insurance: 'Insurance', Inspection: 'Inspection', Registration: 'Registration', Licence: "Driver's license" },
        empty: "Add the insurance, inspection, registration or driver's license to get a reminder before it expires.",
        in: (n) => `Expires in ${n} days`, today: 'Expires today', ago: (n) => `Expired ${n} days ago`, on: 'Expires on ',
        nothing: 'Nothing needs your attention.', snoozed: '1 snoozed', choices: ['1 day', '1 week', '1 month'], until: 'Oil change (Doc car) snoozed until ', undo: 'Undo',
        overdue: 'Overdue', oilLate: 'Overdue by 2,000 km', snoozeOf: (n) => `Snooze: ${n}, Doc car`, retry: 'Retry',
        tooLate: "The date can't be after ", tooEarly: "The date can't be before ",
        tooMany: 'A car can have up to 50 documents. Delete one to add another.',
        notFound: 'This reminder is gone. Its item may have been deleted or its car archived.',
        leadErr: 'Enter a number of days from 1 to 365.', leadLimit: 'Enter a whole number of days from 1 to 365.' }
  const docs = page.locator('section[aria-labelledby=documents]')
  const rem = page.locator('section[aria-labelledby=reminders]')
  const ntNamed = (list, name) => list.filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const docRow = (type) => ntNamed(docs.locator('.documents > li'), NT.types[type])
  const remRow = (name) => ntNamed(rem.locator('.tasks > li'), name)
  const remNames = async () => (await rem.locator('.tasks > li .name').allTextContents()).map(plain)
  const docBadge = async (loc) => plain(await loc.locator('.badge').textContent())
  const fail500 = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  const problem = (body, status = 400) => (r) => r.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify(body) })
  let ntCarId, ntToday
  await step('not1-error-codes', async () => {
    // Every code in docs/contracts/NOT-1.md has a message in this language.
    const codes = ['vehicleDocument.invalidType', 'vehicleDocument.invalidExpiryDate', 'vehicleDocument.invalidCost', 'vehicleDocument.invalidNotes', 'vehicleDocument.tooMany',
      'vehicleDocument.vehicleArchived', 'vehicleDocument.invalidDate', 'vehicleDocument.notFound', 'vehicle.notFound', 'date.tooEarly', 'date.tooLate',
      'reminder.invalidDate', 'reminder.invalidSnooze', 'reminder.notFound', 'settings.invalidLeadDays']
    const errorsSrc = langSrc.slice(langSrc.indexOf('\n  errors: {'))
    const missing = codes.filter((c) => { const [g, k] = c.split('.'); return !new RegExp(`\\n    ${g}: \\{((?!\\n    \\}).)*\\n      ${k}: `, 's').test(errorsSrc) })
    if (missing.length) throw new Error(`no ${s.lng} message for ${missing}`)
  })
  let not1Auth
  await step('reminders-no-cars', async () => {
    const auth = await (await page.request.post(`${BASE}/api/auth/register`, {
      data: { email: `not1-${s.name}-${Date.now()}@onlycars.test`, password: 'Passw0rd!', locale: he ? 'He' : 'En', currency: 'ILS' },
    })).json()
    not1Auth = auth // ACC-2 deletes this user at the end (it holds the Cap car, L168)
    if (auth.user.reminderLeadDays !== 30) throw new Error(`reminderLeadDays ${auth.user.reminderLeadDays}`)
    await page.evaluate(([token, user]) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)) }, [auth.token, auth.user])
    await page.goto(`${BASE}/`)
    await page.locator('main').getByText(he ? 'עדיין אין רכבים. אפשר להוסיף את הרכב הראשון.' : 'No cars yet. Add your first one.').waitFor()
    if (await rem.count()) throw new Error('Reminders without a car')
  })
  await step('reminders-empty', async () => {
    ntToday = await localDate()
    ntCarId = (await apiCall('POST', '/vehicles', { nickname: 'Doc car', initialOdometerKm: 5000, readingDate: ntToday })).id
    // A failure with Retry, loading while it retries, then the empty state.
    // Every load fails until unrouted: in development StrictMode sends the first load twice and shows only the second.
    const isList = (u) => u.pathname === '/api/reminders'
    await page.route(isList, fail500)
    await page.reload()
    await rem.locator('[role=alert]').waitFor()
    await page.unroute(isList, fail500)
    if (plain(await rem.locator('[role=alert]').textContent()) !== RS.generic) throw new Error(`error "${await rem.locator('[role=alert]').textContent()}"`)
    await page.route(isList, async (r) => { await page.waitForTimeout(700); await r.continue() }, { times: 1 })
    const req = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/reminders')
    await rem.getByRole('button', { name: NT.retry }).click()
    if (new URL((await req).url()).searchParams.get('today') !== ntToday) throw new Error(`today ${(await req).url()}`)
    await rem.getByText(NT.nothing).waitFor()
    await focusIs('#reminders', 'the h2 after Retry')
    if (await rem.locator('[role=alert]').count()) throw new Error('error kept after Retry')
    forget500()
  })
  await step('documents-add', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/cars/${ntCarId}`)
    await docs.getByText(NT.empty).waitFor()
    const add = async (type, expiry, cost, notes) => {
      await docs.locator('button.add').click()
      const form = docs.locator('form')
      await focusIs('section[aria-labelledby=documents] select[name=type]', `type after Add (${type})`)
      await form.locator('select[name=type]').selectOption(type)
      await form.locator('input[name=expiryDate]').fill(expiry)
      if (cost != null) await form.locator('input[name=cost]').fill(String(cost))
      if (notes) await form.locator('textarea[name=notes]').fill(notes)
      const res = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/vehicles/${ntCarId}/documents`)
      await form.locator('button:not(.link)').click()
      const r = await res
      if (r.status() !== 201 || new URL(r.url()).searchParams.get('today') !== ntToday) throw new Error(`POST ${r.status()} ${r.url()}`)
      const body = r.request().postDataJSON()
      if (JSON.stringify(body) !== JSON.stringify({ type, expiryDate: expiry, cost: cost ?? null, notes: notes ?? '' })) throw new Error(`body ${JSON.stringify(body)}`)
      // SCAN-2b: on the new document's Add file, so a file or a scan is one step away.
      await focusIs(`section[aria-labelledby=documents] li[data-id="${(await r.json()).id}"] button.add-file`, `Add file after adding ${type}`)
    }
    await add('Insurance', await histDay(10), 1250, 'Comprehensive')
    await add('Inspection', ntToday)
    await add('Registration', await histDay(-3))
    await add('Licence', await histDay(100))
    const types = (await docs.locator('.documents > li .name').allTextContents()).map(plain)
    if (types.join() !== ['Registration', 'Inspection', 'Insurance', 'Licence'].map((x) => NT.types[x]).join()) throw new Error(`order ${types}`)
    for (const [type, want] of [['Insurance', NT.in(10)], ['Inspection', NT.today], ['Registration', NT.ago(3)]]) {
      if ((await docBadge(docRow(type))) !== want) throw new Error(`${type} badge "${await docBadge(docRow(type))}", want "${want}"`)
    }
    if (await docRow('Licence').locator('.badge').count()) throw new Error('a badge on an Ok document')
    const licence = plain(await docRow('Licence').locator('p').first().textContent())
    if (licence !== NT.on + (await fmtDay(await histDay(100)))) throw new Error(`Licence line "${licence}"`)
    const ins = plain(await docRow('Insurance').textContent())
    if (!ins.includes('1,250') || !ins.includes('Comprehensive')) throw new Error(`Insurance row "${ins}"`)
    await noOverflow('documents at 390px')
    await sweep('car page with documents')
    await page.setViewportSize(s.viewport)
  })
  await step('documents-edit-delete', async () => {
    // Out-of-range dates come back from the API, translated; focus returns to Save.
    const edit = (type) => docRow(type).locator('button.edit')
    await edit('Licence').click()
    const form = docRow('Licence').locator('form')
    for (const [date, msg, bound] of [['2101-01-01', NT.tooLate, '2100-12-31'], ['1899-12-31', NT.tooEarly, '1900-01-01']]) {
      await form.locator('input[name=expiryDate]').fill(date)
      await form.locator('button:not(.link)').click()
      await form.locator('[role=alert]').waitFor()
      const text = plain(await form.locator('[role=alert]').textContent())
      if (text !== `${msg}${await fmtDay(bound)}.`) throw new Error(`${date}: "${text}"`)
      await focusIs('section[aria-labelledby=documents] form button:not(.link)', `Save after ${date}`)
    }
    // A date error stays while another field changes and goes once the date is edited.
    await form.locator('input[name=cost]').fill('5')
    if (!(await form.locator('[role=alert]').count())) throw new Error('a date error cleared by editing the cost')
    await form.locator('input[name=expiryDate]').fill(ntToday)
    await form.locator('[role=alert]').waitFor({ state: 'detached' })
    // LOW-8 L158: a non-date error (the cost's, mocked) also stays while another field changes and goes once its own field is edited.
    await page.route(`**/api/vehicles/${ntCarId}/documents/*`, (r) => (r.request().method() === 'PUT' ? problem({ code: 'vehicleDocument.invalidCost' })(r) : r.fallback()), { times: 1 })
    await form.locator('button:not(.link)').click()
    await form.locator('[role=alert]').waitFor()
    if (plain(await form.locator('[role=alert]').textContent()) !== inBlock('vehicleDocument', 'invalidCost')) throw new Error(`cost error "${await form.locator('[role=alert]').textContent()}"`)
    await form.locator('textarea[name=notes]').fill('changed')
    if (!(await form.locator('[role=alert]').count())) throw new Error('a cost error cleared by editing the notes')
    await form.locator('input[name=cost]').fill('6')
    await form.locator('[role=alert]').waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await focusIs('section[aria-labelledby=documents] li button.edit', 'Edit after Escape')
    // Renewing is editing the date.
    await edit('Insurance').click()
    await docRow('Insurance').locator('input[name=expiryDate]').fill(await histDay(5))
    const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/documents/'))
    await docRow('Insurance').locator('form button:not(.link)').click()
    if ((await put).status() !== 200) throw new Error(`PUT ${(await put).status()}`)
    await docRow('Insurance').locator('.badge', { hasText: NT.in(5) }).waitFor()
    await focusIs('section[aria-labelledby=documents] li button.edit', 'Edit after Save')
    // A 51st document: the API's limit, translated.
    await page.route(`**/api/vehicles/${ntCarId}/documents?*`, (r) => (r.request().method() === 'POST' ? problem({ code: 'vehicleDocument.tooMany', max: 50 })(r) : r.continue()), { times: 1 })
    await docs.locator('button.add').click()
    await docs.locator('form input[name=expiryDate]').fill(ntToday)
    await docs.locator('form button:not(.link)').click()
    await docs.locator('form [role=alert]').waitFor()
    if (plain(await docs.locator('form [role=alert]').textContent()) !== NT.tooMany) throw new Error(`tooMany "${await docs.locator('form [role=alert]').textContent()}"`)
    await page.keyboard.press('Escape')
    // Delete asks first; focus goes to the row now in its place.
    await docRow('Licence').locator('button.edit + button').click()
    await focusIs('section[aria-labelledby=documents] li .inline-form button.link', 'Cancel in the confirm')
    await docRow('Licence').locator('button.danger').click()
    await docRow('Licence').waitFor({ state: 'detached' })
    await focusIs('section[aria-labelledby=documents] li button.edit', 'an Edit after Delete')
    if ((await docs.locator('.documents > li').count()) !== 3) throw new Error('rows after Delete')
    await page.screenshot({ path: `${OUT}/${s.name}-documents.png`, fullPage: true })
  })
  // SCAN-2b: a car document's Files, as a service's: Add file and Scan named for the document, an image and a PDF listed with sizes and
  // opened inline, a refused type, Delete asks first, the 10-file note and refusal (mocked), the document gone meanwhile (mocked);
  // deleting a document with files says so, and its file link is 404 afterwards. At 360 px.
  let insId
  const DOCFILES = () => `section[aria-labelledby=documents] .documents > li[data-id="${insId}"] .files`
  await step('documents-files', async () => {
    const listUrl = (u) => u.pathname === `/api/vehicles/${ntCarId}/documents`
    const ten = async (r) => {
      const res = await r.fetch()
      const xs = await res.json()
      await r.fulfill({ response: res, json: xs.map((x) => (x.id !== insId ? x : { ...x, attachments: [...Array(10)].map((_, i) => ({ ...x.attachments[0], id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })) })) })
    }
    await page.setViewportSize({ width: 360, height: 780 })
    try {
      await page.goto(`${BASE}/cars/${ntCarId}`)
      await docRow('Insurance').waitFor()
      insId = await docRow('Insurance').getAttribute('data-id')
      const add = `${DOCFILES()} button.add-file`, scan = `${DOCFILES()} button.scan`
      const named = async (k) => plain(key(k)).replace('{{name}}', NT.types.Insurance).replace('{{date}}', await fmtDay(await histDay(5)))
      if (plain(await page.getAttribute(add, 'aria-label')) !== await named('addFileToDocument')) throw new Error(`Add file label "${await page.getAttribute(add, 'aria-label')}"`)
      if (plain(await page.getAttribute(scan, 'aria-label')) !== await named('scanToDocument')) throw new Error(`Scan label "${await page.getAttribute(scan, 'aria-label')}"`)
      const chooseDoc = async (file) => { const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click(add)]); await c.setFiles(file) }
      const alertIs = async (want, what) => {
        const el = page.locator(`${DOCFILES()} p.error[role=alert]`)
        await el.waitFor()
        if (plain(await el.textContent()) !== plain(want)) throw new Error(`${what}: "${await el.textContent()}"`)
      }
      await chooseDoc({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
      await alertIs(AF.unsupported, 'a .txt file')
      const post = () => page.waitForResponse((r) => r.url().endsWith(`/documents/${insId}/attachments`) && r.request().method() === 'POST')
      for (const [i, file] of [{ name: 'policy.png', mimeType: 'image/png', buffer: await image('image/png') }, { name: 'פוליסה.pdf', mimeType: 'application/pdf', buffer: pdf }].entries()) {
        const res = post()
        await chooseDoc(file)
        if ((await res).status() !== 200) throw new Error(`upload ${file.name}: ${(await res).status()}`)
        await page.locator(`${DOCFILES()} li >> nth=${i}`).waitFor()
        await focusIs(add, `Add file after uploading ${file.name}`)
      }
      if (await page.locator(`${DOCFILES()} p.error`).count()) throw new Error('the error stayed after an upload')
      // After a reload: both, in upload order, with sizes; each link serves its file inline.
      await page.reload()
      await page.locator(`${DOCFILES()} li >> nth=1`).waitFor()
      const names = (await page.locator(`${DOCFILES()} li a bdi`).allTextContents()).map(plain)
      if (names.join('|') !== 'policy.png|פוליסה.pdf') throw new Error(`names ${names}`)
      const sizes = (await page.locator(`${DOCFILES()} li > span.muted`).allTextContents()).map(plain)
      if (!sizes.every((x) => /^[\d.,]+ (KB|ק״ב)$/.test(x))) throw new Error(`sizes ${JSON.stringify(sizes)}`)
      for (const [i, type] of [[0, 'image/png'], [1, 'application/pdf']]) {
        const r = await page.request.get(await page.locator(`${DOCFILES()} li a >> nth=${i}`).getAttribute('href'))
        if (r.status() !== 200 || r.headers()['content-type'] !== type || !r.headers()['content-disposition']?.startsWith('inline')) throw new Error(`file ${i}: ${r.status()} ${r.headers()['content-type']}`)
      }
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.click(`${DOCFILES()} li a >> nth=1`)])
      await popup.waitForURL((u) => u.pathname.endsWith('.pdf'), { timeout: 10000 })
      await popup.close()
      await noOverflow('a document with files at 360px')
      await sweep('a document with files at 360px')
      await page.screenshot({ path: `${OUT}/${s.name}-documents-files.png`, fullPage: true })
      // Delete asks first; focus goes to the list.
      await page.locator(`${DOCFILES()} li >> nth=1`).locator('button.link').click()
      if (plain(await page.locator(`${DOCFILES()} .inline-form p`).textContent()) !== AF.confirm) throw new Error('file delete confirm text')
      const del = page.waitForResponse((r) => r.url().includes(`/documents/${insId}/attachments/`) && r.request().method() === 'DELETE')
      await page.click(`${DOCFILES()} button.danger`)
      if ((await del).status() !== 204) throw new Error(`delete ${(await del).status()}`)
      await page.waitForFunction((sel) => document.querySelectorAll(`${sel} li`).length === 1, DOCFILES(), { timeout: 5000 })
      await focusIs(DOCFILES(), 'the list after a delete')
      // The API's 10-file refusal, in the document's words; then 10 files (mocked): no Add file or Scan, and the note.
      await page.route(`**/api/vehicles/${ntCarId}/documents/${insId}/attachments`, problem({ code: 'attachment.tooMany', maxCount: 10 }), { times: 1 })
      await chooseDoc({ name: 'more.png', mimeType: 'image/png', buffer: await image('image/png') })
      await alertIs(inBlock('documentFile', 'tooMany'), 'the 10-file refusal')
      await page.route(listUrl, ten)
      await page.reload()
      await page.locator(`${DOCFILES()} li >> nth=9`).waitFor()
      await page.unroute(listUrl, ten)
      if (await page.locator(`${add}, ${scan}`).count()) throw new Error('Add file or Scan at 10 files')
      if (plain(await page.locator(`${DOCFILES()} > p.muted`).textContent()) !== plain(key('documentFilesMax'))) throw new Error('no 10-file note')
      // Deleted in another tab (mocked): the list reloads with the gone note, not an error.
      await page.reload()
      await page.locator(add).waitFor()
      await page.route(`**/api/vehicles/${ntCarId}/documents/${insId}/attachments`, problem({ code: 'vehicleDocument.notFound' }, 404), { times: 1 })
      await chooseDoc({ name: 'more.png', mimeType: 'image/png', buffer: await image('image/png') })
      await docs.locator('p[role=status]', { hasText: plain(key('documentGone')) }).waitFor()
      if (await docs.locator('[role=alert]').count()) throw new Error('an error with the gone note')
      // A document with a file: its delete confirm says the files go too, and afterwards the file's link is 404.
      const lic = await apiCall('POST', `/vehicles/${ntCarId}/documents?today=${ntToday}`, { type: 'Licence', expiryDate: await histDay(100), cost: null, notes: null })
      const token = await page.evaluate(() => localStorage.getItem('token'))
      const up = await page.request.post(`${BASE}/api/vehicles/${ntCarId}/documents/${lic.id}/attachments`, { headers: { Authorization: `Bearer ${token}` }, multipart: { file: { name: 'licence.png', mimeType: 'image/png', buffer: await image('image/png') } } })
      if (up.status() !== 200) throw new Error(`API upload ${up.status()}`)
      const link = (await up.json()).attachments[0].url
      await page.reload()
      await docRow('Licence').locator('button.edit + button').click()
      const q = plain(await docRow('Licence').locator('.inline-form p').textContent())
      if (q !== `${plain(key('confirmDeleteDocument'))} ${plain(key('filesDeletedToo'))}`) throw new Error(`document delete confirm "${q}"`)
      await docRow('Licence').locator('.inline-form button.danger').click()
      await docRow('Licence').waitFor({ state: 'detached' })
      if ((await page.request.get(link)).status() !== 404) throw new Error("the deleted document's file still opens")
    } finally {
      await page.unroute(listUrl, ten)
      await page.setViewportSize(s.viewport)
    }
  })
  // SCAN-2b: the scanner's File name, on a document: the default, the fixed .pdf at the end, Enter saves nothing, a failed upload keeps
  // the name, the saved names (a/b, Hebrew with .PDF, cleared), and the default again on reopen. At 360 px.
  await step('scan-name', async () => {
    const D = 'dialog.scanner', NAME = `${D} .scan-name input`
    const scan = () => `${DOCFILES()} button.scan`
    await page.setViewportSize({ width: 360, height: 780 })
    try {
      await page.goto(`${BASE}/cars/${ntCarId}`)
      await page.locator(scan()).waitFor()
      const today = await localDate()
      const photo = { name: 'paper.png', mimeType: 'image/png', buffer: await image('image/png') }
      const toPages = async () => {
        const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click(scan())])
        await c.setFiles(photo)
        await page.locator(`${D} button.corner >> nth=3`).waitFor()
        await page.click(`${D} .actions button:not(.add)`)
        await page.locator(NAME).waitFor()
      }
      const save = async (typed, want) => {
        await page.fill(NAME, typed)
        const res = page.waitForResponse((r) => r.url().endsWith(`/documents/${insId}/attachments`) && r.request().method() === 'POST')
        await page.click(`${D} button.save-scan`)
        if ((await res).status() !== 200) throw new Error(`"${typed}": upload ${(await res).status()}`)
        const got = (await (await res).json()).attachments.at(-1)
        if (got.fileName !== want || got.contentType !== 'application/pdf') throw new Error(`"${typed}" saved as ${got.fileName} ${got.contentType}`)
        await page.locator(D).waitFor({ state: 'detached' })
        await focusIs(scan(), `Scan after saving "${typed}"`)
        if ((await page.locator(`${DOCFILES()} li a bdi`).allTextContents()).filter((x) => plain(x) === want).length !== 1) throw new Error(`${want} not listed once`)
      }
      await toPages()
      if ((await page.inputValue(NAME)) !== `scan-${today}`) throw new Error(`default "${await page.inputValue(NAME)}"`)
      if ((await page.getAttribute(NAME, 'maxlength')) !== '251' || (await page.getAttribute(NAME, 'dir')) !== 'auto') throw new Error('maxlength or dir')
      if ((await page.getByLabel(plain(key('scanName')), { exact: true }).count()) !== 1) throw new Error('the field has no File name label')
      // .pdf at the end: right of the field in English, left of it in Hebrew.
      const [field, ext] = [await page.locator(NAME).boundingBox(), await page.locator(`${D} .scan-name [dir=ltr]`).boundingBox()]
      if ((ext.x < field.x) !== he || plain(await page.locator(`${D} .scan-name [dir=ltr]`).textContent()) !== '.pdf') throw new Error(`.pdf at ${ext.x}, the field at ${field.x}`)
      await tall(page.locator(NAME), 'the File name field')
      const over = await page.evaluate((d) => { const el = document.querySelector(d); return el.scrollWidth - el.clientWidth }, D)
      if (over > 0) throw new Error(`the scanner scrolls sideways by ${over}px`)
      // Enter saves nothing and keeps the scanner open.
      let posts = 0
      const count = (r) => r.method() === 'POST' && r.url().includes('/attachments') && posts++
      page.on('request', count)
      await page.fill(NAME, 'a/b')
      await page.press(NAME, 'Enter')
      await page.waitForTimeout(300)
      page.off('request', count)
      if (posts || !(await page.locator(D).isVisible())) throw new Error('Enter saved or closed the scanner')
      await page.screenshot({ path: `${OUT}/${s.name}-scan-name.png` })
      // Offline: the error, with the name and the page kept; then saved under that name.
      await ctx.setOffline(true)
      await page.click(`${D} button.save-scan`)
      await page.locator(`${D} p.error[role=alert]`).waitFor({ timeout: 10000 })
      await ctx.setOffline(false)
      if ((await page.inputValue(NAME)) !== 'a/b' || (await page.locator(`${D} .scan-pages li`).count()) !== 1) throw new Error('the name or the page went with the failed Save')
      await save('a/b', 'a-b.pdf')
      await toPages()
      if ((await page.inputValue(NAME)) !== `scan-${today}`) throw new Error('the name did not reset on reopen')
      await save('פוליסה 2027.PDF', 'פוליסה 2027.PDF')
      await toPages()
      await save('', `scan-${today}.pdf`)
    } finally {
      await ctx.setOffline(false)
      // Back to one file, for documents-archived.
      const doc = (await apiCall('GET', `/vehicles/${ntCarId}/documents?today=${ntToday}`)).find((x) => x.id === insId)
      for (const a of doc?.attachments.slice(1) ?? []) await apiCall('DELETE', `/vehicles/${ntCarId}/documents/${insId}/attachments/${a.id}`)
      await page.setViewportSize(s.viewport)
    }
  })
  await step('reminders-list', async () => {
    // An overdue task (due at 4,000 km) and an overdue checklist (due at 5,500 km) once the car is at 6,000 km.
    await apiCall('POST', `/vehicles/${ntCarId}/tasks`, { name: 'Oil change', category: 'Oil', intervalKm: 1000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 3000, lastDoneDate: ntToday })
    const tpl = await apiCall('POST', '/checklist-templates', { name: 'Lights check', items: [{ label: 'Lights', type: 'Check' }] })
    await apiCall('POST', `/vehicles/${ntCarId}/checklists`, { templateId: tpl.id, intervalKm: 500, intervalDays: null, date: ntToday })
    await apiCall('POST', `/vehicles/${ntCarId}/odometer`, { valueKm: 6000, readingDate: ntToday })
    await page.evaluate(() => { window.noReload = true })
    await page.click('header a.brand')
    await arrivedAt(T.dashboard)
    await remRow('Oil change').waitFor()
    const want = [NT.types.Registration, 'Lights check', 'Oil change', NT.types.Inspection, NT.types.Insurance]
    if ((await remNames()).join() !== want.join()) throw new Error(`reminders ${await remNames()}`)
    const oil = plain(await remRow('Oil change').textContent())
    if ((await docBadge(remRow('Oil change'))) !== NT.overdue || !oil.includes(NT.oilLate)) throw new Error(`task row "${oil}"`)
    if ((await docBadge(remRow(NT.types.Registration))) !== NT.ago(3)) throw new Error(`Registration "${await docBadge(remRow(NT.types.Registration))}"`)
    if ((await docBadge(remRow(NT.types.Insurance))) !== NT.in(5)) throw new Error(`Insurance "${await docBadge(remRow(NT.types.Insurance))}"`)
    const links = await rem.locator('.tasks > li a').evaluateAll((as) => as.map((a) => `${a.getAttribute('href')} ${a.textContent}`))
    if (links.length !== 5 || links.some((h) => h !== `/cars/${ntCarId} Doc car`)) throw new Error(`links ${links}`)
    if (await rem.getByText(NT.snoozed).count()) throw new Error('a snoozed count with nothing snoozed')
    const label = plain(await remRow('Oil change').locator('button.snooze').getAttribute('aria-label'))
    if (label !== NT.snoozeOf('Oil change')) throw new Error(`Snooze label "${label}"`)
    await at390('the dashboard with reminders', 'reminders')
    await remRow(NT.types.Insurance).getByRole('link').click()
    await arrivedAt('Doc car')
    await page.click('header a.brand')
    await remRow('Oil change').waitFor()
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('reminders-snooze', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const oilSnooze = 'section[aria-labelledby=reminders] li[data-key^="Task-"] button.snooze'
    const group = remRow('Oil change').locator('[role=group]')
    // The first choice has focus when they open; Escape closes them and goes back to Snooze.
    await remRow('Oil change').locator('button.snooze').click()
    if (plain(await group.getAttribute('aria-label')) !== NT.snoozeOf('Oil change')) throw new Error(`group label "${await group.getAttribute('aria-label')}"`)
    const choices = (await group.locator('button:not(.link)').allTextContents()).map(plain)
    if (choices.join() !== NT.choices.join()) throw new Error(`choices ${choices}`)
    await focusIs('section[aria-labelledby=reminders] [role=group] button', 'the first choice')
    await noOverflow('the snooze choices')
    await sweep('the dashboard with the snooze choices')
    await page.screenshot({ path: `${OUT}/${s.name}-snooze-choices.png`, fullPage: true })
    await page.keyboard.press('Escape')
    await focusIs(oilSnooze, 'Snooze after Escape')
    // A failed snooze keeps the choices, with the error and focus on the choice tried.
    await page.route('**/api/reminders/snooze', fail500, { times: 1 })
    await remRow('Oil change').locator('button.snooze').click()
    await group.getByRole('button', { name: NT.choices[0], exact: true }).click()
    await remRow('Oil change').locator('[role=alert]').waitFor()
    if (plain(await remRow('Oil change').locator('[role=alert]').textContent()) !== RS.generic) throw new Error('snooze error')
    await focusIs('section[aria-labelledby=reminders] [role=group] button:first-child', 'the choice after a failed snooze')
    forget500()
    // Keyboard: Tab to 1 week, Enter. The row goes, "Snoozed until" with Undo takes focus, and the count shows.
    await page.keyboard.press('Tab')
    const post = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/reminders/snooze'))
    await page.keyboard.press('Enter')
    const body = (await post).request().postDataJSON()
    if (body.kind !== 'Task' || body.days !== 7 || body.today !== ntToday) throw new Error(`snooze body ${JSON.stringify(body)}`)
    const until = (await (await post).json()).snoozedUntil
    if (until !== await histDay(7)) throw new Error(`snoozedUntil ${until}`)
    await remRow('Oil change').waitFor({ state: 'detached' })
    await focusIs('section[aria-labelledby=reminders] .undo button', 'Undo after snoozing')
    const msg = plain(await rem.locator('.undo [id]').textContent())
    if (msg !== `${NT.until}${await fmtDay(until)}.`) throw new Error(`undo message "${msg}"`)
    if ((await rem.locator('.undo').getAttribute('role')) !== 'status') throw new Error('the message is not a live region')
    if (plain(await rem.locator('.undo button').textContent()) !== NT.undo) throw new Error('Undo label')
    await rem.getByText(NT.snoozed).waitFor()
    await noOverflow('the snoozed message')
    await sweep('the dashboard after snoozing')
    await page.screenshot({ path: `${OUT}/${s.name}-snoozed.png`, fullPage: true })
    // Undo brings the row back, with focus on its Snooze.
    const del = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/api/reminders/snooze?'))
    await rem.locator('.undo button').click()
    if (!(await del).url().includes('kind=Task&refId=')) throw new Error(`DELETE ${(await del).url()}`)
    await remRow('Oil change').waitFor()
    await focusIs(oilSnooze, 'Snooze after Undo')
    await rem.locator('.undo').waitFor({ state: 'detached' })
    if (await rem.getByText(NT.snoozed).count()) throw new Error('snoozed count after Undo')
    // A reminder gone meanwhile: the API's 404, translated.
    await page.route('**/api/reminders/snooze', problem({ code: 'reminder.notFound' }, 404), { times: 1 })
    await remRow('Lights check').locator('button.snooze').click()
    await remRow('Lights check').getByRole('button', { name: NT.choices[0], exact: true }).click()
    await remRow('Lights check').locator('[role=alert]').waitFor()
    if (plain(await remRow('Lights check').locator('[role=alert]').textContent()) !== NT.notFound) throw new Error('notFound message')
    await page.keyboard.press('Escape')
    // Snoozed for a month and left so: the count stays.
    await remRow('Oil change').locator('button.snooze').click()
    await remRow('Oil change').getByRole('button', { name: NT.choices[2], exact: true }).click()
    await remRow('Oil change').waitFor({ state: 'detached' })
    await rem.getByText(NT.snoozed).waitFor()
    await page.setViewportSize(s.viewport)
  })
  await step('reminders-lead-days', async () => {
    await page.evaluate(() => { window.noReload = true })
    await openSettings()
    const input = page.locator('input[name=reminderLeadDays]')
    const form = page.locator('form', { has: input })
    if ((await input.inputValue()) !== '30') throw new Error(`lead days ${await input.inputValue()}`)
    if (!(await page.locator(`#${await input.getAttribute('aria-describedby')}`).isVisible())) throw new Error('no hint')
    // Out of range: the browser stops it with the translated message, before any request.
    let puts = 0
    const count = (r) => r.method() === 'PUT' && puts++
    page.on('request', count)
    await input.fill('366')
    await form.locator('button').click()
    const v = plain(await input.evaluate((el) => el.validationMessage))
    page.off('request', count)
    if (v !== NT.leadLimit) throw new Error(`validation "${v}"`)
    if (puts) throw new Error('366 was sent')
    // The API's refusal, translated, and the saved value back.
    await page.route('**/api/me/settings', problem({ code: 'settings.invalidLeadDays', min: 1, max: 365 }), { times: 1 })
    await input.fill('20')
    await form.locator('button').click()
    await form.locator('[role=alert]').waitFor()
    if (plain(await form.locator('[role=alert]').textContent()) !== NT.leadErr) throw new Error(`lead error "${await form.locator('[role=alert]').textContent()}"`)
    if ((await input.inputValue()) !== '30') throw new Error(`not put back: ${await input.inputValue()}`)
    await noOverflow('settings with lead days')
    await sweep('settings with lead days')
    // 3 days: Insurance (in 5 days) leaves Reminders; Inspection (today) stays. Back to 30 brings it back. No reload.
    await page.click('header a.brand')
    const setLead = async (n) => {
      await openSettings()
      await input.fill(String(n))
      const res = putSettings()
      await input.press('Enter')
      if (JSON.stringify((await res).request().postDataJSON()) !== JSON.stringify({ reminderLeadDays: n })) throw new Error('PUT body')
      await savedShown()
      if ((await page.evaluate(() => JSON.parse(localStorage.getItem('user')).reminderLeadDays)) !== n) throw new Error('cached user')
      await page.click('header a.brand')
      await remRow(NT.types.Inspection).waitFor()
    }
    await setLead(3)
    if ((await remNames()).includes(NT.types.Insurance)) throw new Error(`Insurance with 3 lead days: ${await remNames()}`)
    await setLead(30)
    await remRow(NT.types.Insurance).waitFor()
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  // NOT-2: the daily email toggle, on by default; off and on again round-trips through the API and the cached user.
  await step('settings-email-reminders', async () => {
    await openSettings()
    const box = page.locator('input[name=emailReminders]')
    if (!(await box.isChecked())) throw new Error('email reminders not on by default')
    if (!(await page.locator(`#${await box.getAttribute('aria-describedby')}`).isVisible())) throw new Error('no hint')
    for (const on of [false, true]) {
      const res = putSettings()
      await box.setChecked(on)
      if (JSON.stringify((await res).request().postDataJSON()) !== JSON.stringify({ emailReminders: on })) throw new Error('PUT body')
      await savedShown()
      if ((await page.evaluate(() => JSON.parse(localStorage.getItem('user')).emailReminders)) !== on) throw new Error('cached user')
      if ((await apiCall('GET', '/me')).emailReminders !== on) throw new Error(`API emailReminders not ${on}`)
    }
    await tall(box.locator('xpath=..'), 'the email reminders label')
  })
  // ERR-1b: a render error (the dev-only test button) shows the error page; no sideways scroll at 360px; Reload by keyboard brings the app back.
  await step('crash-page', async () => {
    const logged = run.consoleErrors.length
    // Off Settings first (settings-email-reminders leaves us there), so openSettings navigates and moves focus.
    await page.goto(`${BASE}/`)
    await page.locator('main h1').waitFor()
    const h1 = page.locator('main [role=alert] h1')
    const crash = async () => {
      await openSettings()
      await page.getByRole('button', { name: 'Throw test error', exact: true }).click()
      await h1.waitFor()
    }
    // Back after a crash leaves the error page for the page before.
    await crash()
    await page.goBack()
    await page.locator('main h1').filter({ hasNotText: key('crashTitle') }).waitFor()
    if (await h1.count()) throw new Error('error page still shown after Back')
    await crash()
    if (plain(await h1.textContent()) !== key('crashTitle')) throw new Error(`h1 "${await h1.textContent()}"`)
    await titleIs(key('crashTitle'))
    const vp = page.viewportSize()
    await page.setViewportSize({ width: 360, height: vp.height })
    const over = await overflowPx()
    await page.screenshot({ path: `${OUT}/${s.name}-crash-360.png`, fullPage: true })
    await page.setViewportSize(vp)
    if (over > 0) throw new Error(`${over}px sideways scroll at 360px`)
    await focusIs('main h1', 'h1 after the crash')
    await page.keyboard.press('Tab')
    await focusIs('main .actions button', 'Reload after Tab')
    if (plain(await page.locator('main .actions button').textContent()) !== key('reload')) throw new Error('Reload label')
    await tall(page.locator('main .actions button'), 'Reload')
    const home = page.locator('main .actions a')
    if (plain(await home.textContent()) !== key('goToDashboard') || (await home.getAttribute('href')) !== '/') throw new Error('Go to dashboard link')
    await tall(home, 'Go to dashboard')
    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')])
    await page.locator('input[name=emailReminders]').waitFor()
    // React logs the caught test error; it is expected here.
    run.consoleErrors.splice(logged, Infinity, ...run.consoleErrors.slice(logged).filter((e) => !/ERR-1 test error|error boundary|CrashBoundary/.test(e)))
  })
  await step('documents-archived', async () => {
    await apiCall('POST', `/vehicles/${ntCarId}/archive`)
    await page.goto(`${BASE}/cars/${ntCarId}`)
    await docRow('Insurance').waitFor()
    // SCAN-2b: only the Insurance file left by scan-name, which opens and deletes; no Add file, Scan, Edit or Delete document.
    if (await docs.locator('button:not(.fold)').count() !== 1 || await docRow('Insurance').locator('.files li button.link').count() !== 1) throw new Error("buttons on an archived car's documents")
    if (await docs.locator('button.add-file, button.scan').count() || !(await docRow('Insurance').locator('.files li a[href^="https:"]').count())) throw new Error("an archived car's document files")
    await page.goto(`${BASE}/`)
    await page.locator('main h1').waitFor()
    await page.waitForLoadState('networkidle')
    if (await rem.count()) throw new Error('Reminders with only an archived car')
  })
  // LOW-8 criterion 2 (L155, L160): with the browser 14 hours ahead of UTC and 11 behind, a task due today, one due yesterday and a document
  // expiring today show the same status on the car page, the dashboard and Reminders, as of the browser's date. Then snooze and Mark done,
  // and a document deleted in a second tab. As the NOT-1 user, in a new context with that time zone.
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) await step(`time-zone-${timezoneId.split('/')[1]}`, async () => {
    const tz = await browser.newContext({ timezoneId, viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
    let car // L187: archived in the finally, so a failed step leaves no time-zone car on the user's dashboard (there is no car delete)
    try {
      const p = await tz.newPage()
      p.on('pageerror', (e) => run.consoleErrors.push(`${timezoneId}: ${e}`))
      await p.goto(`${BASE}/login`)
      const today = await p.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
      const day = (n) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10)
      car = await apiCall('POST', '/vehicles', { nickname: `TZ ${timezoneId.split('/')[1]}`, initialOdometerKm: 1000, readingDate: day(-40) })
      const task = (name, last) => apiCall('POST', `/vehicles/${car.id}/tasks`, { name, category: 'Other', intervalKm: null, intervalDays: 30, dueSoonPercent: 10, lastDoneOdometerKm: 1000, lastDoneDate: last })
      const [dueToday, dueYesterday] = [await task('Due today', day(-30)), await task('Due yesterday', day(-31))]
      const doc = await apiCall('POST', `/vehicles/${car.id}/documents?today=${today}`, { type: 'Inspection', expiryDate: today, cost: null, notes: null })
      const want = { [dueToday.id]: 'status-DueSoon', [dueYesterday.id]: 'status-Overdue', [doc.id]: 'status-Expiring' }
      const expect = async (where, rows) => {
        for (const [id, li] of Object.entries(rows)) {
          await li.waitFor()
          const got = `${await li.getAttribute('class')} ${plain(await li.locator('.badge').first().textContent())}`
          if (!`${got} `.startsWith(`${want[id]} `)) throw new Error(`${timezoneId} ${where}: "${got}", want ${want[id]} (browser date ${today})`)
          want[id] = got // the same class and badge text in the next place
        }
      }
      await p.evaluate(([t, u, l]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('i18nextLng', l) }, [not1Auth.token, not1Auth.user, s.lng])
      const tasksGet = p.waitForRequest((r) => r.method() === 'GET' && pathOf(r) === `/api/vehicles/${car.id}/tasks`)
      await p.goto(`${BASE}/cars/${car.id}`)
      if (new URL((await tasksGet).url()).searchParams.get('today') !== today) throw new Error(`tasks today ${(await tasksGet).url()}`)
      const taskLi = (id) => p.locator(`section[aria-labelledby=maintenance] li[data-id="${id}"]`)
      await expect('car page', { [dueToday.id]: taskLi(dueToday.id), [dueYesterday.id]: taskLi(dueYesterday.id), [doc.id]: p.locator(`.documents > li[data-id="${doc.id}"]`) })
      if (plain(await p.locator(`.documents > li[data-id="${doc.id}"] .badge`).textContent()) !== NT.today) throw new Error('document not "expires today"')
      await p.goto(`${BASE}/`)
      const dashLi = (id) => p.locator(`.cars > li[data-id="${car.id}"] .dash-tasks > li[data-id="${id}"]`)
      await expect('dashboard', { [dueToday.id]: dashLi(dueToday.id), [dueYesterday.id]: dashLi(dueYesterday.id) })
      const remLi = (kind, id) => p.locator(`section[aria-labelledby=reminders] li[data-key="${kind}-${id}"]`)
      await expect('Reminders', { [dueToday.id]: remLi('Task', dueToday.id), [dueYesterday.id]: remLi('Task', dueYesterday.id), [doc.id]: remLi('Document', doc.id) })
      await p.screenshot({ path: `${OUT}/${s.name}-tz-${timezoneId.split('/')[1]}.png`, fullPage: true })
      // Snooze the overdue task, then Mark done on its dashboard row: it stays out of Reminders and is no longer counted as snoozed.
      const remSec = p.locator('section[aria-labelledby=reminders]')
      const remApi = async () => (await p.request.get(`${BASE}/api/reminders?today=${today}`, { headers: { Authorization: `Bearer ${not1Auth.token}` } })).json()
      const snoozedBefore = (await remApi()).snoozedCount
      await remLi('Task', dueYesterday.id).locator('button.snooze').click()
      await remLi('Task', dueYesterday.id).locator('[role=group] button:not(.link)').first().click()
      await remLi('Task', dueYesterday.id).waitFor({ state: 'detached' })
      await remSec.locator('.undo').waitFor()
      if ((await remApi()).snoozedCount !== snoozedBefore + 1) throw new Error('the snooze was not counted')
      const reset = p.waitForRequest((r) => r.method() === 'POST' && pathOf(r).endsWith(`/tasks/${dueYesterday.id}/reset`))
      await dashLi(dueYesterday.id).locator('button.done').click()
      if (new URL((await reset).url()).searchParams.get('today') !== today) throw new Error(`reset today ${(await reset).url()}`)
      await p.locator(`.cars > li[data-id="${car.id}"] .dash-tasks > li.status-Ok[data-id="${dueYesterday.id}"]`).waitFor()
      await p.waitForLoadState('networkidle')
      const r = await remApi()
      if (r.items.some((x) => x.refId === dueYesterday.id)) throw new Error('the done task is still a reminder')
      if (await remLi('Task', dueYesterday.id).count()) throw new Error('the done task came back in Reminders')
      if (r.snoozedCount !== snoozedBefore) throw new Error(`snoozedCount ${r.snoozedCount} after Mark done, want ${snoozedBefore}`)
      // documentGone: the document is deleted in a second tab while this one edits it.
      await p.goto(`${BASE}/cars/${car.id}`)
      await p.locator(`.documents > li[data-id="${doc.id}"] button.edit`).click()
      const p2 = await tz.newPage()
      await p2.goto(`${BASE}/cars/${car.id}`)
      await p2.locator(`.documents > li[data-id="${doc.id}"] button.edit + button`).click()
      await p2.locator(`.documents > li[data-id="${doc.id}"] button.danger`).click()
      await p2.locator(`.documents > li[data-id="${doc.id}"]`).waitFor({ state: 'detached' })
      await p.locator(`.documents > li[data-id="${doc.id}"] form button:not(.link)`).click()
      await p.locator('section[aria-labelledby=documents] > p[role=status]', { hasText: key('documentGone') }).waitFor()
      // The list drops the row after the status shows: wait for it rather than count at once (L214).
      await p.locator(`.documents > li[data-id="${doc.id}"]`).waitFor({ state: 'detached', timeout: 3000 }).catch(() => { throw new Error('the deleted document is still listed') })
      await p.waitForFunction(() => document.activeElement?.matches('section[aria-labelledby=documents] button.add'), null, { timeout: 3000 })
    } finally {
      await tz.close()
      // a failed clean-up must not hide the step's own error
      if (car) await apiCall('POST', `/vehicles/${car.id}/archive`).catch((e) => console.warn('tz archive', e))
    }
  })
  // ACC-1: Export my data on Settings. The server allows 5 exports per 10 minutes per user: this step makes 3 real ones.
  await step('export-data', async () => {
    const XD = { export: key('exportData'), busy: key('exportDataBusy'), done: key('downloaded'), failed: key('exportDataFailed'),
      rate: he ? 'יותר מדי בקשות ייצוא. אפשר לנסות שוב בעוד כמה דקות.' : 'Too many exports. Try again in a few minutes.' }
    // The NOT-1 user is signed in; give it a car with a service record to find in the file.
    const xCar = await apiCall('POST', '/vehicles', { nickname: 'Export car', initialOdometerKm: 5000, readingDate: ntToday })
    await apiCall('POST', `/vehicles/${xCar.id}/service-records`, { date: ntToday, odometerKm: 5000, totalCost: 120.5 })
    const email = await page.evaluate(() => JSON.parse(localStorage.getItem('user')).email)
    await openSettings()
    const sec = page.locator('main section[aria-labelledby=your-data]')
    const btn = sec.locator('.export button.stack').first()
    const alert = sec.locator('[role=alert]')
    const exportUrl = '**/api/me/export'
    let sent = 0
    const count = (r) => r.url().endsWith('/api/me/export') && sent++
    page.on('request', count)
    // A real download, by keyboard, through a slow route: busy keeps the width and focus, a second press sends nothing.
    const slow = async (r) => { await page.waitForTimeout(700); await r.continue().catch(() => {}) }
    await page.route(exportUrl, slow, { times: 1 })
    const width = (await btn.boundingBox()).width
    await page.locator('input[name=emailReminders]').focus()
    await page.keyboard.press('Tab')
    await focusIs('main section[aria-labelledby=your-data] button.stack', 'Export after the email reminders box')
    if ((await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)) !== 'solid') throw new Error('no focus ring')
    const dl = page.waitForEvent('download', { timeout: 15000 })
    await page.keyboard.press('Enter')
    await btn.filter({ hasText: XD.busy }).waitFor({ timeout: 3000 })
    if ((await btn.getAttribute('aria-disabled')) !== 'true') throw new Error('not aria-disabled while busy')
    if ((await btn.boundingBox()).width !== width) throw new Error(`width ${width} became ${(await btn.boundingBox()).width}`)
    await page.keyboard.press('Enter')
    await btn.click({ force: true }) // Playwright waits for aria-disabled to clear otherwise
    await focusIs('main section[aria-labelledby=your-data] button.stack', 'Export while busy')
    const file = await dl
    const text = readFileSync(await file.path(), 'utf8')
    const data = JSON.parse(text)
    if (sent !== 1) throw new Error(`${sent} export requests`)
    const name = `onlycars-export-${data.exportedAt.slice(0, 10)}.json`
    if (file.suggestedFilename() !== name) throw new Error(`file name ${file.suggestedFilename()}, want ${name}`)
    const keys = 'formatVersion,exportedAt,units,account,vehicles,checklistTemplates'
    if (Object.keys(data).join() !== keys) throw new Error(`top-level keys ${Object.keys(data)}`)
    if (data.account.email !== email) throw new Error(`account ${data.account.email}`)
    const car = data.vehicles.find((v) => v.id === xCar.id)
    if (car?.nickname !== 'Export car' || car.serviceRecords[0]?.totalCost !== 120.5) throw new Error(`car ${JSON.stringify(car)?.slice(0, 200)}`)
    if (/passwordHash|https:\/\//i.test(text)) throw new Error('a password hash or a link in the file')
    if (plain(await sec.locator('[role=status]').textContent()) !== XD.done) throw new Error('Downloaded not announced')
    if ((await btn.textContent()) !== XD.export) throw new Error(`button "${await btn.textContent()}" after the download`)
    // Without Content-Disposition the name comes from exportedAt.
    await page.route(exportUrl, async (r) => {
      const res = await r.fetch()
      const headers = res.headers()
      delete headers['content-disposition']
      await r.fulfill({ response: res, headers })
    }, { times: 1 })
    const dl2 = page.waitForEvent('download', { timeout: 15000 })
    await btn.click()
    const name2 = (await dl2).suggestedFilename()
    if (!/^onlycars-export-\d{4}-\d{2}-\d{2}\.json$/.test(name2)) throw new Error(`fallback name ${name2}`)
    // A 500: the translated error, no Retry button, focus on Export, no download, and "Downloaded" is gone; Export again downloads for real.
    const before = downloads
    await page.route(exportUrl, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await btn.click()
    await alert.waitFor()
    if (plain(await alert.textContent()) !== `${XD.failed} ${HS.generic}`) throw new Error(`500 error "${await alert.textContent()}"`)
    if (plain(await sec.locator('[role=status]').textContent())) throw new Error('Downloaded still shown after a failure')
    if (downloads !== before) throw new Error('a failed export downloaded a file')
    // ACC-2's Delete my account (the aria-expanded opener) also lives here; only the two exports may be plain buttons.
    if ((await sec.locator('button:not([aria-expanded])').count()) !== 2) throw new Error('a second button in Your data after the error')
    await focusIs('main section[aria-labelledby=your-data] button.stack', 'Export after the error')
    const retried = page.waitForEvent('download', { timeout: 15000 })
    await page.keyboard.press('Enter')
    if ((await retried).suggestedFilename() !== name) throw new Error('Export again file name')
    await alert.waitFor({ state: 'detached' })
    await focusIs('main section[aria-labelledby=your-data] button.stack', 'Export after exporting again')
    // A 429: the export's own message, still no Retry, focus on Export.
    await page.route(exportUrl, (r) => r.fulfill({ status: 429, contentType: 'application/problem+json', headers: { 'Retry-After': '600' },
      body: JSON.stringify({ status: 429, code: 'http.429', title: 'Too many requests' }) }), { times: 1 })
    await btn.click()
    await alert.waitFor()
    if (plain(await alert.textContent()) !== `${XD.failed} ${XD.rate}`) throw new Error(`429 error "${await alert.textContent()}"`)
    if ((await sec.locator('button:not([aria-expanded])').count()) !== 2) throw new Error('a Retry after the 429')
    await focusIs('main section[aria-labelledby=your-data] button.stack', 'Export after the 429')
    // LOW-8 L162: a file cut off mid-stream still comes as a 200: it is not saved, and the export error shows (mocked).
    const cut = downloads
    await page.route(exportUrl, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Content-Disposition': 'attachment; filename=onlycars-export-cut.json' },
      body: '{"formatVersion":1,"exportedAt":"2026-10-24T00:00:00Z","vehicles":[{"id":"' }), { times: 1 })
    await btn.click()
    await alert.waitFor()
    if (plain(await alert.textContent()) !== `${XD.failed} ${HS.generic}`) throw new Error(`cut-off file error "${await alert.textContent()}"`)
    await page.waitForTimeout(300)
    if (downloads !== cut) throw new Error('a cut-off export was saved')
    await focusIs('main section[aria-labelledby=your-data] button.stack', 'Export after the cut-off file')
    await at390('settings with the export error', 'export-data-390')
    // Leaving the page mid-export aborts the request and downloads nothing.
    const left = downloads
    const aborted = page.waitForEvent('requestfailed', (r) => r.url().endsWith('/api/me/export'))
    await page.route(exportUrl, async (r) => { await page.waitForTimeout(1500); await r.continue().catch(() => {}) }, { times: 1 })
    await btn.click()
    await btn.filter({ hasText: XD.busy }).waitFor()
    await page.click('header a[href="/"]')
    await page.locator('main h1').waitFor()
    await aborted
    await page.waitForTimeout(2000)
    if (downloads !== left) throw new Error('an export downloaded after leaving Settings')
    page.off('request', count)
    if (sent !== 7) throw new Error(`${sent} export requests in all`)
    run.badResponses = run.badResponses.filter((r) => !r.includes('/api/me/export')) // the forced failures
    forget500()
  })
  // EXP-1: Download everything (ZIP). The POST returns a one-time link; the browser downloads it under the server's file name.
  // Makes 1 real export (with the 3 of export-data, within the server's 5 per 10 minutes); the errors are mocked.
  await step('export-zip', async () => {
    const XZ = { zip: key('exportZip'), busy: key('exportDataBusy'), started: key('downloadStarted'), failed: key('exportDataFailed'),
      rate: key('exportTooMany'), storage: inBlock('exportZip', 'storageUnavailable') }
    await openSettings()
    const sec = page.locator('main section[aria-labelledby=your-data]')
    const zipBtn = sec.locator('.export button.stack').nth(1)
    const alert = sec.locator('[role=alert]')
    const zipUrl = '**/api/me/export/full'
    if ((await zipBtn.textContent()) !== XZ.zip) throw new Error(`ZIP button "${await zipBtn.textContent()}"`)
    // A real one, slowed: busy keeps the width, a second press sends nothing, then one download named by the server.
    let posts = 0
    const count = (r) => r.url().endsWith('/api/me/export/full') && r.method() === 'POST' && posts++
    page.on('request', count)
    await page.route(zipUrl, async (r) => { await page.waitForTimeout(700); await r.continue().catch(() => {}) }, { times: 1 })
    const width = (await zipBtn.boundingBox()).width
    const dl = page.waitForEvent('download', { timeout: 30000 })
    await zipBtn.click()
    await zipBtn.filter({ hasText: XZ.busy }).waitFor({ timeout: 3000 })
    if ((await zipBtn.getAttribute('aria-disabled')) !== 'true') throw new Error('ZIP not aria-disabled while busy')
    if ((await zipBtn.boundingBox()).width !== width) throw new Error(`ZIP width ${width} became ${(await zipBtn.boundingBox()).width}`)
    await zipBtn.click({ force: true })
    const file = await dl
    if (!/^onlycars-export-\d{4}-\d{2}-\d{2}\.zip$/.test(file.suggestedFilename())) throw new Error(`ZIP file name ${file.suggestedFilename()}`)
    const zip = readFileSync(await file.path())
    // The entry list from the ZIP's central directory; every path data.json names is in it (or in missing-files.txt).
    const entries = new Map()
    for (let i = zip.lastIndexOf(Buffer.from('PK\x05\x06')), o = zip.readUInt32LE(i + 16), n = zip.readUInt16LE(i + 10); n > 0; n--) {
      const nameLen = zip.readUInt16LE(o + 28), local = zip.readUInt32LE(o + 42)
      entries.set(zip.toString('utf8', o + 46, o + 46 + nameLen),
        { method: zip.readUInt16LE(o + 10), size: zip.readUInt32LE(o + 20), local })
      o += 46 + nameLen + zip.readUInt16LE(o + 30) + zip.readUInt16LE(o + 32)
    }
    const read = (name) => {
      const e = entries.get(name), start = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28)
      const raw = zip.subarray(start, start + e.size)
      return (e.method === 8 ? inflateRawSync(raw) : raw).toString('utf8')
    }
    if (!entries.has('data.json')) throw new Error(`no data.json in ${[...entries.keys()]}`)
    const named = [...read('data.json').matchAll(/"path":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`))
    const missingList = entries.has('missing-files.txt') ? read('missing-files.txt') : ''
    const absent = named.filter((p) => !entries.has(p) && !missingList.includes(p))
    // shortcut: earlier steps delete this user's files, so it checks only that named files arrive; ui-tests/exp1-qa.mjs checks a user with files.
    if (absent.length) throw new Error(`data.json names files not in the ZIP: ${absent}`)
    if (posts !== 1) throw new Error(`${posts} ZIP export requests`)
    page.off('request', count)
    await sec.locator('[role=status]', { hasText: XZ.started }).waitFor({ timeout: 3000 })
    if (!page.url().endsWith('/settings')) throw new Error(`left Settings for ${page.url()}`)
    if ((await zipBtn.textContent()) !== XZ.zip) throw new Error('ZIP button still busy after the download')
    // 503, 429 and 500: each its translated message, focus back on the ZIP button, no download.
    const before = downloads
    for (const [status, code, want] of [[503, 'file.storageUnavailable', XZ.storage], [429, 'http.429', XZ.rate], [500, undefined, HS.generic]]) {
      await page.route(zipUrl, (r) => r.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify({ status, code }) }), { times: 1 })
      await zipBtn.click()
      await alert.waitFor()
      if (plain(await alert.textContent()) !== `${XZ.failed} ${want}`) throw new Error(`${status} error "${await alert.textContent()}"`)
      if (plain(await sec.locator('[role=status]').textContent())) throw new Error(`"Download started" still shown after a ${status}`)
      await focusIs('main section[aria-labelledby=your-data] .export button:nth-child(2)', `the ZIP button after a ${status}`)
      if (status === 503) {
        for (const w of [360, 390]) {
          await page.setViewportSize({ width: w, height: 844 })
          await noOverflow(`settings with the ZIP error at ${w}px`)
          await page.screenshot({ path: `${OUT}/${s.name}-export-zip-${w}.png`, fullPage: true })
        }
        await page.setViewportSize(s.viewport)
      }
    }
    if (downloads !== before) throw new Error('a failed ZIP export downloaded a file')
    // Starting the JSON export clears the ZIP's error.
    await page.route('**/api/me/export', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await sec.locator('.export button.stack').first().click()
    await alert.filter({ hasText: HS.generic }).waitFor()
    if ((await alert.count()) !== 1) throw new Error('two export errors at once')
    run.badResponses = run.badResponses.filter((r) => !r.includes('/api/me/export'))
    forget500()
  })
  // ACC-1 caps: each create's 400 tooMany shows its own message with the max.
  await step('acc1-caps', async () => {
    const CAP = he
      ? { car: 'אפשר להוסיף עד 50 רכבים.', record: 'אפשר לרשום לרכב עד 2,000 טיפולים.', reading: 'אפשר להוסיף לרכב עד 5,000 קריאות קילומטראז׳.' }
      : { car: 'You can have up to 50 cars.', record: 'A car can have up to 2,000 service records.', reading: 'A car can have up to 5,000 odometer readings.' }
    const cap = (code, max) => problem({ title: 'Validation failed', status: 400, code, max })
    const is = async (loc, want, what) => { await loc.waitFor(); if (plain(await loc.textContent()) !== want) throw new Error(`${what} "${await loc.textContent()}"`) }
    const [bad, logged] = [run.badResponses.length, run.consoleErrors.length]
    const capCar = await apiCall('POST', '/vehicles', { nickname: 'Cap car', initialOdometerKm: 5000, readingDate: ntToday })
    await page.goto(`${BASE}/cars/new`)
    await page.fill('input[name=nickname]', 'Cap car 2')
    await page.fill('input[name=initialOdometerKm]', '1000')
    await page.route('**/api/vehicles', cap('vehicle.tooMany', 50), { times: 1 })
    await page.click('form button:not(.link)')
    await is(page.locator('main [role=alert]'), CAP.car, 'car cap')
    await page.goto(`${BASE}/`)
    const quick = page.locator(`.cars > li[data-id="${capCar.id}"] .quick`)
    await quick.locator('input[type=number]').fill('6000')
    await page.route(`**/api/vehicles/${capCar.id}/odometer`, cap('odometer.tooMany', 5000), { times: 1 })
    await quick.locator('button').click()
    await is(quick.locator('.error'), CAP.reading, 'reading cap')
    await page.goto(`${BASE}/cars/${capCar.id}`)
    await recordBtn.click()
    await page.route(at('/service-records'), cap('serviceRecord.tooMany', 2000), { times: 1 })
    await recordForm.locator('button:not(.link)').click()
    await is(recordForm.locator('[role=alert]'), CAP.record, 'service cap')
    // LOW-8 L167: the real car cap. A fresh user gets 50 cars through the API, the 51st through the UI shows the message; the user is then deleted.
    const capAuth = await (await page.request.post(`${BASE}/api/auth/register`, {
      data: { email: `other-cap-${s.name}-${Date.now()}@onlycars.test`, password: 'Passw0rd!', locale: he ? 'He' : 'En', currency: 'ILS' } })).json()
    const capHeaders = { Authorization: `Bearer ${capAuth.token}` }
    let capDeleted
    const capCtx = await browser.newContext({ viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
    try {
      for (let i = 1; i <= 50; i++) {
        const r = await page.request.post(`${BASE}/api/vehicles`, { headers: capHeaders, data: { nickname: `Cap ${i}`, initialOdometerKm: 1000 } })
        if (r.status() !== 201) throw new Error(`car ${i}: ${r.status()}`)
      }
      const p = await capCtx.newPage()
      p.on('pageerror', (e) => run.consoleErrors.push(`cap user: ${e}`))
      await p.goto(`${BASE}/login`)
      await p.evaluate(([t, u, l]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('i18nextLng', l) }, [capAuth.token, capAuth.user, s.lng])
      await p.goto(`${BASE}/cars/new`)
      await p.fill('input[name=nickname]', 'Cap 51')
      await p.fill('input[name=initialOdometerKm]', '1000')
      const res = p.waitForResponse((r) => r.request().method() === 'POST' && pathOf(r) === '/api/vehicles')
      await p.click('form button:not(.link)')
      if ((await res).status() !== 400) throw new Error(`51st car: ${(await res).status()}`)
      await is(p.locator('main [role=alert]'), CAP.car, 'real car cap')
      await p.screenshot({ path: `${OUT}/${s.name}-car-cap-real.png`, fullPage: true })
    } finally {
      await capCtx.close()
      capDeleted = (await page.request.delete(`${BASE}/api/me`, { headers: capHeaders, data: { password: 'Passw0rd!' } })).status()
    }
    if (capDeleted !== 204) throw new Error(`delete the cap user: ${capDeleted}`)
    // The three forced 400s.
    run.badResponses.splice(bad, Infinity, ...run.badResponses.slice(bad).filter((r) => !r.startsWith('400 POST')))
    run.consoleErrors.splice(logged, Infinity, ...run.consoleErrors.slice(logged).filter((e) => !e.includes('status of 400')))
  })
  // PWA-1: the production build (vite preview, same /api proxy), as only it has the service worker.
  await step('pwa-install', async () => {
    // AC6: no service worker on the dev server.
    if ((await page.evaluate(() => navigator.serviceWorker.getRegistrations())).length) throw new Error('a service worker on the dev server')
    // AC1: the manifest, and every icon a PNG at its declared size.
    const m = await (await page.request.get(`${PREVIEW}/manifest.webmanifest`)).json()
    for (const k of ['id', 'start_url', 'scope']) if (m[k] !== '/') throw new Error(`manifest ${k} "${m[k]}"`)
    if (m.display !== 'standalone') throw new Error(`display "${m.display}"`)
    const icons = m.icons.map((i) => `${i.sizes} ${i.type} ${i.purpose}`).join(', ')
    if (icons !== '192x192 image/png any, 512x512 image/png any, 512x512 image/png maskable') throw new Error(`icons: ${icons}`)
    const png = async (src, size) => {
      const r = await page.request.get(new URL(src, `${PREVIEW}/`).href)
      const b = await r.body()
      if (r.status() !== 200 || r.headers()['content-type'] !== 'image/png') throw new Error(`${src}: ${r.status()} ${r.headers()['content-type']}`)
      if (`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` !== size) throw new Error(`${src} is ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}, want ${size}`)
    }
    for (const i of m.icons) await png(i.src, i.sizes)
    // This setup's user, language and theme, signed in on the preview origin.
    const stored = await page.evaluate(() => ['token', 'user', 'i18nextLng'].map((k) => [k, localStorage.getItem(k)]))
    // A profile on disk: Chrome reports "in-incognito" for a plain test context, which can never install.
    const profile = mkdtempSync(join(tmpdir(), 'onlycars-pwa-'))
    let pctx
    try {
      pctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', timezoneId: process.env.UI_TZ, viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
      await pctx.addInitScript((kv) => kv.forEach(([k, v]) => v !== null && localStorage.setItem(k, v)), stored)
      const pp = pctx.pages()[0] ?? await pctx.newPage()
      const fromSw = []
      pp.on('response', (r) => pathOf(r).startsWith('/api/') && r.fromServiceWorker() && fromSw.push(pathOf(r)))
      await pp.goto(`${PREVIEW}/`)
      await png(await pp.locator('link[rel=apple-touch-icon]').getAttribute('href'), '180x180')
      // AC2: after one reload the service worker controls the page, and Chrome reports nothing against installing it.
      await pp.evaluate(() => navigator.serviceWorker.ready)
      await pp.reload()
      if (!(await pp.evaluate(() => navigator.serviceWorker.controller))) throw new Error('no service worker controls the page after a reload')
      // Detached after: while attached, setOffline leaves navigator.onLine true, which the offline message (AC4) depends on.
      const cdp = await pctx.newCDPSession(pp)
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
      await cdp.detach()
      if (installabilityErrors.length) throw new Error(`installability: ${JSON.stringify(installabilityErrors)}`)
      // Both fonts are fetched on load in either language, though a phone keeps the other script in More (NAV-1), so the service worker has them.
      await pp.waitForFunction(async () => (await Promise.all(['google-fonts-css', 'google-fonts-files']
        .map(async (c) => (await (await caches.open(c)).keys()).length))).every((n, i) => n >= i + 1), null, { timeout: 10000 })
        .catch(() => { throw new Error('the Google Fonts were not cached') })
      await pp.locator('.cars > li').first().waitFor()
      // AC3: offline, the shell loads and both fonts load from the cache. check() alone is true when no face exists, so load() first.
      await pctx.setOffline(true)
      await pp.reload()
      await pp.locator('header a.brand').waitFor()
      const fonts = await pp.evaluate(() => Promise.all([['Assistant', 'a'], ['Assistant', 'א'], ['Rubik', 'a'], ['Rubik', 'א']].map(async ([f, ch]) =>
        `${f}: ${(await document.fonts.load(`16px "${f}"`, ch).catch(() => [])).length > 0 && document.fonts.check(`16px "${f}"`, ch)}`)))
      if (fonts.some((f) => f.endsWith('false'))) throw new Error(`offline fonts ${fonts.join(', ')}`)
      // AC4: the dashboard's own error with Retry, not cached data; it says the browser is offline (LOW-9, L191).
      const alert = pp.locator('main > .row [role=alert]')
      await alert.waitFor()
      if (plain(await alert.textContent()) !== inBlock('offline', 'noConnection')) throw new Error(`offline error "${await alert.textContent()}"`)
      await pp.getByRole('button', { name: HS.retry, exact: true }).waitFor()
      if (await pp.locator('.cars > li').count()) throw new Error('cars shown offline')
      await pp.screenshot({ path: `${OUT}/${s.name}-pwa-offline.png`, fullPage: true })
      // Online again: the API answers from the network.
      await pctx.setOffline(false)
      await pp.getByRole('button', { name: HS.retry, exact: true }).click()
      await pp.locator('.cars > li').first().waitFor()
      if (fromSw.length) throw new Error(`answered by the service worker: ${fromSw.join(', ')}`)
      // AC5: the maskable icon cut to a circle and a rounded square (the dial whole in both), the 192 icon on light and dark.
      const tile = (bg, src, radius) => `<div style="background:${bg};padding:16px"><img src="${PREVIEW}/${src}" width="160" height="160" style="display:block;border-radius:${radius}"></div>`
      await pp.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap">${tile('#fff', 'icon-maskable-512.png', '50%')}${tile('#fff', 'icon-maskable-512.png', '22%')}`
        + `${tile('#e6e9e3', 'icon-192.png', '0')}${tile('#0c1215', 'icon-192.png', '0')}${tile('#fff', 'apple-touch-icon.png', '22%')}</body>`)
      await pp.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth))
      await pp.screenshot({ path: `${OUT}/${s.name}-pwa-icons.png` })
    } finally {
      await pctx?.close()
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
    }
  })
  // OFF-1: offline odometer entry on the production build (its service worker serves the app offline). Two users of its own,
  // deleted at the end; the setup's page is not used, so the steps after it are not affected.
  await step('offline-odometer', async () => {
    const OF = { km: he ? 'ק״מ' : 'km', waiting: (v) => key('readingWaiting').replace('{{value}}', v).replace('{{distUnit}}', he ? 'ק״מ' : 'km'),
      count1: key('queueCount_one').replace('{{count, number}}', '1'), notSent1: key('notSentCount_one').replace('{{count, number}}', '1'), sendNow: key('sendNow'), sending: key('sendingNow'), correction: key('saveAsCorrection'), discard: key('discard'),
      confirmDiscard: key('confirmDiscardReading'), offlineTitle: key('offlineEntry'), noCars: key('offlineNoCars'), logout: key('logoutLosesReadings'),
      lastKnown: key('lastKnown').split('{{value}}')[0], notSent: key('notSentBecause').replace('{{reason}}', ''),
      orderTail: inBlock('queued', 'lowerThanPrevious').split(')')[1], notFound: copy(/^ {4}vehicle: \{[\s\S]*?^ {6}notFound: (['"])(.*)\1,$/gm), full: inBlock('offline', 'queueFull').split('{{max, number}}') }
    const today = await localDate()
    const signUp = async (tag) => {
      const email = `ui-off1-${tag}-${s.name}-${Date.now()}@onlycars.test`
      const r = await page.request.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })
      if (!r.ok()) throw new Error(`register ${tag}: ${r.status()}`)
      return { email, ...(await r.json()) }
    }
    const as = (auth) => async (method, path, data) => {
      const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${auth.token}` }, data })
      if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()}`)
      return r.status() === 204 ? null : r.json()
    }
    const U = await signUp('u'), V = await signUp('v')
    const profile = mkdtempSync(join(tmpdir(), 'onlycars-off1-'))
    let pctx, pp, failure
    try {
      const carId = (await as(U)('POST', '/vehicles', { nickname: 'Offline car', initialOdometerKm: 10000, readingDate: today })).id
      await as(U)('POST', `/vehicles/${carId}/tasks`, { name: 'Off oil', category: 'Oil', intervalKm: 5000, intervalDays: null, dueSoonPercent: 50, lastDoneOdometerKm: 7000, lastDoneDate: today }) // due soon, so the dashboard lists it
      const readings = async () => (await as(U)('GET', `/vehicles/${carId}/odometer`)).map((r) => Number(r.valueKm))
      pctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', timezoneId: process.env.UI_TZ, viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
      pp = pctx.pages()[0] ?? await pctx.newPage()
      await pp.goto(`${PREVIEW}/login`)
      await pp.evaluate(([t, u, l]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('i18nextLng', l) }, [U.token, U.user, s.lng])
      await pp.goto(`${PREVIEW}/`)
      await pp.evaluate(() => navigator.serviceWorker.ready)
      await pp.reload()
      const card = () => pp.locator(`.cars > li[data-id="${carId}"]`)
      const queueCard = () => pp.locator('section.queue')
      const panel = () => pp.locator('section.offline')
      const pageAlert = () => pp.locator('main > .row [role=alert]')
      const textOf = async (loc) => plain(await loc.textContent())
      const posts = []
      pp.on('request', (r) => r.method() === 'POST' && pathOf(r) === `/api/vehicles/${carId}/odometer` && posts.push(r.postDataJSON()))
      const odoRoute = (u) => u.pathname === `/api/vehicles/${carId}/odometer`
      const check390 = async (what, shot) => {
        if (!s.isMobile) await pp.setViewportSize({ width: 390, height: 844 })
        const px = await pp.evaluate(() => document.documentElement.scrollWidth - 390)
        if (px > 0) throw new Error(`${px}px horizontal overflow with ${what}`)
        const small = await pp.evaluate(() => [...document.querySelectorAll('main a, main button')].filter((el) => el.checkVisibility())
          .map((el) => { const r = el.getBoundingClientRect(); return [el.textContent.trim(), Math.round(r.height), el.matches('button.link') ? Math.round(r.width) : 44] })
          .filter(([, h, w]) => h < 44 || w < 44))
        if (small.length) throw new Error(`${what} under 44px: ${JSON.stringify(small)}`)
        await pp.screenshot({ path: `${OUT}/${s.name}-${shot}.png`, fullPage: true })
        if (!s.isMobile) await pp.setViewportSize(s.viewport)
      }
      const enter = async (scope, value) => {
        await scope.locator('.quick input[type=number]').fill(String(value))
        await scope.locator('.quick button').click()
      }
      await card().waitFor()
      if (await queueCard().count()) throw new Error('a queue card with nothing queued')

      // AC2: an HTTP error while online shows as today and is not queued.
      await pp.route(odoRoute, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
      await enter(card(), 11000)
      await card().locator('.quick [role=alert]').waitFor()
      if (await queueCard().count() || await pp.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('odometerQueue:')))) throw new Error('an HTTP error was queued')
      await card().locator('.quick input[type=number]').fill('')
      posts.length = 0

      // AC2: offline with the page open: queued, the form clears, the car shows it waiting, no error screen.
      const tasksBefore = await textOf(card().locator('.dash-tasks'))
      await pctx.setOffline(true)
      await enter(card(), 12345)
      await card().locator('.pending').waitFor()
      if (await textOf(card().locator('.pending')) !== OF.waiting('12,345')) throw new Error(`pending note "${await textOf(card().locator('.pending'))}"`)
      if (await card().locator('.quick input[type=number]').inputValue() !== '') throw new Error('the form kept the value')
      if (!(await textOf(queueCard().locator('[role=status]'))).includes(OF.count1)) throw new Error(`count "${await textOf(queueCard().locator('[role=status]'))}"`)
      if (await pageAlert().count()) throw new Error('an error screen after queueing')
      await pp.screenshot({ path: `${OUT}/${s.name}-offline-queued.png`, fullPage: true })

      // AC2: reloaded offline: the error with Retry, then the offline panel with the last known odometer and the waiting reading.
      await pp.reload()
      await pageAlert().waitFor()
      await panel().waitFor()
      if (!(await textOf(panel())).includes(OF.lastKnown) || !(await textOf(panel())).includes('10,000')) throw new Error(`panel "${await textOf(panel())}"`)
      const prow = panel().locator(`li[data-id="${carId}"]`)
      if (await textOf(prow.locator('.pending')) !== OF.waiting('12,345')) throw new Error('the reading did not survive the reload')
      await enter(prow, 12400)
      await prow.locator('.pending li').nth(1).waitFor()
      // L192: a second tab queues the third (lower than the others: the server refuses it later); this tab shows it from the storage event.
      const tab2 = await pctx.newPage()
      await tab2.goto(`${PREVIEW}/`)
      await enter(tab2.locator(`section.offline li[data-id="${carId}"]`), 5000)
      // L202: waits for the storage event's change itself (up to the default 30 s), not a fixed window.
      await pp.waitForFunction((id) => document.querySelectorAll(`section.offline li[data-id="${id}"] .pending li`).length === 3, carId)
      await tab2.close()
      // A full queue refuses the 21st with a message (20 stand-ins, then the real 3 put back).
      const real = await pp.evaluate((k) => localStorage.getItem(k), `odometerQueue:${U.user.id}`)
      await pp.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(Array(20).fill(JSON.parse(v)[0]))), [`odometerQueue:${U.user.id}`, real])
      await enter(prow, 12500)
      const fullText = await textOf(prow.locator('.quick [role=alert]'))
      if (!fullText.startsWith(OF.full[0]) || !fullText.endsWith(OF.full[1]) || !fullText.includes('20')) throw new Error(`queue full "${fullText}"`)
      await pp.evaluate(([k, v]) => localStorage.setItem(k, v), [`odometerQueue:${U.user.id}`, real])
      await check390('the offline panel', 'offline-panel-390')
      // An app restart: a new window, still offline.
      await pp.close()
      pp = await pctx.newPage()
      pp.on('request', (r) => r.method() === 'POST' && pathOf(r) === `/api/vehicles/${carId}/odometer` && posts.push(r.postDataJSON()))
      await pp.goto(`${PREVIEW}/`)
      await panel().locator(`li[data-id="${carId}"] .pending li`).nth(2).waitFor()

      // AC3: back online, the online event sends (each run stops at its first failure: here no answer at all, nothing saved).
      await pp.route(odoRoute, (r) => r.abort())
      await pctx.setOffline(false)
      for (let i = 0; i < 50 && !posts.length; i++) await pp.waitForTimeout(100)
      await pp.waitForTimeout(500)
      if (!posts.length || posts.some((b) => b.valueKm !== 12345)) throw new Error(`reconnect POSTs ${posts.map((b) => b.valueKm)}, want only the oldest`)
      // Send now: the server saves it but the reply is lost, so it stays waiting; Send now again resends it with the same id and date
      // (one row), then the rest oldest first, showing Sending…; the refused one stays as Not sent.
      await pp.unroute(odoRoute)
      await pp.route(odoRoute, async (r) => { await r.fetch(); await r.abort() }, { times: 1 })
      const sendNow = queueCard().getByRole('button', { name: OF.sendNow, exact: true })
      const tries = posts.length
      await sendNow.click()
      for (let i = 0; i < 50 && posts.length === tries; i++) await pp.waitForTimeout(100)
      await pp.waitForTimeout(300)
      if (posts.length !== tries + 1) throw new Error(`${posts.length - tries} POSTs after a lost reply, want 1 (then stop)`)
      if ((await readings()).filter((v) => v === 12345).length !== 1) throw new Error('the lost reply was not saved once')
      if (await textOf(pp.locator('.pending li').first()) !== OF.waiting('12,345')) throw new Error('not waiting after a lost reply')
      await pp.route(odoRoute, async (r) => { await new Promise((ok) => setTimeout(ok, 600)); await r.fallback() })
      await sendNow.click()
      await queueCard().locator('[role=status]').filter({ hasText: OF.sending }).waitFor({ timeout: 3000 })
      await pp.locator('.cars > li').first().waitFor({ timeout: 10000 }) // a send reloads the dashboard
      await card().locator('.pending li.error').waitFor({ timeout: 10000 })
      await pp.unroute(odoRoute)
      const sent = posts.slice(tries).map((b) => `${b.valueKm}:${b.readingDate}:${b.confirmCorrection}`)
      if (sent.join() !== [12345, 12345, 12400, 5000].map((v) => `${v}:${today}:false`).join()) throw new Error(`POSTs ${sent.join()}`)
      if (new Set(posts.map((b) => `${b.valueKm}:${b.clientRequestId}`)).size !== 3 || new Set(posts.map((b) => b.clientRequestId)).size !== 3) throw new Error('ids not kept per reading')
      const vals = await readings()
      if (vals.filter((v) => v === 12345).length !== 1 || !vals.includes(12400) || vals.includes(5000)) throw new Error(`readings ${vals.join()}`)
      await pp.waitForFunction((id) => document.querySelector(`.cars > li[data-id="${id}"] .odometer`)?.getAttribute('aria-label').startsWith('12,400'), carId, { timeout: 5000 })
      if (await textOf(card().locator('.dash-tasks')) === tasksBefore) throw new Error('the tasks did not follow')

      // AC4: the refused one: Not sent with the order reason and Save as correction; a 404 one: its reason, no Save as correction.
      const rows = queueCard().locator('.tasks > li')
      if (await rows.count() !== 1) throw new Error(`${await rows.count()} rows left`)
      const count = await textOf(queueCard().locator('[role=status]'))
      if (count !== OF.notSent1) throw new Error(`count "${count}" with every reading refused`)
      const why = await textOf(rows.first().locator('[role=alert]'))
      if (!why.startsWith(OF.notSent.trim()) || !why.includes('12,400') || !why.endsWith(OF.orderTail)) throw new Error(`reason "${why}"`)
      await pctx.setOffline(true)
      await enter(card(), 13000)
      await rows.nth(1).waitFor()
      await pp.route(odoRoute, (r) => r.request().postDataJSON().valueKm === 13000
        ? r.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ status: 404, code: 'vehicle.notFound' }) }) : r.fallback())
      await pctx.setOffline(false)
      await rows.nth(1).locator('[role=alert]').waitFor({ timeout: 10000 })
      await pp.unroute(odoRoute)
      if (!(await textOf(rows.nth(1).locator('[role=alert]'))).includes(OF.notFound)) throw new Error('404 reason')
      if (await rows.nth(1).getByRole('button', { name: OF.correction }).count()) throw new Error('Save as correction on a 404')
      await check390('the Not sent readings', 'offline-not-sent-390')
      await rows.nth(1).getByRole('button', { name: OF.discard, exact: true }).click()
      if (!(await textOf(rows.nth(1))).includes(OF.confirmDiscard)) throw new Error('no discard confirm')
      await rows.nth(1).locator('button.danger').click()
      await rows.nth(1).waitFor({ state: 'detached' })
      await rows.first().getByRole('button', { name: OF.correction, exact: true }).click()
      await queueCard().waitFor({ state: 'detached', timeout: 10000 })
      if (posts.at(-1).confirmCorrection !== true || posts.at(-1).clientRequestId !== posts.find((b) => b.valueKm === 5000).clientRequestId) throw new Error('the correction was not the same id, confirmed')
      if (!(await readings()).includes(5000) || (await readings()).includes(13000)) throw new Error('correction or discard did not hold')

      // AC5: a 401 keeps the queue and the same user's login sends it; another user's login never sees or sends it, and removes it.
      const queueThen401 = async (v) => {
        await pctx.setOffline(true)
        await enter(card(), v)
        await card().locator('.pending').waitFor()
        await pp.evaluate(() => localStorage.setItem('token', 'expired'))
        await pctx.setOffline(false)
        await pp.waitForURL('**/login', { timeout: 10000 })
        if (!(await pp.evaluate((k) => localStorage.getItem(k), `odometerQueue:${U.user.id}`))) throw new Error('a 401 dropped the queue')
      }
      const logIn = async (who) => {
        await pp.fill('input[name=email]', who.email)
        await pp.fill('input[name=password]', 'Passw0rd!')
        await pp.click('form button:not(.link)')
        await pp.locator('a[href="/cars/new"]').waitFor()
      }
      await queueThen401(14000)
      await logIn(U)
      await pp.waitForFunction((k) => !localStorage.getItem(k), `odometerQueue:${U.user.id}`, { timeout: 10000 })
      if (!(await readings()).includes(14000)) throw new Error('not sent after logging in again')
      await queueThen401(14500)
      const before = posts.length
      await logIn(V)
      await pp.locator('main h1').waitFor()
      await pp.waitForTimeout(500)
      if (await queueCard().count() || posts.length !== before) throw new Error('another user saw or sent the queue')
      const others = await pp.evaluate((id) => Object.keys(localStorage).filter((k) => k.endsWith(id)), U.user.id)
      if (others.length) throw new Error(`another user's login left ${others}`)
      await more(pp)
      await pp.locator('header nav button.link').last().click() // V has nothing queued: no confirm
      await logIn(U)

      // AC5: Log out with a reading waiting asks first; Cancel keeps both; OK logs out and clears them. Account delete clears them.
      const queueOnline = async (v) => {
        await pp.route(odoRoute, (r) => r.abort(), { times: 1 })
        await enter(card(), v)
        await card().locator('.pending').waitFor()
      }
      await card().waitFor()
      await queueOnline(15000)
      let asked
      pp.once('dialog', (d) => { asked = d.message(); d.dismiss() })
      await more(pp)
      await pp.locator('header nav button.link').last().click()
      if (plain(asked ?? '') !== OF.logout) throw new Error(`logout asked "${asked}"`)
      if (!(await card().count())) throw new Error('Cancel logged out')
      pp.once('dialog', (d) => d.accept())
      await more(pp)
      await pp.locator('header nav button.link').last().click()
      await pp.locator('input[name=email]').waitFor()
      const leftover = () => pp.evaluate((id) => Object.keys(localStorage).filter((k) => k.endsWith(id)), U.user.id)
      if ((await leftover()).length) throw new Error(`left after logout: ${await leftover()}`)
      await logIn(U)
      await card().waitFor()
      await queueOnline(16000)
      await pp.goto(`${PREVIEW}/settings`)
      await pp.locator('main section[aria-labelledby=your-data] > .actions > button.danger').click()
      await pp.locator('form[aria-labelledby=delete-account-title] input[name=password]').fill('Passw0rd!')
      await pp.locator('form[aria-labelledby=delete-account-title] button.danger').click()
      await pp.waitForURL('**/login')
      if ((await leftover()).length) throw new Error(`left after account delete: ${await leftover()}`)
      U.deleted = true
      // With no saved car list, the offline panel asks to open the app online once.
      await logIn(V)
      await pp.evaluate((id) => localStorage.removeItem(`offlineCars:${id}`), V.user.id)
      await pctx.setOffline(true)
      await pp.reload()
      if (await textOf(panel().locator('p')) !== OF.noCars) throw new Error(`no cars "${await textOf(panel())}"`)
      await pctx.setOffline(false)
    } catch (e) {
      failure = e
      await pp?.screenshot({ path: `${OUT}/${s.name}-offline-failed.png`, fullPage: true }).catch(() => {})
    }
    await pctx?.close()
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
    for (const who of U.deleted ? [V] : [U, V]) {
      const r = await page.request.delete(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${who.token}` }, data: { password: 'Passw0rd!' } })
      if (r.status() !== 204) failure ??= new Error(`cleanup delete: ${r.status()}`)
    }
    if (failure) throw failure
  })
  // NAV-1: the phone tab bar and More menu at 390px (the desktop setups narrow for it), in this setup's language.
  await step('phone-nav', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    try {
      await page.click('header a.brand')
      await arrivedAt(T.dashboard)
      const h = await heightOf(page.locator('header'))
      if (h > 60) throw new Error(`header is ${h}px tall, not one row`)
      const items = page.locator('.tabs > a, .tabs > button')
      const boxes = await items.evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect()
        return { text: el.textContent, top: r.top, left: r.left, h: r.height, cut: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight }
      }))
      const want = he ? ['לוח בקרה', 'הוצאות', 'צמיגים', 'עוד'] : ['Dashboard', 'Spending', 'Tires', 'More']
      if (JSON.stringify(boxes.map((b) => b.text)) !== JSON.stringify(want)) throw new Error(`tabs ${JSON.stringify(boxes.map((b) => b.text))}`)
      const bad = boxes.filter((b) => b.h < 44 || b.cut || b.top !== boxes[0].top)
      if (bad.length) throw new Error(`tabs under 44px, cut off or not in one row: ${JSON.stringify(bad)}`)
      if (boxes.some((b, i) => i && (he ? b.left > boxes[i - 1].left : b.left < boxes[i - 1].left))) throw new Error('tabs not in reading order')
      if ((await page.locator('.tabs > a[href="/"]').getAttribute('aria-current')) !== 'page') throw new Error('Dashboard tab not marked current')
      // More by keyboard: open, Tab through the menu in order, Esc closes it with focus back on More.
      const moreBtn = page.locator('.tabs > button')
      const menu = page.locator('#more-menu')
      await moreBtn.focus()
      await page.keyboard.press('Enter')
      await menu.waitFor()
      if ((await moreBtn.getAttribute('aria-expanded')) !== 'true') throw new Error('More not expanded')
      await page.screenshot({ path: `${OUT}/${s.name}-phone-nav-more.png` })
      const order = []
      for (let i = 0; i < 2; i++) {
        await page.keyboard.press('Tab')
        order.push(await page.evaluate(() => document.activeElement.closest('#more-menu') && (document.activeElement.getAttribute('href') ?? document.activeElement.textContent)))
      }
      const wantOrder = ['/settings', he ? 'התנתקות' : 'Log out']
      if (JSON.stringify(order) !== JSON.stringify(wantOrder)) throw new Error(`menu order ${JSON.stringify(order)}`)
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      await focusIs('.tabs > button', 'focus after Esc')
      // A tap outside closes it; choosing an item closes it, and More is lit on Settings.
      await moreBtn.click()
      await menu.waitFor()
      await page.locator('main h1').click()
      await menu.waitFor({ state: 'detached' })
      // Closed, More points at no menu; a tab, Back and a trip past 40em and back each close it.
      const closed = async (what) => {
        await menu.waitFor({ state: 'detached' })
        const a = await moreBtn.evaluate((b) => [b.getAttribute('aria-expanded'), b.getAttribute('aria-controls')])
        if (a[0] !== 'false' || a[1] !== null) throw new Error(`More after ${what}: aria-expanded ${a[0]}, aria-controls ${a[1]}`)
      }
      await moreBtn.click()
      await page.click('.tabs > a[href="/spending"]')
      await page.waitForURL('**/spending')
      await closed('a tab')
      await moreBtn.click()
      await menu.waitFor()
      await page.goBack()
      await page.waitForURL((u) => u.pathname === '/')
      await closed('Back')
      await moreBtn.click()
      await menu.waitFor()
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.locator('.tabs').waitFor({ state: 'detached' })
      await page.setViewportSize({ width: 390, height: 844 })
      await closed('1280px and back')
      await more(page)
      await page.click('#more-menu a[href="/settings"]')
      await menu.waitFor({ state: 'detached' })
      await page.waitForURL('**/settings')
      await page.locator('main button.danger').last().waitFor()
      if ((await moreBtn.getAttribute('aria-current')) !== 'page') throw new Error('More not marked current on Settings')
      // Nothing behind the bar: at the bottom of /settings the last button is above it and takes the tap.
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      const last = await page.evaluate(() => {
        const b = [...document.querySelectorAll('main button')].filter((el) => el.checkVisibility()).at(-1)
        const r = b.getBoundingClientRect()
        return { bottom: r.bottom, bar: document.querySelector('.tabs').getBoundingClientRect().top, hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }
      })
      if (last.bottom > last.bar || !last.hit) throw new Error(`last button behind the bar: ${JSON.stringify(last)}`)
      // A field reached by Tab while it is behind the bar scrolls above it (scroll-padding).
      const field = await page.evaluate(() => {
        const els = [...document.querySelectorAll('main :is(a, button, input, select)')].filter((el) => el.checkVisibility())
        const [prev, el] = els.slice(-2)
        prev.focus({ preventScroll: true })
        scrollBy(0, el.getBoundingClientRect().bottom - innerHeight)
        el.dataset.target = '1'
        return el.outerHTML.slice(0, 60)
      })
      await page.keyboard.press('Tab')
      await focusIs('[data-target]', `Tab to ${field}`)
      const covered = await page.evaluate(() => document.activeElement.getBoundingClientRect().bottom - document.querySelector('.tabs').getBoundingClientRect().top)
      if (covered > 0) throw new Error(`focused ${field} is ${covered}px behind the bar`)
      await noOverflow('the tab bar')
      await page.setViewportSize({ width: 360, height: 780 })
      await noOverflow('the tab bar at 360px')
      await sweep('the page with the tab bar at 360px')
    } finally {
      await page.setViewportSize(s.viewport)
    }
    // From 40em up the header is as before: no bar.
    if (s.viewport.width > 640) await page.locator('.tabs').waitFor({ state: 'detached', timeout: 3000 })
  })
  // ERR-1b criterion 1: smoke runs without VITE_SENTRY_DSN, so nothing on this setup's pages asked Sentry.
  await step('no-sentry-requests', async () => {
    if (sentryRequests.length) throw new Error(`Sentry requests (start dev without VITE_SENTRY_DSN, in the environment or a .env file): ${sentryRequests.join(', ')}`)
  })
  await step('logout', async () => {
    await more(page)
    await page.click('header nav button.link')
    await page.locator('input[name=email]').waitFor()
  })
  // ACC-2: delete my account, as this setup's first user (its car, service files and run photos go too). These steps come last:
  // nothing after them needs a user. The server allows 5 tries per 10 minutes per user: these make 2 real ones.
  const DA = { open: key('deleteAccount'), confirm: key('deleteAccountConfirm'), busy: key('deleteAccountBusy'), wrong: key('deleteAccountWrongPassword'),
    required: key('deleteAccountPasswordRequired'), failed: key('deleteAccountFailed'), rate: key('deleteAccountTooMany'), done: key('accountDeleted'),
    warning: key('deleteAccountWarning'), exportFirst: key('deleteAccountExportFirst'), loginWrong: inBlock('auth', 'invalidCredentials') }
  const daSec = page.locator('main section[aria-labelledby=your-data]')
  const daOpener = daSec.getByRole('button', { name: DA.open, exact: true })
  const daPanel = daSec.locator('form[aria-labelledby=delete-account-title]')
  const daPassword = daPanel.locator('input[name=password]')
  const daConfirm = daPanel.locator('button.danger')
  const daAlert = daPanel.locator('[role=alert]')
  // Only the DELETE; the page's GET /me goes through. Each mock is removed after its DELETE (L176): { times: 1 } would count a GET's fallback too.
  let daMock
  const onDelete = (fn) => page.route('**/api/me', daMock = (r) => (r.request().method() === 'DELETE' ? fn(r) : r.fallback()))
  const offDelete = () => page.unroute('**/api/me', daMock)
  const daIs = async (want, what) => { await daAlert.waitFor(); if (plain(await daAlert.textContent()) !== want) throw new Error(`${what} "${await daAlert.textContent()}"`) }
  const daForgetFrom = (bad, logged) => {
    run.badResponses.splice(bad, Infinity, ...run.badResponses.slice(bad).filter((r) => !/^(400|429|401) (DELETE|POST) .*\/api\/(me|auth\/login)$|^401 GET .*\/api\//.test(r)))
    run.consoleErrors.splice(logged, Infinity, ...run.consoleErrors.slice(logged).filter((e) => !/status of (400|401|429)|ERR_FAILED/.test(e)))
  }
  await step('delete-account-errors', async () => {
    const [bad, logged] = [run.badResponses.length, run.consoleErrors.length]
    await page.fill('input[name=email]', registered.user.email)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('a[href="/cars/new"]').waitFor()
    if ((await page.getAttribute('html', 'lang')) !== s.lng) throw new Error(`signed in with lang ${await page.getAttribute('html', 'lang')}`)
    await openSettings()
    // Closed, below Export. Opening focuses the panel's heading; it says it can't be undone and points to Export.
    if ((await daOpener.getAttribute('aria-expanded')) !== 'false') throw new Error('opener not aria-expanded=false')
    await daOpener.click()
    await focusIs('#delete-account-title', 'the panel heading on open')
    if ((await daOpener.getAttribute('aria-expanded')) !== 'true') throw new Error('opener not aria-expanded=true')
    const text = plain(await daPanel.textContent())
    if (!text.includes(DA.warning) || !text.includes(DA.exportFirst)) throw new Error(`panel text "${text}"`)
    if ((await daPassword.getAttribute('autocomplete')) !== 'current-password') throw new Error('password autocomplete')
    // Escape and Cancel close it, clear the password and focus Delete my account.
    await daPassword.fill('typed')
    await page.keyboard.press('Escape')
    await daPanel.waitFor({ state: 'detached' })
    await focusIs('main section[aria-labelledby=your-data] > .actions > button.danger', 'opener after Escape')
    await page.keyboard.press('Enter')
    if ((await daPassword.inputValue()) !== '') throw new Error('password kept after Escape')
    await daPassword.fill('typed')
    await daPanel.getByRole('button', { name: key('cancel'), exact: true }).click()
    await daPanel.waitFor({ state: 'detached' })
    await focusIs('main section[aria-labelledby=your-data] > .actions > button.danger', 'opener after Cancel')
    await daOpener.click()
    if ((await daPassword.inputValue()) !== '') throw new Error('password kept after Cancel')
    // Password errors stay in the field: a mocked empty-password 400, then a real wrong password (the account still works).
    await daPassword.fill(' ')
    await onDelete((r) => r.fulfill({ status: 400, contentType: 'application/problem+json', body: JSON.stringify({ status: 400, code: 'auth.credentialsRequired' }) }))
    await daConfirm.click()
    await daIs(DA.required, 'empty password')
    await offDelete()
    await focusIs('form[aria-labelledby=delete-account-title] input[name=password][aria-invalid=true]', 'password after credentialsRequired')
    await daPassword.fill('Wr0ngPassword!')
    await page.keyboard.press('Enter')
    await daIs(DA.wrong, 'wrong password')
    await focusIs('form[aria-labelledby=delete-account-title] input[name=password][aria-invalid=true]', 'password after a wrong password')
    if ((await daPassword.getAttribute('aria-describedby')) !== 'delete-account-error') throw new Error('password not described by its error')
    await apiCall('GET', '/me')
    // A 429 and a network failure: their own messages, focus on the message; Delete is the retry. No password error marks.
    await onDelete((r) => r.fulfill({ status: 429, contentType: 'application/problem+json', headers: { 'Retry-After': '600' }, body: JSON.stringify({ status: 429, code: 'http.429' }) }))
    await daConfirm.click()
    await daIs(`${DA.failed} ${DA.rate}`, '429')
    await offDelete()
    await focusIs('#delete-account-error', 'the 429 message')
    if (await daPassword.getAttribute('aria-invalid')) throw new Error('password marked invalid after a 429')
    await at390('the delete-account panel with an error', 'delete-account-390')
    await onDelete((r) => r.abort())
    await daConfirm.click()
    await daIs(`${DA.failed} ${RS.generic}`, 'network failure')
    await offDelete()
    await focusIs('#delete-account-error', 'the network failure message')
    await apiCall('GET', '/me')
    daForgetFrom(bad, logged)
  })
  await step('delete-account', async () => {
    const [bad, logged] = [run.badResponses.length, run.consoleErrors.length]
    let failure
    try {
      // LOW-8 L178: a service file uploaded now to R2; its signed URL serves it before the delete and finds nothing after.
      const fileCar = (await apiCall('GET', '/vehicles'))[0]
      // With the client's today, as the app sends it: the server's UTC date can be a day before the car's readings (L213).
      const fileRec = (await apiCall('POST', `/vehicles/${fileCar.id}/service-records?today=${await localDate()}`, { odometerKm: fileCar.currentOdometerKm, totalCost: 1 })).record
      const token = await page.evaluate(() => localStorage.getItem('token'))
      const up = await page.request.post(`${BASE}/api/vehicles/${fileCar.id}/service-records/${fileRec.id}/attachments`,
        { headers: { Authorization: `Bearer ${token}` }, multipart: { file: { name: 'l178.png', mimeType: 'image/png', buffer: await image('image/png') } } })
      if (!up.ok()) throw new Error(`upload: ${up.status()}`)
      const fileUrl = (await up.json()).attachments.at(-1)?.url // the response is the record, the new file last
      if (!fileUrl) throw new Error('no signed URL (storage off?)')
      if ((await page.request.get(fileUrl)).status() !== 200) throw new Error('the signed URL fails before the delete') // never printed: a credential
      if (!(await daPanel.count())) { await openSettings(); await daOpener.click() }
      // Through a slow route: busy keeps the width, a second Enter sends nothing; then 204 signs out to /login with the note.
      let sent = 0
      const count = (r) => r.url().endsWith('/api/me') && r.method() === 'DELETE' && sent++
      page.on('request', count)
      await onDelete(async (r) => { await page.waitForTimeout(700); await r.fallback() })
      const width = (await daConfirm.boundingBox()).width
      await daPassword.fill('Passw0rd!')
      await page.keyboard.press('Enter')
      await daConfirm.filter({ hasText: DA.busy }).waitFor({ timeout: 3000 })
      if ((await daConfirm.getAttribute('aria-disabled')) !== 'true') throw new Error('not aria-disabled while busy')
      if ((await daConfirm.boundingBox()).width !== width) throw new Error(`width ${width} became ${(await daConfirm.boundingBox()).width}`)
      await page.keyboard.press('Enter')
      await page.waitForURL('**/login')
      await offDelete()
      page.off('request', count)
      if (sent !== 1) throw new Error(`${sent} DELETE /api/me requests`)
      const note = page.locator('main [role=status]#account-deleted')
      if (plain(await note.textContent()) !== DA.done) throw new Error(`note "${await note.textContent()}"`)
      if (!(await note.evaluate((el) => el.matches('.notice')))) throw new Error('the note is not in the notice style') // L181
      await page.screenshot({ path: `${OUT}/${s.name}-account-deleted-note.png` })
      // The files go after the commit: the same signed URL now gets 404 from R2 (a few tries, as the delete may still be finishing).
      let fileStatus
      for (let i = 0; i < 10 && (fileStatus = (await page.request.get(fileUrl)).status()) !== 404; i++) await page.waitForTimeout(500)
      if (fileStatus !== 404) throw new Error(`the signed URL answers ${fileStatus} after the delete, want 404`)
      await focusIs('main h1[aria-describedby=account-deleted]', 'h1 with the note on /login')
      await titleIs(T.login)
      if (await page.evaluate(() => localStorage.getItem('token') ?? localStorage.getItem('user'))) throw new Error('token or user left in storage')
      // The old password no longer logs in; the note doesn't come back.
      await page.fill('input[name=email]', registered.user.email)
      await page.fill('input[name=password]', 'Passw0rd!')
      await page.click('form button:not(.link)')
      await page.locator('main [role=alert]').filter({ hasText: DA.loginWrong }).waitFor()
      await page.reload()
      await page.locator('input[name=email]').waitFor()
      if (await note.count()) throw new Error('the note came back after a reload')
      // The same email registers again.
      const again = await page.request.post(`${BASE}/api/auth/register`, { data: { email: registered.user.email, password: 'Passw0rd!' } })
      if (!again.ok()) throw new Error(`register again: ${again.status()}`)
      // LOW-8 L174: that user is signed in here and deleted elsewhere (another device): the next call's 401 clears the token and the cached user.
      const againAuth = await again.json()
      await page.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)) }, [againAuth.token, againAuth.user])
      const elsewhere = await page.request.delete(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${againAuth.token}` }, data: { password: 'Passw0rd!' } })
      if (elsewhere.status() !== 204) throw new Error(`delete elsewhere: ${elsewhere.status()}`)
      await page.goto(`${BASE}/`)
      await page.waitForURL('**/login')
      await page.locator('input[name=email]').waitFor()
      if (await page.evaluate(() => localStorage.getItem('token') ?? localStorage.getItem('user'))) throw new Error('token or cached user left after a 401')
    } catch (e) { failure = e }
    // Cleanup even if a check above failed: `registered` (or its re-registration) if it still logs in, and the NOT-1 user
    // (its Cap car, L168) through the API, as the UI does; filter(Boolean): its step may have failed (L175). The first error wins.
    const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: registered.user.email, password: 'Passw0rd!' } })
    for (const token of [login.ok() && (await login.json()).token, not1Auth?.token].filter(Boolean)) {
      const r = await page.request.delete(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` }, data: { password: 'Passw0rd!' } })
      if (r.status() !== 204) failure ??= new Error(`cleanup delete: ${r.status()}`)
    }
    daForgetFrom(bad, logged)
    if (failure) throw failure
  })

  report.push(run)
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.some((r) => r.steps.some((st) => !st.ok)) ? 1 : 0
