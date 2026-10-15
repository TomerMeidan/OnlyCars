// LOW-2 QA: dashboard first load while offline (all dashboard requests aborted), en and he.
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
for (const lng of ['en', 'he']) {
  const email = `qa+low2off-${lng}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: lng === 'he' ? 'He' : 'En' } })).json()
  await req.post(`${BASE}/api/vehicles`, { headers: { Authorization: `Bearer ${reg.token}` }, data: { nickname: 'X', initialOdometerKm: 1000 } })
  const ctx = await browser.newContext()
  await ctx.addInitScript((l) => localStorage.setItem('i18nextLng', l), lng)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`); await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!'); await page.click('form button:not(.link)')
  await page.locator('.cars > li').first().waitFor()
  let n = 0
  await page.route((u) => u.pathname === '/api/dashboard', (rt) => { n++; return rt.abort('internetdisconnected') })
  await page.reload(); await page.waitForTimeout(1500)
  console.log(lng, 'dashboard requests', n, 'alert:', await page.locator('main [role=alert]').first().textContent().catch(() => '(none)'))
  await page.screenshot({ path: `ui-tests/out/qalow2-offline-${lng}.png`, fullPage: true })
}
await browser.close()
