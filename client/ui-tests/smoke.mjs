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
  await step('register', async () => {
    await page.click('a[href="/register"]')
    await page.fill('input[name=email]', `ui-${s.name}-${Date.now()}@onlycars.test`)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('a[href="/cars/new"]').waitFor()
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
    await page.click('.quick button')
    await page.waitForFunction(() => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === '61250')
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
