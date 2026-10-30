// Registration walkthrough: happy path, duplicate email, short password, wrong login.
// Usage (API + Vite must be running): node ui-tests/register.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
const email = `reg-${Date.now()}@onlycars.test`
const log = []
const shot = (name) => page.screenshot({ path: `${OUT}/register-${name}.png`, fullPage: true })
const formError = () => page.locator('.error').textContent({ timeout: 5000 }).catch(() => null)
const invalidMsg = (sel) => page.$eval(sel, (el) => el.validationMessage)

async function register(mail, password) {
  await page.goto(`${BASE}/register`)
  await page.fill('input[name=email]', mail)
  await page.fill('input[name=password]', password)
  await page.click('form button:not(.link)')
}

// 1. Fresh account
await register(email, 'Passw0rd!')
await page.locator('a[href="/cars/new"]').waitFor({ timeout: 10000 }).catch(() => {})
log.push({ case: 'new account', url: page.url(), landedOnCars: await page.locator('a[href="/cars/new"]').isVisible(), token: !!(await page.evaluate(() => localStorage.getItem('token'))) })
await page.waitForLoadState('networkidle')
await shot('1-success')

// 2. Same email again
await page.click('header nav button.link')
await register(email, 'Passw0rd!')
log.push({ case: 'duplicate email', error: await formError() })
await shot('2-duplicate')

// 3. Short password: blocked by the browser before any request
await register(`short-${Date.now()}@onlycars.test`, '123')
log.push({ case: 'short password', browserMessage: await invalidMsg('input[name=password]'), url: page.url() })
await shot('3-short-password')

// 4. Bad email format
await register('not-an-email', 'Passw0rd!')
log.push({ case: 'invalid email', browserMessage: await invalidMsg('input[name=email]') })

// 5. Login with wrong password
await page.goto(`${BASE}/login`)
await page.fill('input[name=email]', email)
await page.fill('input[name=password]', 'WrongPass1')
await page.click('form button:not(.link)')
log.push({ case: 'wrong password login', error: await formError() })
await shot('4-wrong-password')

// 6. Login with the right password
await page.fill('input[name=password]', 'Passw0rd!')
await page.click('form button:not(.link)')
await page.locator('a[href="/cars/new"]').waitFor({ timeout: 10000 }).catch(() => {})
log.push({ case: 'correct login', landedOnCars: await page.locator('a[href="/cars/new"]').isVisible() })

await browser.close()
console.log(JSON.stringify({ email, results: log }, null, 2))
