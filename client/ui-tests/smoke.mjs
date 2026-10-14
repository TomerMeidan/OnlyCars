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

  await step('login-page', async () => {
    await page.goto(`${BASE}/login`)
    await page.locator('input[name=email]').waitFor()
  })
  let currencyOptions, defaultCurrency, registered
  await step('register', async () => {
    await page.click('a[href="/register"]')
    await page.fill('input[name=email]', `ui-${s.name}-${Date.now()}@onlycars.test`)
    await page.fill('input[name=password]', 'Passw0rd!')
    currencyOptions = await page.locator('select[name=currency] option').allTextContents()
    defaultCurrency = await page.inputValue('select[name=currency]')
    const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/register'))
    await page.click('form button:not(.link)')
    registered = await (await response).json()
    await page.locator('a[href="/cars/new"]').waitFor()
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
    await page.fill('input[name=nickname]', 'Test Corolla')
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
  await step('edit-reading', async () => {
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
  })
  await step('delete-reading', async () => {
    // Deleting the latest reading makes the one before it current.
    const row = page.locator('.history li').first()
    await row.getByRole('button', { name: s.lng === 'he' ? 'מחיקה של הקריאה 60,000 ק״מ' : 'Delete reading 60,000 km' }).click()
    await row.locator('.inline-form button:not(.link)').click()
    await waitFor(async () => (await values()) === '59000,61000' && digitsOnly(await odometer()) === '59000', 'after delete')
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
    await page.click('a[href$="/edit"]')
    await page.fill('input[name=nickname]', 'Renamed Corolla')
    await page.click('form button:not(.link)')
    await page.getByRole('heading', { name: 'Renamed Corolla' }).waitFor()
  })
  await step('archive-car', async () => {
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
