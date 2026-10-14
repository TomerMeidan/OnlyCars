// MVP1-C criterion 9, server path: with the input's max removed, 20000000 reaches the API; the form must show the
// translated odometer.invalidValue message and keep its values. Usage: node ui-tests/qa-mvp1c-cap.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome' })
const api = (await browser.newContext()).request
const auth = await (await api.post(`${BASE}/api/auth/register`, { data: { email: `qa-1c-cap-${Date.now()}@onlycars.test`, password: 'Passw0rd!' } })).json()
const report = []
for (const lng of ['en', 'he']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(([lng, t, u]) => { localStorage.setItem('i18nextLng', lng); localStorage.setItem('token', t); localStorage.setItem('user', u) }, [lng, auth.token, JSON.stringify(auth.user)])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/cars/new`)
  await page.fill('input[name=nickname]', 'Cap car')
  const input = page.locator('input[name=initialOdometerKm]')
  const max = await input.getAttribute('max')
  await input.evaluate((e) => e.removeAttribute('max'))
  await input.fill('20000000')
  await page.click('form button:not(.link)')
  const alert = await page.locator('form [role=alert], form .error').first().textContent({ timeout: 4000 }).catch(() => null)
  const shot = `ui-tests/out/qa1c-cap-${lng}.png`
  await page.screenshot({ path: shot, fullPage: true })
  report.push({ lng, max, alert, url: new URL(page.url()).pathname, nickname: await page.inputValue('input[name=nickname]'), km: await input.inputValue(), shot })
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(report, null, 2))
