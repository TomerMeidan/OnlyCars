// Probe: width of the attach form's template select at 390px with a long template name (Hebrew and English).
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
for (const lng of ['he', 'en']) {
  const email = `qa+mvp5b-probe-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: lng === 'he' ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  const car = await post('/vehicles', { nickname: 'Mazda', initialOdometerKm: 50000 })
  await post('/checklist-templates', { name: 'Winter preparation full inspection before the long drive up north to the Golan', items: [] })
  const ctx = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript((l) => localStorage.setItem('i18nextLng', l), lng)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!'); await page.click('form button:not(.link)')
  await page.waitForURL(BASE + '/')
  await page.goto(`${BASE}/cars/${car.id}`)
  const sec = page.locator('section[aria-labelledby=checklists]')
  await sec.locator('button.add').click()
  await page.waitForTimeout(500)
  console.log(lng, await page.evaluate(() => ({ innerWidth, docW: document.documentElement.scrollWidth, visual: visualViewport.width, scale: visualViewport.scale, select: document.querySelector('select[name=templateId]').getBoundingClientRect().width })))
  await page.screenshot({ path: `ui-tests/out/qamvp5b-probe-attach-long-${lng}.png` })
  await ctx.close()
}
await browser.close()
