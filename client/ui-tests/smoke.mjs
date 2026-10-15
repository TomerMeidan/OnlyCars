// UI smoke run: walks the main flows in two setups and prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/smoke.mjs
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const setups = [
  { name: 'desktop-light-en', viewport: { width: 1280, height: 800 }, colorScheme: 'light', lng: 'en' },
  { name: 'mobile-dark-he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', lng: 'he', isMobile: true, hasTouch: true },
]

const browser = await chromium.launch({ channel: 'chrome' })
const report = []

for (const s of setups) {
  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  const run = { setup: s.name, steps: [], consoleErrors: [], badResponses: [] }
  page.on('console', (m) => m.type() === 'error' && run.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => run.consoleErrors.push(String(e)))
  page.on('response', (r) => r.status() >= 400 && run.badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`))

  let n = 0
  async function step(name, fn) {
    const shot = `${OUT}/${s.name}-${String(++n).padStart(2, '0')}-${name}.png`
    try {
      await fn()
      run.steps.push({ step: name, ok: true, screenshot: shot })
    } catch (e) {
      run.steps.push({ step: name, ok: false, error: e.message.split('\n')[0], screenshot: shot })
    }
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({ path: shot, fullPage: true })
    // Page wider than the viewport means horizontal scrolling, a layout bug.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (overflow > 0) run.steps.at(-1).horizontalOverflowPx = overflow
  }

  const odometer = () => page.locator('.odometer').first().getAttribute('aria-label')
  const digitsOnly = (v) => (v ?? '').replace(/\D/g, '')

  // MVP1-C: page titles, focus after navigation and actions, history button sizes.
  const he = s.lng === 'he'
  const T = he
    ? { login: 'התחברות', register: 'יצירת חשבון', myCars: 'הרכבים שלי', addCar: 'הוספת רכב', editCar: 'עריכת רכב' }
    : { login: 'Log in', register: 'Create account', myCars: 'My cars', addCar: 'Add car', editCar: 'Edit car' }
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
    const h = await heightOf(loc)
    if (h < 44) throw new Error(`${what} is ${h}px tall`)
  }
  // Every visible link and button on the page is a 44px tap target.
  async function sweep(what) {
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button')]
      .filter((el) => el.checkVisibility())
      .map((el) => [el.textContent.trim() || el.getAttribute('aria-label'), Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44))
    if (small.length) throw new Error(`${what} under 44px: ${JSON.stringify(small)}`)
  }
  async function noOverflow(what) {
    const px = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (px > 0) throw new Error(`${px}px horizontal overflow with ${what}`)
  }

  await step('login-page', async () => {
    await page.goto(`${BASE}/login`)
    await page.locator('input[name=email]').waitFor()
    await titleIs(T.login)
    // The first load keeps the browser's default focus.
    if (await page.evaluate(() => document.activeElement !== document.body)) throw new Error(`first load moved focus to ${await active()}`)
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
    await arrivedAt(T.myCars)
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
    await page.click('form button:not(.link)')
    await page.locator('.cars li').first().waitFor()
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
    await page.click('.cars li h2 a')
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

  await step('tasks-empty-and-picker', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await tasks.locator('p.muted').filter({ hasText: he ? 'עדיין אין משימות תחזוקה.' : 'No maintenance tasks yet.' }).waitFor()
    // The section sits above the odometer history.
    const order = await page.evaluate(() => [...document.querySelectorAll('main section h2')].map((h) => h.id).join())
    if (order !== 'maintenance,odometer-history') throw new Error(`sections: ${order}`)
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
    const res = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/tasks'))
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
    const countPost = (r) => r.method() === 'POST' && r.url().endsWith('/tasks') && posted++
    page.on('request', countPost)
    await form.locator('button:not(.link)').click()
    await page.waitForTimeout(300)
    page.off('request', countPost)
    const required = await form.locator('[role=alert]').textContent()
    if (posted || required !== (he ? 'הזינו מרווח בק״מ, מרווח זמן או את שניהם.' : 'Enter an interval in km, a time interval, or both.')) throw new Error(`${posted} POST, "${required}"`)
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
    const res = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/tasks'))
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
    if (alert !== (he ? 'משהו השתבש. נסו שוב.' : 'Something went wrong. Please try again.')) throw new Error(`alert "${alert}"`)
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
    await page.route('**/api/vehicles/*/tasks', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    const alert = await tasks.locator('[role=alert]').textContent()
    await page.unroute('**/api/vehicles/*/tasks')
    if (alert !== (he ? 'משהו השתבש. נסו שוב.' : 'Something went wrong. Please try again.')) throw new Error(`alert "${alert}"`)
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
    if (alert !== (he ? 'משהו השתבש. נסו שוב.' : 'Something went wrong. Please try again.')) throw new Error(`picker alert "${alert}"`)
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
    const today = await page.evaluate(() => new Date().toISOString().slice(0, 10))
    const add = async (name, intervalKm, lastDoneOdometerKm, intervalDays = null) => {
      const r = await page.request.post(url, { headers: { Authorization: `Bearer ${token}` }, data: { name, category: 'Other', intervalKm, intervalDays, lastDoneOdometerKm, lastDoneDate: today } })
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
    await page.route('**/api/vehicles/*/tasks', async (r) => {
      const res = await r.fetch()
      const ts = await res.json()
      ts.push({ ...ts[0], id: '00000000-0000-0000-0000-0000000000ff', name: 'Longest', status: 'Overdue', intervalKm: 1, intervalDays: 1, remainingKm: -1000000, remainingDays: -7300, progress: 2 })
      await r.fulfill({ response: res, json: ts })
    })
    await page.reload()
    await taskRow('Longest').waitFor()
    await page.unroute('**/api/vehicles/*/tasks')
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
    await page.route('**/api/vehicles/*/tasks', async (r) => { await page.waitForTimeout(700); await r.continue() }, { times: 1 })
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
      ? { pct: 'הזינו מספר שלם בין 1 ל־50.', km: 'הזינו מרווח של 1 עד 1,000,000 ק״מ.', time: 'הזינו מרווח זמן של עד 20 שנה (243 חודשים או 7,300 ימים).' }
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
    ? { done: 'סימון כבוצע: ', cost: 'הוספת עלות או הערות: ', marked: 'סומן כבוצע.', service: 'טיפול', generic: 'משהו השתבש. נסו שוב.', costMsg: 'הזינו עלות בין 0 ל־1,000,000, עם עד 2 ספרות אחרי הנקודה.', oilLeft: 'עוד 10,000 ק״מ', oilLate: 'באיחור של 1,000 ק״מ', oilAt: 'ב־48,000 ק״מ' }
    : { done: 'Mark done: ', cost: 'Add cost or notes: ', marked: 'Marked as done.', service: 'Service', generic: 'Something went wrong. Please try again.', costMsg: 'Enter a cost from 0 to 1,000,000 with up to 2 decimals.', oilLeft: '10,000 km left', oilLate: 'Overdue by 1,000 km', oilAt: 'at 48,000 km' }
  const localDate = () => page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const serviceRows = () => page.locator('.history li').filter({ hasText: RS.service })
  const isReset = (r) => r.method() === 'POST' && r.url().endsWith('/reset')
  const forget500 = () => {
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 ')) // the forced failure
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
  }
  await step('reset-task', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    if (await taskRow(TK.belt).locator('button.done').count()) throw new Error('Mark done on a disabled task')
    if (await taskBtn(RS.cost, TK.belt).count()) throw new Error('Add cost or notes on a disabled task')
    // A failed reset: the translated error on the row, the rows kept, focus back on Mark done.
    await page.route('**/reset', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
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
    await page.route('**/reset', async (r) => { await page.waitForTimeout(500); await r.continue() }, { times: 1 })
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
    await page.route('**/void', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
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
    const opener = `button[aria-label="${RS.cost}Brakes"]`
    const form = taskRow('Brakes').locator('form')
    // Escape and Cancel close the form with focus back on its opener.
    await taskBtn(RS.cost, 'Brakes').click()
    await focusIs('form input[name=cost]', 'cost form open')
    await page.keyboard.press('Escape')
    await form.waitFor({ state: 'detached' })
    await focusIs(opener, 'after Escape')
    await taskBtn(RS.cost, 'Brakes').click()
    await form.locator('button.link').click()
    await focusIs(opener, 'after Cancel')
    await taskBtn(RS.cost, 'Brakes').click()
    const label = plain(await form.locator('label').first().textContent())
    if (!label.includes(registered.user.currency)) throw new Error(`cost label "${label}"`)
    await noOverflow('the cost form open')
    await sweep('car page with the cost form open')
    // Blocked on the client with the message on the field.
    let posts = 0
    const count = (r) => isReset(r) && posts++
    page.on('request', count)
    for (const v of ['-1', '1000000.01', '1.234']) {
      await form.locator('input[name=cost]').fill(v)
      await form.locator('button:not(.link)').click()
      const shown = await form.locator('input[name=cost]').evaluate((el) => el.validationMessage)
      if (plain(shown) !== RS.costMsg) throw new Error(`cost ${v}: "${shown}"`)
    }
    await page.waitForTimeout(300)
    page.off('request', count)
    if (posts) throw new Error(`${posts} reset POSTs for blocked costs`)
    await form.locator('input[name=cost]').fill('120.50')
    await form.locator('textarea[name=notes]').fill('  Castrol 5W-30 ')
    // A failed reset keeps the form, shows the error, and puts focus back on the form's Mark done.
    await page.route('**/reset', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await form.locator('button:not(.link)').click()
    const failed = await form.locator('[role=alert]').textContent()
    if (failed !== RS.generic) throw new Error(`cost form error "${failed}"`)
    await focusIs('.tasks form button:not(.link)', 'after a failed reset from the form')
    forget500()
    const res = page.waitForResponse((r) => isReset(r.request()))
    await form.locator('button:not(.link)').click()
    const r = await res
    const body = r.request().postDataJSON()
    if (r.status() !== 201 || body.cost !== 120.5 || body.notes !== '  Castrol 5W-30 ' || body.date !== (await localDate())) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    const saved = await r.json()
    if (!saved.serviceRecordId || saved.task.lastDoneOdometerKm !== 59000 || saved.task.status !== 'Ok') throw new Error(`response ${JSON.stringify(saved)}`)
    await badgeIs('Brakes', ST.Ok)
    await focusIs('.tasks .undo button', 'after Mark done from the form')
    // Criterion 12: any other action in the section removes the bar without undoing.
    await taskBtn(TK.edit, '9k service').click()
    await page.keyboard.press('Escape')
    if (await tasks.locator('.undo').count()) throw new Error('bar still shown after Edit')
    await page.waitForTimeout(300)
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
    await page.route('**/api/vehicles/*/tasks', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    const failed = page.waitForResponse((r) => r.url().endsWith('/tasks') && r.status() === 500)
    await taskBtn(RS.done, 'Coolant').click()
    await failed
    const alert = tasks.locator(':scope > p.error[role=alert]')
    await alert.waitFor()
    await page.unroute('**/api/vehicles/*/tasks')
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
    await page.locator('.cars li').first().waitFor()
    await arrivedAt(T.myCars)
    await page.click('a[href$="/edit"]')
    await page.locator('input[name=nickname]').waitFor()
    await arrivedAt(T.editCar)
    await page.fill('input[name=nickname]', 'Renamed Corolla')
    await page.click('form button:not(.link)')
    await page.getByRole('heading', { name: 'Renamed Corolla' }).waitFor()
    await arrivedAt(T.myCars)
  })
  // SET-1: settings. Each setup forces the theme opposite to its OS one, at 390px wide.
  // The hint comes from i18n.ts (en first, then he), so copy edits don't break the step.
  const hints = [...readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8').matchAll(/currencyHint: (['"])(.*)\1,/g)].map((m) => m[2])
  const SE = he ? { settings: 'הגדרות', saved: 'נשמר', hint: hints[1] } : { settings: 'Settings', saved: 'Saved', hint: hints[0] }
  const osTheme = s.colorScheme === 'light' ? 'Light' : 'Dark'
  const forced = osTheme === 'Light' ? 'Dark' : 'Light'
  const BG = { Light: 'rgb(230, 233, 238)', Dark: 'rgb(17, 21, 28)' } // --bg
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
    await tall(page.locator('header a[href="/settings"]'), 'Settings link')
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
    // The header switch saves the language too.
    res = putSettings()
    await page.click('header nav button.link >> nth=0')
    if ((await res).request().postDataJSON().locale !== own) throw new Error('header switch did not save the language')
    await dirIs(ownDir)
    if (!(await radio('locale', own).isChecked())) throw new Error(`${own} not checked after the header switch`)
    // Signed out: no Settings link, /settings goes to the login page, and the switch saves nothing.
    await page.click('header nav button.link >> nth=1')
    await page.locator('input[name=email]').waitFor()
    if (await page.locator('header a[href="/settings"]').count()) throw new Error('Settings link while signed out')
    await page.goto(`${BASE}/settings`)
    await page.waitForURL('**/login')
    let puts = 0
    const count = (r) => r.method() === 'PUT' && puts++
    page.on('request', count)
    await page.click('header nav button.link >> nth=0')
    await dirIs(otherDir)
    page.off('request', count)
    if (puts) throw new Error('the signed-out switch sent a PUT')
    // Logging in applies the saved language and theme.
    await page.fill('input[name=email]', registered.user.email)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('a[href="/cars/new"]').waitFor()
    await dirIs(ownDir)
    await titleIs(T.myCars)
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
    await page.click('.cars li h2 a')
    await taskBtn(RS.cost, 'Brakes').click()
    const label = plain(await taskRow('Brakes').locator('form label').first().textContent())
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
        intervalLabel: 'מרווח במיילים', initialLabel: 'קילומטראז׳ נוכחי (מייל)', maxReading: 'הזינו קריאה בין 0 ל־6,213,711 מייל.', maxInterval: 'הזינו מרווח של 1 עד 621,371 מייל.',
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
    const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
    mileCarId = (await apiCall('POST', '/vehicles', { nickname: 'Mile car', initialOdometerKm: 80467 })).id
    await apiCall('POST', `/vehicles/${mileCarId}/odometer`, { valueKm: 79967, readingDate: utc(10) })
    await apiCall('POST', `/vehicles/${mileCarId}/tasks`, { name: 'Mile oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 72000, lastDoneDate: utc(0) })
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
    const taskPost = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/tasks'))
    await add.locator('button:not(.link)').click()
    body = (await taskPost).request().postDataJSON()
    if (body.intervalKm !== 8047 || body.lastDoneOdometerKm !== 80628) throw new Error(`task POST ${JSON.stringify(body)}`)
    await taskRow('Mile wash').waitFor()
    // Just done: the remaining distance adds up with the shown interval (8,047 km is 5,000.2 mi).
    if (!plain(await taskRow('Mile wash').textContent()).includes(UM.left5000)) throw new Error(`new task row: ${await taskRow('Mile wash').textContent()}`)
    await noOverflow('the car page in miles')
    await sweep('the car page in miles')
    await page.screenshot({ path: `${OUT}/${s.name}-unit-miles-car.png`, fullPage: true })
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
    // SET-1 QA Low 2: each later settings action, on the page or with the header switch, clears every earlier error.
    await openSettings()
    const alerts = () => page.locator('main [role=alert]')
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    await page.route('**/api/me/settings', fail, { times: 1 })
    await radio('theme', 'Dark').click()
    await page.locator('fieldset:has(input[name=theme]) [role=alert]').waitFor()
    await page.route('**/api/me/settings', fail, { times: 1 })
    await page.click('header nav button.link >> nth=0')
    await page.locator('main > p[role=alert]').waitFor()
    if ((await alerts().count()) !== 1) throw new Error(`${await alerts().count()} alerts after the header switch failed`)
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
    await page.locator('.cars li').first().waitFor()
    await tall(page.locator('main > label.inline'), 'Show archived') // MVP2-C QA note (a)
    await sweep('list page at 390px') // the screenshot is taken at 390px; the next step restores the viewport
  })
  await step('archive-car', async () => {
    await page.setViewportSize(s.viewport)
    await page.click('.cars li .actions button.link')
    await page.locator('.cars li').waitFor({ state: 'detached' })
    await page.check('main > label.inline input')
    await page.locator('.cars li.archived', { hasText: 'Renamed Corolla' }).waitFor()
  })
  await step('archived-tasks-read-only', async () => {
    await page.locator('.cars li.archived', { hasText: 'Renamed Corolla' }).locator('h2 a').click()
    await taskRow(TK.belt).waitFor()
    const controls = await tasks.locator('button, input, select').count()
    if (controls) throw new Error(`${controls} controls on an archived car's tasks`)
    await page.click('main > a.back')
    await page.locator('a[href="/cars/new"]').waitFor() // the list hides archived cars again
  })
  await step('switch-language', async () => {
    const before = await page.getAttribute('html', 'dir')
    await page.click('header nav button.link >> nth=0')
    const after = await page.getAttribute('html', 'dir')
    if (before === after) throw new Error(`dir stayed "${after}"`)
  })
  await step('logout', async () => {
    await page.click('header nav button.link >> nth=1')
    await page.locator('input[name=email]').waitFor()
  })

  report.push(run)
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.some((r) => r.steps.some((st) => !st.ok)) ? 1 : 0
