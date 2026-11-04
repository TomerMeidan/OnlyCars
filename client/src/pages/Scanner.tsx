import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { localToday, maxFileBytes } from '../api'
import { blackAndWhite, color, warp, type Pixels, type Point } from '../scan/image'
import { pdf } from '../scan/pdf'
import './Scanner.css'

// SCAN-1: photograph a paper, fit its 4 corners, straighten and clean it, up to 20 pages, saved as one PDF.
// Lazy-loaded from Attachments, which owns the camera input (clicked in the Scan tap) and the upload.
const MAX_PAGES = 20
const MAX_SIDE = 2000
const START: Point[] = [[0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92]]
const CORNERS = ['cornerTL', 'cornerTR', 'cornerBR', 'cornerBL'] as const
const ARROWS: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
const clamp = (v: number) => Math.min(1, Math.max(0, v))

type Page = { id: number; width: number; height: number; bw: Blob; color: Blob; bwUrl: string; colorUrl: string }
let nextId = 0

type Problem = 'scanUnreadable' | 'scanImageTooLarge'
// Upright (EXIF orientation applied) and at most 2000 px on the long side. Throws the message key when the file can't be used.
// Over 25 MB or 50 Mpx is refused before it can exhaust a phone's memory.
async function read(file: File): Promise<Pixels> {
  if (file.size > 25e6) throw 'scanImageTooLarge'
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => { throw 'scanUnreadable' })
  if (bitmap.width * bitmap.height > 50e6) { bitmap.close(); throw 'scanImageTooLarge' }
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * k))
  canvas.height = Math.max(1, Math.round(bitmap.height * k))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function jpeg({ data, width, height }: Pixels, quality: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0)
  return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('JPEG encoding failed'))), 'image/jpeg', quality))
}

export default function Scanner({ camera, openCamera, busy, error, onSave, onClose }: {
  camera: RefObject<HTMLInputElement | null> // Attachments' capture input
  openCamera: () => void
  busy: boolean // the upload is in flight
  error: ReactNode // the upload's error, as Add file shows it
  onSave: (file: File) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const choose = useRef<HTMLInputElement>(null)
  const photoBox = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState<'capture' | 'reading' | 'corners' | 'working' | 'pages'>('capture')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [tooBig, setTooBig] = useState(false) // the PDF is over the upload limit
  const [photo, setPhoto] = useState<{ url: string; pixels: Pixels } | null>(null)
  const [corners, setCorners] = useState(START)
  const [pages, setPages] = useState<Page[]>([])
  const [mode, setMode] = useState<'bw' | 'color'>('bw')
  const [confirming, setConfirming] = useState(false)
  const [building, setBuilding] = useState(false)
  const urls = useRef<string[]>([]) // every object URL made here, revoked when the scanner closes
  const objectUrl = (b: Blob) => { const u = URL.createObjectURL(b); urls.current.push(u); return u }
  const saving = busy || building
  // A dropped photo or page frees its object URLs at once; a photo is several MB.
  const dropPhoto = (next: { url: string; pixels: Pixels } | null = null) => setPhoto((p) => { if (p) URL.revokeObjectURL(p.url); return next })
  const retake = () => { dropPhoto(); setStep('capture') }

  async function take(file: File | undefined) {
    if (!file) return
    setProblem(null)
    setStep('reading')
    try {
      const pixels = await read(file)
      dropPhoto({ url: objectUrl(file), pixels })
      setCorners(START)
      setStep('corners')
    } catch (e) {
      setProblem(e === 'scanImageTooLarge' ? e : 'scanUnreadable')
      retake()
    }
  }
  const takeLatest = useRef(take)
  useEffect(() => { takeLatest.current = take })
  useEffect(() => {
    const d = dialog.current!
    if (!d.open) d.showModal()
    const input = camera.current!
    const onPhoto = () => {
      takeLatest.current(input.files?.[0])
    }
    input.addEventListener('change', onPhoto)
    if (input.files?.length) onPhoto() // taken before this chunk had loaded
    const made = urls.current
    return () => {
      input.removeEventListener('change', onPhoto)
      made.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [camera])

  async function next() {
    if (!photo) return
    setStep('working')
    await new Promise((r) => setTimeout(r, 30)) // lets "Straightening…" paint before the busy loop
    try {
      const { pixels } = photo
      // Corners dragged onto the paper's edge catch a sliver of background, so pull each 2% toward the centre (L238).
      const cx = corners.reduce((s, [x]) => s + x, 0) / 4
      const cy = corners.reduce((s, [, y]) => s + y, 0) / 4
      const flat = warp(pixels, corners.map(([x, y]) => [(x + (cx - x) * 0.02) * pixels.width, (y + (cy - y) * 0.02) * pixels.height]))
      // Black and white stays sharp at a lower quality, which keeps more pages under 10 MB.
      const [bw, col] = await Promise.all([jpeg(blackAndWhite(flat), 0.7), jpeg(color(flat), 0.8)])
      setPages((ps) => [...ps, { id: nextId++, width: flat.width, height: flat.height, bw, color: col, bwUrl: objectUrl(bw), colorUrl: objectUrl(col) }])
      dropPhoto()
      setStep('pages')
    } catch {
      setProblem('scanUnreadable')
      retake()
    }
  }

  function remove(p: Page) {
    URL.revokeObjectURL(p.bwUrl)
    URL.revokeObjectURL(p.colorUrl)
    const left = pages.filter((x) => x !== p)
    setPages(left)
    setTooBig(false)
    if (left.length) list.current?.focus()
    else setStep('capture')
  }

  async function save() {
    if (saving) return
    setBuilding(true)
    setTooBig(false)
    try {
      const bytes = pdf(await Promise.all(pages.map(async (p) => ({ jpeg: new Uint8Array(await (mode === 'bw' ? p.bw : p.color).arrayBuffer()), width: p.width, height: p.height }))))
      // Over the upload limit: said here, without a request; the pages stay so some can be deleted.
      if (bytes.length > maxFileBytes) setTooBig(true)
      else onSave(new File([bytes], `scan-${localToday()}.pdf`, { type: 'application/pdf' }))
    } finally {
      setBuilding(false)
    }
  }

  // Cancel and Escape: with pages, ask first; a second Escape keeps scanning.
  function cancel() {
    if (saving) return
    if (confirming) { setConfirming(false); cancelButton.current?.focus() }
    else if (pages.length) setConfirming(true)
    else onClose()
  }

  const drag = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const r = photoBox.current!.getBoundingClientRect()
    move(i, [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height])
  }
  const move = (i: number, [x, y]: Point) => setCorners((cs) => cs.map((c, j) => (j === i ? [clamp(x), clamp(y)] : c)))
  const points = corners.map((c) => c.join(',')).join(' ')

  return (
    // Escape is handled on keydown, so Chrome can't force the dialog shut on a repeated Escape; cancel covers Android's Back.
    // onClose: the browser closed it anyway (Android Back without a cancel event), so the scanner closes too.
    <dialog ref={dialog} className="scanner" aria-labelledby={`${id}title`} onClose={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel() } }}
      onCancel={(e) => { e.preventDefault(); cancel() }}>
      <div className="scan-bar">
        <h2 id={`${id}title`}>{t('scanTitle')}</h2>
        <button type="button" className="link" ref={cancelButton} aria-disabled={saving} onClick={cancel}>{t('cancel')}</button>
      </div>
      <div className="scan-body">
        {confirming && (
          <div className="inline-form">
            <p>{t('discardScan', { count: pages.length })}</p>
            <div className="actions">
              <button type="button" className="danger" onClick={onClose}>{t('discard')}</button>
              <button type="button" className="link" autoFocus onClick={cancel}>{t('keepScanning')}</button>
            </div>
          </div>
        )}

        {step === 'capture' && (
          <>
            <p>{t('scanIntro')}</p>
            {problem && <p className="error" role="alert">{t(problem)}</p>}
            <div className="actions">
              <button type="button" className="add" autoFocus onClick={openCamera}>{t('takePhoto')}</button>
              <button type="button" className="add" onClick={() => choose.current?.click()}>{t('chooseImage')}</button>
              <input ref={choose} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; take(file) }} />
              {pages.length > 0 && <button type="button" className="link" onClick={() => setStep('pages')}>{t('scanPages')}</button>}
            </div>
          </>
        )}

        {(step === 'reading' || step === 'working') && (
          <p className="muted" role="status" tabIndex={-1} ref={(el) => el?.focus()}>{t(step === 'reading' ? 'scanReading' : 'scanWorking')}</p>
        )}

        {step === 'corners' && photo && (
          <>
            <p>{t('scanCorners')}</p>
            {/* The photo and its corners are physical: never mirrored in RTL. */}
            <div className="scan-stage" dir="ltr">
              <div className="scan-photo" ref={photoBox}
                style={{ aspectRatio: `${photo.pixels.width} / ${photo.pixels.height}`, inlineSize: `min(100%, ${(60 * photo.pixels.width / photo.pixels.height).toFixed(2)}dvh)` }}>
                <img src={photo.url} alt="" draggable={false} />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                  <polygon points={points} className="halo" />
                  <polygon points={points} />
                </svg>
                {corners.map(([x, y], i) => (
                  <button key={CORNERS[i]} type="button" className="corner" aria-label={t(CORNERS[i])} aria-describedby={`${id}keys`}
                    style={{ insetInlineStart: `${x * 100}%`, insetBlockStart: `${y * 100}%` }}
                    autoFocus={i === 0}
                    onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={drag(i)}
                    onKeyDown={(e) => {
                      const d = ARROWS[e.key]
                      if (!d) return
                      e.preventDefault()
                      const s = e.shiftKey ? 0.05 : 0.005
                      move(i, [x + d[0] * s, y + d[1] * s])
                    }} />
                ))}
              </div>
            </div>
            <p className="muted" id={`${id}keys`}>{t('cornerKeys')}</p>
            <div className="actions">
              <button type="button" onClick={next}>{t('next')}</button>
              <button type="button" className="add" onClick={retake}>{t('retake')}</button>
            </div>
          </>
        )}

        {step === 'pages' && (
          <>
            <fieldset className="scan-mode">
              <legend>{t('scanCleanup')}</legend>
              {(['bw', 'color'] as const).map((m) => (
                <label className="inline" key={m}>
                  <input type="radio" name={`${id}mode`} checked={mode === m} onChange={() => { setMode(m); setTooBig(false) }} />
                  {t(m === 'bw' ? 'scanBw' : 'scanColor')}
                </label>
              ))}
            </fieldset>
            <ol className="scan-pages" aria-label={t('scanPages')} tabIndex={-1} ref={list}>
              {pages.map((p, i) => (
                <li key={p.id}>
                  <img src={mode === 'bw' ? p.bwUrl : p.colorUrl} alt="" />
                  <span className="muted">{t('scanPage', { n: i + 1 })}</span>
                  <button type="button" className="link" aria-label={t('deletePage', { n: i + 1 })} aria-disabled={saving}
                    onClick={() => !saving && remove(p)}>{t('delete')}</button>
                </li>
              ))}
            </ol>
            {pages.length >= MAX_PAGES && <p className="muted">{t('pagesMax')}</p>}
            {tooBig ? <p className="error" role="alert">{t('scanTooBig')}</p> : error && <p className="error" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="save-scan" aria-disabled={saving} aria-busy={saving} onClick={save}>{t(saving ? 'savingScan' : 'save')}</button>
              {pages.length < MAX_PAGES && (
                <button type="button" className="add" aria-disabled={saving} onClick={() => !saving && setStep('capture')}>{t('addPage')}</button>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}
