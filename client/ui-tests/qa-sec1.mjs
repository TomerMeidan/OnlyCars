// QA of SEC-1 through the UI: register, login, wrong password, unknown email, and the 429 lockout message
// (mocked with the API's exact body, because Development limits are set too high to hit for real).
// Usage (API + Vite must be running): node ui-tests/qa-sec1.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const report = []
const tooMany = (code) => ({
  status: 429,
  headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '840' },
  body: JSON.stringify({ title: 'Too many requests', status: 429, detail: 'Too many requests. Try again later.', code }),
})

for (const s of [
  { name: 'desktop-light-en', lng: 'en', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'mobile-dark-he', lng: 'he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
]) {
  const ctx = await browser.newContext({ viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  const r = { setup: s.name, checks: [], pageErrors: [], badResponses: [] }
  page.on('pageerror', (e) => r.pageErrors.push(String(e)))
  page.on('response', (x) => x.status() >= 400 && r.badResponses.push(`${x.status()} ${x.request().method()} ${x.url()}`))
  const check = async (label, fn) => {
    try { r.checks.push({ label, ...(await fn()) }) } catch (e) { r.checks.push({ label, error: e.message.split('\n')[0] }) }
  }
  const shot = async (label) => {
    const path = `${OUT}/qa-sec1-${s.name}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    return path
  }
  const email = `qa+sec1-${s.name}-${Date.now()}@example.com`
  const submit = async (mail, pw) => {
    await page.fill('input[name=email]', mail)
    await page.fill('input[name=password]', pw)
    const res = page.waitForResponse((x) => x.url().includes('/api/auth/'))
    await page.click('form button:not([type=button])')
    return (await res).status()
  }
  const alert = () => page.locator('form [role=alert]').textContent({ timeout: 5000 })
  const formState = async () => ({
    email: await page.inputValue('input[name=email]'),
    passwordKept: (await page.inputValue('input[name=password]')).length > 0,
    buttonDisabled: await page.locator('form button:not([type=button])').isDisabled(),
  })

  await check('register', async () => {
    await page.goto(`${BASE}/register`)
    const status = await submit(email, 'Passw0rd!')
    await page.waitForURL((u) => !u.pathname.startsWith('/register'), { timeout: 5000 })
    return { status, url: page.url(), shot: await shot('01-registered') }
  })
  await check('logout-login', async () => {
    await page.getByRole('button', { name: s.lng === 'he' ? 'התנתקות' : 'Log out' }).click()
    await page.waitForURL(/\/login/)
    const status = await submit(email, 'Passw0rd!')
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 5000 })
    return { status, url: page.url() }
  })
  await check('wrong-password', async () => {
    await page.getByRole('button', { name: s.lng === 'he' ? 'התנתקות' : 'Log out' }).click()
    await page.waitForURL(/\/login/)
    const status = await submit(email, 'WrongPass1!')
    return { status, alert: await alert(), ...(await formState()), shot: await shot('02-wrong-password') }
  })
  await check('unknown-email', async () => {
    const status = await submit(`qa+nobody-${Date.now()}@example.com`, 'WrongPass1!')
    return { status, alert: await alert() }
  })
  // Twelve real failures for this throwaway email: with Development limits this should stay 401.
  await check('repeated-failures-real', async () => {
    const statuses = []
    for (let i = 0; i < 12; i++) statuses.push(await submit(email, `Wrong${i}pass!`))
    return { statuses: statuses.join(','), alert: await alert(), shot: await shot('03-after-12-failures') }
  })
  await check('login-429-mocked', async () => {
    await page.route('**/api/auth/login', (rt) => rt.fulfill(tooMany('auth.tooManyAttempts')), { times: 1 })
    const status = await submit(email, 'Passw0rd!')
    return { status, alert: await alert(), ...(await formState()), url: page.url(), shot: await shot('04-login-429') }
  })
  await check('login-after-429-recovers', async () => {
    const status = await submit(email, 'Passw0rd!')
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 5000 })
    await page.getByRole('button', { name: s.lng === 'he' ? 'התנתקות' : 'Log out' }).click()
    await page.waitForURL(/\/login/)
    return { status }
  })
  await check('register-429-mocked', async () => {
    await page.goto(`${BASE}/register`)
    await page.route('**/api/auth/register', (rt) => rt.fulfill(tooMany('auth.tooManyAttempts')), { times: 1 })
    const status = await submit(`qa+never-${Date.now()}@example.com`, 'Passw0rd!')
    return { status, alert: await alert(), ...(await formState()), shot: await shot('05-register-429') }
  })
  await check('global-429-mocked', async () => {
    await page.goto(`${BASE}/login`)
    await page.route('**/api/auth/login', (rt) => rt.fulfill(tooMany('http.429')), { times: 1 })
    const status = await submit(email, 'Passw0rd!')
    return { status, alert: await alert(), shot: await shot('06-global-429') }
  })
  await check('429-non-json-body', async () => {
    await page.route('**/api/auth/login', (rt) => rt.fulfill({ status: 429, contentType: 'text/plain', body: 'Too Many Requests' }), { times: 1 })
    const status = await submit(email, 'Passw0rd!')
    return { status, alert: await alert() }
  })
  report.push(r)
  await ctx.close()
}
console.log(JSON.stringify(report, null, 2))
await browser.close()
