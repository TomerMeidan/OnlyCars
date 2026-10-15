// MVP3-C: where does a failed Show more show its error at 390px? Viewport shot after the failure.
// Usage: EMAIL=<seeded qa user> node ui-tests/qa-mvp3c-more500.mjs  (seeds its own user when EMAIL is unset)
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173', OUT = 'ui-tests/out'
const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const email = `qa+mvp3c-more-${Date.now()}@example.com`
const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!' } })).json()
const H = { Authorization: `Bearer ${reg.token}` }
const car = await (await req.post(`${BASE}/api/vehicles`, { headers: H, data: { nickname: 'Bulk', initialOdometerKm: 100000 } })).json()
for (let i = 0; i < 55; i++) await req.post(`${BASE}/api/vehicles/${car.id}/service-records`, { headers: H, data: { date: new Date(Date.now() - (500 - i) * 864e5).toISOString().slice(0, 10), odometerKm: 1000 + i * 10, shopName: `S${i}`, totalCost: 1, taskIds: [] } })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
const page = await ctx.newPage()
await page.goto(`${BASE}/login`); await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!'); await page.click('form button:not(.link)')
await page.locator('a[href="/cars/new"]').waitFor()
await page.goto(`${BASE}/history`); await page.locator('.services > li').first().waitFor(); await page.waitForTimeout(800)
await page.route('**/api/service-records?**', (r) => r.fulfill({ status: 500, body: '{}' }), { times: 1 })
await page.locator('button.more').click(); await page.waitForTimeout(800)
const info = await page.evaluate(() => { const a = document.querySelector('main [role=alert]'); const b = a?.getBoundingClientRect(); const f = document.activeElement; return { alertTop: b && Math.round(b.top), viewportH: innerHeight, alertInView: !!b && b.top >= 0 && b.bottom <= innerHeight, focus: f.tagName + '.' + f.className + ' ' + f.textContent.trim().slice(0, 30) } })
await page.screenshot({ path: `${OUT}/qamvp3c-more500-viewport.png` })
console.log(JSON.stringify(info))
await browser.close()
