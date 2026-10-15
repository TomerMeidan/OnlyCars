// QA exploration of SET-1 (settings: language, theme, currency) beyond smoke.mjs.
// Usage (API + Vite, or a preview server, must be running): node ui-tests/qa-set1.mjs
//   BASE_URL=http://localhost:4173 THROTTLE=1 ONLY=<setup> to run against a production preview with a slow network.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
const TAG = process.env.TAG ?? 'qaset1'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const req = (await browser.newContext()).request
const ratio = (fg, bg) => {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return +((a + 0.05) / (b + 0.05)).toFixed(2)
}

const setups = [
  { name: 'desktop-light-en', lng: 'en', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'mobile-dark-he', lng: 'he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
]
const report = []

for (const s of setups.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
  const he = s.lng === 'he'
  const email = `qa+set1-${s.name}-${Date.now()}@example.com`
  const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email, password: 'Passw0rd!', locale: he ? 'He' : 'En' } })).json()
  const H = { Authorization: `Bearer ${reg.token}` }
  const me = async () => (await req.get(`${BASE}/api/me`, { headers: H })).json()
  const car = await (await req.post(`${BASE}/api/vehicles`, { headers: H, data: { nickname: 'QA Set car', initialOdometerKm: 50000 } })).json()
  await req.post(`${BASE}/api/vehicles/${car.id}/tasks`, { headers: H, data: { name: 'Brakes', category: 'Brakes', intervalKm: 10000, intervalDays: null, lastDoneOdometerKm: 45000, lastDoneDate: new Date().toISOString().slice(0, 10) } })
  const arch = await (await req.post(`${BASE}/api/vehicles`, { headers: H, data: { nickname: 'QA Archived', initialOdometerKm: 1000 } })).json()
  await req.post(`${BASE}/api/vehicles/${arch.id}/archive`, { headers: H })

  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  const r = { setup: s.name, checks: [], consoleErrors: [], badResponses: [] }
  report.push(r)
  page.on('console', (m) => m.type() === 'error' && r.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => r.consoleErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url()}`))

  const shot = async (label) => {
    await page.waitForTimeout(200)
    const path = `${OUT}/${TAG}-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button, select, main input:not([type=radio]):not([type=checkbox]), label.inline')]
      .filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') ?? e.textContent).trim().slice(0, 30)}`))
    return { shot: path, ...(overflow > 0 && { horizontalOverflowPx: overflow }), ...(small.length && { under44px: small }) }
  }
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) {
      const p = `${OUT}/${TAG}-${s.name}-FAIL-${label}.png`
      await page.screenshot({ path: p, fullPage: true }).catch(() => {})
      r.checks.push({ label, error: e.message.split('\n')[0], shot: p })
    }
  }
  const look = () => page.evaluate(() => {
    const cs = (el) => el && getComputedStyle(el)
    const card = document.querySelector('.card')
    return {
      attr: document.documentElement.dataset.theme ?? null, dir: document.documentElement.dir, lang: document.documentElement.lang,
      bg: cs(document.documentElement).backgroundColor, ink: cs(document.body).color, surface: cs(card ?? document.body).backgroundColor,
      legend: cs(document.querySelector('legend'))?.color, hint: cs(document.querySelector('#currency-hint'))?.color,
      error: cs(document.querySelector('.error'))?.color, select: cs(document.querySelector('select')) && [cs(document.querySelector('select')).color, cs(document.querySelector('select')).backgroundColor],
      radio: cs(document.querySelector('input[type=radio]'))?.accentColor,
    }
  })
  const contrasts = (l) => ({ ink: ratio(l.ink, l.surface), ...(l.legend && { legend: ratio(l.legend, l.surface) }), ...(l.hint && { hint: ratio(l.hint, l.surface) }), ...(l.error && { error: ratio(l.error, l.surface) }), ...(l.select && { select: ratio(...l.select) }) })
  const radio = (n, v) => page.locator(`input[name=${n}][value=${v}]`)
  const checked = (n) => page.evaluate((n) => document.querySelector(`input[name=${n}]:checked`)?.value, n)
  const active = () => page.evaluate(() => { const a = document.activeElement; return `${a.tagName}${a.name ? `[${a.name}=${a.value}]` : ''}|${a.textContent.trim().slice(0, 20)}|fv:${a.matches(':focus-visible')}|${getComputedStyle(a).outlineStyle} ${getComputedStyle(a).outlineWidth}` })
  const idle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(300))
  const login = async () => {
    await page.fill('input[name=email]', email)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('a[href="/cars/new"]').waitFor()
    await idle()
  }

  // Signed out.
  await page.goto(`${BASE}/settings`)
  await check('signed-out-settings', async () => {
    await page.waitForURL('**/login')
    return { url: page.url(), settingsLink: await page.locator('header a[href="/settings"]').count(), ...(await shot('01-signed-out')) }
  })
  await check('login', async () => { await login(); return { look: await look(), ...(await shot('02-list')) } })
  await check('show-archived-44', async () => {
    const lab = page.locator('main > label.inline')
    const h1 = await lab.evaluate((e) => e.getBoundingClientRect().height)
    await lab.click({ position: { x: 5, y: 2 } }) // the label's edge, not the box
    await page.locator('.cars li.archived').waitFor()
    const res = { heightPx: h1, checkedByEdgeTap: await lab.locator('input').isChecked(), ...(await shot('03-archived-shown')) }
    await lab.click()
    return res
  })
  await check('quick-correction-label', async () => {
    const f = page.locator('.cars li form.quick').first()
    await f.locator('input').fill('40000')
    await f.locator('button').click()
    const lab = f.locator('label.inline')
    await lab.waitFor()
    return { heightPx: await lab.evaluate((e) => e.getBoundingClientRect().height), ...(await shot('04-quick-correction')) }
  })

  // Keyboard-only: Tab from the page to the Settings link, Enter, then into the groups.
  await check('keyboard-open-settings', async () => {
    await page.keyboard.press('Escape')
    await page.locator('header a.brand').focus()
    const stops = []
    for (let i = 0; i < 4 && !(await page.evaluate(() => document.activeElement.matches('a[href="/settings"]'))); i++) { await page.keyboard.press('Tab'); stops.push(await active()) }
    await page.keyboard.press('Enter')
    await page.locator('input[name=theme]').first().waitFor()
    await idle()
    const tabs = []
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); tabs.push(await active()) }
    return { stops, focusAfterOpen: 'see tabs', title: await page.title(), tabs, ...(await shot('05-focus-in-group')) }
  })
  await check('keyboard-arrows-save', async () => {
    await radio('theme', 'System').focus()
    const puts = []
    const onReq = (q) => q.method() === 'PUT' && puts.push(q.postData())
    page.on('request', onReq)
    // Slow PUT, so a second arrow lands while the first save is in flight.
    await page.route('**/api/me/settings', async (rt) => { await page.waitForTimeout(800); await rt.continue() })
    await page.keyboard.press('ArrowDown')
    const during = { focus: await active(), checked: await checked('theme'), attr: (await look()).attr }
    await page.keyboard.press('ArrowDown') // ignored while busy?
    const during2 = { focus: await active(), checked: await checked('theme') }
    await page.waitForTimeout(1200); await idle()
    await page.unroute('**/api/me/settings')
    page.off('request', onReq)
    const after = { focus: await active(), checked: await checked('theme'), attr: (await look()).attr, status: await page.locator('main [role=status]').textContent(), server: (await me()).theme }
    return { puts, during, during2, after, ...(await shot('06-after-arrows')) }
  })
  await check('forced-themes-vs-os', async () => {
    const out = {}
    for (const theme of ['Dark', 'Light', 'System']) {
      await radio('theme', theme).click(); await idle()
      for (const os of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: os })
        const l = await look()
        out[`${theme}/os-${os}`] = { attr: l.attr, bg: l.bg, contrast: contrasts(l) }
        if (theme !== 'System' && os !== s.colorScheme) out[`${theme}/os-${os}`].shot = (await shot(`07-${theme}-os-${os}`)).shot
      }
      await page.emulateMedia({ colorScheme: s.colorScheme })
    }
    return out
  })
  await check('save-fails-all-controls', async () => {
    const fail = (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    const res = {}
    await page.route('**/api/me/settings', fail, { times: 1 })
    await radio('theme', 'Dark').click(); await idle()
    res.theme = { checked: await checked('theme'), attr: (await look()).attr, alert: await page.locator('fieldset:has(input[name=theme]) [role=alert]').textContent().catch(() => null) }
    res.themeShot = (await shot('08-theme-fail')).shot
    res.themeContrast = contrasts(await look())
    await page.route('**/api/me/settings', fail, { times: 1 })
    const other = he ? 'En' : 'He'
    await radio('locale', other).click(); await idle()
    res.locale = { checked: await checked('locale'), ...(({ dir, lang }) => ({ dir, lang }))(await look()), alert: await page.locator('fieldset:has(input[name=locale]) [role=alert]').textContent().catch(() => null), focus: await active() }
    res.localeShot = (await shot('09-locale-fail')).shot
    await page.route('**/api/me/settings', fail, { times: 1 })
    await page.click('header nav button.link >> nth=0'); await idle()
    res.header = { ...(({ dir, lang }) => ({ dir, lang }))(await look()), alert: await page.locator('main > [role=alert]').textContent().catch(() => null), focus: await active() }
    res.headerShot = (await shot('10-header-switch-fail')).shot
    // Network down rather than 500
    await page.route('**/api/me/settings', (rt) => rt.abort(), { times: 1 })
    await page.locator('select[name=currency]').selectOption('GBP'); await idle()
    res.currencyOffline = { value: await page.locator('select[name=currency]').inputValue(), alert: await page.locator('.field [role=alert]').textContent().catch(() => null) }
    res.currencyShot = (await shot('11-currency-offline')).shot
    // A 400 with a code
    await page.route('**/api/me/settings', (rt) => rt.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ status: 400, code: 'settings.invalidTheme', title: 'Validation failed' }) }), { times: 1 })
    await radio('theme', 'Light').click(); await idle()
    res.invalidTheme = await page.locator('fieldset:has(input[name=theme]) [role=alert]').textContent().catch(() => null)
    res.server = await me()
    return res
  })
  await check('header-switch-saves-and-errors-cleared', async () => {
    await page.click('header nav button.link >> nth=0'); await idle()
    const a = { ...(({ dir, lang }) => ({ dir, lang }))(await look()), server: (await me()).locale, alerts: await page.locator('[role=alert]').count(), radio: await checked('locale'), focus: await active() }
    await page.click('header nav button.link >> nth=0'); await idle()
    return { a, back: { dir: (await look()).dir, server: (await me()).locale }, ...(await shot('12-after-header-switch')) }
  })
  await check('other-device-refresh', async () => {
    await req.put(`${BASE}/api/me/settings`, { headers: H, data: { currency: 'EUR', theme: 'Dark' } })
    await page.click('header a.brand'); await page.click('header a[href="/settings"]'); await idle()
    return { select: await page.locator('select[name=currency]').inputValue(), theme: await checked('theme'), attr: (await look()).attr, ...(await shot('13-refreshed')) }
  })
  await check('currency-cost-label', async () => {
    await page.locator('select[name=currency]').selectOption('USD'); await idle()
    await page.goto(`${BASE}/cars/${car.id}`)
    await page.locator('.tasks > li').first().waitFor()
    await page.locator('.tasks > li .actions button.link').first().click()
    const label = await page.locator('.tasks > li form label').first().textContent()
    return { label, ...(await shot('14-cost-usd')) }
  })
  await check('history-correction-label', async () => {
    await page.keyboard.press('Escape')
    await req.post(`${BASE}/api/vehicles/${car.id}/odometer`, { headers: H, data: { valueKm: 52000, readingDate: new Date().toISOString().slice(0, 10) } })
    await page.reload(); await page.locator('.history > li').first().waitFor()
    await page.locator('.history > li').first().locator('button').first().click()
    await page.fill('input[name=valueKm]', '1000')
    await page.locator('form.inline-form button:not(.link)').first().click()
    const lab = page.locator('form.inline-form label.inline')
    await lab.waitFor()
    return { heightPx: await lab.evaluate((e) => e.getBoundingClientRect().height), ...(await shot('15-history-correction')) }
  })
  await check('logout-then-login-applies', async () => {
    await page.keyboard.press('Escape')
    await req.put(`${BASE}/api/me/settings`, { headers: H, data: { theme: s.colorScheme === 'light' ? 'Dark' : 'Light', locale: he ? 'He' : 'En' } })
    await page.click('header nav button:has-text("' + (he ? 'התנתקות' : 'Log out') + '")')
    await page.locator('input[name=email]').waitFor()
    const out = { afterLogout: await look(), settingsLink: await page.locator('header a[href="/settings"]').count() }
    await page.click('header nav button.link >> nth=0') // switch signed-out UI to the other language
    out.signedOutSwitched = (await look()).lang
    out.loginShot = (await shot('16-signed-out-other-lang')).shot
    await login()
    const l = await look()
    out.afterLogin = { lang: l.lang, dir: l.dir, attr: l.attr, title: await page.title() }
    out.shot = (await shot('17-after-login')).shot
    return out
  })
  await check('settings-final', async () => { await page.click('header a[href="/settings"]'); await idle(); return { look: contrasts(await look()), ...(await shot('18-settings-final')) } })

  await ctx.close()
}

// Reload flash: frames painted while a forced theme page reloads on a slow network (Fast 3G-like).
if (process.env.THROTTLE) {
  for (const os of ['light', 'dark']) {
    const forcedTheme = os === 'light' ? 'Dark' : 'Light'
    const reg = await (await req.post(`${BASE}/api/auth/register`, { data: { email: `qa+set1-flash-${os}-${Date.now()}@example.com`, password: 'Passw0rd!' } })).json()
    const user = (await (await req.put(`${BASE}/api/me/settings`, { headers: { Authorization: `Bearer ${reg.token}` }, data: { theme: forcedTheme } })).json())
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: os, serviceWorkers: 'block' })
    await ctx.addInitScript(([t, u]) => { if (!localStorage.getItem('token')) { localStorage.setItem('token', t); localStorage.setItem('user', u) } }, [reg.token, JSON.stringify(user)])
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await page.goto(`${BASE}/settings`); await page.waitForLoadState('networkidle')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 560, downloadThroughput: 180000, uploadThroughput: 84000 })
    const frames = []
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    cdp.on('Page.screencastFrame', async (f) => { frames.push(f.data); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) })
    await page.reload({ waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(1500)
    await cdp.send('Page.stopScreencast')
    const { writeFileSync } = await import('node:fs')
    const paths = frames.slice(0, 12).map((d, i) => { const p = `${OUT}/${TAG}-flash-os${os}-${String(i).padStart(2, '0')}.png`; writeFileSync(p, Buffer.from(d, 'base64')); return p })
    report.push({ setup: `flash-os-${os}-forced-${forcedTheme}`, frames: frames.length, saved: paths, attr: await page.evaluate(() => document.documentElement.dataset.theme), bg: await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor) })
    await ctx.close()
  }
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
