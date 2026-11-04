// SCAN-1: a minimal PDF of JPEG pages (one DCTDecode image per page), A4 wide (595 pt) with each page's own aspect.
export type JpegPage = { jpeg: Uint8Array; width: number; height: number }

export function pdf(pages: JpegPage[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const put = (x: string | Uint8Array) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); length += b.length }
  const obj = (n: number, ...body: (string | Uint8Array)[]) => { offsets[n] = length; put(`${n} 0 obj\n`); body.forEach(put); put('\nendobj\n') }

  put('%PDF-1.4\n%âãÏÓ\n') // the binary comment marks the file as binary for transfer tools
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  pages.forEach((p, i) => {
    const n = 3 + i * 3, w = 595, h = Math.round(595 * p.height / p.width * 100) / 100
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`)
    obj(n + 1, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream')
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    obj(n + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)
  })
  const xref = length, size = offsets.length
  put(`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
  put(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  parts.reduce((at, b) => (out.set(b, at), at + b.length), 0)
  return out
}

// SCAN-2b: the saved name from the File name field. Characters Windows refuses become -, empty (or only ".pdf") is the default,
// a typed .pdf in any case is kept rather than doubled; 251 + ".pdf" stays within 255.
export function pdfName(typed: string, today: string) {
  let name = typed.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 251).trimEnd()
  if (!name || /^\.pdf$/i.test(name)) name = `scan-${today}`
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`
}
