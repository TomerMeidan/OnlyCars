// Repro: Hebrew user on /checklists switches language to English, then logs out; does the login form appear?
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const b = await chromium.launch({ channel: 'chrome' })
const req = (await b.newContext()).request
for (const [lng, path] of [['he', '/checklists'], ['he', '/settings'], ['en', '/checklists']]) {
  const email = `qa+mvp5a-lo-${lng}-${Date.now()}@example.com`
  await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: lng === 'he' ? 'He' : 'En', currency: 'ILS' } })
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript((l) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', l), lng)
  const page = await ctx.newPage()
  const log = []
  page.on('response', (x) => x.url().includes('/api/') && log.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))
  page.on('framenavigated', (f) => f === page.mainFrame() && log.push(`nav ${f.url()}`))
  page.on('pageerror', (e) => log.push(`pageerror ${e}`))
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)'); await page.waitForURL((u) => !u.pathname.startsWith('/login'))
  await page.click(`header nav a[href="${path}"]`); await page.waitForLoadState('networkidle')
  log.push('--- switch language')
  await page.click('header nav button.link >> nth=0'); await page.waitForTimeout(800)
  log.push('--- logout')
  await page.click('header nav button.link >> nth=1')
  const ok = await page.locator('input[name=email]').waitFor({ timeout: 5000 }).then(() => true, () => false)
  log.push(`login form shown: ${ok}; url ${page.url()}; inputs ${await page.locator('input').count()}; html ${(await page.locator('main').innerHTML()).slice(0, 200)}`)
  console.log(lng, path, '\n ', log.join('\n  '))
  await ctx.close()
}
await b.close()
