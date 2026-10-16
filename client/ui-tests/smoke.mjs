// UI smoke run: walks the main flows in two setups and prints a JSON report.
// Usage (API + Vite must be running): node ui-tests/smoke.mjs
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? 'ui-tests/out'
mkdirSync(OUT, { recursive: true })

const setups = [
  { name: 'desktop-light-en', viewport: { width: 1280, height: 800 }, colorScheme: 'light', lng: 'en' },
  { name: 'mobile-dark-he', viewport: { width: 390, height: 844 }, colorScheme: 'dark', lng: 'he', isMobile: true, hasTouch: true },
]
// SMOKE_ALL=1 adds the other two combinations, so QA can check dark English and light Hebrew too.
// UI_TZ (e.g. UTC, Pacific/Kiritimati) sets the browser timezone, so QA can run where the local date differs from the server's UTC date.
if (process.env.SMOKE_ALL) setups.push(
  { name: 'desktop-dark-he', viewport: { width: 1280, height: 800 }, colorScheme: 'dark', lng: 'he' },
  { name: 'mobile-light-en', viewport: { width: 390, height: 844 }, colorScheme: 'light', lng: 'en', isMobile: true, hasTouch: true },
)

const browser = await chromium.launch({ channel: 'chrome' })
const report = []

for (const s of setups) {
  const ctx = await browser.newContext({ timezoneId: process.env.UI_TZ, viewport: s.viewport, colorScheme: s.colorScheme, isMobile: s.isMobile, hasTouch: s.hasTouch })
  await ctx.addInitScript((lng) => localStorage.getItem('i18nextLng') || localStorage.setItem('i18nextLng', lng), s.lng)
  const page = await ctx.newPage()
  const run = { setup: s.name, steps: [], consoleErrors: [], badResponses: [] }
  page.on('console', (m) => m.type() === 'error' && run.consoleErrors.push(m.text()))
  page.on('pageerror', (e) => run.consoleErrors.push(String(e)))
  page.on('response', (r) => r.status() >= 400 && run.badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`))

  // Against the set viewport width: with isMobile, innerWidth grows to fit a too-wide page and hides the overflow.
  const overflowPx = () => page.evaluate((w) => document.documentElement.scrollWidth - w, page.viewportSize().width)
  let n = 0
  async function step(name, fn) {
    const shot = `${OUT}/${s.name}-${String(++n).padStart(2, '0')}-${name}.png`
    try {
      await fn()
      run.steps.push({ step: name, ok: true, screenshot: shot })
    } catch (e) {
      run.steps.push({ step: name, ok: false, error: e.message.split('\n')[0], screenshot: shot })
    }
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({ path: shot, fullPage: true })
    // Page wider than the viewport means horizontal scrolling, a layout bug.
    const overflow = await overflowPx()
    if (overflow > 0) run.steps.at(-1).horizontalOverflowPx = overflow
  }

  const odometer = () => page.locator('.odometer').first().getAttribute('aria-label')
  const digitsOnly = (v) => (v ?? '').replace(/\D/g, '')

  // MVP1-C: page titles, focus after navigation and actions, history button sizes.
  const he = s.lng === 'he'
  const T = he
    ? { login: 'התחברות', register: 'יצירת חשבון', dashboard: 'לוח בקרה', addCar: 'הוספת רכב', editCar: 'עריכת רכב' }
    : { login: 'Log in', register: 'Create account', dashboard: 'Dashboard', addCar: 'Add car', editCar: 'Edit car' }
  const editSel = (v) => `button[aria-label="${he ? `עריכה של הקריאה ${v} ק״מ` : `Edit reading ${v} km`}"]`
  const deleteSel = (v) => `button[aria-label="${he ? `מחיקה של הקריאה ${v} ק״מ` : `Delete reading ${v} km`}"]`
  const active = () => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100))
  async function focusIs(selector, what) {
    try {
      await page.waitForFunction((sel) => document.activeElement?.matches(sel), selector, { timeout: 3000 })
    } catch {
      throw new Error(`${what}: focus is on ${await active()}`)
    }
  }
  async function titleIs(name) {
    const want = `${name} · OnlyCars`
    await page.waitForFunction((w) => document.title === w, want, { timeout: 3000 }).catch(async () => {
      throw new Error(`title "${await page.title()}", want "${want}"`)
    })
  }
  // Criteria 2 and 3: after a client-side navigation, focus is on the new page's h1 and the title is set.
  const arrivedAt = async (name) => {
    await focusIs('main h1', `h1 after navigating to ${name}`)
    await titleIs(name)
  }
  const heightOf = (loc) => loc.evaluate((el) => el.getBoundingClientRect().height)
  async function tall(loc, what) {
    const h = await heightOf(loc)
    if (h < 44) throw new Error(`${what} is ${h}px tall`)
  }
  // Every visible link and button on the page is a 44px tap target.
  async function sweep(what) {
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button')]
      .filter((el) => el.checkVisibility())
      .map((el) => [el.textContent.trim() || el.getAttribute('aria-label'), Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44))
    if (small.length) throw new Error(`${what} under 44px: ${JSON.stringify(small)}`)
  }
  async function noOverflow(what) {
    const px = await overflowPx()
    if (px > 0) throw new Error(`${px}px horizontal overflow with ${what}`)
  }

  await step('login-page', async () => {
    await page.goto(`${BASE}/login`)
    await page.locator('input[name=email]').waitFor()
    await titleIs(T.login)
    // The first load keeps the browser's default focus.
    if (await page.evaluate(() => document.activeElement !== document.body)) throw new Error(`first load moved focus to ${await active()}`)
  })
  let currencyOptions, defaultCurrency, registered
  await step('register', async () => {
    await page.click('a[href="/register"]')
    await arrivedAt(T.register)
    await page.fill('input[name=email]', `ui-${s.name}-${Date.now()}@onlycars.test`)
    await page.fill('input[name=password]', 'Passw0rd!')
    currencyOptions = await page.locator('select[name=currency] option').allTextContents()
    defaultCurrency = await page.inputValue('select[name=currency]')
    const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/register'))
    await page.click('form button:not(.link)')
    registered = await (await response).json()
    await page.locator('a[href="/cars/new"]').waitFor()
    await arrivedAt(T.dashboard)
  })
  await step('register-currency', async () => {
    // The default follows the UI language, and the auth response returns what was saved.
    const expected = s.lng === 'he' ? 'ILS' : 'USD'
    if (defaultCurrency !== expected) throw new Error(`default currency ${defaultCurrency}`)
    if (registered?.user?.currency !== expected) throw new Error(`saved currency ${registered?.user?.currency}`)
    if (registered?.user?.locale !== (s.lng === 'he' ? 'He' : 'En')) throw new Error(`saved locale ${registered?.user?.locale}`)
    if (currencyOptions.map((o) => o.slice(0, 3)).join() !== 'ILS,USD,EUR,GBP') throw new Error(`options: ${currencyOptions}`)
    if (!currencyOptions[0].includes(s.lng === 'he' ? 'שקל' : 'Shekel')) throw new Error(`ILS label: ${currencyOptions[0]}`)
  })
  // MVP3-C: /history, every car's services. Before any car exists, it shows the empty state.
  const HS = he
    ? { title: 'היסטוריית טיפולים', empty: 'עדיין לא נרשמו טיפולים.', noMatches: 'אין טיפולים שתואמים לסינון.', clear: 'ניקוי הסינון', showMore: 'הצגת עוד', retry: 'נסו שוב',
        archived: 'בארכיון', searchAll: 'חיפוש בכל ההיסטוריה', labels: ['רכב', 'משימה', 'מתאריך', 'עד תאריך', 'חיפוש'],
        dates: 'תאריך ההתחלה לא יכול להיות אחרי תאריך הסיום.', tooLong: 'הזינו חיפוש של עד 100 תווים.', generic: 'משהו השתבש. נסו שוב.',
        summary: (n, total) => `${n === 1 ? 'טיפול אחד' : `${n.toLocaleString('he')} טיפולים`}, סה״כ ${total}` }
    : { title: 'Service history', empty: 'No services recorded yet.', noMatches: 'No services match these filters.', clear: 'Clear filters', showMore: 'Show more', retry: 'Retry',
        archived: 'Archived', searchAll: 'Search all history', labels: ['Car', 'Task', 'From date', 'To date', 'Search'],
        dates: 'The start date must not be after the end date.', tooLong: 'Enter a search of up to 100 characters.', generic: 'Something went wrong. Please try again.',
        summary: (n, total) => `${n.toLocaleString('en')} service${n === 1 ? '' : 's'}, total ${total}` }
  const histStatus = page.locator('main .card > p[role=status]')
  const histRows = page.locator('main .services > li')
  const filterBar = page.locator('main .filters')
  const carFilter = filterBar.locator('select').nth(0)
  const taskFilter = filterBar.locator('select').nth(1)
  const fromFilter = filterBar.locator('input[type=date]').nth(0)
  const toFilter = filterBar.locator('input[type=date]').nth(1)
  const searchBox = filterBar.locator('input[type=search]')
  const clearBtn = filterBar.getByRole('button', { name: HS.clear, exact: true })
  await step('history-empty', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.click('header a[href="/history"]')
    await arrivedAt(HS.title)
    await histStatus.filter({ hasText: HS.empty }).waitFor()
    if (await histRows.count()) throw new Error('rows without records')
    if (await clearBtn.count()) throw new Error('Clear filters shown without filters')
    // Every filter has a visible label and is 44px tall; the task select waits for a car.
    const labels = await filterBar.locator('label').evaluateAll((ls) => ls.map((l) => l.firstChild.textContent.trim()))
    if (labels.join('|') !== HS.labels.join('|')) throw new Error(`labels ${labels}`)
    for (const c of await filterBar.locator('select, input').all()) await tall(c, 'a filter')
    if (!(await taskFilter.isDisabled())) throw new Error('task select enabled without a car')
    await noOverflow('the header and the empty history')
    await sweep('the empty history')
    await page.setViewportSize(s.viewport)
    await page.click('header a.brand')
    await page.locator('a[href="/cars/new"]').waitFor()
  })
  await step('add-car', async () => {
    await page.click('a[href="/cars/new"]')
    await arrivedAt(T.addCar)
    await page.fill('input[name=nickname]', 'Test Corolla')
    // Criterion 9: an initial odometer over 10,000,000 is blocked by the input, and the form keeps its values.
    await page.fill('input[name=initialOdometerKm]', '20000000')
    let posted = 0
    const countPost = (r) => r.method() === 'POST' && r.url().endsWith('/api/vehicles') && posted++
    page.on('request', countPost)
    await page.click('form button:not(.link)')
    await page.waitForTimeout(300)
    page.off('request', countPost)
    if (posted || new URL(page.url()).pathname !== '/cars/new') throw new Error(`20000000 submitted: ${posted} POST, at ${page.url()}`)
    if (!(await page.locator('input[name=initialOdometerKm]').evaluate((el) => el.validity.rangeOverflow))) throw new Error('20000000 not blocked')
    if ((await page.inputValue('input[name=nickname]')) !== 'Test Corolla') throw new Error('form lost its values')
    await page.fill('input[name=make]', 'Toyota')
    await page.fill('input[name=model]', 'Corolla')
    await page.fill('input[name=year]', '2018')
    await page.fill('input[name=plate]', '12-345-67')
    await page.selectOption('select[name=fuelType]', 'Hybrid')
    await page.fill('input[name=initialOdometerKm]', '61000')
    await page.click('form button:not(.link)')
    await page.locator('.cars > li').first().waitFor()
    if (digitsOnly(await odometer()) !== '61000') throw new Error(`odometer shows ${await odometer()}`)
  })
  await step('odometer-update', async () => {
    await page.fill('.quick input[type=number]', '61250')
    // Hold the POST briefly so the in-flight state is observable: a second tap must not add a second reading.
    await page.route('**/odometer', async (r) => { await page.waitForTimeout(500); await r.continue() }, { times: 1 })
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/odometer'))
    await page.click('.quick button')
    // The quick-add dates the reading with the user's local date.
    const readingDate = (await sent).postDataJSON().readingDate
    const today = await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
    if (readingDate !== today) throw new Error(`quick-add readingDate ${readingDate}, want ${today}`)
    if (!(await page.locator('.quick button').isDisabled())) throw new Error('Update button not disabled while saving')
    await page.waitForFunction(() => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === '61250')
    const label = await odometer()
    if (label !== (s.lng === 'he' ? '61,250 ק״מ' : '61,250 km')) throw new Error(`odometer label "${label}"`)
  })
  await step('odometer-lower-rejected', async () => {
    await page.fill('.quick input[type=number]', '60000')
    await page.click('.quick button')
    const text = await page.locator('.quick .error').textContent()
    await page.locator('.quick input[type=checkbox]').waitFor()
    if (!digitsOnly(text).includes('61250')) throw new Error(`error lacks the current reading: "${text}"`)
    if (s.lng === 'he' && /[A-Za-z]/.test(text)) throw new Error(`Hebrew error has Latin letters: "${text}"`)
  })
  await step('odometer-correction-confirmed', async () => {
    await page.check('.quick input[type=checkbox]')
    await page.click('.quick button')
    await page.waitForFunction(() => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === '60000')
  })
  await step('odometer-history', async () => {
    await page.click('.cars > li h2 a')
    await page.locator('.history li').first().waitFor()
    await arrivedAt('Test Corolla')
    const rows = await page.locator('.history li').allTextContents()
    // Newest first: the correction, the update, then the initial reading from add-car.
    const values = await page.locator('.history .value bdi').allTextContents()
    if (values.map(digitsOnly).join() !== '60000,61250,61000') throw new Error(`history values: ${values}`)
    if (s.lng === 'he' && rows.some((r) => /[A-Za-z]/.test(r))) throw new Error(`Hebrew history has Latin letters: ${rows}`)
    const dir = await page.locator('.history').evaluate((el) => getComputedStyle(el).direction)
    if (dir !== (s.lng === 'he' ? 'rtl' : 'ltr')) throw new Error(`history direction is ${dir}`)
  })
  const values = () => page.locator('.history .value bdi').allTextContents().then((v) => v.map(digitsOnly).join())
  const waitFor = async (check, what) => {
    for (let i = 0; i < 50 && !(await check()); i++) await page.waitForTimeout(100)
    if (!(await check())) throw new Error(`${what}: history ${await values()}, odometer ${await odometer()}`)
  }
  await step('back-link-focus-ring', async () => {
    // Criterion 4: a 44px tap target, with the keyboard focus ring on the text only. Shift+Tab from the h1 reaches it.
    await page.keyboard.press('Shift+Tab')
    await focusIs('a.back', 'Shift+Tab from the h1')
    await tall(page.locator('a.back'), 'back link')
    const ring = await page.locator('a.back').evaluate((a) => [getComputedStyle(a).outlineStyle, getComputedStyle(a.firstElementChild).outlineStyle].join())
    if (ring !== 'none,solid') throw new Error(`outline link,text: ${ring}`)
  })
  // Criteria 5 to 8 at 390px wide (the desktop setup narrows for these steps).
  await step('history-buttons-escape-edit', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const row = page.locator('.history li').nth(1)
    await tall(row.locator(editSel('61,250')), 'Edit')
    await tall(row.locator(deleteSel('61,250')), 'Delete')
    await row.locator(editSel('61,250')).click()
    await tall(row.locator('.inline-form button.link'), 'Cancel')
    await noOverflow('the edit form open')
    await page.keyboard.press('Escape')
    await row.locator('form').waitFor({ state: 'detached' })
    await focusIs(editSel('61,250'), 'after Escape')
  })
  await step('history-delete-confirm-danger', async () => {
    const row = page.locator('.history li').nth(1)
    await row.locator(deleteSel('61,250')).click()
    const confirm = row.locator('button.danger')
    await tall(confirm, 'confirm Delete')
    await tall(row.locator('.inline-form button.link'), 'Cancel')
    await noOverflow('the delete confirmation open')
    // Criterion 8: red, with text contrast of at least 4.5:1.
    const ratio = await confirm.evaluate((el) => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const [a, b] = [lum(getComputedStyle(el).color), lum(getComputedStyle(el).backgroundColor)].sort((x, y) => y - x)
      return (a + 0.05) / (b + 0.05)
    })
    if (ratio < 4.5) throw new Error(`confirm Delete contrast ${ratio.toFixed(2)}:1`)
    await page.keyboard.press('Escape')
    await row.locator('.inline-form').waitFor({ state: 'detached' })
    await focusIs(deleteSel('61,250'), 'after Escape on the delete confirmation')
  })
  await step('history-cancel-delete', async () => {
    const row = page.locator('.history li').nth(1)
    await row.locator(deleteSel('61,250')).click()
    await row.locator('.inline-form button.link').click()
    await focusIs(deleteSel('61,250'), 'after Cancel')
  })
  await step('tap-targets-car-page', async () => {
    await sweep('car page at 390px')
  })
  await step('edit-reading', async () => {
    await page.setViewportSize(s.viewport)
    // Lowering 61250 below the 61000 before it needs a correction; editing an older reading keeps the odometer.
    const row = page.locator('.history li').nth(1)
    await row.getByRole('button', { name: s.lng === 'he' ? 'עריכה של הקריאה 61,250 ק״מ' : 'Edit reading 61,250 km' }).click()
    await row.locator('input[name=valueKm]').fill('59000')
    await row.locator('.inline-form button:not(.link)').click()
    const text = await row.locator('.error').textContent()
    if (!digitsOnly(text).includes('61000')) throw new Error(`error lacks the previous reading: "${text}"`)
    if (s.lng === 'he' && /[A-Za-z]/.test(text)) throw new Error(`Hebrew error has Latin letters: "${text}"`)
    await row.locator('input[type=checkbox]').check()
    await row.locator('.inline-form button:not(.link)').click()
    await waitFor(async () => (await values()) === '60000,59000,61000' && digitsOnly(await odometer()) === '60000', 'after edit')
    await focusIs(editSel('59,000'), 'after Save') // criterion 6
  })
  await step('delete-reading', async () => {
    // Deleting the latest reading makes the one before it current.
    const row = page.locator('.history li').first()
    await row.getByRole('button', { name: s.lng === 'he' ? 'מחיקה של הקריאה 60,000 ק״מ' : 'Delete reading 60,000 km' }).click()
    await row.locator('.inline-form button:not(.link)').click()
    await waitFor(async () => (await values()) === '59000,61000' && digitsOnly(await odometer()) === '59000', 'after delete')
    await focusIs(editSel('59,000'), 'after Delete (the next older row)')
  })

  // MVP2-A: maintenance tasks. The odometer is at 59,000 here.
  const TK = he
    ? { add: 'הוספת משימה', belt: 'רצועת טיימינג', custom: 'משימה מותאמת אישית', wash: 'שטיפה', wash2: 'שטיפה וווקס', edit: 'עריכה של ', del: 'מחיקה של ', on: 'פעילה: ', off: 'לא פעילה', beltInterval: 'כל 100,000 ק״מ או 5 שנים', sixMonths: 'כל 6 חודשים', twelveMonths: 'כל 5,000 ק״מ או 12 חודשים', year: 'כל 5,000 ק״מ או שנה' }
    : { add: 'Add task', belt: 'Timing belt', custom: 'Custom task', wash: 'Wash', wash2: 'Wash and wax', edit: 'Edit ', del: 'Delete ', on: 'Enabled: ', off: 'Disabled', beltInterval: 'Every 100,000 km or 5 years', sixMonths: 'Every 6 months', twelveMonths: 'Every 5,000 km or 12 months', year: 'Every 5,000 km or 1 year' }
  const tasks = page.locator('section[aria-labelledby=maintenance]')
  const taskNames = () => tasks.locator('.tasks .name').allTextContents()
  const taskRow = (name) => tasks.locator('.tasks > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const taskBtn = (verb, name) => tasks.getByRole('button', { name: verb + name, exact: true })
  const plain = (s) => s.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()
  const noLatin = (text, what) => { if (he && /[A-Za-z]/.test(text)) throw new Error(`Hebrew ${what} has Latin letters: "${text}"`) }

  // MVP3-A: service history.
  const SV = he
    ? { items: 'חלקים ועבודה', empty: 'עדיין לא נרשמו טיפולים.', record: 'רישום טיפול', diy: 'טיפול עצמי', editOf: 'עריכת הטיפול מ־', deleteOf: 'מחיקת הטיפול מ־', gone: 'הטיפול הזה כבר נמחק.', editHint: 'כדי לשנות את התאריך, הקילומטראז׳ או המשימות, מחקו את הטיפול ורשמו אותו מחדש.', labour: 'עבודה', item2Qty: 'פריט 2: הזינו כמות בין 0.01 ל־10,000, עם עד 2 ספרות אחרי הנקודה.', taskGone: 'אחת המשימות שסימנתם נמחקה, ורשימת המשימות עודכנה. בדקו את הבחירה ושמרו שוב.', item2Hours: 'פריט 2, שעות', item1Part: 'פריט 1, מק״ט', legend: 'משימות שבוצעו', hint: 'השאירו ריק לטיפול עצמי.', future: 'תאריך הטיפול לא יכול להיות בעתיד.', km: 'ק״מ', generic: 'משהו השתבש. נסו שוב.', odoLabel: 'קילומטראז׳ במיילים', at59500: 'ב־59,500 ק״מ', at59000: 'ב־59,000 ק״מ' }
    : { items: 'Parts and labour', empty: 'No services recorded yet.', record: 'Record a service', diy: 'DIY', editOf: 'Edit the service from ', deleteOf: 'Delete the service from ', gone: 'This service was already deleted.', editHint: 'To change the date, odometer or tasks, delete this service and record it again.', labour: 'Labour', item2Qty: 'Item 2: Enter a quantity above 0 and up to 10,000 with up to 2 decimals.', taskGone: 'A task you ticked was deleted, and the task list has been updated. Check your selection and save again.', item2Hours: 'Item 2, Hours', item1Part: 'Item 1, Part number', legend: 'Tasks done', hint: 'Leave empty for DIY.', future: "The service date can't be in the future.", km: 'km', generic: 'Something went wrong. Please try again.', odoLabel: 'Odometer in miles', at59500: 'at 59,500 km', at59000: 'at 59,000 km' }
  const services = page.locator('section[aria-labelledby=service-history]')
  const serviceItems = () => services.locator('.services > li')
  const recordForm = services.locator('form')
  const recordBtn = services.getByRole('button', { name: SV.record, exact: true })
  const isRecordPost = (r) => r.method() === 'POST' && r.url().endsWith('/service-records')
  await step('service-history-empty', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const empty = services.locator('p.muted', { hasText: SV.empty })
    await empty.waitFor()
    noLatin(await services.textContent(), 'service history')
    // A failed load shows the translated error in the section; the rest of the page stays.
    await page.route('**/service-records', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    const alert = services.locator('[role=alert]')
    await alert.waitFor()
    await page.unroute('**/service-records')
    if ((await alert.textContent()) !== SV.generic) throw new Error(`load error "${await alert.textContent()}"`)
    if (!(await page.locator('.history li').count())) throw new Error('odometer history gone with the service history error')
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 '))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    await page.reload()
    await empty.waitFor()
    await tall(recordBtn, 'Record a service')
    await noOverflow('the empty service history')
    await page.setViewportSize(s.viewport)
  })

  await step('tasks-empty-and-picker', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await tasks.locator('p.muted').filter({ hasText: he ? 'עדיין אין משימות תחזוקה.' : 'No maintenance tasks yet.' }).waitFor()
    // Maintenance first, then To-dos (MVP5-C), Checklists (MVP5-B), the service history and the odometer history.
    const order = await page.evaluate(() => [...document.querySelectorAll('main section h2')].map((h) => h.id).join())
    if (order !== 'maintenance,todos,checklists,service-history,odometer-history') throw new Error(`sections: ${order}`)
    await tasks.getByRole('button', { name: TK.add }).click()
    const options = await tasks.locator('.picker li button').allTextContents()
    if (options.length !== 13) throw new Error(`${options.length} picker options`)
    if (!options.some((o) => plain(o).startsWith(TK.belt) && plain(o).includes(TK.beltInterval))) throw new Error(`no ${TK.belt} option: ${options}`)
    if (plain(options.at(-1)) !== TK.custom) throw new Error(`last option "${options.at(-1)}"`)
    noLatin(options.join(), 'picker')
    await focusIs('.picker li:first-child button', 'picker open')
    await noOverflow('the template picker open')
    await sweep('car page with the picker open')
  })
  await step('task-form-prefill', async () => {
    await tasks.locator('.picker button', { hasText: TK.belt }).click()
    const form = tasks.locator('form')
    await focusIs('form input[name=name]', 'add form open')
    const got = await form.evaluate((f) => Object.fromEntries([...new FormData(f)]))
    const want = { name: TK.belt, category: 'Belts', intervalKm: '100000', intervalTime: '5', intervalUnit: 'years', lastDoneOdometerKm: '59000' }
    for (const [k, v] of Object.entries(want)) if (got[k] !== v) throw new Error(`${k} is "${got[k]}", want "${v}"`)
    const date = form.locator('input[name=lastDoneDate]')
    const today = await page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
    if ((await date.inputValue()) !== today || (await date.getAttribute('max')) !== today) throw new Error(`date ${await date.inputValue()}, max ${await date.getAttribute('max')}`)
    await noOverflow('the add form open')
    await sweep('car page with the add form open')
  })
  await step('add-task-template', async () => {
    const res = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/tasks'))
    await tasks.locator('form button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (!body.templateId?.endsWith('09')) throw new Error(`templateId ${body.templateId}`)
    await taskRow(TK.belt).waitFor()
    await focusIs(`button[aria-label="${TK.edit}${TK.belt}"]`, 'after Save')
    const text = plain(await taskRow(TK.belt).textContent())
    if (!text.includes(TK.beltInterval)) throw new Error(`row "${text}"`)
    if (!text.includes(he ? 'ב־59,000 ק״מ' : 'at 59,000 km')) throw new Error(`last done missing: "${text}"`)
    noLatin(text, 'task row')
  })
  await step('add-task-custom', async () => {
    await tasks.getByRole('button', { name: TK.add }).click()
    await tasks.locator('.picker button', { hasText: TK.custom }).click()
    const form = tasks.locator('form')
    if ((await form.locator('input[name=name]').inputValue()) !== '') throw new Error('custom name prefilled')
    await form.locator('input[name=name]').fill(TK.wash)
    // No interval: the client stops it before sending.
    let posted = 0
    const countPost = (r) => r.method() === 'POST' && r.url().endsWith('/tasks') && posted++
    page.on('request', countPost)
    await form.locator('button:not(.link)').click()
    await page.waitForTimeout(300)
    page.off('request', countPost)
    const required = await form.locator('[role=alert]').textContent()
    if (posted || required !== (he ? 'הזינו מרווח בק״מ, מרווח זמן או את שניהם.' : 'Enter an interval in km, a time interval, or both.')) throw new Error(`${posted} POST, "${required}"`)
    // A last-done km above the odometer: the server's error names the current km, and the input is kept.
    await form.locator('input[name=intervalTime]').fill('6')
    await form.locator('select[name=intervalUnit]').selectOption('months')
    await form.locator('select[name=category]').selectOption('Other')
    await form.locator('input[name=lastDoneOdometerKm]').fill('70000')
    await form.locator('button:not(.link)').click()
    await page.waitForFunction(() => /59/.test(document.querySelector('section[aria-labelledby=maintenance] form [role=alert]')?.textContent ?? ''))
    const err = await form.locator('[role=alert]').textContent()
    if (!plain(err).includes('59,000')) throw new Error(`invalidLastDone: "${err}"`)
    noLatin(err, 'error')
    if ((await form.locator('input[name=name]').inputValue()) !== TK.wash) throw new Error('form lost its input')
    await form.locator('input[name=lastDoneOdometerKm]').fill('58000')
    const res = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/tasks'))
    await form.locator('button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.templateId !== null || body.intervalDays !== 180 || body.intervalKm !== null) throw new Error(`body ${JSON.stringify(body)}`)
    await taskRow(TK.wash).waitFor()
    if (!plain(await taskRow(TK.wash).textContent()).includes(TK.sixMonths)) throw new Error(`row "${await taskRow(TK.wash).textContent()}"`)
    await focusIs(`button[aria-label="${TK.edit}${TK.wash}"]`, 'after Save')
    if ((await taskNames()).join() !== [TK.belt, TK.wash].join()) throw new Error(`order ${await taskNames()}`)
  })
  await step('edit-task', async () => {
    // Escape returns focus to Edit; then a real edit: name, km interval, 6 months to 1 year.
    await taskBtn(TK.edit, TK.wash).click()
    await noOverflow('an edit form open')
    await page.keyboard.press('Escape')
    await taskRow(TK.wash).locator('form').waitFor({ state: 'detached' })
    await focusIs(`button[aria-label="${TK.edit}${TK.wash}"]`, 'after Escape')
    await taskBtn(TK.edit, TK.wash).click()
    const form = taskRow(TK.wash).locator('form')
    await form.locator('input[name=name]').fill(TK.wash2)
    await form.locator('input[name=intervalKm]').fill('5000')
    await form.locator('input[name=intervalTime]').fill('12')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await form.locator('button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.intervalDays !== 360) throw new Error(`12 months sent ${body.intervalDays} days`)
    await taskRow(TK.wash2).waitFor()
    await focusIs(`button[aria-label="${TK.edit}${TK.wash2}"]`, 'after Save')
    // 360 days is shown as 12 months, in the row and in the reopened form; now save 1 year.
    const shown = plain(await taskRow(TK.wash2).textContent())
    if (!shown.includes(TK.twelveMonths)) throw new Error(`row "${shown}"`)
    await taskBtn(TK.edit, TK.wash2).click()
    const prefill = await taskRow(TK.wash2).locator('form').evaluate((f) => Object.fromEntries([...new FormData(f)]))
    if (prefill.intervalTime !== '12' || prefill.intervalUnit !== 'months') throw new Error(`reopened ${prefill.intervalTime} ${prefill.intervalUnit}`)
    await taskRow(TK.wash2).locator('input[name=intervalTime]').fill('1')
    await taskRow(TK.wash2).locator('select[name=intervalUnit]').selectOption('years')
    await taskRow(TK.wash2).locator('form button:not(.link)').click()
    await taskRow(TK.wash2).locator('form').waitFor({ state: 'detached' })
    const text = plain(await taskRow(TK.wash2).textContent())
    if (!text.includes(TK.year)) throw new Error(`row "${text}"`)
  })
  await step('disable-task', async () => {
    const toggle = tasks.getByRole('checkbox', { name: TK.on + TK.belt })
    await tall(taskRow(TK.belt).locator('label.inline'), 'Enabled toggle')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await toggle.uncheck()
    const body = (await res).request().postDataJSON()
    if (body.isEnabled !== false || body.name !== TK.belt || body.intervalKm !== 100000 || body.intervalDays !== 1825 || !body.lastDoneDate) throw new Error(`PUT body ${JSON.stringify(body)}`)
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor()
    if ((await taskNames()).join() !== [TK.wash2, TK.belt].join()) throw new Error(`disabled not last: ${await taskNames()}`)
    await focusIs(`li[data-id] input[aria-label="${TK.on}${TK.belt}"]`, 'after toggling')
    await toggle.check()
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor({ state: 'detached' })
    // Both OK: the one with more of its interval used comes first (Wash and wax 20%, Timing belt 0%).
    if ((await taskNames()).join() !== [TK.wash2, TK.belt].join()) throw new Error(`re-enabled order: ${await taskNames()}`)
    await toggle.uncheck() // leave it disabled for the screenshot and the archived check
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor()
  })
  await step('toggle-task-fails', async () => {
    // A failed save puts the checkbox back, shows the error, and keeps focus on the checkbox.
    const toggle = tasks.getByRole('checkbox', { name: TK.on + TK.belt })
    await page.route('**/api/vehicles/*/tasks/*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await toggle.click()
    const alert = await taskRow(TK.belt).locator('[role=alert]').textContent()
    if (alert !== (he ? 'משהו השתבש. נסו שוב.' : 'Something went wrong. Please try again.')) throw new Error(`alert "${alert}"`)
    if (await toggle.isChecked()) throw new Error('checkbox not put back')
    await taskRow(TK.belt).locator('.badge', { hasText: TK.off }).waitFor()
    await focusIs(`li[data-id] input[aria-label="${TK.on}${TK.belt}"]`, 'after a failed toggle')
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 PUT')) // the forced failure
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    // MVP2-B Low c: the next action on the row clears the old error.
    await taskBtn(TK.edit, TK.belt).click()
    await page.keyboard.press('Escape')
    await focusIs(`button[aria-label="${TK.edit}${TK.belt}"]`, 'after Escape')
    if (await taskRow(TK.belt).locator('[role=alert]').count()) throw new Error('toggle error still shown after Edit')
  })
  await step('delete-task-confirm', async () => {
    await taskBtn(TK.del, TK.wash2).click()
    await tall(taskRow(TK.wash2).locator('button.danger'), 'confirm Delete')
    await noOverflow('the delete confirmation open')
    await sweep('car page with the delete confirmation open')
    await page.keyboard.press('Escape')
    await focusIs(`button[aria-label="${TK.del}${TK.wash2}"]`, 'after Escape on the delete confirmation')
    await taskBtn(TK.del, TK.wash2).click()
  })
  await step('delete-task', async () => {
    const res = page.waitForResponse((r) => r.request().method() === 'DELETE')
    await taskRow(TK.wash2).locator('button.danger').click()
    if ((await res).status() !== 204) throw new Error(`DELETE ${(await res).status()}`)
    await taskRow(TK.wash2).waitFor({ state: 'detached' })
    if ((await taskNames()).join() !== TK.belt) throw new Error(`left ${await taskNames()}`)
    await focusIs(`button[aria-label="${TK.edit}${TK.belt}"]`, 'after Delete (the next row)')
  })
  await step('tasks-load-error', async () => {
    // Every load fails until unrouted: dev StrictMode mounts twice and only the second request's answer counts.
    await page.route('**/api/vehicles/*/tasks', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    const alert = await tasks.locator('[role=alert]').textContent()
    await page.unroute('**/api/vehicles/*/tasks')
    if (alert !== (he ? 'משהו השתבש. נסו שוב.' : 'Something went wrong. Please try again.')) throw new Error(`alert "${alert}"`)
    await page.locator('.quick input[type=number]').waitFor()
    await page.locator('.history li').first().waitFor()
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 GET')) // the forced failure
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    await page.reload()
    await taskRow(TK.belt).waitFor()
    await page.setViewportSize(s.viewport)
  })
  await step('templates-load-error', async () => {
    // The tasks load succeeds, so it must not clear the templates error.
    await page.route('**/api/task-templates', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.reload()
    await taskRow(TK.belt).waitFor()
    await tasks.getByRole('button', { name: TK.add }).click()
    const alert = await tasks.locator('.picker [role=alert]').textContent()
    await page.unroute('**/api/task-templates')
    if (alert !== (he ? 'משהו השתבש. נסו שוב.' : 'Something went wrong. Please try again.')) throw new Error(`picker alert "${alert}"`)
    if (plain((await tasks.locator('.picker li button').allTextContents()).join()) !== TK.custom) throw new Error('picker options with no templates')
    await tasks.screenshot({ path: `${OUT}/${s.name}-templates-error.png` })
    await tasks.locator('.picker button.link').click()
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 GET'))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
    await page.reload()
    await taskRow(TK.belt).waitFor()
  })
  // MVP2-B: status, remaining and the due-soon threshold. The odometer is at 59,000; the Timing belt is disabled.
  const ST = he ? { Ok: 'תקין', DueSoon: 'בקרוב', Overdue: 'באיחור' } : { Ok: 'OK', DueSoon: 'Due soon', Overdue: 'Overdue' }
  const badge = (name) => taskRow(name).locator('.badge.status').textContent()
  const badgeIs = (name, want) => page.waitForFunction(([n, w]) => [...document.querySelectorAll('.tasks > li')]
    .find((li) => li.querySelector('.name').textContent === n)?.querySelector('.badge.status')?.textContent === w, [name, want], { timeout: 5000 })
    .catch(async () => { throw new Error(`${name} badge "${await badge(name)}", want "${want}"`) })
  const ratio = (fg, bg) => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  }
  await step('task-status-order', async () => {
    const token = await page.evaluate(() => localStorage.getItem('token'))
    const url = `${BASE}/api/vehicles/${new URL(page.url()).pathname.split('/').pop()}/tasks`
    const today = await page.evaluate(() => new Date().toISOString().slice(0, 10))
    const add = async (name, intervalKm, lastDoneOdometerKm, intervalDays = null) => {
      const r = await page.request.post(url, { headers: { Authorization: `Bearer ${token}` }, data: { name, category: 'Other', intervalKm, intervalDays, lastDoneOdometerKm, lastDoneDate: today } })
      if (r.status() !== 201) throw new Error(`POST ${name}: ${r.status()}`)
    }
    await add('10k service', 20000, 59000, 365) // OK, 0% used
    await add('9k service', 20000, 59000) // OK, 0% used: sorts before "10k service" (Low a)
    await add('Brakes', 10000, 50500) // OK, 15% left
    await add('Coolant', 10000, 50000) // Due soon, 10% left
    await add('Oil', 10000, 48000) // Overdue by 1,000 km
    await page.reload()
    await taskRow('Oil').waitFor()
    const want = ['Oil', 'Coolant', 'Brakes', '9k service', '10k service', TK.belt]
    if ((await taskNames()).join() !== want.join()) throw new Error(`order ${await taskNames()}`)
    for (const [n, st] of [['Oil', 'Overdue'], ['Coolant', 'DueSoon'], ['Brakes', 'Ok'], ['9k service', 'Ok']]) await badgeIs(n, ST[st])
    if (await taskRow(TK.belt).locator('.badge.status, [role=progressbar]').count()) throw new Error('disabled task has a badge or bar')
    const lines = {
      Oil: he ? 'באיחור של 1,000 ק״מ' : 'Overdue by 1,000 km',
      Coolant: he ? 'עוד 1,000 ק״מ' : '1,000 km left',
      '10k service': he ? 'עוד 20,000 ק״מ או כ־12 חודשים' : '20,000 km or about 12 months left',
    }
    for (const [n, line] of Object.entries(lines)) {
      const text = plain(await taskRow(n).textContent())
      if (!text.includes(line)) throw new Error(`${n}: "${text}" lacks "${line}"`)
    }
    const bar = taskRow('Oil').getByRole('progressbar', { name: he ? 'Oil: נוצלו 110%' : 'Oil: 110% used' })
    const vals = [await bar.getAttribute('aria-valuenow'), await bar.getAttribute('aria-valuetext')].join()
    if (vals !== '100,110%') throw new Error(`Oil valuenow,valuetext ${vals}`)
    // The fill starts at the inline start: the right edge in Hebrew.
    const edges = await taskRow('Coolant').locator('.bar').evaluate((b) => {
      const [t, f] = [b, b.firstElementChild].map((el) => el.getBoundingClientRect())
      return { start: Math.round(getComputedStyle(b).direction === 'rtl' ? t.right - f.right : f.left - t.left), width: Math.round((f.width / t.width) * 100) }
    })
    if (edges.start !== 0 || edges.width !== 90) throw new Error(`Coolant fill ${JSON.stringify(edges)}`)
    // Contrast: badge text 4.5:1 on the card, bar fill 3:1 on its track.
    for (const n of ['Oil', 'Coolant', 'Brakes']) {
      const c = await taskRow(n).evaluate((li) => {
        const css = (el, k) => getComputedStyle(el)[k]
        const bar = li.querySelector('.bar')
        return [css(li.querySelector('.badge.status'), 'color'), css(li.closest('.card'), 'backgroundColor'), css(bar.firstElementChild, 'backgroundColor'), css(bar, 'backgroundColor')]
      })
      if (ratio(c[0], c[1]) < 4.5 || ratio(c[2], c[3]) < 3) throw new Error(`${n} contrast text ${ratio(c[0], c[1]).toFixed(2)}, bar ${ratio(c[2], c[3]).toFixed(2)}`)
    }
    // 390px wide with the longest remaining line (a mocked row), in either language.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/vehicles/*/tasks', async (r) => {
      const res = await r.fetch()
      const ts = await res.json()
      ts.push({ ...ts[0], id: '00000000-0000-0000-0000-0000000000ff', name: 'Longest', status: 'Overdue', intervalKm: 1, intervalDays: 1, remainingKm: -1000000, remainingDays: -7300, progress: 2 })
      await r.fulfill({ response: res, json: ts })
    })
    await page.reload()
    await taskRow('Longest').waitFor()
    await page.unroute('**/api/vehicles/*/tasks')
    const longest = plain(await taskRow('Longest').textContent())
    if (!longest.includes(he ? 'באיחור של 1,000,000 ק״מ וגם כ־243 חודשים' : 'Overdue by 1,000,000 km and about 243 months')) throw new Error(`longest "${longest}"`)
    // MVP2-B Low 2: a non-breaking space keeps each number with its unit word.
    const raw = await taskRow('Longest').textContent()
    if (!raw.includes('1,000,000 ') || !raw.includes('243 ')) throw new Error(`no non-breaking spaces in "${raw}"`)
    await noOverflow('status rows and the longest remaining line')
    await sweep('car page with status rows')
  })
  await step('task-status-after-odometer', async () => {
    await page.setViewportSize(s.viewport)
    await page.evaluate(() => { window.noReload = true })
    // Hold the task reload so the in-between state is visible: the old rows stay.
    await page.route('**/api/vehicles/*/tasks', async (r) => { await page.waitForTimeout(700); await r.continue() }, { times: 1 })
    await page.fill('.quick input[type=number]', '61001')
    await page.click('.quick button')
    await page.waitForFunction(() => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === '61001')
    if (!(await taskRow('Coolant').isVisible())) throw new Error('rows hidden while the tasks reload')
    await badgeIs('Coolant', ST.Overdue) // 1,001 km past its 10,000 km interval
    const row = page.locator('.history li').first()
    await row.locator(deleteSel('61,001')).click()
    await row.locator('button.danger').click()
    await badgeIs('Coolant', ST.DueSoon)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('task-due-soon-percent', async () => {
    const msg = he
      ? { pct: 'הזינו מספר שלם בין 1 ל־50.', km: 'הזינו מרווח של 1 עד 1,000,000 ק״מ.', time: 'הזינו מרווח זמן של עד 20 שנה (243 חודשים או 7,300 ימים).' }
      : { pct: 'Enter a whole number from 1 to 50.', km: 'Enter an interval from 1 to 1,000,000 km.', time: 'Enter a time interval of up to 20 years (243 months or 7,300 days).' }
    // The add form starts at 10.
    await tasks.getByRole('button', { name: TK.add }).click()
    await tasks.locator('.picker button', { hasText: TK.custom }).click()
    if ((await tasks.locator('form input[name=dueSoonPercent]').inputValue()) !== '10') throw new Error('add form not at 10')
    await page.keyboard.press('Escape')
    // Brakes has 15% of its km left: OK at 10, Due soon at 20.
    await taskBtn(TK.edit, 'Brakes').click()
    const form = taskRow('Brakes').locator('form')
    if ((await form.locator('input[name=dueSoonPercent]').inputValue()) !== '10') throw new Error('edit form not at the stored 10')
    let sent = 0
    const count = (r) => r.method() === 'PUT' && sent++
    page.on('request', count)
    // Criteria 9 and 10: each blocked on the client with its own message on its own field.
    const cases = [['dueSoonPercent', '0', msg.pct], ['dueSoonPercent', '51', msg.pct], ['dueSoonPercent', '2.5', msg.pct], ['intervalKm', '1000001', msg.km],
      ['intervalTime', '21', msg.time, 'years'], ['intervalTime', '244', msg.time, 'months'], ['intervalTime', '7301', msg.time, 'days']]
    for (const [name, value, text, unit] of cases) {
      if (unit) await form.locator('select[name=intervalUnit]').selectOption(unit)
      const input = form.locator(`input[name=${name}]`)
      await input.fill(value)
      await form.locator('button:not(.link)').click()
      const shown = await input.evaluate((el) => el.validationMessage)
      if (plain(shown) !== text) throw new Error(`${name} ${value}: "${shown}"`)
      await input.fill({ dueSoonPercent: '10', intervalKm: '10000', intervalTime: '' }[name])
    }
    await page.waitForTimeout(300)
    page.off('request', count)
    if (sent) throw new Error(`${sent} PUT sent for blocked values`)
    await form.locator('input[name=dueSoonPercent]').fill('20')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await form.locator('button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.dueSoonPercent !== 20) throw new Error(`PUT body ${JSON.stringify(body)}`)
    await badgeIs('Brakes', ST.DueSoon)
    await taskBtn(TK.edit, 'Brakes').click()
    if ((await form.locator('input[name=dueSoonPercent]').inputValue()) !== '20') throw new Error('edit form not at the stored 20')
    await page.keyboard.press('Escape')
  })
  // MVP2-C: Mark done and Undo, at 390px wide in both setups. The odometer is at 59,000.
  const RS = he
    ? { done: 'סימון כבוצע: ', cost: 'הוספת עלות או הערות: ', marked: 'סומן כבוצע.', service: 'טיפול', generic: 'משהו השתבש. נסו שוב.', costMsg: 'הזינו עלות בין 0 ל־1,000,000, עם עד 2 ספרות אחרי הנקודה.', oilLeft: 'עוד 10,000 ק״מ', oilLate: 'באיחור של 1,000 ק״מ', oilAt: 'ב־48,000 ק״מ' }
    : { done: 'Mark done: ', cost: 'Add cost or notes: ', marked: 'Marked as done.', service: 'Service', generic: 'Something went wrong. Please try again.', costMsg: 'Enter a cost from 0 to 1,000,000 with up to 2 decimals.', oilLeft: '10,000 km left', oilLate: 'Overdue by 1,000 km', oilAt: 'at 48,000 km' }
  const localDate = () => page.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const histDay = (offset) => page.evaluate((o) => new Date(Date.now() + o * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), offset)
  const serviceRows = () => page.locator('.history li').filter({ hasText: RS.service })
  const isReset = (r) => r.method() === 'POST' && r.url().endsWith('/reset')
  const forget500 = () => {
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('500 ')) // the forced failure
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('500'))
  }
  await step('reset-task', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    if (await taskRow(TK.belt).locator('button.done').count()) throw new Error('Mark done on a disabled task')
    if (await taskBtn(RS.cost, TK.belt).count()) throw new Error('Add cost or notes on a disabled task')
    // A failed reset: the translated error on the row, the rows kept, focus back on Mark done.
    await page.route('**/reset', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await taskBtn(RS.done, 'Oil').click()
    const alert = await taskRow('Oil').locator('[role=alert]').textContent()
    if (alert !== RS.generic) throw new Error(`reset error "${alert}"`)
    await focusIs(`button[aria-label="${RS.done}Oil"]`, 'after a failed reset')
    if ((await taskNames()).length !== 6) throw new Error(`rows after a failed reset: ${await taskNames()}`)
    forget500()
    // Criterion 14: a double tap while the first request is held makes one reset.
    let posts = 0
    const count = (r) => isReset(r) && posts++
    page.on('request', count)
    await page.route('**/reset', async (r) => { await page.waitForTimeout(500); await r.continue() }, { times: 1 })
    const res = page.waitForResponse((r) => isReset(r.request()))
    await taskBtn(RS.done, 'Oil').click()
    if (!(await taskBtn(RS.done, 'Oil').isDisabled())) throw new Error('Mark done not disabled while saving')
    await taskBtn(RS.done, 'Oil').click({ force: true }).catch(() => {})
    const body = (await res).request().postDataJSON()
    if (body.date !== (await localDate())) throw new Error(`reset date ${body.date}`)
    await badgeIs('Oil', ST.Ok)
    await page.waitForTimeout(300)
    page.off('request', count)
    if (posts !== 1) throw new Error(`${posts} reset POSTs for a double tap`)
    // Criterion 10: OK with a full km left and an empty bar, re-sorted, Undo focused, a Service reading without Edit or Delete.
    const text = plain(await taskRow('Oil').textContent())
    if (!text.includes(RS.oilLeft)) throw new Error(`Oil "${text}"`)
    if ((await taskRow('Oil').getByRole('progressbar').getAttribute('aria-valuenow')) !== '0') throw new Error('bar not empty')
    const want = ['Coolant', 'Brakes', '9k service', '10k service', 'Oil', TK.belt]
    if ((await taskNames()).join() !== want.join()) throw new Error(`order ${await taskNames()}`)
    const bar = taskRow('Oil').getByRole('status')
    if (!plain(await bar.textContent()).startsWith(RS.marked)) throw new Error(`bar "${await bar.textContent()}"`)
    await focusIs('.tasks .undo button', 'after Mark done')
    // Focus moves to Undo in the same render as the bar, so Undo is described by the message too.
    const described = await page.evaluate(() => document.getElementById(document.activeElement.getAttribute('aria-describedby') ?? '')?.textContent)
    if (described !== RS.marked) throw new Error(`Undo described by "${described}"`)
    await serviceRows().first().waitFor()
    if (!digitsOnly(await serviceRows().first().locator('.value').textContent()).startsWith('59000')) throw new Error('Service reading value')
    if (await serviceRows().locator('button').count()) throw new Error('Service reading has Edit or Delete')
    await noOverflow('the Undo bar')
    await sweep('car page with the Undo bar')
  })
  await step('undo-reset', async () => {
    // A failed undo keeps the bar, shows the error on the row, and focus stays on Undo.
    await page.route('**/void', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await taskRow('Oil').locator('.undo button').click()
    const alert = await taskRow('Oil').locator('[role=alert]').textContent()
    if (alert !== RS.generic) throw new Error(`undo error "${alert}"`)
    if (!(await taskRow('Oil').locator('.undo').isVisible())) throw new Error('bar gone after a failed undo')
    await focusIs('.tasks .undo button', 'after a failed undo')
    forget500()
    await taskRow('Oil').locator('.undo button').click()
    await badgeIs('Oil', ST.Overdue)
    const text = plain(await taskRow('Oil').textContent())
    if (!text.includes(RS.oilLate) || !text.includes(RS.oilAt)) throw new Error(`Oil "${text}"`)
    if ((await taskNames())[0] !== 'Oil') throw new Error(`order ${await taskNames()}`)
    if (await tasks.locator('.undo').count()) throw new Error('bar still shown')
    await focusIs(`button[aria-label="${RS.done}Oil"]`, 'after Undo')
    await serviceRows().first().waitFor({ state: 'detached' })
  })
  await step('reset-with-cost', async () => {
    const opener = `button[aria-label="${RS.cost}Brakes"]`
    const form = taskRow('Brakes').locator('form')
    // Escape and Cancel close the form with focus back on its opener.
    await taskBtn(RS.cost, 'Brakes').click()
    await focusIs('form input[name=cost]', 'cost form open')
    await page.keyboard.press('Escape')
    await form.waitFor({ state: 'detached' })
    await focusIs(opener, 'after Escape')
    await taskBtn(RS.cost, 'Brakes').click()
    await form.locator('button.link').click()
    await focusIs(opener, 'after Cancel')
    await taskBtn(RS.cost, 'Brakes').click()
    const label = plain(await form.locator('label').first().textContent())
    if (!label.includes(registered.user.currency)) throw new Error(`cost label "${label}"`)
    await noOverflow('the cost form open')
    await sweep('car page with the cost form open')
    // Blocked on the client with the message on the field.
    let posts = 0
    const count = (r) => isReset(r) && posts++
    page.on('request', count)
    for (const v of ['-1', '1000000.01', '1.234']) {
      await form.locator('input[name=cost]').fill(v)
      await form.locator('button:not(.link)').click()
      const shown = await form.locator('input[name=cost]').evaluate((el) => el.validationMessage)
      if (plain(shown) !== RS.costMsg) throw new Error(`cost ${v}: "${shown}"`)
    }
    await page.waitForTimeout(300)
    page.off('request', count)
    if (posts) throw new Error(`${posts} reset POSTs for blocked costs`)
    await form.locator('input[name=cost]').fill('120.50')
    await form.locator('textarea[name=notes]').fill('  Castrol 5W-30 ')
    // A failed reset keeps the form, shows the error, and puts focus back on the form's Mark done.
    await page.route('**/reset', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await form.locator('button:not(.link)').click()
    const failed = await form.locator('[role=alert]').textContent()
    if (failed !== RS.generic) throw new Error(`cost form error "${failed}"`)
    await focusIs('.tasks form button:not(.link)', 'after a failed reset from the form')
    forget500()
    const res = page.waitForResponse((r) => isReset(r.request()))
    await form.locator('button:not(.link)').click()
    const r = await res
    const body = r.request().postDataJSON()
    if (r.status() !== 201 || body.cost !== 120.5 || body.notes !== '  Castrol 5W-30 ' || body.date !== (await localDate())) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    const saved = await r.json()
    if (!saved.serviceRecordId || saved.task.lastDoneOdometerKm !== 59000 || saved.task.status !== 'Ok') throw new Error(`response ${JSON.stringify(saved)}`)
    await badgeIs('Brakes', ST.Ok)
    await focusIs('.tasks .undo button', 'after Mark done from the form')
    // Criterion 12: any other action in the section removes the bar without undoing.
    await taskBtn(TK.edit, '9k service').click()
    await page.keyboard.press('Escape')
    if (await tasks.locator('.undo').count()) throw new Error('bar still shown after Edit')
    await page.waitForTimeout(300)
    await badgeIs('Brakes', ST.Ok)
    if ((await serviceRows().count()) !== 1) throw new Error(`${await serviceRows().count()} Service readings`)
  })
  await step('toggle-clears-undo', async () => {
    // With the Undo bar showing, the first tap on another task's Enabled both removes the bar and toggles.
    await taskBtn(RS.done, '9k service').click()
    await focusIs('.tasks .undo button', 'after Mark done')
    const res = page.waitForResponse((r) => r.request().method() === 'PUT')
    await tasks.getByRole('checkbox', { name: TK.on + '10k service' }).uncheck()
    if ((await res).request().postDataJSON().isEnabled !== false) throw new Error('PUT did not disable')
    await taskRow('10k service').locator('.badge', { hasText: TK.off }).waitFor()
    if (await tasks.locator('.undo').count()) throw new Error('bar still shown after the toggle')
    await tasks.getByRole('checkbox', { name: TK.on + '10k service' }).check()
    await taskRow('10k service').locator('.badge', { hasText: TK.off }).waitFor({ state: 'detached' })
  })
  await step('tasks-reload-error-keeps-rows', async () => {
    // Low 1: a reset reloads the car and then the tasks; that reload fails, and the rows stay with the error above them.
    await page.route('**/api/vehicles/*/tasks', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    const failed = page.waitForResponse((r) => r.url().endsWith('/tasks') && r.status() === 500)
    await taskBtn(RS.done, 'Coolant').click()
    await failed
    const alert = tasks.locator(':scope > p.error[role=alert]')
    await alert.waitFor()
    await page.unroute('**/api/vehicles/*/tasks')
    if ((await alert.textContent()) !== RS.generic) throw new Error(`alert "${await alert.textContent()}"`)
    if ((await taskNames()).length !== 6) throw new Error(`rows ${await taskNames()}`)
    const above = await alert.evaluate((p) => !!(p.compareDocumentPosition(p.parentElement.querySelector('.tasks')) & Node.DOCUMENT_POSITION_FOLLOWING))
    if (!above) throw new Error('error not above the rows')
    await badgeIs('Coolant', ST.Ok)
    forget500()
    await page.reload()
    await taskRow('Coolant').waitFor()
    await page.setViewportSize(s.viewport)
  })
  // MVP3-A at 390px. The odometer is at 59,000; Coolant, 9k service and Brakes (120.50, notes) were marked done today.
  const odometerIs = (v) => page.waitForFunction((v) => document.querySelector('.odometer')?.getAttribute('aria-label')?.replace(/\D/g, '') === v, v, { timeout: 5000 })
  const formValues = () => recordForm.evaluate((f) => [...new FormData(f)].map(([k, v]) => [k, String(v)]))
  let garageId
  await step('record-service', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { window.noReload = true })
    // The resets are listed newest first; Brakes' shows DIY, its cost and its notes.
    await serviceItems().nth(2).waitFor()
    if ((await serviceItems().count()) !== 3) throw new Error(`${await serviceItems().count()} records`)
    const brakes = plain(await serviceItems().nth(2).textContent())
    for (const want of [SV.diy, 'Brakes', 'Castrol 5W-30', '120.50']) if (!brakes.includes(want)) throw new Error(`Brakes record lacks "${want}": "${brakes}"`)
    // A Mark done shows up at the top at once.
    await taskBtn(RS.done, '10k service').click()
    await page.waitForFunction(() => document.querySelectorAll('.services > li').length === 4)
    if (!plain(await serviceItems().first().textContent()).includes('10k service')) throw new Error('Mark done not at the top')
    // The form: today (and no later), the car's odometer, the currency, and a fieldset of the enabled tasks.
    await recordBtn.click()
    await focusIs('form input[name=date]', 'record form open')
    const today = await localDate()
    const date = recordForm.locator('input[name=date]')
    if ((await date.inputValue()) !== today || (await date.getAttribute('max')) !== today) throw new Error(`date ${await date.inputValue()}, max ${await date.getAttribute('max')}`)
    if ((await recordForm.locator('input[name=odometerKm]').inputValue()) !== '59000') throw new Error('odometer default')
    if (!plain(await recordForm.locator('label', { has: page.locator('input[name=totalCost]') }).textContent()).includes(registered.user.currency)) throw new Error('cost label')
    if ((await recordForm.locator('fieldset > legend').textContent()) !== SV.legend) throw new Error('no fieldset legend')
    const boxes = (await recordForm.locator('fieldset label').allTextContents()).map(plain)
    if (boxes.length !== 5 || boxes.includes(TK.belt)) throw new Error(`task boxes ${boxes}`)
    for (const label of await recordForm.locator('fieldset label').all()) await tall(label, `"${await label.textContent()}" checkbox row`)
    const shop = recordForm.locator('input[name=shopName]')
    if ((await page.locator(`#${await shop.getAttribute('aria-describedby')}`).textContent()) !== SV.hint) throw new Error('shop hint')
    noLatin(plain(await recordForm.locator('label:not(.inline)').allTextContents().then((l) => l.join())).replace(registered.user.currency, ''), 'form labels')
    await noOverflow('the record form open')
    await sweep('car page with the record form open')
    // Escape and Cancel close it with focus back on Record a service.
    await page.keyboard.press('Escape')
    await recordForm.waitFor({ state: 'detached' })
    await focusIs('section[aria-labelledby=service-history] button.add', 'after Escape')
    await recordBtn.click()
    await recordForm.locator(':scope > .actions button.link').click()
    await focusIs('section[aria-labelledby=service-history] button.add', 'after Cancel')
    await recordBtn.click()
    const longShop = 'Garage' + 'X'.repeat(94)
    const notes = 'Full service. ' + 'n'.repeat(300)
    await shop.fill(longShop)
    await recordForm.locator('input[name=odometerKm]').fill('59500')
    await recordForm.locator('input[name=totalCost]').fill('250.5')
    await recordForm.locator('textarea[name=notes]').fill(notes)
    await recordForm.getByRole('checkbox', { name: 'Oil', exact: true }).check()
    await recordForm.getByRole('checkbox', { name: 'Brakes', exact: true }).check()
    const typed = JSON.stringify(await formValues())
    // A failed save keeps the form and every value, with the error, and focus back on Save.
    await page.route('**/service-records', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await recordForm.locator('button:not(.link)').click()
    const alert = recordForm.locator('[role=alert]')
    await alert.waitFor()
    if ((await alert.textContent()) !== SV.generic) throw new Error(`save error "${await alert.textContent()}"`)
    await focusIs('section[aria-labelledby=service-history] form button:not(.link)', 'after a failed save')
    if (JSON.stringify(await formValues()) !== typed) throw new Error(`values lost: ${JSON.stringify(await formValues())}`)
    forget500()
    const res = page.waitForResponse((r) => isRecordPost(r.request()))
    await recordForm.locator('button:not(.link)').click()
    const r = await res
    const body = r.request().postDataJSON()
    if (r.status() !== 201 || body.date !== today || body.odometerKm !== 59500 || body.totalCost !== 250.5 || body.taskIds.length !== 2 || body.confirmCorrection !== false) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    garageId = (await r.json()).record.id
    await focusIs(`li[data-id="${garageId}"] button.edit-service`, 'after Save')
    const top = serviceItems().first()
    if ((await top.getAttribute('data-id')) !== garageId) throw new Error('new record not at the top')
    const text = plain(await top.textContent())
    for (const want of [longShop, '250.50', 'Oil', 'Brakes', '59,500', notes]) if (!text.includes(want)) throw new Error(`record lacks "${want.slice(0, 20)}"`)
    // Named by date, odometer and shop, so two services on one day differ.
    for (const [sel, of] of [['button.edit-service', SV.editOf], ['button.delete-service', SV.deleteOf]]) {
      const name = await top.locator(sel).getAttribute('aria-label')
      if (!name.startsWith(of) || !name.endsWith(` ${SV.at59500}, ${longShop}`)) throw new Error(`action name "${name}"`)
    }
    // Both tasks done at 59,500, and the odometer and its history follow, without a reload.
    await odometerIs('59500')
    await badgeIs('Oil', ST.Ok)
    for (const n of ['Oil', 'Brakes']) if (!plain(await taskRow(n).textContent()).includes(SV.at59500)) throw new Error(`${n}: ${plain(await taskRow(n).textContent())}`)
    const reading = plain(await page.locator('.history li').first().textContent())
    if (!reading.includes(RS.service) || !digitsOnly(reading).startsWith('59500')) throw new Error(`top reading "${reading}"`)
    await noOverflow('a long shop name and notes')
    await sweep('car page with service records')
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  let backdatedId
  await step('record-service-backdated', async () => {
    const day = (offset) => page.evaluate((o) => new Date(Date.now() + o * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), offset)
    await recordBtn.click()
    const date = recordForm.locator('input[name=date]')
    const save = recordForm.locator('button:not(.link)')
    // A future date is blocked by the field, before any request.
    let posts = 0
    const count = (r) => isRecordPost(r) && posts++
    page.on('request', count)
    await date.fill(await day(1))
    await save.click()
    if (!(await date.evaluate((el) => el.validity.rangeOverflow))) throw new Error('future date not blocked')
    // LOW-1 L7: the field's message is translated, as the odometer's is.
    if ((await date.evaluate((el) => el.validationMessage)) !== SV.future) throw new Error(`date message "${await date.evaluate((el) => el.validationMessage)}"`)
    await page.waitForTimeout(300)
    page.off('request', count)
    if (posts) throw new Error(`${posts} POSTs for a future date`)
    // If the server rejects one anyway (a device clock ahead), the error is translated and tied to the date.
    await date.fill(await day(0))
    await page.route('**/service-records', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.futureDate' }) }), { times: 1 })
    await save.click()
    const alert = recordForm.locator('[role=alert]')
    await alert.waitFor()
    if ((await alert.textContent()) !== SV.future) throw new Error(`future error "${await alert.textContent()}"`)
    if ((await date.getAttribute('aria-describedby')) !== (await alert.getAttribute('id'))) throw new Error('error not tied to the date')
    // 70,000 a month ago is above the reading after it: the error names it, and the confirm box saves it.
    await date.fill(await day(-30))
    const odo = recordForm.locator('input[name=odometerKm]')
    await odo.fill('70000')
    await recordForm.getByRole('checkbox', { name: 'Coolant', exact: true }).check()
    let res = page.waitForResponse((r) => isRecordPost(r.request()))
    await save.click()
    const problem = await (await res).json()
    if (problem.code !== 'odometer.higherThanNext') throw new Error(`got ${JSON.stringify(problem)}`)
    await alert.filter({ hasText: problem.nextKm.toLocaleString('en') }).waitFor()
    const msg = plain(await alert.textContent())
    if (!msg.includes(`${problem.nextKm.toLocaleString('en')} ${SV.km}`)) throw new Error(`order error "${msg}"`)
    noLatin(msg, 'order error')
    if ((await odo.getAttribute('aria-invalid')) !== 'true') throw new Error('error not tied to the odometer')
    // MVP3-B criterion 11: the error and its confirm box sit right under the odometer field and stay tied to it, here and on desktop.
    if (!(await odo.getAttribute('aria-describedby')).split(' ').includes(await alert.getAttribute('id'))) throw new Error('order error not in the odometer\'s aria-describedby')
    const confirmBox = recordForm.locator(':scope > label.inline')
    await confirmBox.waitFor()
    const underOdometer = async (what) => {
      if ((await odo.evaluate((el) => el.closest('label').nextElementSibling?.getAttribute('role'))) !== 'alert') throw new Error(`${what}: the error doesn't follow the odometer field`)
      const [field, err, box] = await Promise.all([odo, alert, confirmBox].map((l) => l.boundingBox()))
      const gap = err.y - (field.y + field.height)
      if (gap < 0 || gap > 40 || box.y < err.y + err.height - 1) throw new Error(`${what}: error ${gap}px under the odometer, box at ${box.y}`)
    }
    await underOdometer('390px')
    if (!he) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await underOdometer('desktop')
      await page.setViewportSize({ width: 390, height: 844 })
    }
    await recordForm.locator(':scope > label.inline input[type=checkbox]').check()
    res = page.waitForResponse((r) => isRecordPost(r.request()))
    await save.click()
    const r = await res
    if (r.status() !== 201 || r.request().postDataJSON().confirmCorrection !== true) throw new Error(`${r.status()} ${r.request().postData()}`)
    backdatedId = (await r.json()).record.id
    // Older than the rest, it is listed last; Coolant keeps its later last done.
    await focusIs(`li[data-id="${backdatedId}"] button.edit-service`, 'after a backdated save')
    if ((await serviceItems().last().getAttribute('data-id')) !== backdatedId) throw new Error('backdated record not last')
    if (!plain(await taskRow('Coolant').textContent()).includes(SV.at59000)) throw new Error(`Coolant moved: ${plain(await taskRow('Coolant').textContent())}`)
    await odometerIs('59500')
    await noOverflow('the backdated record')
  })
  // MVP3-B at 390px: line items, Edit and Delete. So far: the garage record (59,500 today), the backdated one, and the resets.
  const carId = () => new URL(page.url()).pathname.split('/')[2]
  // Deletes a record as another tab would, through the API.
  const voidElsewhere = async (id) => {
    const token = await page.evaluate(() => localStorage.getItem('token'))
    const r = await page.request.post(`${BASE}/api/vehicles/${carId()}/service-records/${id}/void`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok()) throw new Error(`void elsewhere: ${r.status()}`)
  }
  // Drops one forced or expected failure (a service-records response with this status) from the report.
  const forgetExpected = (status) => {
    const i = run.badResponses.findIndex((r) => r.startsWith(`${status} `) && r.includes('/service-records'))
    if (i >= 0) run.badResponses.splice(i, 1)
    const j = run.consoleErrors.findIndex((e) => e.includes(`status of ${status}`))
    if (j >= 0) run.consoleErrors.splice(j, 1)
  }
  const itemRows = (form) => form.locator('fieldset.item')
  const itemInput = (form, i, n) => itemRows(form).nth(i).locator('input').nth(n)
  // Each row's first label is its description.
  const descSel = (i) => `section[aria-labelledby=service-history] form fieldset.item:nth-of-type(${i + 1}) > label:first-of-type input`
  const sumField = (form) => form.locator('input[readonly]')
  const costDigits = async (row) => digitsOnly(await row.locator(':scope > p').first().locator('bdi').textContent())
  const describedText = (btn) => btn.evaluate((b) => (b.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '(missing)').join(' | '))
  let itemsId
  await step('record-service-items', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await recordBtn.click()
    const addPart = recordForm.locator('button.add-part')
    const addLabour = recordForm.locator('.items > .actions button:not(.add-part)')
    await recordForm.locator('input[name=odometerKm]').fill('59500')
    await recordForm.locator('input[name=shopName]').fill('Garage Cohen')
    // Criterion 16: focus after Add and Remove (the next row, then the previous, then Add part).
    await addPart.click()
    await focusIs(descSel(0), 'after Add part')
    await addLabour.click()
    await focusIs(descSel(1), 'after Add labour')
    if ((await recordForm.locator('input[name=totalCost]').count()) || !(await sumField(recordForm).count())) throw new Error('total still typed with items')
    await addPart.click()
    await itemRows(recordForm).nth(2).locator('button').click()
    await focusIs(descSel(1), 'after removing the last row (the previous row)')
    await itemRows(recordForm).nth(0).locator('button').click()
    await focusIs(descSel(0), 'after removing row 1 (the next row)')
    await itemRows(recordForm).nth(0).locator('button').click()
    await focusIs('section[aria-labelledby=service-history] form button.add-part', 'after removing the only row')
    if (!(await recordForm.locator('input[name=totalCost]').count())) throw new Error('total not typed again without items')
    // The items block is a group named "Parts and labour".
    if ((await recordForm.locator('.items[role=group]').getAttribute('aria-label')) !== SV.items) throw new Error('items group name')
    // An item error stays on the row it was about when an earlier row is removed, and goes with that row.
    for (const n of [0, 1, 2]) { await addPart.click(); await itemInput(recordForm, n, 0).fill(`Part ${n + 1}`); await itemInput(recordForm, n, 4).fill('10') }
    await page.route('**/service-records', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceItem.invalidQuantity', index: 1 }) }), { times: 1 })
    await recordForm.locator('button:not(.link)').click()
    await itemRows(recordForm).nth(1).locator('[role=alert]').waitFor()
    forgetExpected(400)
    await itemRows(recordForm).nth(0).locator('button').click()
    const stayed = itemRows(recordForm).nth(0)
    // It names the row by its number now (Item 1), not the one sent (Item 2).
    if (plain(await stayed.locator('[role=alert]').textContent()) !== SV.item2Qty.replace('2', '1')) throw new Error(`renumbered item error "${await stayed.locator('[role=alert]').textContent()}"`)
    if ((await itemInput(recordForm, 0, 0).inputValue()) !== 'Part 2' || (await stayed.locator('[role=alert]').count()) !== 1 || (await recordForm.locator('[role=alert]').count()) !== 1) throw new Error('item error moved off its row')
    if ((await itemInput(recordForm, 0, 3).getAttribute('aria-describedby')) !== (await stayed.locator('[role=alert]').getAttribute('id'))) throw new Error('item error not tied to its row after a removal')
    await stayed.locator('button').click()
    if ((await recordForm.locator('[role=alert]').count()) || (await recordForm.locator('[aria-invalid]').count())) throw new Error('item error outlived its row')
    await itemRows(recordForm).nth(0).locator('button').click()
    // Criterion 5: a part and a labour row, with the live total while typing.
    const longDesc = 'Oil filter ' + 'Y'.repeat(89)
    const longPart = 'W712/75-' + 'X'.repeat(42)
    await addPart.click()
    for (const [n, v] of [[0, longDesc], [1, 'Mann'], [2, longPart], [3, '2'], [4, '45.5']]) await itemInput(recordForm, 0, n).fill(v)
    if (digitsOnly(await sumField(recordForm).inputValue()) !== '9100') throw new Error(`live total ${await sumField(recordForm).inputValue()}`)
    await addLabour.click()
    for (const [n, v] of [[0, 'Labour'], [1, '1.5'], [2, '200']]) await itemInput(recordForm, 1, n).fill(v)
    if (digitsOnly(await sumField(recordForm).inputValue()) !== '39100') throw new Error(`live total ${await sumField(recordForm).inputValue()}`)
    // A labour row has no brand or part number; every field is named with its row.
    if ((await itemRows(recordForm).nth(1).locator('input').count()) !== 3) throw new Error('labour row fields')
    if (plain(await itemInput(recordForm, 1, 1).getAttribute('aria-label')) !== SV.item2Hours) throw new Error(`hours name "${await itemInput(recordForm, 1, 1).getAttribute('aria-label')}"`)
    if (plain(await itemInput(recordForm, 0, 2).getAttribute('aria-label')) !== SV.item1Part) throw new Error('part number name')
    if (!plain(await itemRows(recordForm).nth(1).locator('legend').textContent()).includes(SV.labour)) throw new Error('labour legend')
    noLatin(plain((await recordForm.locator('fieldset.item label').allTextContents()).join()).replace(new RegExp(registered.user.currency, 'g'), ''), 'item labels')
    await noOverflow('item rows with a long description and part number')
    await sweep('the record form with item rows')
    // Criterion 10: an item error from the server shows on its row, naming it; every typed value stays.
    const itemValues = () => itemRows(recordForm).evaluateAll((fs) => fs.map((f) => [...f.querySelectorAll('input')].map((i) => i.value)))
    const typed = JSON.stringify([await itemValues(), await formValues()])
    await page.route('**/service-records', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceItem.invalidQuantity', index: 1 }) }), { times: 1 })
    const save = recordForm.locator('button:not(.link)')
    await save.click()
    const itemAlert = itemRows(recordForm).nth(1).locator('[role=alert]')
    await itemAlert.waitFor()
    if (plain(await itemAlert.textContent()) !== SV.item2Qty) throw new Error(`item error "${await itemAlert.textContent()}"`)
    const hours = itemInput(recordForm, 1, 1)
    if ((await hours.getAttribute('aria-invalid')) !== 'true' || (await hours.getAttribute('aria-describedby')) !== (await itemAlert.getAttribute('id'))) throw new Error('item error not tied to its field')
    if ((await recordForm.locator('[role=alert]').count()) !== 1) throw new Error('the item error is shown twice')
    if (JSON.stringify([await itemValues(), await formValues()]) !== typed) throw new Error('values lost')
    forgetExpected(400)
    const res = page.waitForResponse((r) => isRecordPost(r.request()))
    await save.click()
    const r = await res
    const body = r.request().postDataJSON()
    const rec = (await r.json()).record
    if (r.status() !== 201 || body.items.length !== 2 || !body.items[1].isLabor || rec.items[1].partNumber !== null || body.totalCost !== null || rec.totalCost !== 391) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    itemsId = rec.id
    await focusIs(`li[data-id="${itemsId}"] button.edit-service`, 'after saving with items')
    // The row shows both items and the total in the user's currency, without a reload.
    const row = services.locator(`li[data-id="${itemsId}"]`)
    const lines = row.locator('.service-items li')
    if ((await lines.count()) !== 2) throw new Error(`${await lines.count()} item lines`)
    const part = plain(await lines.nth(0).textContent())
    for (const want of [longDesc, 'Mann', longPart]) if (!part.includes(want)) throw new Error(`part line lacks "${want.slice(0, 12)}"`)
    const partAmount = await lines.nth(0).locator('.amount').textContent()
    if (digitsOnly(partAmount) !== '24550') throw new Error(`part amount ${partAmount}`)
    if (digitsOnly(await lines.nth(1).locator('.amount').textContent()) !== '1520000' || (await lines.nth(1).locator('.badge').textContent()) !== SV.labour) throw new Error(`labour line ${plain(await lines.nth(1).textContent())}`)
    const sign = new Intl.NumberFormat(s.lng, { style: 'currency', currency: registered.user.currency }).formatToParts(1).find((p) => p.type === 'currency').value
    if (!partAmount.includes(sign)) throw new Error(`amount "${partAmount}" without "${sign}"`)
    if ((await costDigits(row)) !== '39100') throw new Error(`total ${await costDigits(row)}`)
    await noOverflow('a history row with long items')
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('edit-service', async () => {
    const row = services.locator(`li[data-id="${itemsId}"]`)
    const form = row.locator('form')
    const editBtn = `li[data-id="${itemsId}"] button.edit-service`
    // Criterion 12: same date and odometer, different shops, different names; each action described by its row's cost and tasks.
    const names = await services.locator(`li[data-id="${itemsId}"] .actions button, li[data-id="${garageId}"] .actions button`).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
    if (names.length !== 4 || new Set(names).size !== 4) throw new Error(`names ${JSON.stringify(names)}`)
    for (const b of await services.locator('.services > li .actions button').all()) {
      const described = await describedText(b)
      if (!described || described.includes('(missing)')) throw new Error(`"${await b.getAttribute('aria-label')}" described by "${described}"`)
    }
    const garageDesc = plain(await describedText(services.locator(`li[data-id="${garageId}"] button.delete-service`)))
    if (!garageDesc.includes('250.50') || !garageDesc.includes('Oil') || !digitsOnly(await describedText(row.locator('button.edit-service'))).includes('39100')) throw new Error(`described by "${garageDesc}"`)
    // Criterion 6 (MVP3-D: the date, odometer and tasks are fields now, without the old hint).
    await row.locator('button.edit-service').click()
    await focusIs(`li[data-id="${itemsId}"] form input[name=date]`, 'Edit open')
    if ((await form.locator('input[name=date]').inputValue()) !== (await localDate()) || (await form.locator('input[name=odometerKm]').inputValue()) !== '59500') throw new Error('date or odometer not filled in')
    await form.locator('input[name=taskIds]').first().waitFor() // the tasks load on their own
    if (plain(await form.textContent()).includes(SV.editHint)) throw new Error('old hint still shown')
    if ((await form.locator('input[name=shopName]').inputValue()) !== 'Garage Cohen' || (await itemRows(form).count()) !== 2 || (await itemInput(form, 0, 3).inputValue()) !== '2') throw new Error('edit form not filled in')
    await noOverflow('the edit form')
    await sweep('the edit form open')
    // Escape and Cancel discard the changes, with focus back on the row's Edit.
    await form.locator('input[name=shopName]').fill('Changed')
    await page.keyboard.press('Escape')
    await focusIs(editBtn, 'after Escape on Edit')
    await row.locator('button.edit-service').click()
    if ((await form.locator('input[name=shopName]').inputValue()) !== 'Garage Cohen') throw new Error('Escape kept the change')
    await itemRows(form).nth(0).locator('button').click()
    await form.locator(':scope > .actions button.link').click()
    await focusIs(editBtn, 'after Cancel on Edit')
    if ((await row.locator('.service-items li').count()) !== 2) throw new Error('Cancel kept the removed item')
    // Save updates the row in place: shop, notes, items and the recomputed total.
    await row.locator('button.edit-service').click()
    await form.locator('input[name=shopName]').fill('Cohen and Sons')
    await form.locator('textarea[name=notes]').fill('Filter swapped')
    await itemInput(form, 0, 3).fill('3')
    if (digitsOnly(await sumField(form).inputValue()) !== '43650') throw new Error(`live total ${await sumField(form).inputValue()}`)
    const isPut = (r) => r.request().method() === 'PUT'
    let put = page.waitForResponse(isPut)
    await form.locator('button:not(.link)').click()
    let pr = await put
    if (pr.status() !== 200 || pr.request().postDataJSON().items.length !== 2) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after saving the edit')
    const after = plain(await row.textContent())
    for (const want of ['Cohen and Sons', 'Filter swapped']) if (!after.includes(want)) throw new Error(`row lacks "${want}"`)
    if ((await costDigits(row)) !== '43650') throw new Error(`total ${await costDigits(row)}`)
    // Criterion 7: removing every item makes the total typed again, and the typed total is saved.
    await row.locator('button.edit-service').click()
    await itemRows(form).nth(0).locator('button').click()
    await itemRows(form).nth(0).locator('button').click()
    await form.locator('input[name=totalCost]').fill('80')
    put = page.waitForResponse(isPut)
    await form.locator('button:not(.link)').click()
    pr = await put
    if (pr.status() !== 200 || pr.request().postDataJSON().items.length !== 0 || pr.request().postDataJSON().totalCost !== 80 || (await pr.json()).record.totalCost !== 80) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after saving without items')
    if ((await costDigits(row)) !== '8000' || (await row.locator('.service-items').count())) throw new Error('row not updated to 80 without items')
    // QA Low 3: a (mocked) gone on Save whose record still comes back closes the edit form under the note.
    await row.locator('button.edit-service').click()
    await page.route('**/service-records/*', (r) => (r.request().method() === 'PUT'
      ? r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.notFound' }) }) : r.fallback()), { times: 1 })
    await form.locator('button:not(.link)').click()
    await services.locator('p[role=status]', { hasText: SV.gone }).waitFor()
    await row.locator('button.edit-service').waitFor()
    if (await row.locator('form').count()) throw new Error('edit form stayed open under the gone note')
    forgetExpected(404)
    // Criterion 9 (Edit): deleted in another tab, then saved here; the history reloads with the note and the row drops.
    await row.locator('button.edit-service').click()
    await voidElsewhere(itemsId)
    await form.locator('input[name=shopName]').fill('Too late')
    await form.locator('button:not(.link)').click()
    await services.locator('p[role=status]', { hasText: SV.gone }).waitFor()
    await row.waitFor({ state: 'detached' })
    if (await services.locator('.error').count()) throw new Error('an error shown with the note')
    await focusIs('#service-history', 'after editing a deleted record')
    forgetExpected(409)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('delete-service', async () => {
    const row = services.locator(`li[data-id="${garageId}"]`)
    const del = `li[data-id="${garageId}"] button.delete-service`
    // A confirm step: Cancel focused, Escape back to Delete.
    await row.locator('button.delete-service').click()
    await focusIs(`li[data-id="${garageId}"] .inline-form button.link`, 'Delete confirm open')
    const confirm = row.locator('button.danger')
    await tall(confirm, 'confirm Delete')
    await noOverflow('the Delete confirm open')
    await page.keyboard.press('Escape')
    await focusIs(del, 'after Escape on the Delete confirm')
    // A failed delete keeps the row, with the error on it and focus back on the confirm button.
    await row.locator('button.delete-service').click()
    await page.route('**/void', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await confirm.click()
    await row.locator('[role=alert]').waitFor()
    if ((await row.locator('[role=alert]').textContent()) !== SV.generic) throw new Error('delete error')
    await focusIs(`li[data-id="${garageId}"] button.danger`, 'after a failed delete')
    forget500()
    await confirm.click()
    await row.waitFor({ state: 'detached' })
    await focusIs('.services > li:first-child button.delete-service', 'after Delete (the next older row)')
    // Oil and Brakes go back, and so do the odometer and its history, without a reload.
    await odometerIs('59000')
    await badgeIs('Oil', ST.Overdue)
    if (!plain(await taskRow('Brakes').textContent()).includes(SV.at59000)) throw new Error('Brakes not back')
    if (digitsOnly(await page.locator('.history li .value').first().textContent()).startsWith('59500')) throw new Error('Service reading still shown')
    // Deleting the oldest row moves focus to the newest.
    await services.locator(`li[data-id="${backdatedId}"] button.delete-service`).click()
    await services.locator(`li[data-id="${backdatedId}"] button.danger`).click()
    await services.locator(`li[data-id="${backdatedId}"]`).waitFor({ state: 'detached' })
    await focusIs('.services > li:first-child button.delete-service', 'after deleting the oldest row')
    // MVP3-A review 1: deleting a Mark done from the history also ends its Undo bar in the tasks (it would answer 409).
    const reset = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/reset'))
    await tasks.locator(`button[aria-label="${RS.done}Oil"]`).click()
    const resetId = (await (await reset).json()).serviceRecordId
    await taskRow('Oil').locator('.undo').waitFor()
    await services.locator(`li[data-id="${resetId}"] button.delete-service`).click()
    await services.locator(`li[data-id="${resetId}"] button.danger`).click()
    await services.locator(`li[data-id="${resetId}"]`).waitFor({ state: 'detached' })
    if (await tasks.locator('.undo').count()) throw new Error('tasks Undo bar outlived the history Delete')
    // Criterion 9 (Delete): deleted in another tab; the (mocked) 404 reloads the history with the note and the row drops.
    const topId = await serviceItems().first().getAttribute('data-id')
    const top = services.locator(`li[data-id="${topId}"]`)
    await top.locator('button.delete-service').click()
    await voidElsewhere(topId)
    await page.route('**/void', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.notFound' }) }), { times: 1 })
    await top.locator('button.danger').click()
    await services.locator('p[role=status]', { hasText: SV.gone }).waitFor()
    await top.waitFor({ state: 'detached' })
    if (await services.locator('.error').count()) throw new Error('an error shown with the note')
    forgetExpected(404)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
    await page.setViewportSize(s.viewport)
  })
  // MVP3-D at 390px: edit a service's date, odometer and tasks. Each step records its own service and deletes it after, so the car ends as it was.
  const atKm = (km) => (he ? `ב־${km.toLocaleString('en')} ק״מ` : `at ${km.toLocaleString('en')} km`)
  const recordAt = async (km, task) => {
    await recordBtn.click()
    await recordForm.locator('input[name=odometerKm]').fill(String(km))
    await recordForm.getByRole('checkbox', { name: task, exact: true }).check()
    const res = page.waitForResponse((r) => isRecordPost(r.request()))
    await recordForm.locator('button:not(.link)').click()
    const id = (await (await res).json()).record.id
    await focusIs(`li[data-id="${id}"] button.edit-service`, 'after recording')
    return id
  }
  const isEditPut = (r) => r.request().method() === 'PUT' && r.url().includes('/service-records/')
  await step('edit-service-date-odometer', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const day = (offset) => page.evaluate((o) => new Date(Date.now() + o * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), offset)
    const cur = Number(digitsOnly(await odometer()))
    const id = await recordAt(cur + 1000, 'Brakes')
    await odometerIs(String(cur + 1000))
    const row = services.locator(`li[data-id="${id}"]`)
    const form = row.locator('form')
    const editBtn = `li[data-id="${id}"] button.edit-service`
    const date = form.locator('input[name=date]')
    const odo = form.locator('input[name=odometerKm]')
    const save = form.locator(':scope > .actions button:not(.link)')
    await row.locator('button.edit-service').click()
    await focusIs(`li[data-id="${id}"] form input[name=date]`, 'Edit open')
    // LOW-1 L9: Record a service is hidden while a row's Edit form is open.
    await recordBtn.waitFor({ state: 'detached', timeout: 2000 }).catch(() => { throw new Error('Record a service shown during Edit') })
    if ((await date.inputValue()) !== (await day(0)) || (await odo.inputValue()) !== String(cur + 1000)) throw new Error('not filled in')
    await form.locator('input[name=taskIds]').first().waitFor()
    if (!(await form.getByRole('checkbox', { name: 'Brakes', exact: true }).isChecked()) || (await form.getByRole('checkbox', { name: 'Oil', exact: true }).isChecked())) throw new Error('task boxes not as linked')
    await noOverflow('the edit form with date, odometer and tasks')
    for (const input of [date, odo]) await tall(input, `${await input.getAttribute('name')} field`)
    // Criterion 7: a future date and an out-of-range odometer are blocked on the field, before any request.
    let puts = 0
    const count = (r) => r.method() === 'PUT' && r.url().includes('/service-records/') && puts++
    page.on('request', count)
    await date.fill(await day(1))
    await save.click()
    if (!(await date.evaluate((el) => el.validity.rangeOverflow))) throw new Error('future date not blocked')
    // LOW-1 L7: the field's message is translated, as the odometer's is.
    if ((await date.evaluate((el) => el.validationMessage)) !== SV.future) throw new Error(`date message "${await date.evaluate((el) => el.validationMessage)}"`)
    await date.fill(await day(0))
    await odo.fill('20000000')
    await save.click()
    if (!(await odo.evaluate((el) => el.validity.rangeOverflow))) throw new Error('odometer not blocked')
    await page.waitForTimeout(300)
    page.off('request', count)
    if (puts) throw new Error(`${puts} PUTs for invalid values`)
    // Criterion 9: a failed save (mocked 500) keeps the form and the typed values, with the error.
    await odo.fill(String(cur + 800))
    await page.route('**/service-records/*', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.fallback()), { times: 1 })
    await save.click()
    await form.locator('[role=alert]').waitFor()
    if ((await form.locator('[role=alert]').textContent()) !== SV.generic || (await odo.inputValue()) !== String(cur + 800)) throw new Error('500 lost the form or its error')
    forgetExpected(500)
    // Criterion 5: the odometer only; the row, the car's odometer and its history follow, focus back on Edit.
    let put = page.waitForResponse(isEditPut)
    await save.click()
    let pr = await put
    let body = pr.request().postDataJSON()
    if (pr.status() !== 200 || body.odometerKm !== cur + 800 || body.date !== (await day(0)) || body.taskIds.length !== 1) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after saving the odometer')
    await recordBtn.waitFor({ timeout: 2000 })
    await odometerIs(String(cur + 800))
    if (!digitsOnly(await row.locator('.value').textContent()).startsWith(String(cur + 800))) throw new Error('row odometer')
    if (!(await page.locator('.history li', { hasText: RS.service }).filter({ hasText: (cur + 800).toLocaleString('en') }).count())) throw new Error('Service reading not moved')
    // Criterion 6: a day earlier and above every reading of today, it breaks date order: the error and the correction box sit under the odometer field.
    await row.locator('button.edit-service').click()
    await date.fill(await day(-1))
    await odo.fill(String(cur + 20000))
    put = page.waitForResponse(isEditPut)
    await save.click()
    const problem = await (await put).json()
    if (problem.code !== 'odometer.higherThanNext') throw new Error(`got ${JSON.stringify(problem)}`)
    const alert = form.locator('[role=alert]')
    await alert.filter({ hasText: problem.nextKm.toLocaleString('en') }).waitFor()
    if ((await odo.evaluate((el) => el.closest('label').nextElementSibling?.getAttribute('role'))) !== 'alert') throw new Error('order error not under the odometer field')
    if (!(await odo.getAttribute('aria-describedby')).split(' ').includes(await alert.getAttribute('id'))) throw new Error('order error not tied to the odometer')
    noLatin(plain(await alert.textContent()), 'order error')
    forgetExpected(400)
    await noOverflow('the edit form with the order error')
    await form.locator(':scope > label.inline input[type=checkbox]').check()
    put = page.waitForResponse(isEditPut)
    await save.click()
    pr = await put
    body = pr.request().postDataJSON()
    if (pr.status() !== 200 || body.confirmCorrection !== true || body.date !== (await day(-1)) || body.odometerKm !== cur + 20000) throw new Error(`${pr.status()} ${pr.request().postData()}`)
    await focusIs(editBtn, 'after the confirmed correction')
    // Today's reading is the latest again, so the car's odometer falls back to it.
    await odometerIs(String(cur))
    if ((await row.locator('time').getAttribute('datetime')).slice(0, 10) !== (await day(-1))) throw new Error('row date')
    await voidElsewhere(id)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('edit-service-tasks', async () => {
    // Brakes' last done before this record (its remaining distance moves with the odometer, so only this part is compared).
    const lastAt = (name) => taskRow(name).textContent().then((t) => plain(t).match(he ? /ב־[\d,]+ ק״מ/ : /at [\d,]+ km/)?.[0])
    const before = await lastAt('Brakes')
    if (!before) throw new Error('Brakes has no last done')
    const cur = Number(digitsOnly(await odometer()))
    const id = await recordAt(cur + 1000, 'Brakes')
    if (!plain(await taskRow('Brakes').textContent()).includes(atKm(cur + 1000))) throw new Error('Brakes not done at the record')
    // Criterion 8: unticking Brakes makes it fall back; ticking Oil moves it to this, the most recent record.
    const row = services.locator(`li[data-id="${id}"]`)
    const form = row.locator('form')
    const editBtn = `li[data-id="${id}"] button.edit-service`
    // LOW-1 L9: Record a service comes back after Escape and Cancel, with focus on Edit (MVP1-C).
    await row.locator('button.edit-service').click()
    await form.locator('input[name=taskIds]').first().waitFor()
    await recordBtn.waitFor({ state: 'detached', timeout: 2000 }).catch(() => { throw new Error('Record a service shown during Edit') })
    await page.keyboard.press('Escape')
    await focusIs(editBtn, 'after Escape')
    await recordBtn.waitFor({ timeout: 2000 })
    await row.locator('button.edit-service').click()
    await form.locator(':scope > .actions button.link').click()
    await focusIs(editBtn, 'after Cancel')
    await recordBtn.waitFor({ timeout: 2000 })
    // LOW-1 L8: maintenanceTask.notFound (mocked: Oil was deleted meanwhile) reloads the tasks, keeping the form and its other input.
    await row.locator('button.edit-service').click()
    await form.getByRole('checkbox', { name: 'Brakes', exact: true }).uncheck()
    await form.getByRole('checkbox', { name: 'Oil', exact: true }).check()
    await form.locator('input[name=shopName]').fill('Kept shop')
    await page.route('**/service-records/*', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'maintenanceTask.notFound' }) }) : r.fallback()), { times: 1 })
    const reload = page.waitForRequest((q) => q.method() === 'GET' && q.url().endsWith(`/vehicles/${carId()}/tasks`))
    await page.route(`**/vehicles/${carId()}/tasks`, async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, json: (await res.json()).filter((x) => x.name !== 'Oil') }) }, { times: 2 })
    await form.locator(':scope > .actions button:not(.link)').click()
    await reload
    await form.getByRole('checkbox', { name: 'Oil', exact: true }).waitFor({ state: 'detached' })
    // LOW-2 L13: the Maintenance list drops it too, without a page reload.
    await taskRow('Oil').waitFor({ state: 'detached', timeout: 5000 }).catch(() => { throw new Error('the Maintenance list still shows the deleted task') })
    if ((await form.locator('[role=alert]').textContent()) !== SV.taskGone) throw new Error(`notFound error "${await form.locator('[role=alert]').textContent()}"`)
    if ((await form.locator('input[name=shopName]').inputValue()) !== 'Kept shop' || (await form.getByRole('checkbox', { name: 'Brakes', exact: true }).isChecked())) throw new Error('notFound lost the input')
    forgetExpected(404)
    await form.locator(':scope > .actions button.link').click()
    await focusIs(editBtn, 'after Cancel')
    await row.locator('button.edit-service').click()
    await form.getByRole('checkbox', { name: 'Brakes', exact: true }).uncheck()
    await form.getByRole('checkbox', { name: 'Oil', exact: true }).check()
    const put = page.waitForResponse(isEditPut)
    await form.locator(':scope > .actions button:not(.link)').click()
    const pr = await put
    const res = await pr.json()
    if (pr.status() !== 200 || pr.request().postDataJSON().taskIds.length !== 1 || res.record.tasks.map((x) => x.name).join() !== 'Oil') throw new Error(`${pr.status()} ${JSON.stringify(res.record)}`)
    await focusIs(`li[data-id="${id}"] button.edit-service`, 'after saving the tasks')
    await badgeIs('Oil', ST.Ok)
    await page.waitForFunction(([w]) => [...document.querySelectorAll('.tasks > li')].some((l) => l.textContent.replace(/[⁦-⁩]/g, '').includes(w)), [atKm(cur + 1000)])
    if (!plain(await taskRow('Oil').textContent()).includes(atKm(cur + 1000))) throw new Error(`Oil: ${plain(await taskRow('Oil').textContent())}`)
    if ((await lastAt('Brakes')) !== before) throw new Error(`Brakes did not fall back to ${before}: ${await lastAt('Brakes')}`)
    const tasksText = plain(await row.locator('p.muted').textContent())
    if (!tasksText.includes('Oil') || tasksText.includes('Brakes')) throw new Error(`row tasks "${tasksText}"`)
    await noOverflow('the edited tasks')
    await voidElsewhere(id)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
    await page.setViewportSize(s.viewport)
  })
  await step('other-users-car-not-found', async () => {
    // A second user's car, created through the API, must not be visible to this user.
    const auth = await page.request.post(`${BASE}/api/auth/register`, {
      data: { email: `other-${s.name}-${Date.now()}@onlycars.test`, password: 'Passw0rd!' },
    })
    const headers = { Authorization: `Bearer ${(await auth.json()).token}` }
    const car = await (await page.request.post(`${BASE}/api/vehicles`, { headers, data: { nickname: 'Not yours' } })).json()
    await page.goto(`${BASE}/cars/${car.id}`)
    const text = await page.locator('main .error').textContent()
    const expected = s.lng === 'he' ? 'הרכב לא נמצא.' : 'This car was not found.'
    if (text !== expected) throw new Error(`not-found text: "${text}"`)
    // The error is the h1 and the title (without the full stop), with the back link, on both car routes.
    for (const path of [`/cars/${car.id}`, '/cars/abc/edit']) {
      await page.goto(`${BASE}${path}`)
      const h1 = await page.locator('main h1').textContent()
      if (h1 !== expected) throw new Error(`${path} h1: "${h1}"`)
      await titleIs(expected.slice(0, -1))
      await page.locator('main > a.back').waitFor()
    }
  })
  await step('api-register-short-password', async () => {
    const res = await page.request.post(`${BASE}/api/auth/register`, {
      data: { email: `short-${s.name}-${Date.now()}@onlycars.test`, password: '1234567' },
    })
    const body = await res.json()
    if (res.status() !== 400 || body.code !== 'auth.passwordTooShort') throw new Error(`got ${res.status()} ${JSON.stringify(body)}`)
  })
  await step('edit-car', async () => {
    await page.click('main > a[href="/"]') // back from the not-found page via the detail page's link
    await page.locator('.cars > li').first().waitFor()
    await arrivedAt(T.dashboard)
    await page.click('a[href$="/edit"]')
    await page.locator('input[name=nickname]').waitFor()
    await arrivedAt(T.editCar)
    await page.fill('input[name=nickname]', 'Renamed Corolla')
    await page.click('form button:not(.link)')
    await page.getByRole('heading', { name: 'Renamed Corolla' }).waitFor()
    await arrivedAt(T.dashboard)
  })
  // SET-1: settings. Each setup forces the theme opposite to its OS one, at 390px wide.
  // The hint comes from i18n.ts (en first, then he), so copy edits don't break the step.
  const hints = [...readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8').matchAll(/currencyHint: (['"])(.*)\1,/g)].map((m) => m[2])
  const SE = he ? { settings: 'הגדרות', saved: 'נשמר', hint: hints[1] } : { settings: 'Settings', saved: 'Saved', hint: hints[0] }
  const osTheme = s.colorScheme === 'light' ? 'Light' : 'Dark'
  const forced = osTheme === 'Light' ? 'Dark' : 'Light'
  const BG = { Light: 'rgb(230, 233, 238)', Dark: 'rgb(17, 21, 28)' } // --bg
  const looks = () => page.evaluate(() => ({
    attr: document.documentElement.dataset.theme ?? null,
    bg: getComputedStyle(document.documentElement).backgroundColor,
    ink: getComputedStyle(document.body).color,
    surface: getComputedStyle(document.querySelector('.card') ?? document.body).backgroundColor,
  }))
  async function themeIs(theme, when) {
    const l = await looks()
    if (l.attr !== (theme === 'System' ? null : theme.toLowerCase()) || l.bg !== BG[theme === 'System' ? osTheme : theme]) throw new Error(`${when}: ${JSON.stringify(l)}`)
  }
  const radio = (name, v) => page.locator(`input[name=${name}][value=${v}]`)
  const putSettings = () => page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/api/me/settings'))
  const savedShown = () => page.locator('main [role=status]', { hasText: SE.saved }).waitFor({ timeout: 3000 })
  const dirIs = (d) => page.waitForFunction((d) => document.documentElement.dir === d, d, { timeout: 3000 })
  const openSettings = async () => {
    await page.click('header a[href="/settings"]')
    await radio('theme', 'System').waitFor()
    await arrivedAt(SE.settings)
  }
  await step('settings-theme', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSettings()
    if (!(await radio('theme', 'System').isChecked())) throw new Error('theme not System by default')
    let res = putSettings()
    await radio('theme', forced).click()
    const body = JSON.stringify((await res).request().postDataJSON())
    if (body !== JSON.stringify({ theme: forced })) throw new Error(`PUT body ${body}`)
    await savedShown()
    await themeIs(forced, `${forced} picked`)
    // Applied before the first render, so the reload never shows the OS theme.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await themeIs(forced, 'right after a reload')
    await page.screenshot({ path: `${OUT}/${s.name}-theme-right-after-reload.png` })
    await radio('theme', forced).waitFor()
    if (!(await radio('theme', forced).isChecked())) throw new Error(`${forced} not checked after a reload`)
    res = putSettings()
    await radio('theme', 'System').click()
    await res
    await themeIs('System', 'System picked')
    res = putSettings()
    await radio('theme', forced).click() // kept for the next steps and their screenshots
    await res
    const l = await looks()
    if (ratio(l.ink, l.surface) < 4.5) throw new Error(`${forced} text contrast ${ratio(l.ink, l.surface).toFixed(2)}:1`)
    if ((await page.locator('main fieldset > legend').count()) !== 3) throw new Error('radio groups without fieldset and legend')
    for (const label of await page.locator('main label').all()) await tall(label, `"${await label.textContent()}"`)
    await tall(page.locator('header a[href="/settings"]'), 'Settings link')
    await noOverflow(`settings at 390px, ${forced}`)
    await sweep('settings page')
  })
  await step('settings-language', async () => {
    const [own, other] = he ? ['He', 'En'] : ['En', 'He']
    const [ownDir, otherDir] = he ? ['rtl', 'ltr'] : ['ltr', 'rtl']
    let res = putSettings()
    await radio('locale', other).click()
    if ((await res).request().postDataJSON().locale !== other) throw new Error('settings radio did not save the language')
    await dirIs(otherDir)
    await page.locator('main h1', { hasText: he ? 'Settings' : 'הגדרות' }).waitFor()
    await noOverflow(`settings at 390px in the other language, ${forced}`)
    await sweep('settings page in the other language')
    // The header switch saves the language too.
    res = putSettings()
    await page.click('header nav button.link >> nth=0')
    if ((await res).request().postDataJSON().locale !== own) throw new Error('header switch did not save the language')
    await dirIs(ownDir)
    if (!(await radio('locale', own).isChecked())) throw new Error(`${own} not checked after the header switch`)
    // Signed out: no Settings link, /settings goes to the login page, and the switch saves nothing.
    await page.click('header nav button.link >> nth=1')
    await page.locator('input[name=email]').waitFor()
    if (await page.locator('header a[href="/settings"]').count()) throw new Error('Settings link while signed out')
    await page.goto(`${BASE}/settings`)
    await page.waitForURL('**/login')
    let puts = 0
    const count = (r) => r.method() === 'PUT' && puts++
    page.on('request', count)
    await page.click('header nav button.link >> nth=0')
    await dirIs(otherDir)
    page.off('request', count)
    if (puts) throw new Error('the signed-out switch sent a PUT')
    // Logging in applies the saved language and theme.
    await page.fill('input[name=email]', registered.user.email)
    await page.fill('input[name=password]', 'Passw0rd!')
    await page.click('form button:not(.link)')
    await page.locator('a[href="/cars/new"]').waitFor()
    await dirIs(ownDir)
    await titleIs(T.dashboard)
    await themeIs(forced, 'after logging in')
  })
  await step('settings-currency', async () => {
    const target = registered.user.currency === 'USD' ? 'EUR' : 'USD'
    await page.evaluate(() => { window.noReload = true })
    await openSettings()
    const select = page.locator('select[name=currency]')
    const hint = page.locator(`#${await select.getAttribute('aria-describedby')}`)
    if (!(await hint.isVisible()) || (await hint.textContent()) !== SE.hint) throw new Error(`hint "${await hint.textContent()}"`)
    const res = putSettings()
    await select.selectOption(target)
    if ((await res).request().postDataJSON().currency !== target) throw new Error('currency not saved')
    await savedShown()
    if (await page.evaluate(() => JSON.parse(localStorage.getItem('user')).currency) !== target) throw new Error('cached user not updated')
    // The cost label follows without a reload.
    await page.click('header a.brand')
    await page.click('.cars > li h2 a')
    await taskBtn(RS.cost, 'Brakes').click()
    const label = plain(await taskRow('Brakes').locator('form label').first().textContent())
    if (!label.includes(target)) throw new Error(`cost label "${label}"`)
    await page.keyboard.press('Escape')
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('settings-save-fails', async () => {
    await openSettings()
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    const themeGroup = page.locator('fieldset', { has: radio('theme', 'System') })
    const select = page.locator('select[name=currency]')
    const focusInTheme = (when) => focusIs('fieldset:has(input[name=theme]) input', `theme group ${when}`)
    // Held, so the in-flight state is visible: the whole page is busy but keeps focus, then the radio goes back with the error next to it.
    let puts = 0
    const count = (r) => r.method() === 'PUT' && puts++
    page.on('request', count)
    await page.route('**/api/me/settings', async (r) => { await page.waitForTimeout(700); await fail(r) }, { times: 1 })
    const before = await select.inputValue()
    await radio('theme', 'System').click()
    if ((await themeGroup.getAttribute('aria-disabled')) !== 'true') throw new Error('theme group not busy while saving')
    if ((await select.getAttribute('aria-disabled')) !== 'true') throw new Error('currency not busy while the theme saves')
    // Changes while busy are ignored. Sent from the page: Playwright's own actions wait out aria-disabled, even with force.
    await select.evaluate((el) => { el.value = 'GBP'; el.dispatchEvent(new Event('change', { bubbles: true })) })
    await radio('theme', forced === 'Dark' ? 'Light' : 'Dark').evaluate((el) => el.click())
    if (!(await radio('theme', 'System').isChecked())) throw new Error(`theme changed while busy: ${await page.evaluate(() => [...document.querySelectorAll('input[name=theme]')].map((i) => i.value + (i.checked ? '*' : '')).join())}`)
    if ((await select.inputValue()) !== before) throw new Error('currency changed while busy')
    await focusInTheme('while saving')
    const alert = themeGroup.locator('[role=alert]')
    await alert.waitFor()
    page.off('request', count)
    if (puts !== 1) throw new Error(`${puts} PUTs while busy`)
    if ((await alert.textContent()) !== RS.generic) throw new Error(`theme error "${await alert.textContent()}"`)
    if (!(await radio('theme', forced).isChecked())) throw new Error('theme radio not put back')
    await themeIs(forced, 'after a failed save')
    await focusInTheme('after a failed save')
    await page.route('**/api/me/settings', fail, { times: 1 })
    await select.focus() // selectOption doesn't move focus
    await select.selectOption('GBP')
    await page.locator('.field [role=alert]').waitFor()
    if ((await select.inputValue()) !== before) throw new Error(`currency not put back: ${await select.inputValue()}`)
    if (await themeGroup.locator('[role=alert]').count()) throw new Error('old theme error still shown')
    await focusIs('select[name=currency]', 'after a failed currency save')
    forget500()
    // Keyboard: an arrow key in the Theme group saves the next theme, and focus stays in the group. Dark is last, and Chrome doesn't wrap.
    await radio('theme', forced).focus()
    let res = putSettings()
    await page.keyboard.press(forced === 'Dark' ? 'ArrowUp' : 'ArrowDown')
    if ((await res).status() !== 200) throw new Error(`PUT ${(await res).status()}`)
    await savedShown()
    await focusInTheme('after a keyboard save')
    // Back to System for the rest of the run.
    res = putSettings()
    await radio('theme', 'System').click()
    if ((await res).status() !== 200) throw new Error(`PUT ${(await res).status()}`)
    await savedShown()
    await themeIs('System', 'System after the failures')
    await page.setViewportSize(s.viewport)
  })
  // SET-2: km or miles, at 390px. A fresh car at 80,467 km (50,000 mi), 500 km in the 10 days before (50 km/day, 31.1 mi/day).
  const UM = he
    ? { mi: 'מייל', km: 'ק״מ', newReading: 'קריאה חדשה במיילים', perDay: '31.1 מייל ליום', perDayKm: '66.1 ק״מ ליום', edit: 'עריכה של הקריאה ', readingLabel: 'קריאה במיילים',
        every6214: 'כל 6,214 מייל', left853: 'עוד 853 מייל', left5000: 'עוד 5,000 מייל', at44739: 'ב־44,739 מייל', every5000: 'כל 5,000 מייל', every8047: 'כל 8,047 ק״מ', beltMi: 'כל 62,137 מייל או 5 שנים',
        intervalLabel: 'מרווח במיילים', initialLabel: 'קילומטראז׳ נוכחי (מייל)', maxReading: 'הזינו קריאה בין 0 ל־6,213,711 מייל.', maxInterval: 'הזינו מרווח של 1 עד 621,371 מייל.',
        previous: '(50,100 מייל)', current: '(50,100 מייל)' }
    : { mi: 'mi', km: 'km', newReading: 'New reading in miles', perDay: '31.1 mi/day', perDayKm: '66.1 km/day', edit: 'Edit reading ', readingLabel: 'Reading in miles',
        every6214: 'Every 6,214 mi', left853: '853 mi left', left5000: '5,000 mi left', at44739: 'at 44,739 mi', every5000: 'Every 5,000 mi', every8047: 'Every 8,047 km', beltMi: 'Every 62,137 mi or 5 years',
        intervalLabel: 'Interval in miles', initialLabel: 'Current odometer (mi)', maxReading: 'Enter a reading between 0 and 6,213,711 mi.', maxInterval: 'Enter an interval from 1 to 621,371 mi.',
        previous: '(50,100 mi)', current: 'the current 50,100 mi' }
  const mileCar = () => page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Mile car', exact: true }) })
  const apiCall = async (method, path, data) => {
    const token = await page.evaluate(() => localStorage.getItem('token'))
    const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data })
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`)
    return r.status() === 204 ? null : r.json()
  }
  const carState = async (id) => JSON.stringify(await Promise.all(['', '/odometer', '/tasks'].map((p) => apiCall('GET', `/vehicles/${id}${p}`))))
  let mileCarId
  const unitIs = async (unit) => {
    await openSettings()
    if (await radio('distanceUnit', unit).isChecked()) return
    const res = putSettings()
    await radio('distanceUnit', unit).click()
    if ((await res).request().postDataJSON().distanceUnit !== unit) throw new Error(`PUT did not save ${unit}`)
    await savedShown()
  }
  const odometerLabel = (loc) => loc.locator('.odometer').first().getAttribute('aria-label')
  await step('settings-unit-miles', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { window.noReload = true })
    // LOW-2 L26: dated with the browser's local date, as the app dates its own readings (quick entry below), so they stay in order when that is already tomorrow in UTC.
    // The API dates a new car's first reading in UTC, so it is moved to the local date too.
    mileCarId = (await apiCall('POST', '/vehicles', { nickname: 'Mile car', initialOdometerKm: 80467 })).id
    const [first] = await apiCall('GET', `/vehicles/${mileCarId}/odometer`)
    await apiCall('PUT', `/vehicles/${mileCarId}/odometer/${first.id}`, { valueKm: 80467, readingDate: await localDate() })
    await apiCall('POST', `/vehicles/${mileCarId}/odometer`, { valueKm: 79967, readingDate: await histDay(-10) })
    await apiCall('POST', `/vehicles/${mileCarId}/tasks`, { name: 'Mile oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 72000, lastDoneDate: await localDate() })
    if (!(await radio('distanceUnit', 'Km').isChecked())) throw new Error('unit not Km by default')
    // SET-1 QA Low 1: an arrow key while the group saves leaves focus on its checked radio, and sends nothing.
    let puts = 0
    const count = (r) => r.method() === 'PUT' && puts++
    page.on('request', count)
    await page.route('**/api/me/settings', async (r) => { await page.waitForTimeout(700); await r.continue() }, { times: 1 })
    const res = putSettings()
    await radio('distanceUnit', 'Mi').click()
    await page.keyboard.press('ArrowUp')
    await focusIs('input[name=distanceUnit][value=Mi]:checked', 'unit group after an arrow key while saving')
    if ((await res).request().postDataJSON().distanceUnit !== 'Mi') throw new Error('Mi not saved')
    await savedShown()
    page.off('request', count)
    if (puts !== 1) throw new Error(`${puts} PUTs`)
    await focusIs('input[name=distanceUnit][value=Mi]:checked', 'unit group after the save')
    await noOverflow('settings in miles')
    await sweep('settings in miles')
    // Car list: odometer, average and quick-add in miles; 50,100 mi is stored as 80,628 km and shows back unchanged.
    await page.click('header a.brand')
    await mileCar().waitFor()
    if ((await odometerLabel(mileCar())) !== `50,000 ${UM.mi}`) throw new Error(`list odometer "${await odometerLabel(mileCar())}"`)
    if ((await mileCar().locator('.reading .unit').textContent()) !== UM.mi) throw new Error('list unit')
    if (!(await mileCar().locator('.reading').textContent()).includes(UM.perDay)) throw new Error(`average "${await mileCar().locator('.reading').textContent()}"`)
    const quick = mileCar().locator('.quick input[type=number]')
    if ((await quick.getAttribute('placeholder')) !== UM.newReading) throw new Error(`placeholder "${await quick.getAttribute('placeholder')}"`)
    await quick.fill('50100')
    const post = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/odometer'))
    await mileCar().locator('.quick button').click()
    if ((await post).request().postDataJSON().valueKm !== 80628) throw new Error(`POST ${JSON.stringify((await post).request().postDataJSON())}`)
    await page.waitForFunction(() => [...document.querySelectorAll('.odometer')].some((o) => o.getAttribute('aria-label').startsWith('50,100')))
    if ((await apiCall('GET', `/vehicles/${mileCarId}`)).currentOdometerKm !== 80628) throw new Error('not stored as 80,628 km')
    // MVP4-A criterion 7: the dashboard's remaining distance is in miles too.
    const dashRow = plain(await mileCar().locator('.dash-tasks').textContent())
    if (!dashRow.includes(UM.left853)) throw new Error(`dashboard task "${dashRow}"`)
    await noOverflow('the list in miles')
    // Car page: odometer, history and its edit form, tasks, and the template picker.
    await mileCar().locator('h2 a').click()
    await arrivedAt('Mile car')
    if ((await odometerLabel(page.locator('main'))) !== `50,100 ${UM.mi}`) throw new Error(`car odometer "${await odometerLabel(page.locator('main'))}"`)
    const values = await page.locator('.history .value').allTextContents()
    if (values.map(plain).join('|') !== ['50,100', '50,000', '49,689'].map((v) => `${v} ${UM.mi}`).join('|')) throw new Error(`history ${values}`)
    await page.getByRole('button', { name: `${UM.edit}50,000 ${UM.mi}`, exact: true }).click()
    const readingInput = page.locator('.history input[name=valueKm]')
    if ((await readingInput.inputValue()) !== '50000') throw new Error(`edit value ${await readingInput.inputValue()}`)
    if (!plain(await page.locator('.history form label').first().textContent()).startsWith(UM.readingLabel)) throw new Error('reading label')
    // Saved untouched, the reading keeps its exact km.
    const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/odometer/'))
    await page.locator('.history form button:not(.link)').click()
    if ((await put).request().postDataJSON().valueKm !== 80467) throw new Error(`PUT ${JSON.stringify((await put).request().postDataJSON())}`)
    const row = plain(await taskRow('Mile oil').textContent())
    for (const want of [UM.every6214, UM.left853, UM.at44739]) if (!row.includes(want)) throw new Error(`task row lacks "${want}": "${row}"`)
    await taskBtn(TK.edit, 'Mile oil').click()
    const form = taskRow('Mile oil').locator('form')
    if ((await form.locator('input[name=intervalKm]').inputValue()) !== '6214' || (await form.locator('input[name=lastDoneOdometerKm]').inputValue()) !== '44739') throw new Error('edit form not in miles')
    if (!plain(await form.locator('label', { has: page.locator('input[name=intervalKm]') }).textContent()).startsWith(UM.intervalLabel)) throw new Error('interval label')
    await form.locator('input[name=intervalKm]').fill('5000')
    const taskPut = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/tasks/'))
    await form.locator('button:not(.link)').click()
    let body = (await taskPut).request().postDataJSON()
    if (body.intervalKm !== 8047 || body.lastDoneOdometerKm !== 72000) throw new Error(`task PUT ${JSON.stringify(body)}`)
    await page.waitForFunction((w) => document.querySelector('.tasks')?.textContent.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').includes(w), UM.every5000)
    await tasks.getByRole('button', { name: TK.add }).click()
    const options = (await tasks.locator('.picker li button').allTextContents()).map(plain)
    if (!options.some((o) => o.startsWith(TK.belt) && o.includes(UM.beltMi))) throw new Error(`picker ${options}`)
    await tasks.locator('.picker button', { hasText: TK.custom }).click()
    const add = tasks.locator('form')
    await add.locator('input[name=name]').fill('Mile wash')
    await add.locator('input[name=intervalKm]').fill('5000')
    if ((await add.locator('input[name=lastDoneOdometerKm]').inputValue()) !== '50100') throw new Error('add form last done not in miles')
    const taskPost = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/tasks'))
    await add.locator('button:not(.link)').click()
    body = (await taskPost).request().postDataJSON()
    if (body.intervalKm !== 8047 || body.lastDoneOdometerKm !== 80628) throw new Error(`task POST ${JSON.stringify(body)}`)
    await taskRow('Mile wash').waitFor()
    // Just done: the remaining distance adds up with the shown interval (8,047 km is 5,000.2 mi).
    if (!plain(await taskRow('Mile wash').textContent()).includes(UM.left5000)) throw new Error(`new task row: ${await taskRow('Mile wash').textContent()}`)
    await noOverflow('the car page in miles')
    await sweep('the car page in miles')
    // MVP3-A criterion 10: the record form starts at the odometer in miles, and saved unchanged it stores the exact km.
    // 80,629 km shows as 50,101 mi, which converts back to 80,630, so only the kept value sends 80,629.
    const drift = await apiCall('POST', `/vehicles/${mileCarId}/odometer`, { valueKm: 80629, readingDate: await localDate() })
    await page.click('header a.brand')
    await mileCar().locator('h2 a').click()
    await arrivedAt('Mile car')
    await recordBtn.click()
    if ((await recordForm.locator('input[name=odometerKm]').inputValue()) !== '50101') throw new Error('record form odometer not in miles')
    if (!plain(await recordForm.locator('label', { has: page.locator('input[name=odometerKm]') }).textContent()).startsWith(SV.odoLabel)) throw new Error('record odometer label')
    const recordPost = page.waitForResponse((r) => isRecordPost(r.request()))
    await recordForm.locator('button:not(.link)').click()
    if ((await recordPost).request().postDataJSON().odometerKm !== 80629) throw new Error(`record POST ${(await recordPost).request().postData()}`)
    const mileRecord = (await (await recordPost).json()).record.id
    const recordValue = services.locator(`li[data-id="${mileRecord}"] .value`)
    await recordValue.waitFor()
    if (plain(await recordValue.textContent()) !== `50,101 ${UM.mi}`) throw new Error(`record value "${await recordValue.textContent()}"`)
    // MVP3-D criterion 10: Edit starts at the record's 50,101 mi; saved unchanged it keeps 80,629 km and shows back the same.
    await services.locator(`li[data-id="${mileRecord}"] button.edit-service`).click()
    const editOdo = services.locator(`li[data-id="${mileRecord}"] form input[name=odometerKm]`)
    if ((await editOdo.inputValue()) !== '50101') throw new Error(`edit odometer ${await editOdo.inputValue()}`)
    const editPut = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/service-records/'))
    await services.locator(`li[data-id="${mileRecord}"] form > .actions button:not(.link)`).click()
    if ((await editPut).status() !== 200 || (await editPut).request().postDataJSON().odometerKm !== 80629) throw new Error(`edit PUT ${(await editPut).request().postData()}`)
    await focusIs(`li[data-id="${mileRecord}"] button.edit-service`, 'after saving the miles record')
    if (plain(await recordValue.textContent()) !== `50,101 ${UM.mi}`) throw new Error(`edited record value "${await recordValue.textContent()}"`)
    await page.screenshot({ path: `${OUT}/${s.name}-unit-miles-car.png`, fullPage: true })
    await apiCall('POST', `/vehicles/${mileCarId}/service-records/${mileRecord}/void`) // the stored values below are from before it
    await apiCall('DELETE', `/vehicles/${mileCarId}/odometer/${drift.id}`)
    // Back to km: every value as before, no reload, nothing stored changed.
    const stored = await carState(mileCarId)
    await unitIs('Km')
    await page.goBack()
    await taskRow('Mile wash').waitFor()
    if ((await odometerLabel(page.locator('main'))) !== `80,628 ${UM.km}`) throw new Error(`km odometer "${await odometerLabel(page.locator('main'))}"`)
    const kmValues = (await page.locator('.history .value bdi').allTextContents()).join('|')
    if (kmValues !== '80,628|80,467|79,967') throw new Error(`km history ${kmValues}`)
    if (!plain(await taskRow('Mile oil').textContent()).includes(UM.every8047)) throw new Error('km interval')
    if ((await carState(mileCarId)) !== stored) throw new Error('stored values changed with the unit')
    await page.click('header a.brand')
    await mileCar().waitFor()
    if (!(await mileCar().locator('.reading').textContent()).includes(UM.perDayKm)) throw new Error(`km average "${await mileCar().locator('.reading').textContent()}"`)
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('settings-unit-errors', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    // SET-1 QA Low 2: each later settings action, on the page or with the header switch, clears every earlier error.
    await openSettings()
    const alerts = () => page.locator('main [role=alert]')
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    await page.route('**/api/me/settings', fail, { times: 1 })
    await radio('theme', 'Dark').click()
    await page.locator('fieldset:has(input[name=theme]) [role=alert]').waitFor()
    await page.route('**/api/me/settings', fail, { times: 1 })
    await page.click('header nav button.link >> nth=0')
    await page.locator('main > p[role=alert]').waitFor()
    if ((await alerts().count()) !== 1) throw new Error(`${await alerts().count()} alerts after the header switch failed`)
    const res = putSettings()
    await radio('distanceUnit', 'Mi').click()
    await res
    await savedShown()
    if (await alerts().count()) throw new Error('old errors still shown after a successful save')
    forget500()
    // Criterion 5: limits in miles, blocked before any request; the server's errors name readings in miles.
    let sent = 0
    const count = (r) => ['POST', 'PUT'].includes(r.method()) && !r.url().endsWith('/me/settings') && sent++
    page.on('request', count)
    const blocked = async (input, submit, want) => {
      await submit.click()
      const msg = plain(await input.evaluate((el) => el.validationMessage))
      if (msg !== want) throw new Error(`"${msg}", want "${want}"`)
    }
    await page.click('header a.brand')
    await page.click('a[href="/cars/new"]')
    await arrivedAt(T.addCar)
    if (!plain(await page.locator('label', { has: page.locator('input[name=initialOdometerKm]') }).textContent()).startsWith(UM.initialLabel)) throw new Error('car form label')
    await page.fill('input[name=nickname]', 'Too far')
    await page.fill('input[name=initialOdometerKm]', '6213712')
    await blocked(page.locator('input[name=initialOdometerKm]'), page.locator('form button:not(.link)'), UM.maxReading)
    await page.click('form button.link')
    await mileCar().waitFor()
    const quick = mileCar().locator('.quick input[type=number]')
    await quick.fill('6213712')
    await blocked(quick, mileCar().locator('.quick button'), UM.maxReading)
    await mileCar().locator('h2 a').click()
    await taskRow('Mile oil').waitFor()
    await taskBtn(TK.edit, 'Mile oil').click()
    const form = taskRow('Mile oil').locator('form')
    await form.locator('input[name=intervalKm]').fill('621372')
    await blocked(form.locator('input[name=intervalKm]'), form.locator('button:not(.link)'), UM.maxInterval)
    await page.waitForTimeout(300)
    page.off('request', count)
    if (sent) throw new Error(`${sent} requests sent for blocked values`)
    await form.locator('input[name=intervalKm]').fill('5000')
    await form.locator('input[name=lastDoneOdometerKm]').fill('60000')
    await form.locator('button:not(.link)').click()
    await form.locator('[role=alert]').waitFor()
    const lastDone = plain(await form.locator('[role=alert]').textContent())
    if (!lastDone.includes(UM.current)) throw new Error(`invalidLastDone "${lastDone}"`)
    noLatin(lastDone, 'error')
    await page.keyboard.press('Escape')
    await page.locator('main > .card .quick input[type=number]').fill('49000')
    await page.locator('main > .card .quick button').click()
    await page.locator('main > .card .quick [role=alert]').waitFor()
    const lower = plain(await page.locator('main > .card .quick [role=alert]').textContent())
    if (!lower.includes(UM.previous)) throw new Error(`lowerThanPrevious "${lower}"`)
    noLatin(lower, 'error')
    // A failed history save puts focus back on Save, so Escape still closes the form.
    await page.getByRole('button', { name: `${UM.edit}50,000 ${UM.mi}`, exact: true }).click()
    await page.route('**/odometer/*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await page.locator('.history form button:not(.link)').click()
    await page.locator('.history form [role=alert]').waitFor()
    await focusIs('.history form button:not(.link)', 'after a failed history save')
    await page.keyboard.press('Escape')
    await page.locator('.history form').waitFor({ state: 'detached' })
    forget500()
    await noOverflow('the car page with errors in miles')
    await page.screenshot({ path: `${OUT}/${s.name}-unit-errors-car.png`, fullPage: true })
    await unitIs('Km')
    await apiCall('POST', `/vehicles/${mileCarId}/archive`) // the steps below expect one car
    await page.setViewportSize(s.viewport)
  })
  await step('tap-targets-list', async () => {
    await page.click('header a.brand')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.cars > li').first().waitFor()
    await tall(page.locator('main > label.inline'), 'Show archived') // MVP2-C QA note (a)
    await sweep('list page at 390px') // the screenshot is taken at 390px; the next step restores the viewport
  })
  await step('archive-car', async () => {
    await page.setViewportSize(s.viewport)
    await page.click('.cars > li .actions button.link')
    await page.locator('.cars > li').waitFor({ state: 'detached' })
    await page.check('main > label.inline input')
    await page.locator('.cars > li.archived', { hasText: 'Renamed Corolla' }).waitFor()
  })
  await step('archived-tasks-read-only', async () => {
    await page.locator('.cars > li.archived', { hasText: 'Renamed Corolla' }).locator('h2 a').click()
    await taskRow(TK.belt).waitFor()
    const controls = await tasks.locator('button, input, select').count()
    if (controls) throw new Error(`${controls} controls on an archived car's tasks`)
    // MVP3-A criterion 11 and MVP3-B criterion 13: the history and its items are shown, without Record, Edit or Delete.
    await apiCall('POST', `/vehicles/${carId()}/service-records`, { date: await localDate(), odometerKm: 59000, items: [{ description: 'Wiper', quantity: 2, unitCost: 30 }] })
    await page.reload()
    await services.locator('.service-items li', { hasText: 'Wiper' }).waitFor()
    if (await services.locator('button, input').count()) throw new Error('Record, Edit or Delete on an archived car')
    await page.click('main > a.back')
    await page.locator('a[href="/cars/new"]').waitFor() // the list hides archived cars again
  })
  // MVP3-C: a third car with a task, three distinct services and 50 older ones, beside the archived Renamed Corolla's.
  const isHistoryGet = (url) => new URL(url).pathname === '/api/service-records'
  const histUser = () => page.evaluate(() => JSON.parse(localStorage.getItem('user')))
  const moneyText = async (v) => { const u = await histUser(); return page.evaluate(([v, lng, c]) => v.toLocaleString(lng, { style: 'currency', currency: c }), [v, s.lng, u.currency]) }
  const summaryIs = async (n, cost) => {
    const want = HS.summary(n, await moneyText(cost))
    await page.waitForFunction((w) => document.querySelector('main .card > p[role=status]')?.textContent.replace(/[⁦-⁩]/g, '') === w, want, { timeout: 5000 })
      .catch(async () => { throw new Error(`summary "${plain(await histStatus.textContent())}", want "${want}"`) })
  }
  // Counts the list requests while fn runs, plus a pause longer than the search's 300 ms.
  const historyGets = async (fn) => {
    let n = 0
    const count = (r) => isHistoryGet(r.url()) && n++
    page.on('request', count)
    await fn()
    await page.waitForTimeout(600)
    page.off('request', count)
    return n
  }
  const longGarage = 'Garage' + 'Y'.repeat(90)
  const longPart = 'P' + '9'.repeat(49)
  let civicId, civicTaskId, histAll
  await step('history-page', async () => {
    civicId = (await apiCall('POST', '/vehicles', { nickname: 'History Civic', initialOdometerKm: 100000 })).id
    civicTaskId = (await apiCall('POST', `/vehicles/${civicId}/tasks`, { name: 'Civic oil', category: 'Oil', intervalKm: 10000, intervalDays: null, dueSoonPercent: 10, lastDoneOdometerKm: 5000, lastDoneDate: await histDay(-300) })).id
    const rec = (body) => apiCall('POST', `/vehicles/${civicId}/service-records`, body)
    for (let i = 0; i < 50; i++) await rec({ date: await histDay(-150 + i), odometerKm: 10000 + i * 100, shopName: `Filler ${i}`, totalCost: 1 })
    await rec({ date: await histDay(-40), odometerKm: 50000, shopName: 'Speedy Garage', notes: 'Fixed a rattle', taskIds: [civicTaskId],
      items: [{ description: 'Oil filter', brand: 'Mann', partNumber: 'W 712/75', quantity: 1, unitCost: 45.5 }] })
    await rec({ date: await histDay(-20), odometerKm: 60000, shopName: longGarage, items: [{ description: 'Brake pads', brand: 'Brembo', partNumber: longPart, quantity: 2, unitCost: 200 }] })
    await rec({ date: await histDay(-10), odometerKm: 70000, notes: 'Topped up washer fluid' })
    histAll = await apiCall('GET', '/service-records?take=100')
    // Criterion 11: a loading line on the first load.
    await page.route((url) => isHistoryGet(url.href), async (r) => { await page.waitForTimeout(700); await r.continue().catch(() => {}) }, { times: 1 }) // the request may be gone by then
    await page.click('header a[href="/history"]')
    await histStatus.filter({ hasText: he ? 'טוען' : 'Loading' }).waitFor()
    await arrivedAt(HS.title)
    // Criterion 5: every car's records, newest first, with the count and total of all matches.
    await summaryIs(histAll.totalCount, histAll.totalCost)
    // LOW-1 L3: the Hebrew total sits in a first-strong isolate, as a row's <bdi> amount.
    if (he && !(await histStatus.textContent()).includes(`\u2068${await moneyText(histAll.totalCost)}\u2069`)) throw new Error('summary total not isolated like a row amount')
    if (histAll.totalCount <= 50 || histAll.totalCount > 100) throw new Error(`${histAll.totalCount} records`)
    await histRows.nth(49).waitFor()
    if ((await histRows.count()) !== 50) throw new Error(`${await histRows.count()} rows on the first page`)
    const ids = await histRows.evaluateAll((ls) => ls.map((l) => l.dataset.id))
    if (ids.join() !== histAll.items.slice(0, 50).map((r) => r.id).join()) throw new Error('rows not in the API order')
    const dates = await histRows.locator('time').evaluateAll((ts) => ts.map((t) => t.dateTime))
    if (dates.some((d, i) => i && d > dates[i - 1])) throw new Error(`not newest first: ${dates}`)
    // Criterion 12: each row names its car, linking to it; archived cars carry the tag; no Edit, Delete or Record anywhere.
    const archivedRow = histRows.filter({ has: page.getByRole('link', { name: 'Renamed Corolla', exact: true }) }).first()
    if ((await archivedRow.locator('.row .badge').textContent()) !== HS.archived) throw new Error('no Archived tag')
    const civicRow = histRows.filter({ hasText: 'Speedy Garage' })
    if (await civicRow.locator('.row .badge').count()) throw new Error('Archived tag on an active car')
    if ((await civicRow.locator('a.car').getAttribute('href')) !== `/cars/${civicId}`) throw new Error('car link')
    if (await page.locator('main .services button, main .services input').count()) throw new Error('a row has a button')
    // Criterion 13: km and the user's currency, as on the car page.
    const civicText = plain(await civicRow.textContent())
    for (const want of ['50,000', SV.km, plain(await moneyText(45.5)), 'Civic oil', 'Fixed a rattle', 'W 712/75', 'Mann']) if (!civicText.includes(want)) throw new Error(`row lacks "${want}": ${civicText}`)
    // Criteria 10 and 11: a failed Show more keeps the rows, with the error and Retry; Retry appends the next page and focuses its first row.
    const more = page.getByRole('button', { name: HS.showMore, exact: true })
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await more.click()
    const alert = page.locator('main [role=alert]')
    await alert.waitFor()
    if ((await alert.textContent()) !== HS.generic) throw new Error(`error "${await alert.textContent()}"`)
    if ((await histRows.count()) !== 50) throw new Error('rows lost on a failed Show more')
    // The error and Retry take Show more's place below the rows, with focus on Retry.
    if (!(await page.locator('main .services ~ .row [role=alert]').count())) throw new Error('Show more error not below the rows')
    await focusIs('main .services ~ .row button', 'after a failed Show more')
    forgetExpected(500)
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await focusIs('main .services > li:nth-child(51) a.car', 'after Show more')
    if ((await histRows.count()) !== histAll.totalCount) throw new Error(`${await histRows.count()} rows after Show more`)
    if (await more.count()) throw new Error('Show more still shown with every match listed')
    if (await alert.count()) throw new Error('error still shown')
    // Criterion 13: miles follow the setting.
    await unitIs('Mi')
    await page.goto(`${BASE}/history?q=Speedy`)
    await summaryIs(1, 45.5)
    if (!plain(await histRows.first().textContent()).includes(`31,069 ${UM.mi}`)) throw new Error(`miles: ${plain(await histRows.first().textContent())}`)
    await unitIs('Km')
    // LOW-2 L15: a failed first load with a car in the URL still fills the Task select (the cars loaded); Retry fills the rows.
    const failList = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    const listUrl = (url) => isHistoryGet(url.href)
    await page.route(listUrl, failList) // every list request: dev StrictMode loads twice
    await page.goto(`${BASE}/history?vehicleId=${civicId}`)
    await alert.waitFor()
    await taskFilter.locator('option', { hasText: 'Civic oil' }).waitFor({ state: 'attached', timeout: 5000 }).catch(() => { throw new Error('Task select empty after a failed first load') })
    if (await histRows.count()) throw new Error('rows after a failed first load')
    await page.unroute(listUrl, failList)
    forgetExpected(500)
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await histRows.first().waitFor()
    if ((await carFilter.inputValue()) !== civicId || !(await taskFilter.locator('option', { hasText: 'Civic oil' }).count())) throw new Error('filters lost after Retry')
  })
  await step('history-filter', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/history`)
    await summaryIs(histAll.totalCount, histAll.totalCost)
    const civicAll = await apiCall('GET', `/service-records?vehicleId=${civicId}`)
    const params = () => Object.fromEntries(new URL(page.url()).searchParams)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    // Criterion 6: a car narrows the list and offers its tasks; a task narrows it further; another car resets the task.
    await carFilter.selectOption(civicId)
    await summaryIs(53, civicAll.totalCost)
    if (!same(params(), { vehicleId: civicId })) throw new Error(`URL ${page.url()}`)
    await taskFilter.locator('option', { hasText: 'Civic oil' }).waitFor({ state: 'attached' })
    await taskFilter.selectOption(civicTaskId)
    await summaryIs(1, 45.5)
    if (!same(params(), { vehicleId: civicId, taskId: civicTaskId })) throw new Error(`URL ${page.url()}`)
    const corollaOption = carFilter.locator('option', { hasText: 'Renamed Corolla' })
    if (!(await corollaOption.textContent()).includes(HS.archived.toLowerCase())) throw new Error('archived car not marked in the select')
    const corolla = await corollaOption.getAttribute('value')
    await carFilter.selectOption(corolla)
    await page.waitForURL((u) => u.searchParams.get('vehicleId') === corolla)
    await page.waitForFunction(() => !document.querySelectorAll('main .filters select')[1]?.value, null, { timeout: 2000 }).catch(() => {}) // the URL changes before React renders
    if (params().taskId || (await taskFilter.inputValue()) !== '') throw new Error('task not reset with the car')
    // LOW-1 L4: at 390px the archived car's name and tag fit the select (the arrow takes about 24px).
    const room = await carFilter.evaluate((el) => {
      const cs = getComputedStyle(el), span = document.createElement('span')
      span.style.cssText = `font: ${cs.font}; white-space: pre; position: absolute`
      span.textContent = el.selectedOptions[0].text
      document.body.append(span)
      const left = el.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd) - 24 - span.offsetWidth
      span.remove()
      return left
    })
    if (room < 0) throw new Error(`archived car name cut by ${-room}px`)
    // LOW-1 L2: at 1280px no filter sits alone on a row.
    await page.setViewportSize({ width: 1280, height: 800 })
    const tops = await filterBar.locator(':scope > label:not(.wide)').evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().top)))
    if (tops.some((t) => tops.filter((u) => u === t).length < 2)) throw new Error(`a filter alone on its row: ${tops}`)
    await page.setViewportSize({ width: 390, height: 844 })
    // Criterion 9: Back restores the car, the task and their results.
    await page.goBack()
    await summaryIs(1, 45.5)
    if ((await carFilter.inputValue()) !== civicId || (await taskFilter.inputValue()) !== civicTaskId) throw new Error('Back did not restore the filters')
    await taskFilter.selectOption('')
    // Criterion 7: the dates are inclusive at both ends; from after to is blocked on the dates, without a request.
    await fromFilter.fill(await histDay(-40))
    await toFilter.fill(await histDay(-10))
    await summaryIs(3, 445.5)
    const fiveAgo = await histDay(-5)
    const sent = await historyGets(() => fromFilter.fill(fiveAgo))
    const dateAlert = filterBar.locator('[role=alert]')
    if (plain(await dateAlert.textContent()) !== HS.dates) throw new Error(`dates message "${await dateAlert.textContent()}"`)
    for (const d of [fromFilter, toFilter]) if ((await d.getAttribute('aria-invalid')) !== 'true' || (await d.getAttribute('aria-describedby')) !== (await dateAlert.getAttribute('id'))) throw new Error('message not tied to the dates')
    if (sent) throw new Error(`${sent} requests with from after to`)
    await fromFilter.fill(await histDay(-40))
    await summaryIs(3, 445.5)
    // Criterion 8: the search applies after a pause, replacing the URL entry; it finds the shop, notes and parts in any case.
    const entries = await page.evaluate(() => history.length)
    for (const [word, n, cost] of [['mann', 1, 45.5], ['RATTLE', 1, 45.5], ['w 712', 1, 45.5], ['brembo', 1, 400], ['speedy', 1, 45.5]]) {
      await searchBox.fill(word)
      await summaryIs(n, cost)
    }
    if ((await page.evaluate(() => history.length)) !== entries) throw new Error('typing pushed history entries')
    // Enter applies at once.
    await searchBox.fill('washer')
    await searchBox.press('Enter')
    await page.waitForURL((u) => u.searchParams.get('q') === 'washer', { timeout: 250 })
    await summaryIs(1, 0)
    // Over 100 characters is blocked on the field, without a request.
    const tooLong = await historyGets(() => searchBox.fill('x'.repeat(101)))
    const searchAlert = filterBar.locator('[role=alert]')
    if (plain(await searchAlert.textContent()) !== HS.tooLong) throw new Error(`search message "${await searchAlert.textContent()}"`)
    if (!(await searchBox.getAttribute('aria-describedby')).split(' ').includes(await searchAlert.getAttribute('id'))) throw new Error('message not tied to the search')
    if (tooLong) throw new Error(`${tooLong} requests for a long search`)
    // A server 400 shows next to its filter.
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'serviceRecord.searchTooLong' }) }), { times: 1 })
    const r400 = page.waitForResponse((r) => isHistoryGet(r.url()))
    await searchBox.fill('brembo')
    await r400
    await searchAlert.waitFor()
    if (plain(await searchAlert.textContent()) !== HS.tooLong) throw new Error(`400 message "${await searchAlert.textContent()}"`)
    // Only this 400: forgetExpected would take an earlier, intended one.
    run.badResponses = run.badResponses.filter((r) => !r.startsWith('400 GET') || !isHistoryGet(r.split(' ')[2]))
    const logged = run.consoleErrors.findLastIndex((e) => e.includes('status of 400'))
    if (logged >= 0) run.consoleErrors.splice(logged, 1)
    await searchBox.fill('Brembo') // a new query; the same one again sends nothing
    await summaryIs(1, 400)
    if (await searchAlert.count()) throw new Error('400 message outlived a good search')
    // Criteria 14 and 15: a long shop name and part number at 390px, in both languages, without overflow.
    const row = histRows.first()
    for (const want of [longGarage, longPart]) if (!plain(await row.textContent()).includes(want)) throw new Error(`row lacks ${want.slice(0, 10)}`)
    await noOverflow('a long shop name and part number')
    for (const c of await filterBar.locator('select, input, button').all()) await tall(c, `filter "${await c.evaluate((e) => e.closest('label')?.firstChild.textContent ?? e.textContent)}"`)
    await sweep('the filtered history')
    // Criterion 9: reload keeps every filter and its results.
    const url = page.url()
    await page.reload()
    await summaryIs(1, 400)
    if (page.url() !== url || (await carFilter.inputValue()) !== civicId || (await fromFilter.inputValue()) !== (await histDay(-40)) || (await toFilter.inputValue()) !== (await histDay(-10)) || (await searchBox.inputValue()) !== 'Brembo') throw new Error('reload lost the filters')
    await page.screenshot({ path: `${OUT}/${s.name}-history-filtered.png`, fullPage: true })
    // Criterion 11: a failed reload keeps the rows, with the error and Retry.
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await searchBox.fill('')
    const loadAlert = page.locator('main .card [role=alert]')
    await loadAlert.waitFor()
    if ((await loadAlert.textContent()) !== HS.generic || (await histRows.count()) !== 1) throw new Error('a failed reload lost the rows or the error')
    // LOW-1 L1: the stale rows' count and total don't show beside the new filter.
    if (await histStatus.textContent()) throw new Error(`stale summary "${plain(await histStatus.textContent())}"`)
    forgetExpected(500)
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await summaryIs(3, 445.5)
    // Review: the URL holds the search trimmed, and Enter on the same search after a failure retries it.
    await page.route((url) => isHistoryGet(url.href), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await searchBox.fill('  washer  ')
    await loadAlert.waitFor()
    if (params().q !== 'washer') throw new Error(`URL ${page.url()}`)
    forgetExpected(500)
    await searchBox.press('Enter')
    await summaryIs(1, 0)
    if (await loadAlert.count()) throw new Error('error outlived Enter')
    // Criterion 11: no matches, then Clear filters resets every filter and the URL, with focus on the car select.
    await searchBox.fill('nothing-matches-this')
    await histStatus.filter({ hasText: HS.noMatches }).waitFor()
    await clearBtn.click()
    await summaryIs(histAll.totalCount, histAll.totalCost)
    if (new URL(page.url()).search || (await carFilter.inputValue()) || (await fromFilter.inputValue()) || (await toFilter.inputValue()) || (await searchBox.inputValue())) throw new Error('Clear filters left a filter')
    await focusIs('main .filters select', 'after Clear filters')
    // Criterion 9: "Search all history" on a car page opens /history with that car.
    await page.goto(`${BASE}/cars/${civicId}`)
    await services.getByRole('link', { name: HS.searchAll, exact: true }).click()
    await arrivedAt(HS.title)
    await summaryIs(53, civicAll.totalCost)
    if ((await carFilter.inputValue()) !== civicId) throw new Error('car not selected')
    // Review: a car that isn't the user's drops from the URL, with its task, instead of filtering under All cars.
    // LOW-1 L5: no tasks request for it, so no tasks error.
    let taskGets = 0
    const countTasks = (q) => q.url().includes('/tasks') && taskGets++
    page.on('request', countTasks)
    await page.goto(`${BASE}/history?vehicleId=${crypto.randomUUID()}&taskId=${civicTaskId}&q=a`)
    await page.waitForURL((u) => !u.searchParams.has('vehicleId'))
    if (!same(params(), { q: 'a' }) || (await carFilter.inputValue()) !== '') throw new Error(`URL ${page.url()}`)
    await page.waitForLoadState('networkidle')
    page.off('request', countTasks)
    if (taskGets) throw new Error(`${taskGets} tasks requests for an unknown car`)
    if (await filterBar.locator('[role=alert]').count()) throw new Error('an error for an unknown car')
    await page.setViewportSize(s.viewport)
  })
  // MVP4-A: the dashboard on `/`. A car with four tasks (overdue, due soon, two OK) and one with none, beside History Civic.
  const D = he
    ? { overdue: (n) => ['אין משימות באיחור', 'משימה אחת באיחור', 'שתי משימות באיחור'][n] ?? `${n} משימות באיחור`,
        soon: (n) => ['אין משימות לביצוע בקרוב', 'משימה אחת לביצוע בקרוב', 'שתי משימות לביצוע בקרוב'][n] ?? `${n} משימות לביצוע בקרוב`,
        month: (n, total) => (n ? `החודש: ${total} (${['', 'טיפול אחד', 'שני טיפולים'][n] || `${n} טיפולים`})` : 'החודש: אין טיפולים'),
        all: (n) => `כל המשימות (${n})`, noTasks: 'עדיין אין משימות תחזוקה.', addTask: 'הוספת משימה', status: { Overdue: 'באיחור', DueSoon: 'בקרוב' }, brakesLate: 'באיחור של 500 ק״מ' }
    : { overdue: (n) => (n ? `${n} overdue` : 'Nothing overdue'), soon: (n) => (n ? `${n} due soon` : 'Nothing due soon'),
        month: (n, total) => (n ? `This month: ${total} (${n} service${n === 1 ? '' : 's'})` : 'This month: no services'),
        all: (n) => `All tasks (${n})`, noTasks: 'No maintenance tasks yet.', addTask: 'Add task', status: { Overdue: 'Overdue', DueSoon: 'Due soon' }, brakesLate: 'Overdue by 500 km' }
  const isDashGet = (u) => u.pathname === '/api/dashboard'
  const dashCar = () => page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Dash car', exact: true }) })
  const dashRow = (name) => dashCar().locator('.dash-tasks > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const dashNames = () => dashCar().locator('.dash-tasks .name').allTextContents()
  const cardCounts = async () => (await dashCar().locator('.counts span').allTextContents()).map(plain).join('|')
  const summary = page.locator('main .summary')
  const dashApi = async () => apiCall('GET', `/dashboard?today=${await localDate()}`)
  // The summary shows the API's figures, once the reload lands.
  async function summaryShows(dash) {
    const want = [D.overdue(dash.overdueCount), D.soon(dash.dueSoonCount), D.month(dash.monthServiceCount, await moneyText(dash.monthTotalCost))].join('|')
    await page.waitForFunction((w) => [...document.querySelectorAll('main .summary .counts span, main .summary a')].map((e) => e.textContent.replace(/[⁦-⁩]/g, '')).join('|') === w, want, { timeout: 5000 })
      .catch(async () => { throw new Error(`summary "${plain(await summary.textContent())}", want "${want}"`) })
  }
  let dashCarId, taskIds
  await step('dashboard-summary', async () => {
    dashCarId = (await apiCall('POST', '/vehicles', { nickname: 'Dash car', initialOdometerKm: 50000 })).id
    await apiCall('POST', '/vehicles', { nickname: 'Dash bike', initialOdometerKm: 1000 })
    const today = await localDate()
    const utcToday = new Date().toISOString().slice(0, 10)
    const task = (name, intervalKm, intervalDays, lastKm) =>
      apiCall('POST', `/vehicles/${dashCarId}/tasks`, { name, category: 'Other', intervalKm, intervalDays, dueSoonPercent: 10, lastDoneOdometerKm: lastKm, lastDoneDate: utcToday })
    taskIds = {
      Oil: (await task('Oil', 10000, null, 39000)).id, // overdue by 1,000 km
      Brakes: (await task('Brakes', 20000, null, 31000)).id, // due soon, 1,000 km left
      'Air filter': (await task('Air filter', null, 365, 50000)).id,
      Coolant: (await task('Coolant', 100000, null, 50000)).id,
    }
    // Criterion 8: a slow load shows the placeholder, as tall as the loaded summary.
    // Every request is held (dev StrictMode loads twice); continue fails harmlessly on one the page dropped.
    const slow = async (r) => { await page.waitForTimeout(600); await r.continue().catch(() => {}) }
    await page.route(isDashGet, slow)
    await page.click('header a.brand')
    await summary.locator('[role=status]').waitFor()
    const loadingH = await heightOf(summary)
    await dashCar().waitFor()
    await page.unroute(isDashGet, slow)
    await arrivedAt(T.dashboard)
    const loadedH = await heightOf(summary)
    if (Math.abs(loadedH - loadingH) > 1) throw new Error(`summary ${loadingH}px while loading, ${loadedH}px loaded`)
    // A failed load: a translated error with Retry; Retry loads it and focuses the h1.
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    await page.route(isDashGet, fail)
    await page.reload()
    const alert = page.locator('main > .row [role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    // A Retry that fails again keeps focus on Retry (MVP1-C).
    const retry = page.getByRole('button', { name: HS.retry, exact: true })
    const failed = page.waitForResponse((r) => isDashGet(new URL(r.url())))
    await retry.click()
    await failed
    await page.locator('main > .row button[aria-disabled=false]').waitFor()
    await focusIs('main > .row button', 'Retry after a failed Retry')
    await page.unroute(isDashGet, fail)
    await retry.click()
    await dashCar().waitFor()
    await focusIs('main h1', 'h1 after Retry')
    if (await alert.count()) throw new Error('the error stayed after Retry')
    forget500()
    // Criterion 3: one card per active car in the server's order, then the summary's figures.
    const dash = await dashApi()
    const cars = await apiCall('GET', '/vehicles')
    const want = dash.vehicles.map((v) => cars.find((c) => c.id === v.id).nickname)
    const names = await page.locator('.cars > li:not(.archived) h2').allTextContents()
    if (names.join('|') !== want.join('|')) throw new Error(`cards ${names}, want ${want}`)
    await summaryShows(dash)
    noLatin((await summary.textContent()).replace(/[A-Z]{3}/, ''), 'summary')
    // The first 3 tasks, most urgent first, with status and remaining; All tasks (4); a car without tasks says so.
    if ((await dashNames()).join('|') !== 'Oil|Brakes|Air filter') throw new Error(`tasks ${await dashNames()}`)
    if ((await dashRow('Oil').locator('.badge.status').textContent()) !== D.status.Overdue) throw new Error('Oil badge')
    if ((await dashRow('Brakes').locator('.badge.status').textContent()) !== D.status.DueSoon) throw new Error('Brakes badge')
    if (!plain(await dashRow('Oil').textContent()).includes(RS.oilLate)) throw new Error(`Oil row "${plain(await dashRow('Oil').textContent())}"`)
    if ((await cardCounts()) !== `${D.overdue(1)}|${D.soon(1)}`) throw new Error(`card counts ${await cardCounts()}`)
    const all = plain(await dashCar().locator(`.actions a[href="/cars/${dashCarId}"]`).textContent())
    if (all !== D.all(4)) throw new Error(`All tasks link "${all}"`)
    const bike = page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Dash bike', exact: true }) })
    if (!(await bike.textContent()).includes(D.noTasks) || !(await bike.getByRole('link', { name: D.addTask, exact: true }).count())) throw new Error('no-tasks state')
    // Criterion 10: at 390px nothing overflows and the controls are 44px tall.
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the dashboard')
    await sweep('the dashboard')
    await tall(dashCar().locator('.quick input[type=number]'), 'quick entry')
    // Criterion 4: the month links to /history for this month, which shows the same count and total.
    const month = summary.locator('a')
    if ((await month.getAttribute('href')) !== `/history?from=${dash.month}-01&to=${today}`) throw new Error(`month link ${await month.getAttribute('href')}`)
    await month.click()
    await arrivedAt(HS.title)
    if (dash.monthServiceCount) await summaryIs(dash.monthServiceCount, dash.monthTotalCost)
    await page.goBack()
    await dashCar().waitFor()
    await page.setViewportSize(s.viewport)
  })
  // Counts the moments, at each DOM change and each frame, when focus is on body or the task's row is missing.
  const watchUndo = (id) => page.evaluate((id) => {
    const w = (window.undoWatch = { body: 0, gone: 0, on: true })
    const check = () => {
      if (document.activeElement === document.body) w.body++
      if (!document.querySelector(`.dash-tasks > li[data-id="${id}"]`)) w.gone++
    }
    w.mo = new MutationObserver(check)
    w.mo.observe(document.querySelector('main'), { subtree: true, childList: true, attributes: true })
    const tick = () => { check(); if (w.on) requestAnimationFrame(tick) }
    tick()
  }, id)
  const watched = () => page.evaluate(() => { const w = window.undoWatch; w.on = false; w.mo.disconnect(); return { body: w.body, gone: w.gone } })
  await step('dashboard-mark-done', async () => {
    const before = await dashApi()
    const sent = page.waitForRequest(isReset)
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).click()
    if ((await sent).postDataJSON().date !== (await localDate())) throw new Error('reset not dated with the local date')
    // Criterion 5: focus on the row's Undo; Oil restarts and stays shown with its Undo though it is now 4th; the counts drop.
    await focusIs(`li[data-id="${taskIds.Oil}"] .undo button`, 'Undo after Mark done')
    if ((await dashNames()).join('|') !== 'Brakes|Air filter|Coolant|Oil') throw new Error(`tasks after Mark done ${await dashNames()}`)
    if (!plain(await dashRow('Oil').textContent()).includes(RS.oilLeft)) throw new Error(`Oil row "${plain(await dashRow('Oil').textContent())}"`)
    if ((await cardCounts()) !== `${D.overdue(0)}|${D.soon(1)}`) throw new Error(`card counts ${await cardCounts()}`)
    const after = await dashApi()
    if (after.overdueCount !== before.overdueCount - 1) throw new Error(`overdue ${before.overdueCount} -> ${after.overdueCount}`)
    await summaryShows(after)
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-undo.png`, fullPage: true })
    // Undo restores it, with focus back on its Mark done. LOW-2 L17: straight there, never on body, and the row never leaves the page.
    await watchUndo(taskIds.Oil)
    await dashRow('Oil').locator('.undo button').click()
    await focusIs(`li[data-id="${taskIds.Oil}"] button.done`, 'Mark done after Undo')
    let w = await watched()
    if (w.body || w.gone) throw new Error(`during Undo: focus on body ${w.body} times, Oil row gone ${w.gone} times`)
    if ((await dashNames()).join('|') !== 'Oil|Brakes|Air filter') throw new Error(`tasks after Undo ${await dashNames()}`)
    if (!plain(await dashRow('Oil').textContent()).includes(RS.oilLate)) throw new Error('Oil not overdue again')
    await summaryShows(before)
    // LOW-2 review M1: ticking Show archived while Undo is in flight ends the Undo bar.
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).click()
    await focusIs(`li[data-id="${taskIds.Oil}"] .undo button`, 'Undo after Mark done')
    let release
    const held = new Promise((r) => { release = r })
    await page.route('**/void', async (r) => { await held; await r.continue() }, { times: 1 })
    await dashRow('Oil').locator('.undo button').click()
    const archived = page.locator('main > label.inline input')
    await archived.check()
    release()
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).waitFor()
    await page.waitForLoadState('networkidle')
    if (await page.locator('.cars .undo').count()) throw new Error('Undo bar outlived the Show archived toggle')
    const reloaded = page.waitForResponse((r) => isDashGet(new URL(r.url())))
    await archived.uncheck()
    await reloaded
    // LOW-2 L22: Undo is 44px at 390px; when the restored task is no longer among the first 3, focus goes to the car's h2 link.
    await page.setViewportSize({ width: 390, height: 844 })
    await dashRow('Oil').getByRole('button', { name: RS.done + 'Oil', exact: true }).click()
    await focusIs(`li[data-id="${taskIds.Oil}"] .undo button`, 'Undo after Mark done')
    await tall(dashRow('Oil').locator('.undo button'), 'dashboard Undo')
    // The reload after Undo ranks Oil last, as if it had been done elsewhere meanwhile.
    const oilLast = async (r) => {
      const res = await r.fetch()
      const json = await res.json()
      for (const v of json.vehicles) for (const t of v.tasks) if (t.id === taskIds.Oil) Object.assign(t, { status: 'Ok', progress: 0, remainingKm: 10000 })
      await r.fulfill({ response: res, json })
    }
    await page.route(isDashGet, oilLast, { times: 1 })
    await watchUndo(taskIds.Oil)
    await dashRow('Oil').locator('.undo button').click()
    await focusIs(`.cars > li[data-id="${dashCarId}"] h2 a`, 'the car link after Undo')
    w = await watched()
    if (w.body) throw new Error(`during Undo: focus on body ${w.body} times`)
    if (await dashRow('Oil').count()) throw new Error('Oil still shown outside the first 3')
    await page.setViewportSize(s.viewport)
    // Criterion 8: a failed Mark done shows on that row, keeps the page, and focus returns to Mark done.
    await page.route('**/reset', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await dashRow('Brakes').getByRole('button', { name: RS.done + 'Brakes', exact: true }).click()
    const alert = dashRow('Brakes').locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== RS.generic) throw new Error(`row error "${await alert.textContent()}"`)
    await focusIs(`li[data-id="${taskIds.Brakes}"] button.done`, 'Mark done after a failure')
    if (await page.locator('main > .row [role=alert]').count()) throw new Error('a page-level error')
    forget500()
  })
  await step('dashboard-quick-odometer', async () => {
    await page.evaluate(() => { window.noReload = true })
    const before = await dashApi()
    // A failed save shows on that card only.
    await page.route((u) => u.pathname === `/api/vehicles/${dashCarId}/odometer`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await dashCar().locator('.quick input[type=number]').fill('51500')
    await dashCar().locator('.quick button').click()
    const alert = dashCar().locator('.quick [role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`quick entry error "${await alert.textContent()}"`)
    if (await page.locator('main > .row [role=alert]').count()) throw new Error('a page-level error')
    forget500()
    const brakesError = dashRow('Brakes').locator('[role=alert]')
    if (!(await brakesError.count())) throw new Error("the failed Mark done's error went without a reload")
    // Criterion 6: the card's odometer and statuses and the summary follow, without a page reload.
    await dashCar().locator('.quick button').click()
    await page.waitForFunction((id) => document.querySelector(`.cars > li[data-id="${id}"] .odometer`)?.getAttribute('aria-label').startsWith('51,500'), dashCarId, { timeout: 5000 })
    if (!plain(await dashRow('Brakes').textContent()).includes(D.brakesLate)) throw new Error(`Brakes row "${plain(await dashRow('Brakes').textContent())}"`)
    if ((await cardCounts()) !== `${D.overdue(2)}|${D.soon(0)}`) throw new Error(`card counts ${await cardCounts()}`)
    const after = await dashApi()
    if (after.overdueCount !== before.overdueCount + 1 || after.dueSoonCount !== before.dueSoonCount - 1) throw new Error('API counts did not follow')
    await summaryShows(after)
    if (await alert.count()) throw new Error('the error stayed after saving')
    // LOW-2 L24: the reload clears the row's Mark done error.
    if (await brakesError.count()) throw new Error("the failed Mark done's error stayed after the reload")
    if (!(await page.evaluate(() => window.noReload))) throw new Error('the page reloaded')
  })
  await step('dashboard-long-name', async () => {
    // LOW-2 L25: a long task name wraps beside its status badge, at 390px and 1280px, without overflow.
    const long = 'Replace the timing belt, the water pump and every tensioner and idler pulley on the engine'
    const rename = async (r) => {
      const res = await r.fetch()
      const json = await res.json()
      for (const v of json.vehicles) for (const t of v.tasks) if (t.id === taskIds.Brakes) t.name = long
      await r.fulfill({ response: res, json })
    }
    await page.route(isDashGet, rename)
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      await page.reload()
      const row = dashRow(long)
      await row.waitFor()
      const m = await row.evaluate((li) => {
        const name = li.querySelector('.name'), n = name.getBoundingClientRect(), b = li.querySelector('.badge.status').getBoundingClientRect()
        return { rtl: getComputedStyle(li).direction === 'rtl', line: parseFloat(getComputedStyle(name).lineHeight), n: n.toJSON(), b: b.toJSON() }
      })
      if (m.n.height < 2 * m.line - 1) throw new Error(`the name did not wrap at ${width}px`)
      if (m.b.top > m.n.top + m.line) throw new Error(`the badge is below the name's first line at ${width}px`)
      if (m.rtl ? m.b.right > m.n.left + 1 : m.b.left < m.n.right - 1) throw new Error(`the badge is not beside the name at ${width}px`)
      await noOverflow(`a long task name at ${width}px`)
      await page.screenshot({ path: `${OUT}/${s.name}-dashboard-long-name-${width}.png`, fullPage: true })
    }
    await page.unroute(isDashGet, rename)
    await page.setViewportSize(s.viewport)
    await page.reload()
    await dashCar().waitFor()
  })
  await step('dashboard-archive-fails', async () => {
    // LOW-2 L23: a failed archive shows a translated error on that card, which stays as it was, with focus back on Archive.
    const bike = page.locator('.cars > li').filter({ has: page.getByRole('link', { name: 'Dash bike', exact: true }) })
    const bikeId = await bike.getAttribute('data-id')
    const archive = bike.getByRole('button', { name: he ? 'העברה לארכיון' : 'Archive', exact: true })
    await page.route('**/archive', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await archive.click()
    const alert = bike.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`archive error "${await alert.textContent()}"`)
    await focusIs(`.cars > li[data-id="${bikeId}"] .actions button`, 'Archive after a failed archive')
    if (await page.locator('main > .row [role=alert]').count()) throw new Error('a page-level error')
    if ((await bike.getAttribute('class')).includes('archived') || !(await dashCar().count())) throw new Error('the page changed')
    forget500()
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the archive error')
    await tall(archive, 'Archive')
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-archive-error.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    // Archived for real, the card leaves the dashboard.
    await archive.click()
    await bike.waitFor({ state: 'detached' })
  })
  // MVP5-A: checklist templates on /checklists.
  const CL = he
    ? { title: 'רשימות בדיקה', add: 'רשימת בדיקה חדשה', empty: 'עדיין אין רשימות בדיקה. צרו רשימה כדי להשתמש בה ברכבים שלכם.', addItem: 'הוספת פריט',
        three: '3 פריטים', edit: 'עריכה של ', del: 'מחיקה של ', confirm: 'למחוק את רשימת הבדיקה הזו?', name: 'הזינו שם של עד 100 תווים.', remove2: 'הסרת פריט ⁦2⁩',
        range: 'פריט 2: הזינו מינימום ומקסימום בין -1,000,000 ל־1,000,000, עם עד 2 ספרות אחרי הנקודה. המינימום לא יכול להיות גבוה מהמקסימום.',
        up: (n) => `הזזת פריט ⁦${n}⁩ למעלה`, unit: (n) => `פריט ${n}, יחידה` }
    : { title: 'Checklists', add: 'New checklist', empty: 'No checklists yet. Create one to use on your cars.', addItem: 'Add item',
        three: '3 items', edit: 'Edit ', del: 'Delete ', confirm: 'Delete this checklist?', name: 'Enter a name of up to 100 characters.', remove2: 'Remove item 2',
        range: 'Item 2: Enter a min and max from -1,000,000 to 1,000,000 with up to 2 decimals, and a min not above the max.',
        up: (n) => `Move item ${n} up`, unit: (n) => `Item ${n}, Unit` }
  const clNew = page.getByRole('button', { name: CL.add, exact: true })
  const clForm = page.locator('main form')
  const clSave = clForm.locator('> .actions > button:not(.link)')
  const clRows = page.locator('main .checklists > li')
  const clRow = (name) => clRows.filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const clItem = (i) => clForm.locator('fieldset.item').nth(i)
  const clLabels = () => clForm.locator('fieldset.item').evaluateAll((fs) => fs.map((f) => f.querySelector('input').value).join())
  const clTypes = () => clForm.locator('fieldset.item select').evaluateAll((xs) => xs.map((x) => x.value).join())
  const isTemplateSave = (r) => r.url().includes('/api/checklist-templates') && ['POST', 'PUT'].includes(r.request().method())
  const forget400 = () => {
    run.badResponses = run.badResponses.filter((r) => !(r.startsWith('400 ') && r.includes('/checklist-templates')))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes('status of 400'))
  }
  let clIds
  await step('checklists-empty', async () => {
    // Criterion 8: a failed load shows a translated error with Retry; Retry focuses the h1. Every load fails until unrouted (StrictMode loads twice).
    await page.route('**/api/checklist-templates', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.click('header nav a[href="/checklists"]')
    await arrivedAt(CL.title)
    const alert = page.locator('main [role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    await page.unroute('**/api/checklist-templates')
    forget500()
    await page.getByRole('button', { name: HS.retry, exact: true }).click()
    await focusIs('main h1', 'h1 after Retry')
    // The empty state offers New checklist.
    await page.getByText(CL.empty, { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await tall(clNew, 'New checklist')
    await sweep('the empty checklists page')
    await noOverflow('the empty checklists page')
  })
  await step('checklist-create', async () => {
    // Criterion 11: focus on the name when the form opens; Escape cancels and returns to New checklist.
    await clNew.click()
    await focusIs('main form input[name=name]', 'the name after New checklist')
    await page.keyboard.press('Escape')
    await focusIs('main button.add', 'New checklist after Escape')
    if (await clForm.count()) throw new Error('the form stayed open')
    await clNew.click()
    // Criterion 6: an empty name is stopped by the browser with the translated message, before any request.
    let sent = 0
    const count = (r) => { if (r.url().includes('/api/checklist-templates') && r.method() === 'POST') sent++ }
    page.on('request', count)
    await clSave.click()
    const nameMsg = await clForm.locator('input[name=name]').evaluate((el) => el.validationMessage)
    if (plain(nameMsg) !== CL.name) throw new Error(`name message "${nameMsg}"`)
    await clForm.locator('input[name=name]').fill('Monthly quick check')
    const addItem = clForm.getByRole('button', { name: CL.addItem, exact: true })
    // Criterion 4: a Checkbox, a Number with unit and range, and a Text item; focus goes to each new label.
    await addItem.click()
    await focusIs('main form fieldset.item:nth-of-type(1) input', 'the new label')
    await page.keyboard.type('Lights')
    await addItem.click()
    await focusIs('main form fieldset.item:nth-of-type(2) input', 'the second label')
    await page.keyboard.type('Tire pressure')
    if ((await clItem(1).locator('input').count()) !== 1) throw new Error('unit, min or max shown for a Checkbox item')
    await clItem(1).locator('select').selectOption('Number')
    const [unit, min, max] = [1, 2, 3].map((n) => clItem(1).locator('input').nth(n))
    if (plain(await unit.getAttribute('aria-label')) !== CL.unit(2)) throw new Error(`unit name "${await unit.getAttribute('aria-label')}"`)
    await unit.fill('bar')
    await min.fill('2.0')
    await max.fill('1.5')
    await addItem.click()
    await page.keyboard.type('Notes')
    await clItem(2).locator('select').selectOption('Text')
    page.off('request', count)
    if (sent) throw new Error('a request was sent with an empty name')
    // Min above max: the API's message on that row, tied to min and max; everything typed stays.
    await clSave.click()
    const rowAlert = clItem(1).locator('[role=alert]')
    await rowAlert.waitFor()
    if (plain(await rowAlert.textContent()) !== CL.range) throw new Error(`range error "${await rowAlert.textContent()}"`)
    if ((await min.getAttribute('aria-invalid')) !== 'true' || (await max.getAttribute('aria-describedby')) !== (await rowAlert.getAttribute('id'))) throw new Error('range error not tied to min and max')
    if ((await clForm.locator('[role=alert]').count()) !== 1) throw new Error('the error shows twice')
    forget400()
    await max.fill('2.6')
    // A negative min reads "-5.5" in Hebrew too: min and max are LTR, aligned to the page's start side.
    await min.fill('-5.5')
    const pageDir = await page.evaluate(() => document.documentElement.dir)
    for (const x of [min, max]) {
      const [dir, align] = await x.evaluate((el) => [getComputedStyle(el).direction, getComputedStyle(el).textAlign])
      if (dir !== 'ltr' || align !== (pageDir === 'rtl' ? 'right' : 'start')) throw new Error(`min/max direction ${dir} ${align}`)
    }
    // A failed save keeps the form and what was typed, with a translated error.
    await page.route('**/api/checklist-templates', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await clSave.click()
    await clForm.locator('[role=alert]', { hasText: HS.generic }).waitFor()
    forget500()
    if ((await clLabels()) !== 'Lights,Tire pressure,Notes' || (await max.inputValue()) !== '2.6') throw new Error('values lost after a failed save')
    noLatin(plain((await clForm.locator('label, legend, option').allTextContents()).join()), 'checklist form labels')
    await noOverflow('the checklist form with three items')
    await sweep('the checklist form')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-form.png`, fullPage: true })
    const res = page.waitForResponse(isTemplateSave)
    await clSave.click()
    const r = await res
    const body = r.request().postDataJSON()
    const tp = await r.json()
    if (r.status() !== 201 || body.items[0].unit !== undefined || body.items[1].minValue !== -5.5 || body.items[1].maxValue !== 2.6 || body.items[1].unit !== 'bar') throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    clIds = tp.items.map((i) => i.id)
    // Criterion 11: after Save, focus on the template's Edit.
    await focusIs(`.checklists li[data-id="${tp.id}"] button.edit`, 'Edit after Save')
    if (plain(await clRow('Monthly quick check').locator('.task-head .muted').textContent()) !== CL.three) throw new Error('item count')
    // After a reload the items are there in the same order, with the Number's unit and range (GET's 2.60 shown as 2.6).
    await page.reload()
    await clRow('Monthly quick check').getByRole('button', { name: `${CL.edit}Monthly quick check`, exact: true }).click()
    if ((await clLabels()) !== 'Lights,Tire pressure,Notes' || (await clTypes()) !== 'Check,Number,Text') throw new Error(`after reload ${await clLabels()} ${await clTypes()}`)
    if ([await unit.inputValue(), await min.inputValue(), await max.inputValue()].join() !== 'bar,-5.5,2.6') throw new Error('unit or range after reload')
    await page.keyboard.press('Escape')
    await focusIs('.checklists button.edit', 'Edit after Escape')
  })
  await step('checklist-edit', async () => {
    // Criterion 5: rename, relabel, reorder with the buttons, change a type, remove one and add one.
    await clRow('Monthly quick check').locator('button.edit').click()
    await focusIs('main form input[name=name]', 'the name on Edit')
    await clForm.locator('input[name=name]').fill('Monthly check')
    await clItem(2).locator('input').first().fill('Notes v2')
    await clForm.getByRole('button', { name: CL.up(3), exact: true }).click()
    await focusIs('main form fieldset.item:nth-of-type(2) button.up', 'Move up after moving up')
    await clForm.getByRole('button', { name: CL.up(2), exact: true }).click()
    // At the top its Move up is disabled, so focus moves to its Move down.
    await focusIs('main form fieldset.item:nth-of-type(1) button.down', 'Move down at the top')
    if ((await clLabels()) !== 'Notes v2,Lights,Tire pressure') throw new Error(`order ${await clLabels()}`)
    // Number to Text hides and clears unit, min and max; back to Number they are empty.
    await clItem(2).locator('select').selectOption('Text')
    if ((await clItem(2).locator('input').count()) !== 1) throw new Error('unit, min or max still shown')
    await clItem(2).locator('select').selectOption('Number')
    if ((await clItem(2).locator('input').evaluateAll((xs) => xs.slice(1).map((x) => x.value).join(''))) !== '') throw new Error('unit, min or max not cleared')
    await clItem(2).locator('select').selectOption('Check')
    // Remove Lights: focus goes to the row that took its place.
    await clItem(1).getByRole('button', { name: CL.remove2, exact: true }).click()
    await focusIs('main form fieldset.item:nth-of-type(2) input', 'the next label after Remove')
    await clForm.getByRole('button', { name: CL.addItem, exact: true }).click()
    await page.keyboard.type('Wipers')
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the edit form')
    await sweep('the edit form')
    const res = page.waitForResponse(isTemplateSave)
    await clSave.click()
    const r = await res
    const body = r.request().postDataJSON()
    const tp = await r.json()
    if (r.status() !== 200 || body.items[1].unit !== undefined || body.items.map((i) => i.id ?? '').join() !== `${clIds[2]},${clIds[1]},`) throw new Error(`${r.status()} ${JSON.stringify(body)}`)
    if (tp.items[0].id !== clIds[2] || tp.items[1].id !== clIds[1] || !tp.items[2].id) throw new Error('item ids not kept')
    await focusIs(`.checklists li[data-id="${tp.id}"] button.edit`, 'Edit after saving an edit')
    await page.reload()
    await clRow('Monthly check').locator('button.edit').click()
    if ((await clLabels()) !== 'Notes v2,Tire pressure,Wipers' || (await clTypes()) !== 'Text,Check,Check') throw new Error(`after reload ${await clLabels()} ${await clTypes()}`)
    await clForm.locator('> .actions > button.link').click() // Cancel
    await focusIs('.checklists button.edit', 'Edit after Cancel')
  })
  await step('checklist-delete', async () => {
    // A second template, sorted first, so deleting it moves focus to the next row's Edit.
    const token = await page.evaluate(() => localStorage.getItem('token'))
    await page.request.post(`${BASE}/api/checklist-templates`, { headers: { Authorization: `Bearer ${token}` }, data: { name: 'Another check', items: [] } })
    await page.reload()
    await clRow('Another check').waitFor()
    const del = (name) => clRow(name).getByRole('button', { name: `${CL.del}${name}`, exact: true })
    // Criterion 7: Delete asks first, with the red confirm; Escape goes back to Delete.
    await del('Another check').click()
    await clRow('Another check').getByText(CL.confirm, { exact: true }).waitFor()
    const danger = clRow('Another check').locator('button.danger')
    const bg = await danger.evaluate((el) => getComputedStyle(el).backgroundColor)
    const want = await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--danger)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c })
    if (bg !== want) throw new Error(`confirm ${bg}, want ${want}`)
    await page.setViewportSize({ width: 390, height: 844 })
    await sweep('the delete confirm')
    await noOverflow('the delete confirm')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-delete-confirm.png`, fullPage: true })
    await page.keyboard.press('Escape')
    await focusIs('.checklists > li:nth-child(1) .actions button:not(.edit)', 'Delete after Escape')
    await del('Another check').click()
    await danger.click()
    await clRow('Another check').waitFor({ state: 'detached' })
    await focusIs('.checklists > li:nth-child(1) button.edit', 'the next row\'s Edit after Delete')
    // The last one: focus goes to New checklist, and the empty state is back.
    await del('Monthly check').click()
    await clRow('Monthly check').locator('button.danger').click()
    await page.getByText(CL.empty, { exact: true }).waitFor()
    await focusIs('main button.add', 'New checklist after deleting the last')
    await page.reload()
    await page.getByText(CL.empty, { exact: true }).waitFor()
    await page.setViewportSize(s.viewport)
  })
  // MVP5-B: checklists on a car (Dash car), runs, run history, the dashboard's Start a checklist, and a template in use.
  const CK = he
    ? { add: 'הוספת רשימת בדיקה', none: 'עדיין אין רשימות בדיקה לרכב הזה.', noTemplates: 'עדיין אין לך רשימות בדיקה. אפשר ליצור רשימה בדף רשימות הבדיקה.',
        allAttached: 'כל רשימות הבדיקה שלך כבר משויכות לרכב הזה. אפשר ליצור רשימה נוספת.', manual: 'ידני בלבד', ok: 'תקין', off: 'לא פעילה',
        left: 'עוד 5,000 ק״מ או 30 ימים', notRun: 'עדיין לא בוצעה', runOf: (n) => `ביצוע ${n}`, editOf: (n) => `עריכה של ${n}`, removeOf: (n) => `הסרה של ${n} מהרכב`,
        title: (n, c) => `⁨${n}⁩ לרכב ⁨${c}⁩`, notOk: 'לא תקין', notOkReason: 'סומן כבעיה: לא תקין', below: 'סומן כבעיה: מתחת ל־2 bar', range: 'טווח 2 עד 2.6 bar',
        field: (l, f) => `${l}: ${f}`, flag: 'סימון כבעיה', value: 'ערך', saved3: 'הבדיקה נשמרה. סומנו 3 בעיות.', history: (n) => `היסטוריה (${n})`, flagged3: '3 בעיות',
        hasRuns: 'כבר בוצעו בדיקות לפי הרשימה הזו, ולכן אי אפשר להסיר אותה. במקום זה אפשר להשבית אותה.', confirmRun: 'למחוק את הבדיקה הזו? גם קריאת הקילומטראז׳ שלה תימחק.',
        lower: 'הקריאה נמוכה מהקריאה שלפניה', start: 'ביצוע רשימת בדיקה', startOf: (n) => `ביצוע רשימת בדיקה: ${n}`,
        inUse: 'רשימת הבדיקה משויכת לרכב, ולכן אי אפשר למחוק אותה. קודם הסירו אותה מהרכב.',
        item2: 'פריט 2: הערך לא מתאים לפריט.', changed: 'רשימת הבדיקה השתנתה מאז שפתחתם אותה.', future: 'התאריך לא יכול להיות בעתיד.' }
    : { add: 'Add a checklist', none: 'No checklists on this car yet.', noTemplates: 'You have no checklists yet. Create one on the Checklists page.',
        allAttached: 'All your checklists are already on this car. Create another one.', manual: 'Manual only', ok: 'OK', off: 'Disabled',
        left: '5,000 km or 30 days left', notRun: 'Not run yet', runOf: (n) => `Run ${n}`, editOf: (n) => `Edit ${n}`, removeOf: (n) => `Remove ${n} from this car`,
        title: (n, c) => `${n} for ${c}`, notOk: 'Not OK', notOkReason: 'Flagged: Not OK', below: 'Flagged: below 2 bar', range: 'Range 2 to 2.6 bar',
        field: (l, f) => `${l}: ${f}`, flag: 'Flag', value: 'Value', saved3: 'Run saved. 3 items flagged.', history: (n) => `History (${n})`, flagged3: '3 flagged',
        hasRuns: "This checklist has runs, so it can't be removed. Turn it off instead.", confirmRun: 'Delete this run? Its odometer reading is deleted with it.',
        lower: 'This reading is lower than the reading before it', start: 'Start a checklist', startOf: (n) => `Start a checklist: ${n}`,
        inUse: "This checklist is on a car, so it can't be deleted. Remove it from the car first.",
        item2: "Item 2: This value doesn't fit the item.", changed: 'This checklist has changed since you opened it.', future: "The date can't be in the future." }
  const ckSec = page.locator('section[aria-labelledby=checklists]')
  const ckRow = (name) => ckSec.locator('.car-checklists > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
  const ckForm = ckSec.locator('form')
  // Hebrew names carry bidi isolates around free text, so these compare the name without them.
  async function named(loc, name) {
    await loc.waitFor()
    if (plain(await loc.getAttribute('aria-label')) !== name) throw new Error(`name "${await loc.getAttribute('aria-label')}", want "${name}"`)
    return loc
  }
  const runForm = page.locator('main form')
  const runItem = (i) => runForm.locator('fieldset.item').nth(i)
  const forgetCk = (status, part) => {
    run.badResponses = run.badResponses.filter((r) => !(r.startsWith(`${status} `) && r.includes(part)))
    run.consoleErrors = run.consoleErrors.filter((e) => !e.includes(`status of ${status}`))
  }
  const ckCarPath = () => `/cars/${dashCarId}`
  let monthlyTpl, monthlyId
  await step('checklist-attach', async () => {
    await page.goto(`${BASE}${ckCarPath()}`)
    // Empty states: none on the car, and no templates yet, with a link to /checklists. Escape goes back to Add a checklist.
    await ckSec.getByText(CK.none, { exact: true }).waitFor()
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    const empty = ckSec.locator('.inline-form p')
    await empty.waitFor()
    if (plain(await empty.textContent()) !== CK.noTemplates || !(await empty.locator('a[href="/checklists"]').count())) throw new Error(`no templates "${await empty.textContent()}"`)
    await page.keyboard.press('Escape')
    await focusIs('section[aria-labelledby=checklists] button.add', 'Add a checklist after Escape')
    monthlyTpl = await apiCall('POST', '/checklist-templates', { name: 'Monthly quick check', items: [
      { label: 'Lights', type: 'Check' }, { label: 'Tire pressure', type: 'Number', unit: 'bar', minValue: 2, maxValue: 2.6 }, { label: 'Notes', type: 'Text' }] })
    await apiCall('POST', '/checklist-templates', { name: 'Pre-road-trip', items: [{ label: 'Spare tire', type: 'Check' }] })
    await page.reload()
    // Criterion 6: Monthly quick check every 5,000 km or 30 days; focus goes to its new Run.
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    await focusIs('section[aria-labelledby=checklists] select[name=templateId]', 'the checklist picker')
    await ckForm.locator('select[name=templateId]').selectOption({ label: 'Monthly quick check' })
    await ckForm.locator('input[name=intervalKm]').fill('5000')
    await ckForm.locator('input[name=intervalTime]').fill('30')
    await ckForm.locator('select[name=intervalUnit]').selectOption('days')
    let res = page.waitForResponse((r) => r.url().endsWith(`/vehicles/${dashCarId}/checklists`) && r.request().method() === 'POST')
    await ckForm.locator('> .actions > button:not(.link)').click()
    const attached = await (await res).json()
    monthlyId = attached.id
    if (attached.intervalKm !== 5000 || attached.intervalDays !== 30 || (await res).request().postDataJSON().date !== (await localDate())) throw new Error(JSON.stringify(attached))
    await focusIs(`li[data-id="${monthlyId}"] a.run`, 'Run after attaching')
    const monthly = ckRow('Monthly quick check')
    if (plain(await monthly.locator('.badge.status').textContent()) !== CK.ok) throw new Error('no OK badge')
    if (!plain(await monthly.textContent()).includes(CK.left)) throw new Error(`row "${plain(await monthly.textContent())}"`)
    if (!plain(await monthly.textContent()).includes(CK.notRun)) throw new Error('last run shown before any run')
    // The second, manual only: no badge. The picker no longer offers the first.
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    if ((await ckForm.locator('select[name=templateId] option').allTextContents()).join() !== 'Pre-road-trip') throw new Error('an attached template is offered')
    res = page.waitForResponse((r) => r.url().endsWith(`/vehicles/${dashCarId}/checklists`) && r.request().method() === 'POST')
    await ckForm.locator('> .actions > button:not(.link)').click()
    const manual = await (await res).json()
    await focusIs(`li[data-id="${manual.id}"] a.run`, 'Run after attaching manual only')
    const trip = ckRow('Pre-road-trip')
    if (await trip.locator('.badge.status').count()) throw new Error('a badge on manual only')
    if (!plain(await trip.textContent()).includes(CK.manual)) throw new Error('manual only not shown')
    // With every template attached, Add says so.
    await ckSec.getByRole('button', { name: CK.add, exact: true }).click()
    await ckSec.getByText(CK.allAttached.split('. ')[0] + '.', { exact: false }).waitFor()
    await page.keyboard.press('Escape')
    // Editing turns it off without a reload: no status, a Disabled badge, no Run; focus back on Edit. Then on again.
    for (const on of [false, true]) {
      await monthly.getByRole('button', { name: CK.editOf('Monthly quick check'), exact: true }).click()
      if ((await ckForm.locator('input[name=intervalTime]').inputValue()) !== '1' || (await ckForm.locator('select[name=intervalUnit]').inputValue()) !== 'months') throw new Error('30 days not shown as 1 month')
      await ckForm.locator('input[name=isEnabled]').setChecked(on)
      await ckForm.locator('> .actions > button:not(.link)').click()
      await focusIs(`li[data-id="${monthlyId}"] button.edit`, 'Edit after saving')
      if ((await monthly.locator('.badge.status').count()) !== (on ? 1 : 0) || (await monthly.locator('a.run').count()) !== (on ? 1 : 0)) throw new Error(`enabled ${on}: status or Run`)
      if (!on && !plain(await monthly.textContent()).includes(CK.off)) throw new Error('no Disabled badge')
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the checklists section')
    await sweep('the checklists section')
    await tall(monthly.locator('details > summary'), 'History')
    await page.screenshot({ path: `${OUT}/${s.name}-checklists-on-car.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
  })
  await step('checklist-run', async () => {
    const before = (await apiCall('GET', `/vehicles/${dashCarId}`)).currentOdometerKm
    await (await named(ckRow('Monthly quick check').locator('a.run'), CK.runOf('Monthly quick check'))).click()
    await arrivedAt(CK.title('Monthly quick check', 'Dash car'))
    if ((await runForm.locator('input[name=runAt]').inputValue()) !== (await localDate())) throw new Error('date is not today')
    if ((await runForm.locator('input[name=odometerKm]').inputValue()) !== '') throw new Error('odometer prefilled')
    // Criterion 7: Not OK flags Lights; 1.8 flags Tire pressure as typed, with the reason tied to the field; Notes flagged by hand.
    const notOk = runItem(0).locator('input[type=radio]').nth(1)
    if (plain(await notOk.getAttribute('aria-label')) !== CK.field('Lights', CK.notOk)) throw new Error(`radio name "${await notOk.getAttribute('aria-label')}"`)
    await notOk.check()
    if (plain(await runItem(0).locator('p.flag').textContent()) !== CK.notOkReason) throw new Error('Not OK reason')
    const value = runItem(1).locator('input[type=number]')
    if (plain(await runItem(1).locator('.muted').textContent()) !== CK.range) throw new Error(`range "${await runItem(1).locator('.muted').textContent()}"`)
    await value.pressSequentially('1.8')
    const reason = runItem(1).locator('p.flag')
    if (plain(await reason.textContent()) !== CK.below) throw new Error(`reason "${await reason.textContent()}"`)
    if (!(await value.getAttribute('aria-describedby')).includes(await reason.getAttribute('id'))) throw new Error('reason not tied to the value')
    const autoFlag = runItem(1).locator('input[type=checkbox]')
    if (!(await autoFlag.isChecked()) || !(await autoFlag.isDisabled())) throw new Error('auto flag not shown as fixed')
    await value.fill('2')
    if (await reason.count()) throw new Error('2.0 (the min) flagged')
    await value.fill('1.8')
    await runItem(2).locator('textarea').fill('Scratch')
    const hand = runItem(2).locator('input[type=checkbox]')
    if (plain(await hand.getAttribute('aria-label')) !== CK.field('Notes', CK.flag)) throw new Error('flag name')
    await hand.check()
    await runForm.locator('textarea[name=notes]').fill('Before the trip')
    // A lower odometer asks for a correction under the field; everything typed stays.
    await runForm.locator('input[name=odometerKm]').fill('40000')
    await runForm.locator('> .actions > button:not(.link)').click()
    const orderAlert = runForm.locator('> [role=alert]')
    await orderAlert.waitFor()
    if (!plain(await orderAlert.textContent()).startsWith(CK.lower)) throw new Error(`order error "${await orderAlert.textContent()}"`)
    await runForm.locator('> label.inline input[type=checkbox]').waitFor()
    forgetCk(400, '/runs')
    // A failed save keeps everything, with a translated error.
    await runForm.locator('input[name=odometerKm]').fill(String(before + 500))
    await page.route('**/runs', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 })
    await runForm.locator('> .actions > button:not(.link)').click()
    await runForm.locator('[role=alert]', { hasText: HS.generic }).waitFor()
    forget500()
    if ((await value.inputValue()) !== '1.8' || !(await notOk.isChecked()) || !(await hand.isChecked())) throw new Error('answers lost after a failed save')
    // An item error shows inside its item, with the value marked invalid; a changed checklist shows above Save.
    const fail = (body) => page.route('**/runs', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(body) }), { times: 1 })
    await fail({ code: 'checklistItem.invalidValue', index: 1 })
    await runForm.locator('> .actions > button:not(.link)').click()
    const itemAlert = runItem(1).locator('[role=alert]')
    await itemAlert.waitFor()
    if (!plain(await itemAlert.textContent()).startsWith(CK.item2)) throw new Error(`item error "${await itemAlert.textContent()}"`)
    if ((await value.getAttribute('aria-invalid')) !== 'true') throw new Error('the item value is not marked invalid')
    await fail({ code: 'checklistRun.itemsChanged' })
    await runForm.locator('> .actions > button:not(.link)').click()
    const changed = runForm.locator('> [role=alert]')
    await changed.waitFor()
    if (!plain(await changed.textContent()).startsWith(CK.changed) || !(await changed.evaluate((el) => el.nextElementSibling.matches('.actions')))) throw new Error(`itemsChanged "${await changed.textContent()}"`)
    forgetCk(400, '/runs')
    // A future date is stopped in the browser, with the translated message.
    const runAt = runForm.locator('input[name=runAt]')
    let posted = false
    const onPost = (r) => { if (r.url().endsWith('/runs') && r.method() === 'POST') posted = true }
    page.on('request', onPost)
    await runAt.fill(await page.evaluate(() => new Date(Date.now() + 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)))
    await runForm.locator('> .actions > button:not(.link)').click()
    const msg = await runAt.evaluate((el) => el.validationMessage)
    page.off('request', onPost)
    if (msg !== CK.future || posted) throw new Error(`future date: "${msg}", posted ${posted}`)
    await runAt.fill(await localDate())
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the run form')
    await sweep('the run form')
    for (const r of [notOk, hand]) await tall(r.locator('xpath=..'), 'an item control')
    const [dir, align] = await value.evaluate((el) => [getComputedStyle(el).direction, getComputedStyle(el).textAlign])
    if (dir !== 'ltr' || align !== (he ? 'right' : 'start')) throw new Error(`value direction ${dir} ${align}`)
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-run-form.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    const res = page.waitForResponse((r) => r.url().endsWith('/runs') && r.request().method() === 'POST')
    await runForm.locator('> .actions > button:not(.link)').click()
    const body = (await res).request().postDataJSON()
    if (body.items[0].numberValue !== undefined || body.items[1].numberValue !== 1.8 || body.items[1].boolValue !== undefined || body.items[2].isFlagged !== true) throw new Error(JSON.stringify(body))
    // Back on the car: the status line, focus on that Run, the new odometer and last run.
    await page.waitForURL((u) => u.pathname === ckCarPath())
    const status = ckSec.locator('[role=status]', { hasText: CK.saved3.slice(0, 6) })
    await status.waitFor()
    if (plain(await status.textContent()) !== CK.saved3) throw new Error(`status "${await status.textContent()}"`)
    await focusIs(`li[data-id="${monthlyId}"] a.run`, 'Run after saving a run')
    if (digitsOnly(await odometer()) !== String(before + 500)) throw new Error(`odometer ${await odometer()}`)
    // Back doesn't reopen the saved run form (a second save would make a duplicate run).
    await page.goBack()
    await page.waitForLoadState('networkidle')
    if (new URL(page.url()).pathname !== ckCarPath() || (await page.locator('fieldset.item').count())) throw new Error(`Back went to ${page.url()}`)
    const monthly = ckRow('Monthly quick check')
    if (plain(await monthly.textContent()).includes(CK.notRun)) throw new Error('last run not updated')
    // After a reload it is all still there, without the status line.
    await page.reload()
    await monthly.waitFor()
    if (plain(await monthly.locator('details > summary').first().textContent()) !== CK.history(1)) throw new Error('history count')
    if (digitsOnly(await odometer()) !== String(before + 500)) throw new Error('odometer after reload')
    if (await ckSec.locator('[role=status]', { hasText: CK.saved3.slice(0, 6) }).count()) throw new Error('the status line came back after a reload')
  })
  // MVP5-C: Dash car's to-dos, from the run's flagged items (Lights, Tire pressure, Notes) and by hand; the dashboard's open count.
  const IS = he
    ? { empty: 'אין מטלות פתוחות.', create: (l) => `יצירת מטלה: ${l}`, created: (l) => `נוצרה מטלה: ${l}`, from: (n, d) => `מקור: ${n}, ${d}`,
        done: (x) => `סימון כבוצעה: ${x}`, reopen: (x) => `פתיחה מחדש של ${x}`, edit: (x) => `עריכה של ${x}`, del: (x) => `מחיקה של ${x}`,
        doneN: (n) => `בוצעו (${n})`, doneOn: (d) => `בוצעה ב־${d}`, markedDone: (x) => `${x}: סומנה כבוצעה.`, reopened: (x) => `${x}: נפתחה מחדש.`,
        gone: 'המטלה הזו כבר נמחקה, והרשימה עודכנה.', duplicate: 'כבר יש מטלה לפריט הזה.', confirm: 'למחוק את המטלה הזו?',
        open: (n) => (n === 1 ? 'מטלה פתוחה אחת' : n === 2 ? 'שתי מטלות פתוחות' : `${n} מטלות פתוחות`) }
    : { empty: 'No open to-dos.', create: (l) => `Create to-do: ${l}`, created: (l) => `To-do created: ${l}`, from: (n, d) => `From: ${n}, ${d}`,
        done: (x) => `Done: ${x}`, reopen: (x) => `Reopen ${x}`, edit: (x) => `Edit ${x}`, del: (x) => `Delete ${x}`,
        doneN: (n) => `Done (${n})`, doneOn: (d) => `Done on ${d}`, markedDone: (x) => `${x}: marked as done.`, reopened: (x) => `${x}: reopened.`,
        gone: 'This to-do was already deleted. The list has been updated.', duplicate: 'This item already has a to-do.', confirm: 'Delete this to-do?',
        open: (n) => `${n} open to-do${n === 1 ? '' : 's'}` }
  const isSel = 'section[aria-labelledby=todos]'
  const isSec = page.locator(isSel)
  const isRow = (title) => isSec.locator('.issues > li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${title}$`) }) })
  const fmtDay = (d) => page.evaluate(([d, l]) => new Date(d).toLocaleDateString(l, { dateStyle: 'medium', timeZone: 'UTC' }), [d, s.lng])
  const isPost = (r) => r.url().endsWith(`/vehicles/${dashCarId}/issues`) && r.request().method() === 'POST'
  const isPut = (r) => r.url().includes('/api/issues/') && r.request().method() === 'PUT'
  const at390 = async (what, shot) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow(what)
    await sweep(what)
    await page.screenshot({ path: `${OUT}/${s.name}-${shot}.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
  }
  await step('issue-from-flag', async () => {
    // Criterion 5: the empty state first; then Create to-do on Tire pressure, prefilled, with the title changed.
    await isSec.getByText(IS.empty, { exact: true }).waitFor()
    const monthly = ckRow('Monthly quick check')
    await monthly.locator('details.run-history > summary').click()
    const runRow = monthly.locator('.run-list > li')
    await runRow.locator('summary').click()
    const item = (label) => runRow.locator('.run-items > li').filter({ hasText: label })
    const tire = item('Tire pressure')
    const tireId = await tire.getAttribute('data-id')
    const create = await named(tire.locator('button.create-issue'), IS.create('Tire pressure'))
    await create.click()
    const form = tire.locator('form')
    await focusIs(`li[data-id="${tireId}"] form input[name=title]`, 'the title after Create to-do')
    const date = await fmtDay(await localDate())
    const desc = await form.locator('textarea[name=description]').inputValue()
    if ((await form.locator('input[name=title]').inputValue()) !== 'Tire pressure' || desc !== `1.8 bar, Monthly quick check, ${date}`) throw new Error(`prefilled "${desc}"`)
    await page.keyboard.press('Escape')
    await focusIs(`li[data-id="${tireId}"] button.create-issue`, 'Create to-do after Escape')
    await create.click()
    await form.locator('input[name=title]').fill('Inflate the tires')
    await at390('the Create to-do form', 'issue-from-flag-form')
    const res = page.waitForResponse(isPost)
    await form.locator('.actions > button:not(.link)').click()
    const created = await (await res).json()
    if (created.title !== 'Inflate the tires' || created.source?.runItemId !== tireId) throw new Error(JSON.stringify(created))
    // The item shows To-do created, with focus on it; the to-do is at the top of To-dos with its From line.
    await focusIs(`li[data-id="${tireId}"] button.to-issue`, 'To-do created after saving')
    await named(tire.locator('button.to-issue'), IS.created('Tire pressure'))
    const top = isSec.locator('.open-issues > li').first()
    await top.waitFor()
    if (plain(await top.locator('.name').textContent()) !== 'Inflate the tires' || !plain(await top.textContent()).includes(IS.from('Monthly quick check', date))) throw new Error(`to-do "${plain(await top.textContent())}"`)
    // To-do created moves focus to that to-do.
    await tire.locator('button.to-issue').click()
    await focusIs(`${isSel} li[data-id="${created.id}"] button.edit`, 'the to-do after To-do created')
    // Criterion 8: Lights got a to-do in another tab; Save reloads the history with a note, and Lights shows To-do created.
    const lights = item('Lights')
    const lightsId = await lights.getAttribute('data-id')
    await lights.locator('button.create-issue').click()
    await apiCall('POST', `/vehicles/${dashCarId}/issues`, { title: 'Lights', sourceRunItemId: lightsId })
    await lights.locator('form .actions > button:not(.link)').click()
    await focusIs(`li[data-id="${lightsId}"] button.to-issue`, 'To-do created after a duplicate')
    if (plain(await monthly.locator('details.run-history > [role=status]').textContent()) !== IS.duplicate) throw new Error('no duplicate note')
    forgetCk(409, '/issues')
    await isRow('Lights').waitFor()
    // A reload keeps it all; Notes (no to-do yet) still offers Create to-do.
    await page.reload()
    await monthly.locator('details.run-history > summary').click()
    await runRow.locator('summary').click()
    for (const [l, cls] of [['Tire pressure', 'to-issue'], ['Lights', 'to-issue'], ['Notes', 'create-issue']]) await item(l).locator(`button.${cls}`).waitFor()
    await isSec.locator('.open-issues > li').nth(1).waitFor()
    if ((await isSec.locator('.open-issues > li').count()) !== 2) throw new Error('not 2 open to-dos')
    await at390('the run history with to-dos', 'issue-from-flag')
  })
  await step('issue-manual', async () => {
    // Criterion 8: a failed load shows the translated error with Retry, which focuses the h2.
    const fail500 = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    await page.route('**/issues', (r) => (r.request().method() === 'GET' ? fail500(r) : r.fallback()))
    await page.reload()
    const alert = isSec.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== HS.generic) throw new Error(`load error "${await alert.textContent()}"`)
    await page.unroute('**/issues')
    forget500()
    await isSec.getByRole('button', { name: HS.retry, exact: true }).click()
    await focusIs('#todos', 'the To-dos h2 after Retry')
    // Criterion 11: Add focuses the title; Escape goes back to Add.
    const add = isSec.locator('button.add')
    await add.click()
    await focusIs(`${isSel} form input[name=title]`, 'the title after Add a to-do')
    await page.keyboard.press('Escape')
    await focusIs(`${isSel} button.add`, 'Add a to-do after Escape')
    await add.click()
    const form = isSec.locator('form')
    await form.locator('input[name=title]').fill('Wash the car')
    await form.locator('textarea[name=description]').fill('Inside too')
    // A failed save keeps what was typed, with the translated error by the form.
    await page.route('**/issues', fail500, { times: 1 })
    await form.locator('.actions > button:not(.link)').click()
    await form.locator('[role=alert]', { hasText: HS.generic }).waitFor()
    forget500()
    if ((await form.locator('input[name=title]').inputValue()) !== 'Wash the car' || (await form.locator('textarea').inputValue()) !== 'Inside too') throw new Error('typed text lost')
    await at390('the Add a to-do form', 'issue-add-form')
    let res = page.waitForResponse(isPost)
    await form.locator('.actions > button:not(.link)').click()
    const x = await (await res).json()
    await focusIs(`${isSel} li[data-id="${x.id}"] button.edit`, 'the new to-do')
    if ((await isSec.locator('.open-issues > li').first().getAttribute('data-id')) !== x.id) throw new Error('the new to-do is not at the top')
    const row = () => isSec.locator(`li[data-id="${x.id}"]`)
    // Criterion 6: Done moves it under Done (1) with today's date, announced, with focus on its Reopen.
    const today = await localDate()
    res = page.waitForResponse(isPut)
    await (await named(row().locator('button.done'), IS.done('Wash the car'))).click()
    const body = (await res).request().postDataJSON()
    if (body.status !== 'Done' || body.resolvedAt !== today || body.title !== 'Wash the car' || body.description !== 'Inside too') throw new Error(JSON.stringify(body))
    await focusIs(`${isSel} .done-issues li[data-id="${x.id}"] button.reopen`, 'Reopen after Done')
    if (plain(await isSec.locator('details > summary').textContent()) !== IS.doneN(1)) throw new Error('no Done (1)')
    if (!plain(await row().textContent()).includes(IS.doneOn(await fmtDay(today)))) throw new Error(`done row "${plain(await row().textContent())}"`)
    if (plain(await isSec.locator('> [role=status]').textContent()) !== IS.markedDone('Wash the car')) throw new Error('Done not announced')
    await at390('the done to-dos', 'issue-done')
    // Reopen: back in the open list, focus on its Done.
    res = page.waitForResponse(isPut)
    await (await named(row().locator('button.reopen'), IS.reopen('Wash the car'))).click()
    if ((await res).request().postDataJSON().status !== 'Open') throw new Error('Reopen sent no Open')
    await focusIs(`${isSel} .open-issues li[data-id="${x.id}"] button.done`, 'Done after Reopen')
    if (plain(await isSec.locator('> [role=status]').textContent()) !== IS.reopened('Wash the car') || (await isSec.locator('details').count())) throw new Error('Reopen not shown')
    // Edit: prefilled; Save renames it with focus back on Edit.
    await (await named(row().locator('button.edit'), IS.edit('Wash the car'))).click()
    await focusIs(`${isSel} li[data-id="${x.id}"] input[name=title]`, 'the title after Edit')
    await row().locator('input[name=title]').fill('Wash and vacuum')
    await row().locator('form .actions > button:not(.link)').click()
    await focusIs(`${isSel} li[data-id="${x.id}"] button.edit`, 'Edit after saving')
    await isRow('Wash and vacuum').waitFor()
    // Criterion 8: deleted in another tab: Done reloads the list with a note.
    await page.route(`**/issues/${x.id}`, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'issue.notFound' }) }), { times: 1 })
    await row().locator('button.done').click()
    await isSec.locator('> [role=status]', { hasText: IS.gone }).waitFor()
    forgetCk(404, '/issues/')
    // Delete: the red confirm; Escape goes back to Delete; then focus on the next row's Edit.
    const del = await named(row().locator('.actions button:not(.done, .edit)'), IS.del('Wash and vacuum'))
    await del.click()
    await isSec.getByText(IS.confirm, { exact: true }).waitFor()
    await at390('the to-do delete confirm', 'issue-delete-confirm')
    await page.keyboard.press('Escape')
    await focusIs(`${isSel} li[data-id="${x.id}"] .actions button:not(.done, .edit)`, 'Delete after Escape')
    await del.click()
    await row().locator('button.danger').click()
    await row().waitFor({ state: 'detached' })
    await focusIs(`${isSel} .open-issues > li:nth-child(1) button.edit`, "the next row's Edit after Delete")
  })
  await step('checklist-run-history', async () => {
    // The template item is renamed; the run keeps the label it had.
    await apiCall('PUT', `/checklist-templates/${monthlyTpl.id}`, { name: 'Monthly quick check', items: monthlyTpl.items.map((i) => ({ ...i, label: i.label === 'Tire pressure' ? 'Tyre pressure' : i.label })) })
    await page.reload()
    const monthly = ckRow('Monthly quick check')
    await monthly.locator('details.run-history > summary').click()
    const runRow = monthly.locator('.run-list > li')
    await runRow.waitFor()
    if (!plain(await runRow.locator('summary').textContent()).includes(CK.flagged3) || !(await runRow.textContent()).includes('Before the trip')) throw new Error(`run "${plain(await runRow.textContent())}"`)
    await runRow.locator('summary').click()
    const items = (await runRow.locator('.run-items > li').allTextContents()).map(plain)
    if (items.length !== 3 || !(items[1].startsWith('Tire pressure') && items[1].includes('1.8 bar')) || (await runRow.locator('.run-items > li > .flag').count()) !== 3) throw new Error(`items ${JSON.stringify(items)}`)
    // Remove with runs: the translated hasRuns message, and the row stays.
    await (await named(monthly.locator(':scope > .actions button:not(.edit)'), CK.removeOf('Monthly quick check'))).click()
    await monthly.locator('button.danger').click()
    const alert = monthly.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== CK.hasRuns) throw new Error(`remove error "${await alert.textContent()}"`)
    forgetCk(409, '/vehicle-checklists/')
    await page.keyboard.press('Escape')
    // Delete the run: the red confirm; Escape goes back to Delete; then the odometer goes back and focus moves to the history.
    await runRow.locator('button.delete-run').click()
    await runRow.getByText(CK.confirmRun, { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the run history')
    await sweep('the run history')
    await page.screenshot({ path: `${OUT}/${s.name}-checklist-run-history.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    await page.keyboard.press('Escape')
    await focusIs(`li[data-id="${monthlyId}"] button.delete-run`, 'Delete after Escape')
    const before = digitsOnly(await odometer())
    await runRow.locator('button.delete-run').click()
    await runRow.locator('button.danger').click()
    await runRow.waitFor({ state: 'detached' })
    await focusIs(`li[data-id="${monthlyId}"] details.run-history > summary`, 'History after deleting the last run')
    await page.waitForFunction((b) => document.querySelector('.odometer').getAttribute('aria-label').replace(/\D/g, '') !== b, before, { timeout: 5000 })
    await page.waitForFunction(([id, w]) => document.querySelector(`li[data-id="${id}"] details.run-history > summary`).textContent.replace(/[⁦-⁩]/g, '') === w, [monthlyId, CK.history(0)], { timeout: 5000 })
    // MVP5-C criterion 5: the run's to-dos stay, without their From line.
    await page.waitForFunction((sel) => !document.querySelector(`${sel} .open-issues p.muted`), isSel, { timeout: 5000 })
    if ((await isSec.locator('.open-issues > li').count()) !== 2) throw new Error('the to-dos went with the run')
  })
  await step('dashboard-start-checklist', async () => {
    // Criterion 9: two enabled checklists open a list, most urgent first; Escape goes back to the button.
    await page.click('header a.brand')
    await arrivedAt(T.dashboard)
    const start = dashCar().getByRole('button', { name: CK.start, exact: true })
    await start.click()
    const links = dashCar().locator('.picker a')
    if ((await links.allTextContents()).map(plain).join('|') !== `Monthly quick check${CK.ok}|Pre-road-trip`) throw new Error(`list ${(await links.allTextContents()).join('|')}`)
    await focusIs('.cars .picker a', 'the first checklist')
    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow('the checklist list on a card')
    await sweep('the checklist list on a card')
    await page.screenshot({ path: `${OUT}/${s.name}-dashboard-start-checklist.png`, fullPage: true })
    await page.setViewportSize(s.viewport)
    await page.keyboard.press('Escape')
    await focusIs(`.cars > li[data-id="${dashCarId}"] .actions button.link`, 'Start a checklist after Escape')
    await start.click()
    await links.nth(1).click()
    await arrivedAt(CK.title('Pre-road-trip', 'Dash car'))
    // Cancel goes back where it came from.
    await runForm.locator('> .actions > button.link').click()
    await arrivedAt(T.dashboard)
    // With one enabled checklist, it opens the run page directly. Not on cars without checklists.
    await apiCall('PUT', `/vehicle-checklists/${monthlyId}`, { intervalKm: 5000, intervalDays: 30, isEnabled: false })
    await page.reload()
    await (await named(dashCar().locator('.actions a[href$="/run"]'), CK.startOf('Pre-road-trip'))).click()
    await arrivedAt(CK.title('Pre-road-trip', 'Dash car'))
    await page.goBack()
    await dashCar().waitFor()
    const others = page.locator('.cars > li').filter({ hasNot: page.getByRole('link', { name: 'Dash car', exact: true }) })
    if (await others.getByText(CK.start).count()) throw new Error('Start a checklist on a car without checklists')
  })
  await step('dashboard-open-issues', async () => {
    // Criterion 7: Dash car's 2 open to-dos link to its page; after one is marked done it shows 1; other cars show nothing.
    // Already on the dashboard after dashboard-start-checklist.
    await page.reload()
    const link = dashCar().getByRole('link', { name: IS.open(2), exact: true })
    await link.waitFor()
    if ((await link.getAttribute('href')) !== `/cars/${dashCarId}`) throw new Error(`href ${await link.getAttribute('href')}`)
    const others = page.locator('.cars > li').filter({ hasNot: page.getByRole('link', { name: 'Dash car', exact: true }) })
    if (await others.getByText(/open to-do|מטלה פתוחה|מטלות פתוחות/).count()) throw new Error('an open to-do count on a car without to-dos')
    await at390('the dashboard with open to-dos', 'dashboard-open-issues')
    await link.click()
    await arrivedAt('Dash car')
    await isSec.locator('.open-issues > li button.done').first().click()
    await isSec.locator('.done-issues > li').waitFor({ state: 'attached' })
    await page.click('header a.brand')
    await arrivedAt(T.dashboard)
    await dashCar().getByRole('link', { name: IS.open(1), exact: true }).waitFor()
  })
  await step('checklist-template-in-use', async () => {
    // Deleting a template that is on a car: the translated inUse message on its row, which stays.
    await page.click('header nav a[href="/checklists"]')
    await arrivedAt(CL.title)
    const row = clRow('Monthly quick check')
    await row.getByRole('button', { name: `${CL.del}Monthly quick check`, exact: true }).click()
    await row.locator('button.danger').click()
    const alert = row.locator('[role=alert]')
    await alert.waitFor()
    if (plain(await alert.textContent()) !== CK.inUse) throw new Error(`in use "${await alert.textContent()}"`)
    forgetCk(409, '/checklist-templates/')
    await page.reload()
    await clRow('Monthly quick check').waitFor()
  })
  await step('switch-language', async () => {
    const before = await page.getAttribute('html', 'dir')
    await page.click('header nav button.link >> nth=0')
    const after = await page.getAttribute('html', 'dir')
    if (before === after) throw new Error(`dir stayed "${after}"`)
  })
  await step('logout', async () => {
    await page.click('header nav button.link >> nth=1')
    await page.locator('input[name=email]').waitFor()
  })

  report.push(run)
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.some((r) => r.steps.some((st) => !st.ok)) ? 1 : 0
