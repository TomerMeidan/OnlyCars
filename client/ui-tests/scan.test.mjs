// SCAN-1: the straighten step and the PDF writer (no browser).
// Usage: node --test ui-tests/scan.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blackAndWhite, color, homography, warp } from '../src/scan/image.ts'
import { pdf, pdfName } from '../src/scan/pdf.ts'

const quad = [[120.5, 40], [900, 95], [860, 1210.25], [60, 1100]]

test('the homography maps the 4 corners exactly onto the output rectangle', () => {
  const map = homography(quad)
  for (const [[u, v], [x, y]] of [[[0, 0], quad[0]], [[1, 0], quad[1]], [[1, 1], quad[2]], [[0, 1], quad[3]]]) {
    const [gx, gy] = map(u, v)
    assert.ok(Math.abs(gx - x) < 1e-9 && Math.abs(gy - y) < 1e-9, `(${u}, ${v}) gave (${gx}, ${gy}), want (${x}, ${y})`)
  }
  // A rectangle maps without perspective: its centre to its centre.
  assert.deepEqual(homography([[0, 0], [10, 0], [10, 20], [0, 20]])(0.5, 0.5), [5, 10])
})

// A w x h image of one gray value, with a darker block.
const page = (w, h, paper, ink, block) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = block(x, y) ? ink : paper
    data.set([v, v, v, 255], (y * w + x) * 4)
  }
  return { data, width: w, height: h }
}

test('warp cuts the quad out at its average side lengths', () => {
  const src = page(40, 40, 200, 20, (x, y) => x >= 10 && x < 30 && y >= 10 && y < 30)
  const out = warp(src, [[10, 10], [30, 10], [30, 30], [10, 30]])
  assert.equal(out.width, 20)
  assert.equal(out.height, 20)
  assert.ok(out.data.every((v, i) => (i % 4 === 3 ? v === 255 : v === 20)), 'only the dark block is inside')
})

test('black and white: gray paper turns white, a 3 px stroke black', () => {
  const out = blackAndWhite(page(200, 100, 170, 60, (x, y) => y >= 49 && y < 52 && x >= 20 && x < 180))
  assert.equal(out.data[(10 * 200 + 10) * 4], 255)
  assert.equal(out.data[(50 * 200 + 100) * 4], 0)
})

const at = (img, x, y) => img.data[(y * img.width + x) * 4]

test('black and white: a shadow across the paper still comes out white, and the text in it black', () => {
  // The light falls from 230 on the left to 90 on the right; a 3 px line runs through it at 30% of the local paper.
  const w = 400, h = 300, data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const light = 230 - (140 * x) / w, v = y >= 149 && y < 152 && x >= 20 && x < 380 ? light * 0.3 : light
    data.set([v, v, v, 255], (y * w + x) * 4)
  }
  const out = blackAndWhite({ data, width: w, height: h })
  for (const x of [10, 100, 200, 300, 390]) {
    assert.equal(at(out, x, 50), 255, `paper at x=${x}`)
    if (x > 20 && x < 380) assert.equal(at(out, x, 150), 0, `ink at x=${x}`)
  }
})

test('black and white: a solid dark square (a stamp) stays filled', () => {
  const w = 1000, h = 1400, s = (x, y) => x >= 400 && x < 520 && y >= 600 && y < 720
  const out = blackAndWhite(page(w, h, 200, 50, s))
  for (const [x, y] of [[460, 660], [405, 605], [515, 715], [440, 690]]) assert.equal(at(out, x, y), 0, `inside at ${x},${y}`)
  assert.equal(at(out, 100, 100), 255)
})

test('black and white: a soft text edge keeps its gray steps instead of a hard cut', () => {
  // A camera-blurred edge: paper 220 ramps down to ink 40 over 8 px.
  const w = 200, h = 100, data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x < 96 ? 220 : x >= 104 ? (x < 112 ? 40 : 220) : 220 - (180 * (x - 96)) / 8
    data.set([v, v, v, 255], (y * w + x) * 4)
  }
  const out = blackAndWhite({ data, width: w, height: h })
  const row = Array.from({ length: 10 }, (_, i) => at(out, 95 + i, 50))
  assert.equal(row[0], 255)
  assert.equal(at(out, 108, 50), 0)
  assert.ok(row.filter((v) => v > 20 && v < 235).length >= 2, `gray steps on the edge: ${row}`)
  for (let i = 1; i < row.length; i++) assert.ok(row[i] <= row[i - 1], `monotone: ${row}`)
})

test('color: the paper is stretched to white', () => {
  const out = color(page(100, 100, 190, 40, (x, y) => y < 10))
  assert.equal(out.data[(50 * 100 + 50) * 4], 255)
  assert.equal(out.data[(5 * 100 + 50) * 4], 0)
})

test('the PDF has one page per JPEG, in order, and a correct xref', () => {
  const jpeg = (n) => Uint8Array.from([0xff, 0xd8, 0xff, n, 0x00, 0x0a, 0xff, 0xd9]) // binary, with a newline byte inside
  const bytes = pdf([{ jpeg: jpeg(1), width: 1000, height: 1414 }, { jpeg: jpeg(2), width: 800, height: 400 }, { jpeg: jpeg(3), width: 10, height: 10 }])
  const text = Buffer.from(bytes).toString('latin1')
  assert.ok(text.startsWith('%PDF-'))
  assert.ok(text.trimEnd().endsWith('%%EOF'))
  assert.equal(text.match(/\/Type \/Page\b/g).length, 3)
  assert.match(text, /\/MediaBox \[0 0 595 841\.33\]/)
  assert.match(text, /\/MediaBox \[0 0 595 297\.5\]/)
  // The pages in order: the Kids list follows the page objects.
  assert.match(text, /\/Kids \[3 0 R 6 0 R 9 0 R\] \/Count 3/)
  const startxref = Number(text.match(/startxref\n(\d+)\n/)[1])
  assert.ok(text.startsWith('xref\n', startxref))
  const [, first, count] = text.slice(startxref).match(/^xref\n(\d+) (\d+)\n/)
  assert.equal(Number(first), 0)
  assert.equal(Number(count), 12)
  const rows = text.slice(startxref).split('\n').slice(2, 2 + 12)
  rows.slice(1).forEach((row, i) => {
    assert.match(row, /^\d{10} 00000 n $/)
    assert.ok(text.startsWith(`${i + 1} 0 obj`, Number(row.slice(0, 10))), `object ${i + 1} at ${row}`)
  })
  // Each image's /Length is its JPEG's byte count.
  assert.equal(text.match(/\/Length 8 >>/g).length, 3)
})

// SCAN-2b: the File name field's rule.
test('pdfName: default, trim, .pdf not doubled, reserved characters, the 251 cut, Hebrew', () => {
  const d = '2026-11-04'
  for (const typed of ['', '   ', '.pdf', ' .PDF ']) assert.equal(pdfName(typed, d), 'scan-2026-11-04.pdf')
  assert.equal(pdfName('  policy  ', d), 'policy.pdf')
  assert.equal(pdfName('x.PDF', d), 'x.PDF')
  assert.equal(pdfName('x.pdf.txt', d), 'x.pdf.txt.pdf')
  assert.equal(pdfName('a/b\\c:d*e?f"g<h>i|j', d), 'a-b-c-d-e-f-g-h-i-j.pdf')
  assert.equal(pdfName('פוליסה 2027.PDF', d), 'פוליסה 2027.PDF')
  assert.equal(pdfName('א'.repeat(300), d), `${'א'.repeat(251)}.pdf`)
  assert.equal(pdfName(`${'a'.repeat(247)}.pdf`, d).length, 251)
})
