// Zoomed crops of MVP3-B history rows in Hebrew (amount and part number rendering). Usage: node ui-tests/qa-mvp3b-zoom.mjs
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173', OUT = 'ui-tests/out'
const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const email = `qa+mvp3bzoom-${Date.now()}@example.com`
const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: 'He' } })).json()
const H = { Authorization: `Bearer ${reg.token}` }
const car = await (await req.post(`${BASE}/api/vehicles`, { headers: H, data: { nickname: 'Zoom', initialOdometerKm: 50000 } })).json()
await req.post(`${BASE}/api/vehicles/${car.id}/service-records`, { headers: H, data: { date: new Date().toISOString().slice(0, 10), odometerKm: 50000, shopName: 'מוסך כהן', notes: 'החלפת שמן',
  items: [{ description: 'מסנן שמן', brand: 'Mann', partNumber: 'W 712/75', quantity: 2, unitCost: 45.5 }, { description: 'עבודה', quantity: 1.5, unitCost: 1200, isLabor: true }] } })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark' })
await ctx.addInitScript(() => localStorage.setItem('i18nextLng', 'he'))
const page = await ctx.newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!')
await page.click('form button:not(.link)'); await page.locator('a[href="/cars/new"]').waitFor()
await page.goto(`${BASE}/cars/${car.id}`)
const row = page.locator('.services > li').first(); await row.waitFor()
await row.screenshot({ path: `${OUT}/qamvp3b-zoom-he-row.png` })
const info = await row.locator('.service-items li bdi, :scope > p bdi').evaluateAll((bs) => bs.map((b) => ({ text: JSON.stringify(b.textContent), dir: getComputedStyle(b).direction })))
await row.locator('button.edit-service').click()
await row.locator('form').screenshot({ path: `${OUT}/qamvp3b-zoom-he-edit.png` })
console.log(JSON.stringify(info, null, 1))
await browser.close()
