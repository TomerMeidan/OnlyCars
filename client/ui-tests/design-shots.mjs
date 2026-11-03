// Design review shots: the main screens in en/he, light/dark, 390px and 1280px, for a seeded user.
// Usage (API + Vite running): node ui-tests/design-shots.mjs <folder name>, e.g. before or after; writes ui-tests/out-design/<name>/. WIDTHS=360 for other widths.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = `ui-tests/out-design/${process.argv[2] ?? 'after'}`
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const ctx0 = await browser.newContext()
const req = ctx0.request

const today = new Date().toISOString().slice(0, 10)
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const auth = await (await req.post(`${BASE}/api/auth/register`, { data: { email: `design-${Date.now()}@onlycars.test`, password: 'Passw0rd!', currency: 'ILS' } })).json()
const headers = { Authorization: `Bearer ${auth.token}` }
const call = async (method, path, data) => {
  const r = await req.fetch(`${BASE}/api${path}`, { method, headers, data })
  if (!r.ok()) console.error(method, path, r.status(), await r.text())
  return r.status() === 204 ? null : r.json().catch(() => null)
}
const car = await call('POST', '/vehicles', { nickname: 'Family Corolla', make: 'Toyota', model: 'Corolla', year: 2019, plate: '12-345-67', initialOdometerKm: 48200, readingDate: ago(400) })
await call('POST', `/vehicles/${car.id}/odometer`, { valueKm: 61250, readingDate: today })
const car2 = await call('POST', '/vehicles', { nickname: 'מאזדה של אבא', make: 'Mazda', model: '3', year: 2015, initialOdometerKm: 143900, readingDate: ago(30) })
const task = (v, name, category, intervalKm, intervalDays, lastKm, lastDays) =>
  call('POST', `/vehicles/${v.id}/tasks`, { name, category, intervalKm, intervalDays, lastDoneOdometerKm: lastKm, lastDoneDate: ago(lastDays) })
await task(car, 'Oil change', 'Oil', 10000, 365, 50500, 300)
await task(car, 'Brake fluid', 'Brakes', null, 730, 52000, 690)
await task(car, 'Air filter', 'Filters', 20000, null, 50000, 200)
await task(car2, 'Timing belt', 'Belts', 100000, null, 45000, 900)
await call('POST', `/vehicles/${car.id}/service-records`, { date: ago(60), odometerKm: 59000, shopName: 'Garage Levi', notes: 'Wipers and a check', items: [{ description: 'Wiper', quantity: 2, unitCost: 45 }, { description: 'Labour', quantity: 1, unitCost: 120 }] })
await call('POST', `/vehicles/${car.id}/documents`, { type: 'Insurance', expiryDate: ago(-12), cost: 3200, notes: null })
await call('POST', `/vehicles/${car.id}/issues`, { title: 'Rattle from the rear door' })
const tpl = await call('POST', '/checklist-templates', { name: 'Monthly check', items: [
  { label: 'Lights', type: 'Check' }, { label: 'Tire pressure', type: 'Number', unit: 'bar', minValue: 2, maxValue: 2.6 }, { label: 'Notes', type: 'Text' }] })
const vc = await call('POST', `/vehicles/${car.id}/checklists`, { templateId: tpl.id, intervalKm: null, intervalDays: 30, date: today })
// TIRE-2b: four tires entered as already on the car, the front pair replaced since (a Tires record), and a check with a low rear-left tread.
await call('POST', `/vehicles/${car.id}/tires/replace`, { positions: ['FL', 'FR', 'RL', 'RR'], date: ago(390), odometerKm: 48500, brand: 'Michelin', model: 'Primacy 4', size: '205/55 R16', season: 'Summer', dotCode: 'DOT 4X 2124' })
await call('POST', `/vehicles/${car.id}/tires/replace`, { positions: ['FL', 'FR'], date: ago(30), odometerKm: 60000, brand: 'Pirelli', model: 'Cinturato P7', size: '205/55 R16', season: 'Summer', cost: 720, shopName: 'Tire shop' })
await call('POST', `/vehicles/${car.id}/tires/checks`, { measuredAt: ago(2), items: [{ position: 'FL', pressureBar: 2.3, treadDepthMm: 7.5 }, { position: 'RL', pressureBar: 2.2, treadDepthMm: 2.5 }] })

const screens = [
  ['login', '/login', false],
  ['dashboard', '/', true],
  ['car', `/cars/${car.id}`, true],
  ['settings', '/settings', true],
  ['reports', '/reports', true],
  ['run', `/cars/${car.id}/checklists/${vc?.id}/run`, true],
  ['checklists', '/checklists', true],
  ['history', '/history', true],
  ['tires', '/tires', true],
  ['car-new', '/cars/new', true],
  // TIRE-2b: the car page's Tires section alone, the rear-left wheel (low tread) selected.
  ['car-tires', `/cars/${car.id}`, true, async (page) => { await page.click('.wheel-RL'); return page.locator('#tires-section') }],
]
for (const lng of ['en', 'he']) {
  await call('PUT', '/me/settings', { locale: lng === 'he' ? 'He' : 'En' })
  const user = await call('GET', '/me')
  for (const scheme of ['light', 'dark']) for (const width of (process.env.WIDTHS ?? '390,1280').split(',').map(Number)) {
    const mobile = width < 600
    const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 800 }, colorScheme: scheme, isMobile: mobile, hasTouch: mobile })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error('pageerror', e.message))
    for (const [name, path, signedIn, act] of screens) {
      await page.goto(`${BASE}/login`)
      await page.evaluate(([token, user, lng, signedIn]) => {
        localStorage.clear()
        localStorage.setItem('i18nextLng', lng)
        if (signedIn) { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)) }
      }, [auth.token, user, lng, signedIn])
      await page.goto(`${BASE}${path}`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(400)
      const over = await page.evaluate((w) => document.documentElement.scrollWidth - w, width)
      if (over > 0) console.error(`OVERFLOW ${over}px ${name} ${lng} ${scheme} ${width}`)
      const shot = { path: `${OUT}/${name}-${lng}-${scheme}-${width}.png` }
      if (act) await (await act(page)).screenshot(shot)
      else await page.screenshot({ ...shot, fullPage: true })
    }
    await ctx.close()
  }
}
await browser.close()
console.log(`done: ${OUT}`)
