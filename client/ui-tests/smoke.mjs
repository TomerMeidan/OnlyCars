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
