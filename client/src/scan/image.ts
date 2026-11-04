// SCAN-1: straighten and clean a photographed page. Plain RGBA pixels in and out (no DOM), so node --test can check them.
export type Pixels = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }
export type Point = [number, number]

// The perspective map from the unit square onto a quad (top-left, top-right, bottom-right, bottom-left), Heckbert's closed form.
export function homography([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]: Point[]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  const det = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3
  return (u: number, v: number): Point => {
    const w = g * u + h * v + 1
    return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]
  }
}

const dist = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(ax - bx, ay - by)

// The quad (in source pixels) cut out into a rectangle sized from the average side lengths, sampled bilinearly.
export function warp(src: Pixels, quad: Point[]): Pixels {
  const [tl, tr, br, bl] = quad
  const width = Math.max(1, Math.round((dist(tl, tr) + dist(bl, br)) / 2))
  const height = Math.max(1, Math.round((dist(tl, bl) + dist(tr, br)) / 2))
  const map = homography(quad)
  const s = src.data, sw = src.width, sh = src.height
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++, o += 4) {
      const [fx, fy] = map((x + 0.5) / width, (y + 0.5) / height)
      const px = Math.min(Math.max(fx - 0.5, 0), sw - 1), py = Math.min(Math.max(fy - 0.5, 0), sh - 1)
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1)
      const ax = px - x0, ay = py - y0
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax
        out[o + c] = top + (s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax - top) * ay
      }
      out[o + 3] = 255
    }
  }
  return { data: out, width, height }
}

// Black and white: grayscale, then a local adaptive threshold (Bradley): darker than 85% of its neighbourhood's mean is ink.
// The neighbourhood follows the page size, so shadows and uneven light across the paper still come out white.
export function blackAndWhite({ data, width: w, height: h }: Pixels): Pixels {
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8
  // Summed-area table; 255 x 4 Mpx fits in 32 bits.
  const W = w + 1, sum = new Uint32Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    for (let x = 0, row = 0; x < w; x++) {
      row += gray[y * w + x]
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row
    }
  }
  const r = Math.max(4, Math.round(Math.max(w, h) / 40))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1)
      const total = sum[yb * W + xb] - sum[ya * W + xb] - sum[yb * W + xa] + sum[ya * W + xa]
      const v = gray[y * w + x] * (xb - xa) * (yb - ya) * 100 < total * 85 ? 0 : 255
      const o = (y * w + x) * 4
      out[o] = out[o + 1] = out[o + 2] = v
      out[o + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

// Color: each channel's levels stretched from its 2nd to its 90th percentile, so the paper (most of the page) turns white.
export function color({ data, width, height }: Pixels): Pixels {
  const n = width * height
  const out = new Uint8ClampedArray(data.length).fill(255) // alpha stays opaque
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256)
    for (let i = c; i < data.length; i += 4) hist[data[i]]++
    const at = (q: number) => { let v = 0; for (let seen = hist[0]; seen < q * n && v < 255;) seen += hist[++v]; return v }
    const lo = at(0.02), hi = Math.max(at(0.9), lo + 1)
    for (let i = c; i < data.length; i += 4) out[i] = (data[i] - lo) * 255 / (hi - lo)
  }
  return { data: out, width, height }
}
