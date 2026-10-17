// RFC 4180 rows with CRLF and a UTF-8 BOM (so Excel reads Hebrew); no imports, so ui-tests/smoke.mjs can import and check it.
export const toCsv = (rows: (string | number)[][]) => '﻿' + rows.map((r) => r.map(field).join(',') + '\r\n').join('')

function field(v: string | number) {
  // Text that a spreadsheet would run as a formula (= + - @, also full-width or after leading spaces and control characters,
  // or starting with tab, CR or LF) gets a leading '.
  const formula = typeof v === 'string' && (/^[\s\x00-\x1f 　]*[=+\-@＝＋－＠]/.test(v) || /^[\t\r\n]/.test(v)) // eslint-disable-line no-control-regex
  const s = formula ? `'${v}` : String(v)
  // ; too, so Excel with a semicolon list separator keeps the field in one cell.
  return /[",;\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
