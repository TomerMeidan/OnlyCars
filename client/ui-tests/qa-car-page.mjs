// QA exploration of the car page (/cars/:id): light Hebrew, mobile English, many readings,
// malformed ids, keyboard-only navigation. Prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/qa-car-page.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const report = []

// One user with a car that has several readings, built through the API.
const api = await (await browser.newContext()).request
const auth = await (await api.post(`${BASE}/api/auth/register`, {
  data: { email: `qa-car-${Date.now()}@onlycars.test`, password: 'Passw0rd!' },
})).json()
const headers = { Authorization: `Bearer ${auth.token}` }
const car = await (await api.post(`${BASE}/api/vehicles`, {
  headers,
  data: { nickname: 'A very long nickname for the family station wagon that we drive', make: 'Skoda', model: 'Octavia', year: 2015, initialOdometerKm: 98000 },
})).json()
const posts = [
  { valueKm: 101500, readingDate: '2026-01-15' },
  { valueKm: 104320.5, readingDate: '2026-03-02' },
  { valueKm: 110000, readingDate: '2026-06-30' },
  { valueKm: 109000, readingDate: '2026-07-01', confirmCorrection: true },
  { valueKm: 1234567, readingDate: '2026-09-10' },
]
const postResults = []
for (const p of posts) {
  const r = await api.post(`${BASE}/api/vehicles/${car.id}/odometer`, { headers, data: p })
  postResults.push(`${r.status()} ${p.valueKm}`)
}
const emptyCar = await (await api.post(`${BASE}/api/vehicles`, { headers, data: { nickname: 'No readings' } })).json()
report.push({ setup: 'data', carId: car.id, emptyCarId: emptyCar.id, postResults })

async function run(name, opts, lng, fn) {
  const ctx = await browser.newContext(opts)
  await ctx.addInitScript(([lng, token, user]) => {
    localStorage.setItem('i18nextLng', lng)
    localStorage.setItem('token', token)
    localStorage.setItem('user', user)
  }, [lng, auth.token, JSON.stringify(auth.user)])
  const page = await ctx.newPage()
  const r = { setup: name, checks: [], consoleErrors: [], badResponses: [] }
  page.on('console', (m) => m.type() === 'error' && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url()}`))
  const shot = async (label) => {
    await page.waitForLoadState('networkidle').catch(() => {})
    const path = `${OUT}/qa-${name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    r.checks.push({ shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }) })
  }
  try { await fn(page, shot, r) } catch (e) { r.checks.push({ error: e.message.split('\n')[0] }) }
  report.push(r)
  await ctx.close()
}

const history = (page) => page.locator('.history li').allTextContents()

// 1. Light theme, Hebrew, desktop and mobile
for (const [n, vp] of [['desktop-light-he', { width: 1280, height: 800 }], ['mobile-light-he', { width: 390, height: 844 }]]) {
  await run(n, { viewport: vp, colorScheme: 'light', isMobile: vp.width < 500, hasTouch: vp.width < 500 }, 'he', async (page, shot, r) => {
    await page.goto(`${BASE}/`)
    await page.click(`a[href="/cars/${car.id}"]`)
    await page.locator('.history li').first().waitFor()
    r.checks.push({ dir: await page.getAttribute('html', 'dir'), rows: await history(page) })
    r.checks.push({ latin: (await page.locator('main').innerText()).match(/[A-Za-z]+/g) })
    await shot('many-readings')
    await page.goto(`${BASE}/cars/${emptyCar.id}`)
    await page.locator('.card').nth(1).waitFor()
    r.checks.push({ emptyText: await page.locator('section.card').innerText() })
    await shot('empty')
  })
}

// 2. Mobile 390px English, light, plus malformed URLs
await run('mobile-light-en', { viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true }, 'en', async (page, shot, r) => {
  await page.goto(`${BASE}/`)
  await page.click(`a[href="/cars/${car.id}"]`)
  await page.locator('.history li').first().waitFor()
  r.checks.push({ rows: await history(page), odometerLabel: await page.locator('.odometer').getAttribute('aria-label') })
  const backBox = await page.locator('main > a[href="/"]').boundingBox()
  r.checks.push({ backLinkTapTarget: backBox && `${Math.round(backBox.width)}x${Math.round(backBox.height)}` })
  await shot('many-readings')
  for (const [label, path] of [['abc', '/cars/abc'], ['zero-guid', '/cars/00000000-0000-0000-0000-000000000000'], ['trailing-slash', `/cars/${car.id}/`], ['encoded', '/cars/%2e%2e%2fvehicles']]) {
    await page.goto(`${BASE}${path}`)
    await page.waitForLoadState('networkidle')
    const err = await page.locator('main .error').textContent({ timeout: 3000 }).catch(() => null)
    r.checks.push({ path, finalUrl: page.url().replace(BASE, ''), error: err, mainText: (await page.locator('main').innerText()).slice(0, 120) })
    await shot(`url-${label}`)
  }
})

// 3. Keyboard only, desktop English light: list -> car page -> back
await run('keyboard-en', { viewport: { width: 1280, height: 800 }, colorScheme: 'light' }, 'en', async (page, shot, r) => {
  await page.goto(`${BASE}/`)
  await page.locator('.cars li').first().waitFor()
  const focusInfo = () => page.evaluate(() => {
    const el = document.activeElement
    const cs = getComputedStyle(el)
    return { tag: el.tagName, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), href: el.getAttribute('href'), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, boxShadow: cs.boxShadow }
  })
  const order = []
  let reached = false
  for (let i = 0; i < 25 && !reached; i++) {
    await page.keyboard.press('Tab')
    const f = await focusInfo()
    order.push(f)
    reached = f.href === `/cars/${car.id}`
  }
  r.checks.push({ tabsToCarLink: order.length, reached, focusOnCarLink: order.at(-1) })
  await shot('focus-car-link')
  await page.keyboard.press('Enter')
  await page.locator('.history li').first().waitFor()
  r.checks.push({ afterEnterUrl: page.url().replace(BASE, ''), focusAfterNav: await focusInfo(), title: await page.title() })
  const carOrder = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    carOrder.push(await focusInfo())
  }
  r.checks.push({ tabOrderOnCarPage: carOrder })
  // Focus "All cars" and go back with Enter.
  await page.locator('main > a[href="/"]').focus()
  await shot('focus-back-link')
  await page.keyboard.press('Enter')
  await page.locator('.cars li').first().waitFor()
  r.checks.push({ backUrl: page.url().replace(BASE, ''), focusAfterBack: await focusInfo() })
  // Browser back returns to the car page.
  await page.goBack()
  await page.locator('.history li').first().waitFor({ timeout: 5000 })
  r.checks.push({ browserBackUrl: page.url().replace(BASE, '') })
})

await browser.close()
console.log(JSON.stringify(report, null, 2))
