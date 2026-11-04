// SCAN-1: the straighten step and the PDF writer (no browser).
// Usage: node --test ui-tests/scan.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blackAndWhite, color, homography, warp } from '../src/scan/image.ts'
import { pdf } from '../src/scan/pdf.ts'

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
