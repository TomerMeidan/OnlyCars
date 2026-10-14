// UI smoke run: walks the main flows in two setups and prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/smoke.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

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
    await page.click('.quick button')
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
    if (posted || required !== (he ? 'הזינו מרווח בק״מ, מרווח זמן או את שניהם.' : 'Enter a km interval, a time interval, or both.')) throw new Error(`${posted} POST, "${required}"`)
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
      : { pct: 'Enter a whole number from 1 to 50.', km: 'Enter a km interval from 1 to 1,000,000.', time: 'Enter a time interval of up to 20 years (243 months or 7,300 days).' }
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
  await step('tap-targets-list', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await sweep('list page at 390px') // the screenshot is taken at 390px; the next step restores the viewport
  })
  await step('archive-car', async () => {
    await page.setViewportSize(s.viewport)
    await page.click('.cars li .actions button.link')
    await page.locator('.cars li').waitFor({ state: 'detached' })
    await page.check('main > label.inline input')
    await page.locator('.cars li.archived').waitFor()
  })
  await step('archived-tasks-read-only', async () => {
    await page.click('.cars li.archived h2 a')
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
