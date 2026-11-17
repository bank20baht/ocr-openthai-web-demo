/**
 * Pixel work for the recognizer, on plain arrays: greyscale, cutting a line box out of the page
 * at the recognizer's height, and line_engine._flatten (dark text on white from any crop).
 */
import { dist, type Point, type Quad } from './geometry'

/** One 8-bit channel, row-major. */
export type Gray = { readonly width: number; readonly height: number; readonly data: Uint8Array }

/** Luminance as OpenCV's BGR2GRAY computes it. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = Math.round(
      0.299 * (rgba[j] ?? 0) + 0.587 * (rgba[j + 1] ?? 0) + 0.114 * (rgba[j + 2] ?? 0),
    )
  }
  return { width, height, data }
}

function sample(g: Gray, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), g.width - 1)
  const cy = Math.min(Math.max(y, 0), g.height - 1)
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(x0 + 1, g.width - 1)
  const y1 = Math.min(y0 + 1, g.height - 1)
  const fx = cx - x0
  const fy = cy - y0
  const d = g.data
  const top = (d[y0 * g.width + x0] ?? 0) * (1 - fx) + (d[y0 * g.width + x1] ?? 0) * fx
  const bot = (d[y1 * g.width + x0] ?? 0) * (1 - fx) + (d[y1 * g.width + x1] ?? 0) * fx
  return top * (1 - fy) + bot * fy
}

/** A quad's own size, as line_engine.crop_line measures it. */
export function quadSize(q: Quad): { w: number; h: number } {
  const w = Math.trunc(Math.max(dist(q[0], q[1]), dist(q[2], q[3])))
  const h = Math.trunc(Math.max(dist(q[0], q[3]), dist(q[1], q[2])))
  return { w: Math.max(w, 1), h: Math.max(h, 1) }
}

/**
 * The quad cut out of the page and scaled to `height` rows (width follows its aspect, at most
 * maxWidth): crop_line + resize in one pass. Each output pixel averages up to 4x4 samples, so a
 * tall line shrinks without aliasing its thin Thai marks away.
 */
export function cutLine(g: Gray, q: Quad, height: number, maxWidth: number): Gray {
  const { w, h } = quadSize(q)
  const width = Math.min(maxWidth, Math.max(1, Math.ceil((height * w) / h)))
  const ss = Math.min(4, Math.max(1, Math.ceil(h / height), Math.ceil(w / width)))
  const [p0, p1, p2, p3] = q
  const at = (s: number, t: number): Point => {
    const tx = p0[0] + s * (p1[0] - p0[0])
    const ty = p0[1] + s * (p1[1] - p0[1])
    const bx = p3[0] + s * (p2[0] - p3[0])
    const by = p3[1] + s * (p2[1] - p3[1])
    return [tx + t * (bx - tx), ty + t * (by - ty)]
  }
  const data = new Uint8Array(width * height)
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      let sum = 0
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const [x, y] = at((u + (i + 0.5) / ss) / width, (v + (j + 0.5) / ss) / height)
          sum += sample(g, x - 0.5, y - 0.5)
        }
      }
      data[v * width + u] = Math.round(sum / (ss * ss))
    }
  }
  return { width, height, data }
}

/** The quad turned a quarter: +1 counter-clockwise, -1 clockwise (np.rot90 of the cut). */
export function turnQuad(q: Quad, k: 1 | -1): Quad {
  const [a, b, c, d] = q
  return k === 1 ? [b, c, d, a] : [d, a, b, c]
}

const bump = (a: Uint32Array, i: number, by: number): void => {
  a[i] = (a[i] ?? 0) + by
}

function medianOf(values: number[]): number {
  values.sort((a, b) => a - b)
  const mid = values.length >> 1
  return values.length % 2 ? (values[mid] ?? 0) : ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2
}

/**
 * Dark text on white from any line crop: each column's background is the median of the crop's
 * top and bottom margin rows, smoothed along the line, and text is whatever differs from it,
 * light or dark (line_engine._flatten).
 */
export function flatten(g: Gray): Gray {
  const { width: w, height: h, data } = g
  const bg = runningMedian(marginColumns(g), Math.max(3, Math.min(h | 1, 255)))
  const diff = new Float32Array(w * h)
  const counts = new Uint32Array(256)
  for (let i = 0; i < diff.length; i++) {
    const d = Math.abs((data[i] ?? 0) - (bg[i % w] ?? 0))
    diff[i] = d
    bump(counts, Math.trunc(d), 1)
  }
  const hi = Math.max(firstLevel(counts, 0.98 * w * h), 24)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.trunc(255 - Math.min(Math.max(((diff[i] ?? 0) * 255) / hi, 0), 255))
  }
  return { width: w, height: h, data: out }
}

/** First level whose cumulative count reaches `need` (np.searchsorted on the cumsum). */
function firstLevel(hist: Uint32Array, need: number): number {
  let acc = 0
  for (let v = 0; v < hist.length; v++) {
    acc += hist[v] ?? 0
    if (acc >= need) return v
  }
  return hist.length
}

/** Each column's background: the median of its top and bottom h/6 rows. */
function marginColumns(g: Gray): Uint8Array {
  const { width: w, height: h, data } = g
  const k = Math.max(2, Math.floor(h / 6))
  const column = new Uint8Array(w)
  const margin: number[] = []
  for (let x = 0; x < w; x++) {
    margin.length = 0
    for (let y = 0; y < k; y++) margin.push(data[y * w + x] ?? 0, data[(h - 1 - y) * w + x] ?? 0)
    column[x] = Math.trunc(medianOf(margin))
  }
  return column
}

/** cv2.medianBlur over a 3-row image of equal rows: a 1-D running median, edges replicated. */
function runningMedian(column: Uint8Array, win: number): Uint8Array {
  const w = column.length
  const half = win >> 1
  const out = new Uint8Array(w)
  const hist = new Uint32Array(256)
  const at = (x: number) => column[Math.min(Math.max(x, 0), w - 1)] ?? 0
  for (let x = -half; x <= half; x++) bump(hist, at(x), 1)
  for (let x = 0; x < w; x++) {
    out[x] = firstLevel(hist, half + 1)
    bump(hist, at(x - half), -1)
    bump(hist, at(x + half + 1), 1)
  }
  return out
}
