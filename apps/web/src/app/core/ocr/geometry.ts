/**
 * Plane geometry for the detector's post-processing: what the Python runtime gets from OpenCV
 * (findContours, minAreaRect, boxPoints) and pyclipper (unclip), on plain arrays.
 */

export type Point = readonly [number, number]
/** Four corners: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point]

/** The quad with each corner mapped, corner order kept. */
export const mapQuad = (q: Quad, f: (p: Point) => Point): Quad => [
  f(q[0]),
  f(q[1]),
  f(q[2]),
  f(q[3]),
]

export const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Width (top edge) and height (left edge) of an ordered quad. */
export const quadWidth = (q: Quad): number => dist(q[0], q[1])
export const quadHeight = (q: Quad): number => dist(q[0], q[3])

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

export const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

/** Four points -> top-left, top-right, bottom-right, bottom-left (as line_engine.order_points). */
export function orderPoints(pts: readonly Point[]): Quad {
  const byX = [...pts].sort((a, b) => a[0] - b[0])
  const [l0, l1, r0, r1] = byX as [Point, Point, Point, Point]
  const [tl, bl] = l0[1] <= l1[1] ? [l0, l1] : [l1, l0]
  const [tr, br] = r0[1] <= r1[1] ? [r0, r1] : [r1, r0]
  return [tl, tr, br, bl]
}

/** Andrew's monotone chain; collinear points dropped. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Point[]): Point[] => {
    const out: Point[] = []
    for (const p of list) {
      for (let a = out.at(-2), b = out.at(-1); a && b && cross(a, b, p) <= 0;) {
        out.pop()
        a = out.at(-2)
        b = out.at(-1)
      }
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(pts), ...half([...pts].reverse())]
}

export type RotatedRect = { cx: number; cy: number; w: number; h: number; angle: number }

/** Smallest-area enclosing rectangle by rotating calipers over the hull (cv2.minAreaRect). */
export function minAreaRect(points: readonly Point[]): RotatedRect {
  const hull = convexHull(points)
  if (hull.length === 0) return { cx: 0, cy: 0, w: 0, h: 0, angle: 0 }
  if (hull.length < 3) {
    const [a, b = a] = hull as [Point, Point?]
    return {
      cx: (a[0] + b[0]) / 2,
      cy: (a[1] + b[1]) / 2,
      w: dist(a, b),
      h: 0,
      angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
    }
  }
  let best: RotatedRect = { cx: 0, cy: 0, w: 0, h: 0, angle: 0 }
  let bestArea = Infinity
  for (const [i, p] of hull.entries()) {
    const q = hull[(i + 1) % hull.length] ?? p
    const angle = Math.atan2(q[1] - p[1], q[0] - p[0])
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const [x, y] of hull) {
      const u = x * c + y * s
      const v = -x * s + y * c
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < bestArea) {
      bestArea = area
      const u = (minU + maxU) / 2
      const v = (minV + maxV) / 2
      best = { cx: u * c - v * s, cy: u * s + v * c, w: maxU - minU, h: maxV - minV, angle }
    }
  }
  return best
}

/** The rectangle's corners, ordered (cv2.boxPoints + order_points). */
export function rectCorners(r: RotatedRect): Quad {
  const c = Math.cos(r.angle)
  const s = Math.sin(r.angle)
  const hw = r.w / 2
  const hh = r.h / 2
  const at = (u: number, v: number): Point => [r.cx + u * c - v * s, r.cy + u * s + v * c]
  return orderPoints([at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)])
}

/**
 * DB "unclip": grow the box outward by area * ratio / perimeter. For a rectangle, pyclipper's
 * round-joined offset followed by minAreaRect is the same rectangle with each side pushed out by
 * that distance.
 */
export function unclip(r: RotatedRect, ratio: number): RotatedRect | null {
  const perimeter = 2 * (r.w + r.h)
  if (perimeter === 0) return null
  const d = (r.w * r.h * ratio) / perimeter
  return { ...r, w: r.w + 2 * d, h: r.h + 2 * d }
}

/** Is (x, y) inside or on a convex quad? */
export function insideQuad(q: Quad, x: number, y: number): boolean {
  let sign = 0
  for (const [i, a] of q.entries()) {
    const b = q[(i + 1) % 4] ?? a
    const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
    if (cr === 0) continue
    const s = cr > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Connected regions of a binary map (8-connected, as cv2.findContours sees blobs), each as the
 * pixel centres on its border: enough for the hull, the rest of a blob never touches it.
 */
export function regionBorders(bitmap: Uint8Array, width: number, height: number): Point[][] {
  const label = new Int32Array(width * height)
  const regions: Point[][] = []
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && bitmap[y * width + x] === 1
  const NEIGHBOURS = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy] as const))
  /** Flood one region from `start`, labelling it `id`; its border pixels. */
  const flood = (start: number, id: number): Point[] => {
    const border: Point[] = []
    const stack = [start]
    label[start] = id
    for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
      const x = i % width
      const y = (i - x) / width
      if (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)) border.push([x, y])
      for (const [dx, dy] of NEIGHBOURS) {
        const j = (y + dy) * width + x + dx
        if (on(x + dx, y + dy) && label[j] === 0) {
          label[j] = id
          stack.push(j)
        }
      }
    }
    return border
  }
  for (let start = 0; start < bitmap.length; start++) {
    if (bitmap[start] === 1 && label[start] === 0) regions.push(flood(start, regions.length + 1))
  }
  return regions
}

/** Mean of `map` over the pixels a quad covers (line_engine._box_score). */
export function quadMean(map: Float32Array, width: number, height: number, q: Quad): number {
  const xs = q.map((p) => p[0])
  const ys = q.map((p) => p[1])
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi)
  const x0 = clamp(Math.floor(Math.min(...xs)), width - 1)
  const x1 = clamp(Math.ceil(Math.max(...xs)), width - 1)
  const y0 = clamp(Math.floor(Math.min(...ys)), height - 1)
  const y1 = clamp(Math.ceil(Math.max(...ys)), height - 1)
  // cv2.fillPoly draws the polygon on integer vertices.
  const iq = mapQuad(q, (p) => [Math.trunc(p[0]), Math.trunc(p[1])])
  let sum = 0
  let n = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!insideQuad(iq, x, y)) continue
      sum += map[y * width + x] ?? 0
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

/** 2x3 affine matrix [a, b, c, d, e, f]: x' = a x + b y + c, y' = d x + e y + f. */
export type Affine = readonly [number, number, number, number, number, number]

export const applyAffine = (m: Affine, p: Point): Point => [
  m[0] * p[0] + m[1] * p[1] + m[2],
  m[3] * p[0] + m[4] * p[1] + m[5],
]

export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[4] - m[1] * m[3]
  const a = m[4] / det
  const b = -m[1] / det
  const d = -m[3] / det
  const e = m[0] / det
  return [a, b, -(a * m[2] + b * m[5]), d, e, -(d * m[2] + e * m[5])]
}
