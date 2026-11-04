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

// Black and white, the way document scanners do it. First flatten the light: the paper's brightness is estimated with a max filter
// wider than a stroke (so ink drops out), a min filter of the same size (so the bright paper doesn't spill into a shadow's edge) and
// a small blur, on a 1/4 copy for speed, and each pixel is divided by it, so the paper is about 255 and shadows go.
// Then a contrast curve: near-white to 255, ink near 0, and the ink's edges stay gray (smooth letters, no JPEG-hostile hard cut).
export function blackAndWhite({ data, width: w, height: h }: Pixels): Pixels {
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8
  // A 3x3 [1 2 1] smoothing first: in a shadow the division below would blow the sensor and JPEG noise up into speckles.
  const row = new Uint16Array(w * h)
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) row[i] = gray[x ? i - 1 : i] + 2 * gray[i] + gray[x < w - 1 ? i + 1 : i]
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) gray[i] = (row[y ? i - w : i] + 2 * row[i] + row[y < h - 1 ? i + w : i] + 8) >> 4
  // The 1/4 copy keeps each 4x4 block's brightest pixel, which is already the first step of the max filter.
  const F = 4, sw = Math.ceil(w / F), sh = Math.ceil(h / F)
  const small = new Float32Array(sw * sh)
  for (let y = 0; y < h; y++) {
    for (let x = 0, j = ((y / F) | 0) * sw; x < w; x++) small[j + ((x / F) | 0)] = Math.max(small[j + ((x / F) | 0)], gray[y * w + x])
  }
  // shortcut: a solid dark area whose short side is over 1/8 of the page's long side (about 350 px on a 2000x2800 page) comes out hollow; widen r if real stamps are bigger.
  const r = Math.max(1, Math.round(Math.max(sw, sh) / 16))
  const closed = separable(separable(small, sw, sh, (a) => rankLine(a, r, Math.max, -Infinity)), sw, sh, (a) => rankLine(a, r, Math.min, Infinity))
  const bg = separable(closed, sw, sh, (a) => boxLine(a, Math.max(1, r >> 2)))
  // Bilinear upsampling, the column weights computed once.
  const xi = new Int32Array(w), xa = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const fx = Math.min(Math.max((x + 0.5) / F - 0.5, 0), sw - 1)
    xi[x] = Math.min(fx | 0, Math.max(sw - 2, 0))
    xa[x] = sw > 1 ? fx - xi[x] : 0
  }
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) / F - 0.5, 0), sh - 1)
    const y0 = Math.min(fy | 0, Math.max(sh - 2, 0)), ay = sh > 1 ? fy - y0 : 0, r0 = y0 * sw, r1 = Math.min(y0 + 1, sh - 1) * sw
    for (let x = 0; x < w; x++) {
      const i = xi[x], ax = xa[x], j = Math.min(i + 1, sw - 1)
      const top = bg[r0 + i] + (bg[r0 + j] - bg[r0 + i]) * ax
      const b = top + (bg[r1 + i] + (bg[r1 + j] - bg[r1 + i]) * ax - top) * ay
      // The pixel's share of the paper's light: up to 0.4 is ink (0), from 0.9 paper (255, with a little room for noise in a
      // shadow), squared between so faint print and blurred thin strokes come out darker while their edges stay gray.
      // In a deep shadow (paper under 100) the darkness is measured against 100, not the paper: there the sensor noise is a big
      // share of the light, and dividing by it turned the paper into speckle (SCAN-2 QA), while ink is still far darker.
      const t = Math.min(Math.max((1 - (b - gray[y * w + x]) / Math.max(b, 100) - 0.4) / 0.5, 0), 1)
      const o = (y * w + x) * 4
      out[o] = out[o + 1] = out[o + 2] = 255 * t * t
      out[o + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

// A per-line filter run along the rows, then along the columns.
function separable(src: Float32Array, w: number, h: number, line: (a: Float32Array) => Float32Array) {
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) out.set(line(src.subarray(y * w, (y + 1) * w)), y * w)
  const col = new Float32Array(h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = out[y * w + x]
    const c = line(col)
    for (let y = 0; y < h; y++) out[y * w + x] = c[y]
  }
  return out
}

// The max (or min) over [i - r, i + r] for every i, O(1) each (van Herk / Gil-Werman): prefix and suffix extremes in blocks of
// 2r + 1. Outside the line is `pad`, which the pick ignores.
function rankLine(a: Float32Array, r: number, pick: (x: number, y: number) => number, pad: number) {
  const n = a.length, k = 2 * r + 1, m = n + 2 * r
  const pre = new Float32Array(m), suf = new Float32Array(m)
  for (let i = 0; i < m; i++) { const v = i >= r && i < r + n ? a[i - r] : pad; pre[i] = i % k ? pick(pre[i - 1], v) : v }
  for (let i = m - 1; i >= 0; i--) { const v = i >= r && i < r + n ? a[i - r] : pad; suf[i] = i % k === k - 1 || i === m - 1 ? v : pick(suf[i + 1], v) }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = pick(suf[i], pre[i + 2 * r])
  return out
}

// The mean over [i - r, i + r], clipped to the line, from running sums.
function boxLine(a: Float32Array, r: number) {
  const n = a.length, sum = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + a[i]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n, i + r + 1); out[i] = (sum[hi] - sum[lo]) / (hi - lo) }
  return out
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
