// Repro: Hebrew user switches to English, then Log out. Does it land on /login? Repeats N times.
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
for (let i = 0; i < Number(process.argv[2] ?? 3); i++) {
  const lng = process.argv[3] ?? 'he'
  const email = `qa+mvp5b-logout-${Date.now()}@example.com`
  await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: lng === 'he' ? 'He' : 'En' } })
  const ctx = await browser.newContext({ timezoneId: 'UTC' })
  await ctx.addInitScript((l) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', l), lng)
  const page = await ctx.newPage()
  const log = []
  page.on('request', (x) => x.url().includes('/api/') && log.push(`> ${x.method()} ${x.url().replace(/.*\/api/, '')}`))
  page.on('response', (x) => x.url().includes('/api/') && log.push(`< ${x.status()} ${x.url().replace(/.*\/api/, '')}`))
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!'); await page.click('form button:not(.link)')
  await page.waitForURL(BASE + '/'); await page.locator('main h1').waitFor(); await page.waitForTimeout(800)
  log.length = 0
  if (process.env.SLOW) await page.route('**/api/me/settings', async (rt) => { await new Promise((ok) => setTimeout(ok, 1500)); await rt.continue() })
  await page.click('header nav button.link >> nth=0')
  await page.waitForTimeout(Number(process.argv[4] ?? 0))
  await page.click('header nav button.link >> nth=1')
  await page.waitForTimeout(2500)
  const ok = await page.locator('input[name=email]').waitFor({ timeout: 4000 }).then(() => true, () => false)
  console.log(i, ok ? 'login page' : `STUCK at ${page.url()} | ${(await page.locator('main').textContent()).slice(0, 80)}`, '\n  ' + log.join('\n  '))
  if (!ok) await page.screenshot({ path: `ui-tests/out/qamvp5b-logout-stuck-${lng}.png` })
  await ctx.close()
}
await browser.close()
