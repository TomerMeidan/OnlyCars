// Renders the PWA icons in public/ from the dial mark in public/favicon.svg, with the installed Playwright Chrome.
// Usage (from client/): node scripts/icons.mjs. Run again after a change to favicon.svg, and commit the PNGs.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const svg = readFileSync('public/favicon.svg', 'utf8').trim()
const mark = svg.replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/<rect width="48" height="48"[^>]*\/>/, '')
if (mark === svg || mark.includes('height="48"')) throw new Error('favicon.svg changed shape: update this script')
const bleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0f1a1f"/>`
  + `<g transform="translate(24 24) scale(${scale}) translate(-24 -28)">${mark}</g></svg>` // (24,28) is the mark's centre
// L188: a thin light rim (the needle's colour, inside the tile's edge) so the dark tile shows on dark launchers and taskbars.
const rimmed = svg.replace('</svg>', '<rect x=".5" y=".5" width="47" height="47" rx="10.5" fill="none" stroke="#eef2ef"/></svg>')
const icons = [
  ['icon-192.png', 192, rimmed],
  ['icon-512.png', 512, rimmed],
  // Maskable: full bleed; at 0.8 the mark's farthest point is 14 of 48 units from the centre, inside the 19.2-unit (80%) safe circle.
  ['icon-maskable-512.png', 512, bleed(0.8)],
  // iOS rounds the corners itself and fills transparency with black, so full bleed at the favicon's own scale.
  ['apple-touch-icon.png', 180, bleed(1)],
]
const browser = await chromium.launch({ channel: 'chrome' })
for (const [file, size, src] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0"><img width="${size}" height="${size}" src="data:image/svg+xml,${encodeURIComponent(src)}">`)
  if (!(await page.$eval('img', (i) => i.decode().then(() => i.naturalWidth).catch(() => 0)))) throw new Error(`${file}: the SVG did not render`)
  await page.screenshot({ path: `public/${file}`, omitBackground: true })
  await page.close()
}
await browser.close()
