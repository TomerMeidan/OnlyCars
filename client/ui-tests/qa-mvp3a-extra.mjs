// MVP3-A extra probes: the tasks' own Undo bar reloads the history, mocked field errors are tied to their field, 409 on Undo, keyboard focus ring.
// Usage (API + Vite running): node ui-tests/qa-mvp3a-extra.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = 'ui-tests/out'
const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()
const out = []

for (const lng of ['en', 'he']) {
  const email = `qa+mvp3ax-${lng}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: lng === 'he' ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const car = await (await req.post(`${BASE}/api/vehicles`, { headers: H, data: { nickname: 'Probe', initialOdometerKm: 50000 } })).json()
  await req.post(`${BASE}/api/vehicles/${car.id}/tasks`, { headers: H, data: { name: 'Oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 45000, lastDoneDate: '2026-01-01' } })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const r = { lng }
  out.push(r)
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)'); await page.locator('a[href="/cars/new"]').waitFor()
  await page.goto(`${BASE}/cars/${car.id}`)
  const sec = page.locator('section[aria-labelledby=service-history]')
  const items = sec.locator('.services > li')
  await sec.waitFor(); await page.waitForLoadState('networkidle')

  // 1. Mark done, then the tasks' Undo bar: the history row goes away.
  await page.locator('.tasks button.done').click()
  await items.first().waitFor()
  await page.locator('.undo button').click()
  r.historyAfterTaskUndo = await items.first().waitFor({ state: 'detached', timeout: 4000 }).then(() => 'row removed', async () => `still ${await items.count()} rows`)

  // 2. Mocked field errors: translated, and aria-invalid on the right field.
  const form = sec.locator('form')
  await sec.locator('button.add').click()
  r.fieldErrors = {}
  for (const [code, field] of [['serviceRecord.shopTooLong', 'shopName'], ['serviceRecord.notesTooLong', 'notes'], ['serviceRecord.invalidCost', 'totalCost'], ['maintenanceTask.notFound', null], ['odometer.invalidValue', 'odometerKm']]) {
    await page.route('**/service-records', (rt) => rt.request().method() === 'POST' ? rt.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code }) }) : rt.continue(), { times: 1 })
    await form.locator('.actions button:not(.link)').click()
    await form.locator('[role=alert]').waitFor()
    await page.waitForTimeout(150)
    const invalid = await form.locator('[aria-invalid=true]').evaluateAll((els) => els.map((e) => e.name))
    r.fieldErrors[code] = { text: plain(await form.locator('[role=alert]').textContent()), invalid, ok: field ? invalid.join() === field : invalid.length === 0 }
  }
  await page.screenshot({ path: `${OUT}/qamvp3ax-${lng}-field-error.png`, fullPage: true })
  await form.locator('button.link').click()

  // 3. 409 alreadyVoided on Undo (another tab undid it): translated on the row.
  await sec.locator('button.add').click(); await form.locator('.actions button:not(.link)').click(); await items.first().waitFor()
  await items.first().locator('button.undo-service').click()
  await page.route('**/void', (rt) => rt.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.alreadyVoided' }) }), { times: 1 })
  await items.first().locator('button.danger').click()
  await items.first().locator('[role=alert]').waitFor()
  r.alreadyVoided = plain(await items.first().locator('[role=alert]').textContent())
  await items.first().locator('button.link').click()

  // 4. Keyboard only: focus Undo with Tab, Enter opens the confirm, Escape returns; is a focus ring visible?
  await items.first().locator('button.undo-service').focus()
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
  const ring = () => page.evaluate(() => { const a = document.activeElement; const c = getComputedStyle(a); return `${a.textContent.trim()} ${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}` })
  r.ringOnUndo = await ring()
  await page.keyboard.press('Enter'); await page.waitForTimeout(150)
  r.ringOnCancel = await ring()
  await page.keyboard.press('Escape'); await page.waitForTimeout(150)
  r.ringAfterEscape = await ring()
  await page.screenshot({ path: `${OUT}/qamvp3ax-${lng}-keyboard.png` })
  await ctx.close()
}
console.log(JSON.stringify(out, null, 2))
await browser.close()
