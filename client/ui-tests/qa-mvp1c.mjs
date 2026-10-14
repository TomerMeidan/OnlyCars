// QA exploration for MVP1-C: keyboard-only flow with focus after each step, Delete focus fallbacks
// (oldest row, only other reading non-manual), page titles in en/he, danger button in two themes,
// 44px tap targets for every button at 390px, initial-odometer cap via the API.
// Usage (API + Vite must be running; sqlcmd + LocalDB for the non-manual reading): node ui-tests/qa-mvp1c.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const report = []
const api = (await browser.newContext()).request
const email = `qa-1c-${Date.now()}@onlycars.test`
const auth = await (await api.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!' } })).json()
const headers = { Authorization: `Bearer ${auth.token}` }
const newCar = async (nickname, km) => (await (await api.post(`${BASE}/api/vehicles`, { headers, data: { nickname, initialOdometerKm: km } })).json())
const addReading = (car, valueKm, readingDate) => api.post(`${BASE}/api/vehicles/${car.id}/odometer`, { headers, data: { valueKm, readingDate } })

// Criterion 1 via the API.
{
  const res = {}
  for (const km of [-1, 10000001, 99999999999999, 0, 10000000]) {
    const r = await api.post(`${BASE}/api/vehicles`, { headers, data: { nickname: `cap ${km}`, initialOdometerKm: km } })
    res[km] = `${r.status()} ${(await r.json().catch(() => ({}))).code ?? ''}`
  }
  const list = await (await api.get(`${BASE}/api/vehicles`, { headers })).json()
  report.push({ setup: 'c1-api', res, savedCapCars: list.filter((c) => c.nickname.startsWith('cap ')).map((c) => c.nickname) })
  for (const c of list) await api.post(`${BASE}/api/vehicles/${c.id}/archive`, { headers })
}

async function run(name, opts, lng, fn, loggedIn = true) {
  const ctx = await browser.newContext(opts)
  await ctx.addInitScript(([lng, token, user, loggedIn]) => {
    if (!sessionStorage.getItem('qa-init')) {
      sessionStorage.setItem('qa-init', '1')
      localStorage.setItem('i18nextLng', lng)
      if (loggedIn) { localStorage.setItem('token', token); localStorage.setItem('user', user) }
    }
  }, [lng, auth.token, JSON.stringify(auth.user), loggedIn])
  const page = await ctx.newPage()
  const r = { setup: name, checks: [], consoleErrors: [], badResponses: [] }
  page.on('console', (m) => m.type() === 'error' && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(BASE, '')}`))
  const shot = async (label) => {
    await page.waitForLoadState('networkidle').catch(() => {})
    const path = `${OUT}/qa1c-${name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    r.checks.push({ shot: path })
  }
  try { await fn(page, shot, r) } catch (e) { r.checks.push({ error: e.message.split('\n')[0] }) }
  report.push(r)
  await ctx.close()
}

const focus = (page) => page.evaluate(() => {
  const e = document.activeElement
  const cs = getComputedStyle(e)
  return `${e.tagName}${e === document.body ? '(BODY!)' : ''} "${(e.getAttribute('aria-label') || e.getAttribute('name') || e.textContent || '').trim().slice(0, 40)}" outline=${cs.outlineStyle}`
})
const settle = (page) => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(300))
async function tabTo(page, pred, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate(pred)) return
  }
  throw new Error(`tabTo never matched ${pred}`)
}
const desktop = { viewport: { width: 1280, height: 800 }, colorScheme: 'light' }
const mobile = (colorScheme) => ({ viewport: { width: 390, height: 844 }, colorScheme, isMobile: true, hasTouch: true })

// Keyboard-only: sign in, list, car page, back link, edit car, save, browser back. Focus + title after each step.
const kbCar = await newCar('KB car', 10000)
await addReading(kbCar, 9000, '2026-09-01')
for (const [name, opts, lng] of [['kb-desktop-light-en', desktop, 'en'], ['kb-mobile-dark-he', mobile('dark'), 'he']]) {
  await run(name, opts, lng, async (page, shot, r) => {
    const step = async (label) => { await settle(page); r.checks.push({ step: label, url: new URL(page.url()).pathname, title: await page.title(), focus: await focus(page) }) }
    await page.goto(`${BASE}/login`)
    await page.locator('input[name=email]').waitFor()
    await step('first load')
    await tabTo(page, () => document.activeElement?.name === 'email')
    await page.keyboard.type(email)
    await page.keyboard.press('Tab')
    await page.keyboard.type('Passw0rd!')
    await page.keyboard.press('Enter')
    await page.locator('.cars li').first().waitFor()
    await step('after sign in')
    await shot('list-after-signin')
    await tabTo(page, () => document.activeElement?.textContent === 'KB car')
    await page.keyboard.press('Enter')
    await page.locator('.history li').first().waitFor()
    await step('car page')
    await shot('car-page-h1-focus')
    // Escape with no form open: nothing should change.
    await page.keyboard.press('Escape')
    await step('escape with no form open')
    await page.keyboard.press('Shift+Tab')
    await step('shift+tab from h1')
    await shot('back-link-focus')
    await page.keyboard.press('Enter')
    await page.locator('.cars li').first().waitFor()
    await step('back link -> list')
    await tabTo(page, () => document.activeElement?.getAttribute('href')?.endsWith('/edit'))
    await page.keyboard.press('Enter')
    await page.locator('input[name=nickname]').waitFor()
    await step('edit car')
    await tabTo(page, () => document.activeElement?.name === 'nickname')
    await page.keyboard.press('End')
    await page.keyboard.type(' 2')
    await page.keyboard.press('Enter')
    await page.locator('.cars li').first().waitFor()
    await step('after save edit car')
    await page.goBack()
    await page.waitForTimeout(500)
    await step('browser back')
    await tabTo(page, () => document.activeElement?.textContent === 'cancel' || document.activeElement?.matches('form button.link'))
    await page.keyboard.press('Enter')
    await page.locator('.cars li').first().waitFor()
    await step('cancel edit car -> list')
    await tabTo(page, () => document.activeElement?.getAttribute('href') === '/cars/new')
    await page.keyboard.press('Enter')
    await page.locator('input[name=nickname]').waitFor()
    await step('add car')
  }, false)
  // The edit step renamed whichever car came first; put every name back.
  for (const c of await (await api.get(`${BASE}/api/vehicles`, { headers })).json()) if (c.nickname.endsWith(' 2')) await api.put(`${BASE}/api/vehicles/${c.id}`, { headers, data: { ...c, nickname: c.nickname.slice(0, -2) } })
}

// Delete focus fallbacks.
// The initial reading is dated today, so older readings must be lower.
const oldestCar = await newCar('Oldest delete car', 10000)
await addReading(oldestCar, 8000, '2026-08-01')
await addReading(oldestCar, 9000, '2026-09-01')
const svcCar = await newCar('Service reading car', 5000)
await addReading(svcCar, 4000, '2026-09-01')
const dangerCar = await newCar('Danger car', 7000)
await addReading(dangerCar, 6000, '2026-09-01')
let sqlNote
try {
  const sql = `UPDATE OdometerReadings SET Source = 1 WHERE VehicleId = '${svcCar.id}' AND ValueKm = 5000; SELECT @@ROWCOUNT`
  sqlNote = execFileSync('sqlcmd', ['-S', '(localdb)\\mssqllocaldb', '-d', 'OnlyCars', '-E', '-h', '-1', '-Q', sql], { encoding: 'utf8' }).trim()
} catch (e) { sqlNote = `sqlcmd failed: ${e.message.split('\n')[0]}` }
report.push({ setup: 'svc-reading-sql', rowsUpdated: sqlNote })
for (const [name, opts, lng] of [['del-desktop-en', desktop, 'en'], ['del-mobile-he', mobile('light'), 'he']]) {
  await run(name, opts, lng, async (page, shot, r) => {
    const confirmDelete = async (row) => {
      await row.locator('.actions button:not(.edit)').click()
      await row.locator('button.danger').click()
    }
    await page.goto(`${BASE}/cars/${oldestCar.id}`)
    await page.locator('.history li').first().waitFor()
    const before = await page.locator('.history li').count()
    await confirmDelete(page.locator('.history li').last())
    await page.waitForFunction((n) => document.querySelectorAll('.history li').length === n - 1, before)
    await settle(page)
    r.checks.push({ case: 'delete oldest row', focus: await focus(page) })
    await shot('after-delete-oldest')

    await page.goto(`${BASE}/cars/${svcCar.id}`)
    await page.locator('.history li').first().waitFor()
    r.checks.push({ rowsBefore: await page.locator('.history li').allTextContents() })
    if ((await page.locator('.history li').count()) === 2) {
      await confirmDelete(page.locator('.history li').last())
      await page.waitForFunction(() => document.querySelectorAll('.history li').length === 1)
      await settle(page)
      r.checks.push({ case: 'delete manual, only other reading non-manual', focus: await focus(page), rowsAfter: await page.locator('.history li').allTextContents() })
      await shot('after-delete-to-h2')
    }
  })
  // Restore for the second language.
  if (name === 'del-desktop-en') {
    await addReading(oldestCar, 8000, '2026-08-01')
    await addReading(svcCar, 4000, '2026-09-01')
  }
}

// Page titles in en and he, including error pages.
const titleCar = await newCar('Title car', 100)
for (const lng of ['en', 'he']) {
  await run(`titles-${lng}`, desktop, lng, async (page, shot, r) => {
    const titles = {}
    for (const [label, path, loggedIn] of [['login', '/login'], ['register', '/register']]) {
      await page.goto(`${BASE}${path}`); await settle(page); titles[label] = await page.title()
    }
    await page.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', u) }, [auth.token, JSON.stringify(auth.user)])
    for (const [label, path] of [['list', '/'], ['car', `/cars/${titleCar.id}`], ['addCar', '/cars/new'], ['editCar', `/cars/${titleCar.id}/edit`],
      ['carNotFound', '/cars/abc'], ['editCarNotFound', '/cars/abc/edit'], ['carZeroGuid', '/cars/00000000-0000-0000-0000-000000000000']]) {
      await page.goto(`${BASE}${path}`); await settle(page); titles[label] = await page.title()
    }
    r.checks.push({ titles })
  }, false)
}

// Danger confirm button: Hebrew light and English dark.
for (const [name, lng, scheme] of [['danger-he-light', 'he', 'light'], ['danger-en-dark', 'en', 'dark']]) {
  await run(name, mobile(scheme), lng, async (page, shot, r) => {
    await page.goto(`${BASE}/cars/${dangerCar.id}`)
    await page.locator('.history li').first().waitFor()
    const row = page.locator('.history li').first()
    await row.locator('.actions button:not(.edit)').click()
    const btn = row.locator('button.danger')
    r.checks.push(await btn.evaluate((el) => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const cs = getComputedStyle(el)
      const [a, b] = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x)
      return { color: cs.color, background: cs.backgroundColor, contrast: +((a + 0.05) / (b + 0.05)).toFixed(2), height: el.getBoundingClientRect().height, focused: document.activeElement?.textContent }
    }))
    await btn.focus()
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab') // make focus-visible
    await shot('confirm-open-focused')
  })
}

// 44px tap targets for every visible button / button-like control at 390px, en and he.
for (const lng of ['en', 'he']) {
  await run(`tap-390-${lng}`, mobile('light'), lng, async (page, shot, r) => {
    const measure = (where) => page.evaluate((where) => [...document.querySelectorAll('button, a, input:not([type=checkbox]), select, [role=button]')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ e, h: e.getBoundingClientRect().height }))
      .filter((x) => x.h < 44)
      .map(({ e, h }) => `${where}: <${e.tagName.toLowerCase()}${e.className ? ` .${e.className}` : ''}> "${(e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 30)}" ${h.toFixed(1)}px`), where)
    const small = []
    await page.goto(`${BASE}/login`)
    await page.evaluate(() => { localStorage.removeItem('token'); localStorage.removeItem('user') })
    await page.goto(`${BASE}/login`); await settle(page); small.push(...await measure('login'))
    await page.goto(`${BASE}/register`); await settle(page); small.push(...await measure('register'))
    await page.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', u) }, [auth.token, JSON.stringify(auth.user)])
    await page.goto(`${BASE}/`); await page.locator('.cars li').first().waitFor(); await settle(page); small.push(...await measure('list'))
    await shot('list')
    await page.goto(`${BASE}/cars/new`); await settle(page); small.push(...await measure('addCar'))
    await page.goto(`${BASE}/cars/${oldestCar.id}`); await page.locator('.history li').first().waitFor(); await settle(page)
    small.push(...await measure('carPage'))
    await page.locator('.history li').first().locator('button.edit').click()
    await page.locator('.history li').nth(1).locator('.actions button:not(.edit)').click()
    small.push(...await measure('carPage forms open'))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    await shot('car-forms-open')
    r.checks.push({ under44: [...new Set(small)], overflowWithFormsOpen: overflow })
  })
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
