/**
 * OpenThai2.0-OCR-Text in the browser: a port of the model's own runtime (runtime/line_engine.py)
 * onto two ONNX networks and OffscreenCanvas.
 *
 *   page -> detector (probability map -> DB boxes, unclipped) -> [deskew, detect again]
 *        -> each line cut at height 48, background flattened -> recognizer (batched by width)
 *        -> greedy CTC decode -> Thai clean-up -> line filter -> reading order -> text
 *
 * Not ported: quarter-turn orientation (sideways / upside-down pages), splitting a line at a wide
 * blank gap, and word boxes. EXIF rotation is applied by the browser when it decodes the photo.
 */
import {
  applyAffine,
  invertAffine,
  mapQuad,
  minAreaRect,
  quadMean,
  rectCorners,
  regionBorders,
  unclip,
  type Affine,
  type Quad,
} from './geometry'
import { fragments, pageSkew, readingOrder } from './layout'
import { cutLine, flatten, quadSize, toGray, turnQuad, type Gray } from './pixels'
import type { OcrLine, OcrResult, Stage } from './protocol'
import { canonical, fixScripts, invalidShare } from './thai-text'

/** One ONNX network: a float32 tensor in, its first output back. */
export type Net = (
  data: Float32Array,
  dims: readonly number[],
) => Promise<{ data: Float32Array; dims: readonly number[] }>

export type Progress = (stage: Stage, done: number, total: number) => void

/** line_engine.DEFAULTS, with det.yml's PostProcess and the model's config.json applied. */
const CONFIG = {
  det: { limit: 1280, thresh: 0.2, boxThresh: 0.4, unclip: 1.4, minSize: 3, maxCandidates: 3000 },
  rec: {
    height: 48,
    maxWidth: 3200,
    batch: 16,
    dropBelow: 0.8,
    minChars: 2,
    junkBelow: 0.9,
    junkInvalid: 0.05,
  },
  deskewAbove: 2.5,
  /** Longest side a page is read at; phone photos are larger than the text needs. */
  maxSide: 4000,
} as const

const DET_MEAN = [0.485, 0.456, 0.406] as const
const DET_STD = [0.229, 0.224, 0.225] as const

type Canvas = OffscreenCanvas

function context(canvas: Canvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available')
  return ctx
}

const pixelsOf = (canvas: Canvas): Uint8ClampedArray =>
  context(canvas).getImageData(0, 0, canvas.width, canvas.height).data

/**
 * Greedy CTC over one sequence of softmax frames: the best class per frame, runs collapsed,
 * blanks (class 0) dropped. Confidence is the mean of each kept run's first-frame probability.
 */
export function ctcDecode(
  probs: Float32Array,
  offset: number,
  frames: number,
  classes: number,
  chars: readonly string[],
): { text: string; confidence: number } {
  let text = ''
  let sum = 0
  let kept = 0
  let prev = -1
  for (let t = 0; t < frames; t++) {
    const base = offset + t * classes
    let best = 0
    let bestP = probs[base] ?? 0
    for (let c = 1; c < classes; c++) {
      const p = probs[base + c] ?? 0
      if (p > bestP) {
        bestP = p
        best = c
      }
    }
    if (best !== prev && best !== 0) {
      text += chars[best] ?? ''
      sum += bestP
      kept++
    }
    prev = best
  }
  return { text, confidence: kept === 0 ? 0 : sum / kept }
}

/** Median colour of the page's outer rows and columns: what deskewing fills the corners with. */
function borderColour(rgba: Uint8ClampedArray, w: number, h: number): string {
  const ch: [number[], number[], number[]] = [[], [], []]
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4
    ch[0].push(rgba[i] ?? 255)
    ch[1].push(rgba[i + 1] ?? 255)
    ch[2].push(rgba[i + 2] ?? 255)
  }
  for (let x = 0; x < w; x++) {
    take(x, 0)
    take(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    take(0, y)
    take(w - 1, y)
  }
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 255
  return `rgb(${String(med(ch[0]))} ${String(med(ch[1]))} ${String(med(ch[2]))})`
}

/** The page turned by -angle degrees on a canvas grown to fit, and the map onto it. */
function deskew(page: Canvas, angle: number): { canvas: Canvas; map: Affine } {
  const { width: w, height: h } = page
  const a = (-angle * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const nw = Math.round(h * Math.abs(s) + w * Math.abs(c))
  const nh = Math.round(h * Math.abs(c) + w * Math.abs(s))
  // p' = R (p - centre) + new centre
  const map: Affine = [
    c,
    -s,
    nw / 2 - (c * w) / 2 + (s * h) / 2,
    s,
    c,
    nh / 2 - (s * w) / 2 - (c * h) / 2,
  ]
  const canvas = new OffscreenCanvas(nw, nh)
  const ctx = context(canvas)
  ctx.fillStyle = borderColour(pixelsOf(page), w, h)
  ctx.fillRect(0, 0, nw, nh)
  ctx.setTransform(map[0], map[3], map[1], map[4], map[2], map[5])
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(page, 0, 0)
  return { canvas, map }
}

/** The detector's input: RGBA -> normalised BGR planes (mean/std apply to B, G, R in order). */
function detTensor(rgba: Uint8ClampedArray, plane: number): Float32Array {
  const x = new Float32Array(3 * plane)
  for (let k = 0; k < 3; k++) {
    const m = DET_MEAN[k] ?? 0
    const sd = DET_STD[k] ?? 1
    for (let i = 0; i < plane; i++) x[k * plane + i] = ((rgba[i * 4 + (2 - k)] ?? 0) / 255 - m) / sd
  }
  return x
}

/**
 * DB post-processing on the probability map: threshold, one rotated rectangle per region, kept
 * if its mean probability clears box_thresh, then unclipped. Corners in map pixels.
 */
export function dbBoxes(prob: Float32Array, pw: number, ph: number): Quad[] {
  const c = CONFIG.det
  const bitmap = new Uint8Array(pw * ph)
  for (let i = 0; i < bitmap.length; i++) bitmap[i] = (prob[i] ?? 0) > c.thresh ? 1 : 0
  return regionBorders(bitmap, pw, ph)
    .slice(0, c.maxCandidates)
    .flatMap((border) => {
      const rect = minAreaRect(border)
      if (Math.min(rect.w, rect.h) < c.minSize) return []
      if (quadMean(prob, pw, ph, rectCorners(rect)) < c.boxThresh) return []
      const big = unclip(rect, c.unclip)
      if (!big || Math.min(big.w, big.h) < c.minSize + 2) return []
      return [rectCorners(big)]
    })
}

type Read = { text: string; confidence: number }

export class LineOcr {
  constructor(
    private readonly det: Net,
    private readonly rec: Net,
    /** CTC classes: blank, the dictionary, then the space PaddleOCR appends. */
    private readonly chars: readonly string[],
  ) {}

  static charset(dict: string): string[] {
    return ['', ...dict.split('\n').filter((c) => c !== ''), ' ']
  }

  // -- detection -------------------------------------------------------------
  async detect(page: Canvas): Promise<Quad[]> {
    const { width: w0, height: h0 } = page
    // A white border so text touching the edge still closes; then the long side to the
    // detector's working size, both ways, in multiples of 32.
    const pad = Math.max(8, Math.trunc(0.05 * Math.min(w0, h0)))
    const w = w0 + 2 * pad
    const h = h0 + 2 * pad
    const s = Math.min(CONFIG.det.limit / Math.max(w, h), 4)
    const rw = Math.max(32, Math.round((w * s) / 32) * 32)
    const rh = Math.max(32, Math.round((h * s) / 32) * 32)
    const canvas = new OffscreenCanvas(rw, rh)
    const ctx = context(canvas)
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, rw, rh)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(page, (pad * rw) / w, (pad * rh) / h, (w0 * rw) / w, (h0 * rh) / h)
    const out = await this.det(detTensor(pixelsOf(canvas), rw * rh), [1, 3, rh, rw])
    const pw = out.dims[3] ?? rw
    const ph = out.dims[2] ?? rh
    const toPage = (v: number, scale: number, max: number) =>
      Math.min(Math.max(v * scale - pad, 0), max - 1)
    return dbBoxes(out.data, pw, ph).flatMap((q) => {
      const box = mapQuad(q, ([px, py]) => [toPage(px, w / pw, w0), toPage(py, h / ph, h0)])
      const xs = box.map((p) => p[0])
      const ys = box.map((p) => p[1])
      const big = Math.max(...xs) - Math.min(...xs) >= 2 && Math.max(...ys) - Math.min(...ys) >= 2
      return big ? [box] : []
    })
  }

  // -- recognition -----------------------------------------------------------
  /** Read every crop, batched by width. */
  async recognize(crops: Gray[], progress: Progress): Promise<Read[]> {
    const c = CONFIG.rec
    const H = c.height
    const out: Read[] = crops.map(() => ({ text: '', confidence: 0 }))
    const order = crops
      .map((_, i) => i)
      .sort((a, b) => (crops[a]?.width ?? 0) - (crops[b]?.width ?? 0))
    for (let b = 0; b < order.length; b += c.batch) {
      const idx = order.slice(b, b + c.batch)
      const W = Math.min(c.maxWidth, Math.max(16, ...idx.map((i) => crops[i]?.width ?? 0)))
      const plane = H * W
      // 0 is mid-grey after normalising: the padding right of a short line.
      const x = new Float32Array(idx.length * 3 * plane)
      idx.forEach((i, n) => {
        const crop = crops[i]
        if (!crop) return
        const rw = Math.min(W, crop.width)
        for (let y = 0; y < H; y++) {
          for (let px = 0; px < rw; px++) {
            const v = ((crop.data[y * crop.width + px] ?? 0) / 255 - 0.5) / 0.5
            for (let k = 0; k < 3; k++) x[(n * 3 + k) * plane + y * W + px] = v
          }
        }
      })
      const res = await this.rec(x, [idx.length, 3, H, W])
      const frames = res.dims[1] ?? 0
      const classes = res.dims[2] ?? 0
      idx.forEach((i, n) => {
        out[i] = ctcDecode(res.data, n * frames * classes, frames, classes, this.chars)
      })
      progress('recognize', Math.min(b + c.batch, order.length), order.length)
    }
    return out
  }

  /**
   * Recognise every box. A box taller than wide is either a vertical run of text or one tall
   * character, so it is also read turned both ways and the most confident reading kept.
   */
  async readBoxes(gray: Gray, boxes: readonly Quad[], progress: Progress): Promise<Read[]> {
    const { height, maxWidth } = CONFIG.rec
    const cut = (q: Quad) => flatten(cutLine(gray, q, height, maxWidth))
    const tall = boxes.flatMap((b, i) => {
      const { w, h } = quadSize(b)
      return h >= 1.5 * w ? [{ i, b }] : []
    })
    const quads = [
      ...boxes,
      ...tall.map((t) => turnQuad(t.b, 1)),
      ...tall.map((t) => turnQuad(t.b, -1)),
    ]
    const res = await this.recognize(quads.map(cut), progress)
    const out = res.slice(0, boxes.length)
    tall.forEach(({ i: n }, j) => {
      for (const alt of [res[boxes.length + j], res[boxes.length + tall.length + j]]) {
        const cur = out[n]
        if (alt && cur && alt.confidence > cur.confidence) out[n] = alt
      }
    })
    return out
  }

  // -- page ------------------------------------------------------------------
  async read(image: ImageBitmap, progress: Progress): Promise<OcrResult> {
    const scale = Math.min(1, CONFIG.maxSide / Math.max(image.width, image.height))
    let page = new OffscreenCanvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    )
    const ctx = context(page)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, page.width, page.height)

    const t0 = performance.now()
    progress('detect', 0, 1)
    let boxes = await this.detect(page)
    let toPage: Affine = [1, 0, 0, 0, 1, 0]
    const skew = pageSkew(boxes)
    const straightened = Math.abs(skew) >= CONFIG.deskewAbove
    if (straightened) {
      const turned = deskew(page, skew)
      page = turned.canvas
      toPage = turned.map
      boxes = await this.detect(page)
    }
    const { width: pw, height: ph } = page
    if (boxes.length === 0 && ph <= 200 && pw >= 1.5 * ph) {
      // A small line-shaped image with nothing found: read it whole as one line.
      boxes = [
        [
          [0, 0],
          [pw - 1, 0],
          [pw - 1, ph - 1],
          [0, ph - 1],
        ],
      ]
    }
    progress('detect', 1, 1)
    const t1 = performance.now()

    const gray = toGray(pixelsOf(page), pw, ph)
    const reads = await this.readBoxes(gray, boxes, progress)
    const t2 = performance.now()

    const raw = reads.map((r) => r.text)
    const rows = readingOrder(boxes, pageSkew(boxes), raw)
    const frag = fragments(boxes, raw)
    const back = invertAffine(toPage)
    const toImage = (q: Quad) =>
      q.map((p) => {
        const [x, y] = applyAffine(back, p)
        return [Math.round((x / scale) * 10) / 10, Math.round((y / scale) * 10) / 10] as const
      })
    const { dropBelow, minChars, junkBelow, junkInvalid } = CONFIG.rec
    const lines: OcrLine[] = []
    const rowTexts: string[] = []
    let dropped = 0
    rows.forEach((row, ri) => {
      const parts: string[] = []
      for (const i of row) {
        if (frag.has(i)) continue
        const r = reads[i]
        const box = boxes[i]
        if (!r || !box) continue
        const text = fixScripts(canonical(r.text))
        const keep =
          text !== '' &&
          r.confidence >= dropBelow &&
          text.replaceAll(' ', '').length >= minChars &&
          !(r.confidence < junkBelow && invalidShare(text) > junkInvalid)
        if (!keep) {
          dropped++
          continue
        }
        parts.push(text)
        lines.push({
          text,
          confidence: Math.round(r.confidence * 10_000) / 10_000,
          row: ri,
          box: toImage(box),
        })
      }
      if (parts.length > 0) rowTexts.push(parts.join(' '))
    })
    return {
      text: rowTexts.join('\n'),
      lines,
      dropped,
      deskew: straightened ? Math.round(skew * 100) / 100 : 0,
      width: image.width,
      height: image.height,
      timing: {
        detMs: Math.round(t1 - t0),
        recMs: Math.round(t2 - t1),
        lines: boxes.length,
      },
    }
  }
}
