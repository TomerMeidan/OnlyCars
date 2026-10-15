// QA exploration of MVP3-B (line items, edit, delete) beyond smoke.mjs: en/he, light/dark, km/miles, desktop/390px.
// Usage (API + Vite running): node ui-tests/qa-mvp3b.mjs   ONLY=<setup> to run one setup.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = 'qamvp3b'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const utc = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const plain = (s) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim()
const digits = (s) => (s ?? '').replace(/\D/g, '')

const setups = [
  { name: 'desktop-light-en-km', lng: 'en', unit: 'Km', theme: 'Light', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-dark-he-mi', lng: 'he', unit: 'Mi', theme: 'Dark', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-dark-he-km', lng: 'he', unit: 'Km', theme: 'Dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'mobile-light-en-mi', lng: 'en', unit: 'Mi', theme: 'Light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const report = []
const LONG_DESC = 'Synthetic long-life oil filter cartridge with gasket' + 'Z'.repeat(48) // 100 chars
const LONG_PN = 'OEM-15208-65F0A-' + '9'.repeat(34) // 50 chars

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+mvp3b-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const post = async (p, data) => (await req.post(`${BASE}/api${p}`, { headers: H, data })).json()
  await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.theme, distanceUnit: s.unit } })
  const car = await post('/vehicles', { nickname: 'Items car', initialOdometerKm: 50000 })
  await post(`/vehicles/${car.id}/tasks`, { name: 'Oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 41000, lastDoneDate: utc(90) })
  // Two records on the same day and odometer, different shops (criterion 12).
  await post(`/vehicles/${car.id}/service-records`, { date: utc(0), odometerKm: 50000, shopName: 'Garage A', totalCost: 100, taskIds: [] })
  await post(`/vehicles/${car.id}/service-records`, { date: utc(0), odometerKm: 50000, shopName: 'Garage B', notes: 'Seeded with items',
    items: [{ description: 'Brake pads', brand: 'Brembo', partNumber: 'P 85 020', quantity: 1, unitCost: 300 }, { description: 'Fitting', quantity: 0.5, unitCost: 250, isLabor: true }] })
  const old = await post('/vehicles', { nickname: 'Old car', initialOdometerKm: 10000 })
  await post(`/vehicles/${old.id}/service-records`, { date: utc(0), odometerKm: 10000, shopName: 'Garage Cohen', notes: 'Archived note',
    items: [{ description: LONG_DESC, brand: 'Mann-Filter GmbH', partNumber: LONG_PN, quantity: 2, unitCost: 45.5 }, { description: 'עבודה', quantity: 1.5, unitCost: 200, isLabor: true }] })
  await req.post(`${BASE}/api/vehicles/${old.id}/archive`, { headers: H })

  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.theme.toLowerCase(), isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url().replace(/.*\/api/, '')}`))

  const sec = page.locator('section[aria-labelledby=service-history]')
  const shot = async (label) => {
    await page.waitForTimeout(250)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby=service-history] :is(button, input:not([type=checkbox]), textarea, label.inline)')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}`))
    // Elements wider than the section (clipped or overflowing inside a card).
    const wide = await page.evaluate(() => {
      const box = document.querySelector('section[aria-labelledby=service-history]')?.getBoundingClientRect()
      if (!box) return []
      return [...document.querySelectorAll('section[aria-labelledby=service-history] *')].filter((e) => e.checkVisibility())
        .filter((e) => { const b = e.getBoundingClientRect(); return b.right > box.right + 1 || b.left < box.left - 1 })
        .map((e) => `${e.tagName}.${e.className}`).slice(0, 5)
    })
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: small }), ...(wide.length && { outsideSection: wide }) }
  }
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) {
      const p = `${OUT}/${TAG}-${s.name}-FAIL-${label}.png`
      await page.screenshot({ path: p, fullPage: true }).catch(() => {})
      r.checks.push({ label, error: e.message.split('\n')[0], shot: p })
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
  }
  const idle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(300))
  const active = () => page.evaluate(() => {
    const a = document.activeElement
    const cs = getComputedStyle(a)
    return { el: `${a.tagName}.${a.className} ${(a.getAttribute('aria-label') ?? a.textContent).trim().slice(0, 60)}`, outline: `${cs.outlineStyle} ${cs.outlineWidth}` }
  })
  const rows = () => sec.locator('.services > li')
  const rowOf = (shop) => rows().filter({ hasText: shop })
  const items = (f) => f.locator('fieldset.item')
  const inp = (f, i, n) => items(f).nth(i).locator('input').nth(n)
  const sum = (f) => f.locator('input[readonly]')
  const openCar = async (name) => { await page.click('header a.brand'); await page.locator('.cars > li h2 a', { hasText: name }).click(); await sec.waitFor(); await idle() }
  const fillPart = async (f, i, [d, b, p, q, u]) => { for (const [n, v] of [[0, d], [1, b], [2, p], [3, q], [4, u]]) await inp(f, i, n).fill(v) }
  const fillLab = async (f, i, [d, q, u]) => { for (const [n, v] of [[0, d], [1, q], [2, u]]) await inp(f, i, n).fill(v) }
  const itemValues = (f) => items(f).evaluateAll((fs) => fs.map((x) => [...x.querySelectorAll('input')].map((i) => i.value)))
  const mock = (pattern, status, body) => page.route(pattern, (rt) => rt.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }), { times: 1 })

  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Passw0rd!')
  await page.click('form button:not(.link)')
  await page.locator('a[href="/cars/new"]').waitFor()
  await idle()
  await openCar('Items car')
  const recordForm = sec.locator(':scope > form')
  const addPart = recordForm.locator('button.add-part')
  const addLabour = recordForm.locator('.items > .actions button:not(.add-part)')

  await check('01-history-with-items', async () => {
    const b = rowOf('Garage B')
    return { rowText: plain(await b.textContent()), lines: (await b.locator('.service-items li').allTextContents()).map(plain), ...(await shot('01-history')) }
  })

  await check('02-record-items-live-total', async () => {
    await sec.locator('button.add').click()
    await addPart.click()
    const afterAdd = await active()
    await fillPart(recordForm, 0, ['Oil filter', 'Mann', 'W 712/75', '2', '45.5'])
    const t1 = await sum(recordForm).inputValue()
    await addLabour.click()
    const afterLab = await active()
    await fillLab(recordForm, 1, ['Labour', '1.5', '200'])
    const t2 = await sum(recordForm).inputValue()
    const labels = await items(recordForm).nth(1).locator('input').evaluateAll((is) => is.map((i) => i.getAttribute('aria-label')))
    const visible = (await items(recordForm).nth(1).locator('label').allTextContents()).map(plain)
    const typedTotal = await recordForm.locator('input[name=totalCost]').count()
    const sh = await shot('02-record-form-items')
    const res = page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/service-records'))
    await recordForm.locator(':scope > .actions button:not(.link)').click()
    const resp = await res
    const rec = (await resp.json()).record
    await sec.locator(`li[data-id="${rec.id}"]`).waitFor()
    const row = sec.locator(`li[data-id="${rec.id}"]`)
    return { afterAdd, afterLab, liveAfterPart: t1, liveAfterLabour: t2, labourLabels: labels, labourVisible: visible, typedTotalWhileItems: typedTotal,
      savedTotal: rec.totalCost, focusAfterSave: await active(), rowText: plain(await row.textContent()), ...sh, rowShot: (await shot('03-record-saved')).shot }
  })

  await check('03-rounding', async () => {
    const out = {}
    for (const [label, q, u] of [['0.5x0.01', '0.5', '0.01'], ['1.5x0.67', '1.5', '0.67'], ['1.005x1', '1.005', '1']]) {
      await sec.locator('button.add').click()
      await addPart.click()
      await fillPart(recordForm, 0, [`Round ${label}`, '', '', q, u])
      const live = await sum(recordForm).inputValue()
      const qtyMsg = await inp(recordForm, 0, 3).evaluate((i) => i.validationMessage)
      const res = page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/service-records'), { timeout: 1500 }).catch(() => null)
      await recordForm.locator(':scope > .actions button:not(.link)').click()
      const resp = await res
      out[label] = { live, posted: !!resp, saved: resp ? (await resp.json()).record?.totalCost : null, qtyValidation: qtyMsg }
      if (!resp) { out[label].shot = (await shot(`04-round-${label}`)).shot; await recordForm.locator(':scope > .actions button.link').click() }
      else await idle()
    }
    return out
  })

  await check('04-remove-focus-and-typed-total', async () => {
    await sec.locator('button.add').click()
    for (let i = 0; i < 3; i++) { await addPart.click(); await inp(recordForm, i, 0).fill(`P${i + 1}`) }
    await items(recordForm).nth(1).locator('button').click()
    const afterMid = await active()
    await items(recordForm).nth(1).locator('button').click()
    const afterLast = await active()
    await items(recordForm).nth(0).locator('button').click()
    const afterOnly = await active()
    const editable = await recordForm.locator('input[name=totalCost]').evaluate((i) => !i.readOnly).catch(() => false)
    await recordForm.locator('input[name=totalCost]').fill('80')
    const res = page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/service-records'))
    await recordForm.locator(':scope > .actions button:not(.link)').click()
    const resp = await res
    return { afterMid, afterLast, afterOnly, editable, sentTotal: resp.request().postDataJSON().totalCost, savedTotal: (await resp.json()).record?.totalCost }
  })

  await check('05-item-error-row-after-removal', async () => {
    await sec.locator('button.add').click()
    for (let i = 0; i < 3; i++) { await addPart.click(); await fillPart(recordForm, i, [`Part ${i + 1}`, 'B', `PN-${i + 1}`, '1', '10']) }
    await mock('**/service-records', 400, { code: 'serviceItem.invalidUnitCost', index: 2 })
    await recordForm.locator(':scope > .actions button:not(.link)').click()
    await items(recordForm).nth(2).locator('[role=alert]').waitFor()
    const before = plain(await items(recordForm).nth(2).locator('[role=alert]').textContent())
    const sh1 = await shot('05-item-error')
    await items(recordForm).nth(0).locator('button').click()
    const row = items(recordForm).nth(1)
    const after = { legend: plain(await row.locator('legend').textContent()), desc: await inp(recordForm, 1, 0).inputValue(), alert: plain(await row.locator('[role=alert]').textContent().catch(() => '(none)')),
      describedOk: (await inp(recordForm, 1, 4).getAttribute('aria-describedby')) === (await row.locator('[role=alert]').getAttribute('id').catch(() => 'x')) }
    const sh2 = await shot('05-item-error-after-removal')
    await recordForm.locator(':scope > .actions button.link').click()
    return { before, after, shot: sh1.shot, afterShot: sh2.shot, ...(sh2.horizontalOverflowPx && { horizontalOverflowPx: sh2.horizontalOverflowPx }) }
  })

  await check('06-failed-save-500', async () => {
    await sec.locator('button.add').click()
    await recordForm.locator('input[name=shopName]').fill('Kept shop')
    await recordForm.locator('textarea[name=notes]').fill('Kept notes')
    await addPart.click(); await fillPart(recordForm, 0, [LONG_DESC, 'Bosch', LONG_PN, '2', '45.5'])
    await addLabour.click(); await fillLab(recordForm, 1, ['Labour', '1.5', '200'])
    const before = JSON.stringify(await itemValues(recordForm))
    await mock('**/service-records', 500, {})
    await recordForm.locator(':scope > .actions button:not(.link)').click()
    await recordForm.locator('[role=alert]').waitFor()
    const kept = JSON.stringify(await itemValues(recordForm)) === before && (await recordForm.locator('input[name=shopName]').inputValue()) === 'Kept shop'
    const error = plain(await recordForm.locator('[role=alert]').textContent())
    const sh = await shot('06-save-500-long-items')
    await recordForm.locator(':scope > .actions button.link').click()
    return { kept, error, ...sh }
  })

  await check('07-date-order-under-odometer', async () => {
    await sec.locator('button.add').click()
    const lower = s.unit === 'Mi' ? '20000' : '30000' // below the 50,000 km initial reading, dated today
    await recordForm.locator('input[name=odometerKm]').fill(lower)
    await recordForm.locator(':scope > .actions button:not(.link)').click()
    await recordForm.locator('[role=alert]').waitFor()
    const layout = await recordForm.evaluate((f) => {
      const odo = f.querySelector('input[name=odometerKm]')
      const label = odo.closest('label')
      const alert = f.querySelector('[role=alert]')
      const box = f.querySelector('input[type=checkbox]')
      return { alertRightAfterOdometer: label.nextElementSibling === alert, checkboxAfterAlert: alert.nextElementSibling?.contains(box),
        odoDescribedBy: odo.getAttribute('aria-describedby') === alert.id, boxDescribedBy: box?.getAttribute('aria-describedby') === alert.id,
        gapPx: Math.round(alert.getBoundingClientRect().top - label.getBoundingClientRect().bottom), text: alert.textContent }
    })
    const sh = await shot('07-date-order')
    await recordForm.locator(':scope > .actions button.link').click()
    return { ...layout, ...sh }
  })

  await check('08-names-and-describedby', async () => {
    const acts = await sec.locator('.services > li .actions button').evaluateAll((bs) => bs.map((b) => ({ name: b.getAttribute('aria-label'),
      described: (b.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '(missing)').join(' | ') })))
    const names = acts.map((a) => a.name)
    return { distinct: new Set(names).size === names.length, acts: acts.filter((a) => /Garage [AB]/.test(a.name)) }
  })

  await check('09-edit-cancel-escape-save', async () => {
    const b = rowOf('Garage B')
    const id = await b.getAttribute('data-id')
    const row = sec.locator(`li[data-id="${id}"]`)
    const f = row.locator('form')
    await row.locator('button.edit-service').click()
    const filled = { shop: await f.locator('input[name=shopName]').inputValue(), notes: await f.locator('textarea[name=notes]').inputValue(), items: await itemValues(f), total: await sum(f).inputValue(), text: plain(await f.locator(':scope > p').allTextContents().then((x) => x.join(' | '))) }
    const focusOpen = await active()
    const sh = await shot('09-edit-open')
    await f.locator('input[name=shopName]').fill('Changed')
    await page.keyboard.press('Escape')
    const afterEsc = { focus: await active(), row: plain(await row.textContent()).includes('Garage B') }
    await row.locator('button.edit-service').click()
    const reopenedShop = await f.locator('input[name=shopName]').inputValue()
    await items(f).nth(0).locator('button').click()
    await f.locator(':scope > .actions button.link').click()
    const afterCancel = { focus: await active(), lines: await row.locator('.service-items li').count() }
    // Save: shop, notes, add a labour item.
    await row.locator('button.edit-service').click()
    await f.locator('input[name=shopName]').fill('Garage B2')
    await f.locator('textarea[name=notes]').fill('Edited notes')
    await f.locator('.items > .actions button:not(.add-part)').click()
    await fillLab(f, 2, ['Alignment', '1', '150'])
    const live = await sum(f).inputValue()
    let gets = 0
    const countGet = (q) => q.method() === 'GET' && q.url().endsWith('/service-records') && gets++
    page.on('request', countGet)
    const res = page.waitForResponse((x) => x.request().method() === 'PUT')
    await f.locator(':scope > .actions button:not(.link)').click()
    const resp = await res
    await idle()
    page.off('request', countGet)
    return { filled, focusOpen, afterEsc, reopenedShop, afterCancel, live, putStatus: resp.status(), savedTotal: (await resp.json()).record.totalCost, reloadsAfterEdit: gets,
      focusAfterSave: await active(), rowText: plain(await row.textContent()), ...sh, savedShot: (await shot('10-edit-saved')).shot }
  })

  await check('10-edit-failures', async () => {
    const id = await rowOf('Garage B2').getAttribute('data-id')
    const row = sec.locator(`li[data-id="${id}"]`)
    const f = row.locator('form')
    await row.locator('button.edit-service').click()
    await f.locator('input[name=shopName]').fill('Typed shop')
    const before = JSON.stringify(await itemValues(f))
    await mock('**/service-records/*', 500, {})
    await f.locator(':scope > .actions button:not(.link)').click()
    await f.locator('[role=alert]').waitFor()
    const kept500 = JSON.stringify(await itemValues(f)) === before && (await f.locator('input[name=shopName]').inputValue()) === 'Typed shop'
    const err500 = plain(await f.locator('[role=alert]').textContent())
    const sh = await shot('11-edit-500')
    // Item error on row 3 of the edit form.
    await mock('**/service-records/*', 400, { code: 'serviceItem.invalidDescription', index: 2 })
    await f.locator(':scope > .actions button:not(.link)').click()
    await items(f).nth(2).locator('[role=alert]').waitFor()
    const itemErr = plain(await items(f).nth(2).locator('[role=alert]').textContent())
    const sh2 = await shot('12-edit-item-error')
    // Mocked 409 on Edit: the record really still exists, so the reload keeps it.
    await mock('**/service-records/*', 409, { code: 'serviceRecord.alreadyVoided' })
    await f.locator(':scope > .actions button:not(.link)').click()
    await sec.locator('p[role=status]').waitFor()
    const note = plain(await sec.locator('p[role=status]').textContent())
    const sh3 = await shot('13-edit-409-note')
    return { kept500, err500, itemErr, note, formStillOpen: await row.locator('form').count(), rowPresent: await sec.locator(`li[data-id="${id}"]`).count(), ...sh, itemErrShot: sh2.shot, noteShot: sh3.shot }
  })

  await check('11-delete', async () => {
    const row = rowOf('Garage A')
    const id = await row.getAttribute('data-id')
    await row.locator('button.delete-service').click()
    const sh = await shot('14-delete-confirm')
    await mock('**/void', 500, {})
    await row.locator('button.danger').click()
    await row.locator('[role=alert]').waitFor()
    const err = plain(await row.locator('[role=alert]').textContent())
    const sh2 = await shot('15-delete-500')
    await row.locator('button.danger').click()
    await sec.locator(`li[data-id="${id}"]`).waitFor({ state: 'detached' })
    const focus = await active()
    // Mocked 404 on Delete of another row: the note shows.
    const other = rows().first()
    await other.locator('button.delete-service').click()
    await mock('**/void', 404, { code: 'serviceRecord.notFound' })
    await other.locator('button.danger').click()
    await sec.locator('p[role=status]').waitFor()
    const note = plain(await sec.locator('p[role=status]').textContent())
    const sh3 = await shot('16-delete-404-note')
    return { err, focusAfterDelete: focus, note, ...sh, failShot: sh2.shot, noteShot: sh3.shot }
  })

  await check('12-real-delete-updates-tasks-and-odometer', async () => {
    const odoBefore = await page.locator('.odometer').first().getAttribute('aria-label')
    const oil = page.locator('.tasks > li').filter({ has: page.locator('.name', { hasText: /^Oil$/ }) })
    const oilBefore = plain(await oil.textContent())
    await sec.locator('button.add').click()
    const hi = s.unit === 'Mi' ? '32000' : '51000'
    await recordForm.locator('input[name=odometerKm]').fill(hi)
    await recordForm.locator('input[type=checkbox][name=taskIds]').first().check()
    await recordForm.locator('input[name=shopName]').fill('To delete')
    await recordForm.locator(':scope > .actions button:not(.link)').click()
    await rowOf('To delete').waitFor()
    await idle()
    const oilMid = plain(await oil.textContent())
    const odoMid = await page.locator('.odometer').first().getAttribute('aria-label')
    const row = rowOf('To delete')
    await row.locator('button.delete-service').click()
    await row.locator('button.danger').click()
    await row.waitFor({ state: 'detached' })
    await idle()
    return { odoBefore, odoMid, odoAfter: await page.locator('.odometer').first().getAttribute('aria-label'), oilBefore, oilMid, oilAfter: plain(await oil.textContent()),
      topReading: plain(await page.locator('.history li').first().textContent()) }
  })

  await check('13-real-409-on-edit', async () => {
    await page.reload(); await sec.waitFor(); await idle()
    const row = rows().first()
    const id = await row.getAttribute('data-id')
    await row.locator('button.edit-service').click()
    await req.post(`${BASE}/api/vehicles/${car.id}/service-records/${id}/void`, { headers: H })
    await row.locator('form > .actions button:not(.link)').click()
    await sec.locator('p[role=status]').waitFor()
    await sec.locator(`li[data-id="${id}"]`).waitFor({ state: 'detached' })
    return { note: plain(await sec.locator('p[role=status]').textContent()), focus: await active(), ...(await shot('17-edit-real-409')) }
  })

  await check('14-keyboard-focus-ring', async () => {
    await sec.locator('button.add').click()
    await addPart.focus()
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    const ring = await active()
    await page.keyboard.press('Enter')
    const afterEnter = await active()
    const sh = await shot('18-keyboard-add-part')
    await recordForm.locator(':scope > .actions button.link').click()
    return { ring, afterEnter, ...sh }
  })

  await check('15-archived-car', async () => {
    await page.goto(`${BASE}/cars/${old.id}`); await sec.waitFor(); await idle()
    const text = plain(await sec.textContent())
    return { controls: await sec.locator('button, input, textarea').count(), lines: (await sec.locator('.service-items li').allTextContents()).map(plain), text: text.slice(0, 200), ...(await shot('19-archived')) }
  })

  await check('16-long-items-history', async () => {
    // Record with long values on the active car, then view the row and its edit form.
    await openCar('Items car')
    await post(`/vehicles/${car.id}/service-records`, { date: utc(0), odometerKm: 50000, shopName: 'מוסך ' + 'ש'.repeat(90), notes: 'x'.repeat(400),
      items: [{ description: LONG_DESC, brand: 'B'.repeat(100), partNumber: LONG_PN, quantity: 9999.99, unitCost: 99.99 }, { description: 'Labour ' + 'L'.repeat(90), quantity: 10000, unitCost: 0, isLabor: true }] })
    await page.reload(); await sec.waitFor(); await idle()
    const sh = await shot('20-long-history')
    await rows().first().locator('button.edit-service').click()
    const sh2 = await shot('21-long-edit')
    await page.keyboard.press('Escape')
    return { ...sh, editShot: sh2.shot, editOverflow: sh2.horizontalOverflowPx, editOutside: sh2.outsideSection, editSmall: sh2.under44px }
  })

  await ctx.close()
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
