import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const b = await chromium.launch({ channel: 'chrome' })
const req = (await b.newContext()).request
const email = `qa+mvp5a-zoom-${Date.now()}@example.com`
const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: 'He', currency: 'ILS' } })).json()
console.log((await req.post(`${BASE}/api/checklist-templates`, { headers: { Authorization: `Bearer ${reg.token}` }, data: { name: 'בדיקה חודשית', items: [{ label: 'לחץ אוויר', type: 'Number', unit: 'bar', minValue: -5.5, maxValue: 2.6 }] } })).status())
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('i18nextLng', 'he'))
const page = await ctx.newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!')
await page.click('form button:not(.link)'); await page.waitForURL((u) => !u.pathname.startsWith('/login'))
await page.goto(`${BASE}/checklists`)

await page.locator('main .checklists button.edit').click()
const it = page.locator('fieldset.item').first()
await it.locator('input').nth(3).fill('-10')
await page.locator('main form > .actions > button:not(.link)').click()
await it.locator('[role=alert]').waitFor()
await it.screenshot({ path: process.argv[2] })
console.log(await it.locator('input').evaluateAll((xs) => xs.map((x) => x.value)))
await b.close()
