/**
 * Floating Thai marks (line_engine.LineOCR._attach_marks): old letterpress books and some display
 * fonts set tone marks and upper vowels so far above the consonants that the detector boxes the
 * line without them and finds the marks as boxes of their own, which the filter then drops.
 */
import { clean, dropReason } from './filter'
import { mapQuad, quadHeight, type Point, type Quad } from './geometry'
import { lineHeight } from './layout'
import { baseOf, digitsOf } from './thai-text'

/** Distances in line heights. */
const MARKS = {
  maxGap: 0.35,
  maxExt: 0.9,
  maxHeight: 0.9,
  margin: 0,
  pageShare: 0.25,
  pageMin: 3,
} as const

export type Reading = { readonly text: string; readonly confidence: number }

const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k]
const norm = (a: Point) => Math.hypot(a[0], a[1])

/** A kept line's frame: origin, unit vectors along and across it, its width and height. */
type Frame = { readonly o: Point; readonly u: Point; readonly v: Point; w: number; h: number }
/** How far a line grows, in pixels: [above, below]. */
type Reach = [number, number]
type Side = 0 | 1

/** numpy's median: the mean of the two middle values for an even count. */
function medianOf(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const m = v.length >> 1
  return v.length % 2 ? (v[m] ?? 0) : ((v[m - 1] ?? 0) + (v[m] ?? 0)) / 2
}

/** A box's extent along (s0..s1) and across (t0..t1) a line's frame. */
function project(f: Frame, q: Quad): readonly [number, number, number, number] {
  const ps = q.map((p) => minus(p, f.o))
  const s = ps.map((p) => dot(p, f.u))
  const t = ps.map((p) => dot(p, f.v))
  return [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)]
}

/** Frames of the kept lines at least half the line height tall. */
function lineFrames(boxes: readonly Quad[], junk: readonly boolean[]): Map<number, Frame> {
  const hmed = lineHeight(boxes.filter((_, i) => !junk[i]))
  const frames = new Map<number, Frame>()
  boxes.forEach((b, a) => {
    const w = norm(minus(b[1], b[0]))
    const h = norm(minus(b[3], b[0]))
    if (junk[a] || w < 1 || h < 0.5 * hmed) return
    frames.set(a, {
      o: b[0],
      u: times(minus(b[1], b[0]), 1 / w),
      v: times(minus(b[3], b[0]), 1 / h),
      w,
      h,
    })
  })
  return frames
}

type Placement = { gap: number; side: Side; ext: number }

/** Where a mark box sits against one line, or null if it is not one of that line's marks. */
function placement(f: Frame, q: Quad): Placement | null {
  const [s0, s1, t0, t1] = project(f, q)
  if (t1 - t0 > MARKS.maxHeight * f.h) return null
  if (Math.min(s1, f.w) - Math.max(s0, 0) < 0.5 * (s1 - s0)) return null
  let p: Placement
  if (t1 <= 0.5 * f.h) p = { gap: Math.max(0, -t1), side: 0, ext: -t0 }
  else if (t0 >= 0.5 * f.h) p = { gap: Math.max(0, t0 - f.h), side: 1, ext: t1 - f.h }
  else return null // across the line's middle: part of the line, not a mark
  return p.gap > MARKS.maxGap * f.h || p.ext > MARKS.maxExt * f.h ? null : p
}

/** Each junk box that is a mark goes to the nearest line (a tie to the line below). */
function assignMarks(
  boxes: readonly Quad[],
  junk: readonly boolean[],
  frames: ReadonlyMap<number, Frame>,
  reach: Map<number, Reach>,
): Map<number, number> {
  const owner = new Map<number, number>()
  boxes.forEach((q, j) => {
    if (!junk[j]) return
    let best: (Placement & { a: number }) | null = null
    for (const [a, f] of frames) {
      const p = placement(f, q)
      if (p && (!best || p.gap < best.gap || (p.gap === best.gap && p.side < best.side)))
        best = { ...p, a }
    }
    const r = best && reach.get(best.a)
    if (!best || !r) return
    owner.set(j, best.a)
    r[best.side] = Math.max(r[best.side], best.ext)
  })
  return owner
}

/** Room to grow line a towards one side before the neighbouring line's core, at most `room`. */
function roomBeside(
  a: number,
  side: Side,
  room: number,
  boxes: readonly Quad[],
  frames: ReadonlyMap<number, Frame>,
) {
  const f = frames.get(a)
  if (!f) return 0
  let out = room
  for (const b of frames.keys()) {
    const q = boxes[b]
    if (b === a || !q) continue
    const [s0, s1, t0, t1] = project(f, q)
    if (Math.min(s1, f.w) - Math.max(s0, 0) <= 0) continue
    if (side === 0 && t1 <= 0.5 * f.h) out = Math.min(out, Math.max(0, -t1 * 0.9))
    else if (side === 1 && t0 >= 0.5 * f.h) out = Math.min(out, Math.max(0, (t0 - f.h) * 0.9))
  }
  return out
}

/**
 * When enough lines had marks on one side, the typeface floats its marks: every other line grows
 * by the median reach too, as far as the room to its neighbour allows. True if the page does.
 */
function spreadReach(
  boxes: readonly Quad[],
  frames: ReadonlyMap<number, Frame>,
  reach: Map<number, Reach>,
): boolean {
  let floating = false
  for (const side of [0, 1] as const) {
    const lifted = [...frames].filter(([a]) => (reach.get(a)?.[side] ?? 0) > 0)
    if (lifted.length < Math.max(MARKS.pageMin, MARKS.pageShare * frames.size)) continue
    floating = true
    const typ = medianOf(lifted.map(([a, f]) => (reach.get(a)?.[side] ?? 0) / f.h))
    for (const [a, f] of frames) {
      const r = reach.get(a)
      if (r && r[side] <= 0) r[side] = roomBeside(a, side, typ * f.h, boxes, frames)
    }
  }
  return floating
}

/** Line a's box grown by its reach, clamped to the page. */
function grow(q: Quad, f: Frame, [up, down]: Reach, size: { width: number; height: number }): Quad {
  const lift = up > 0 ? times(f.v, up + MARKS.margin * f.h) : ([0, 0] as const)
  const drop = down > 0 ? times(f.v, down + MARKS.margin * f.h) : ([0, 0] as const)
  const clamp = ([x, y]: Point): Point => [
    Math.min(Math.max(x, 0), size.width - 1),
    Math.min(Math.max(y, 0), size.height - 1),
  ]
  return mapQuad([minus(q[0], lift), minus(q[1], lift), plus(q[2], drop), plus(q[3], drop)], clamp)
}

/**
 * Puts floating marks back into their lines. A box the filter would drop anyway, within maxGap
 * line heights above or below a kept line it overlaps and no taller than maxHeight of it, is a
 * mark of the nearest such line; that line grows by the marks' reach and is read again (on a page
 * that floats its marks, every line grows). A re-read is kept only if it passes the filter and
 * changes no digit and, unless the page floats its marks, no letter either: a speck taken for a
 * mark must not change a tax ID. Updates boxes and reads in place; returns the absorbed mark
 * boxes, to be skipped like fragments.
 */
export async function attachMarks<R extends Reading>(
  boxes: Quad[],
  reads: R[],
  frag: ReadonlySet<number>,
  size: { width: number; height: number },
  reread: (grown: Quad[]) => Promise<R[]>,
): Promise<Set<number>> {
  const hAll = boxes.length > 0 ? lineHeight(boxes) : 1
  const junk = boxes.map((b, i) => {
    const r = reads[i]
    return (
      frag.has(i) || !r || dropReason(clean(r.text), r.confidence, quadHeight(b) / hAll) !== null
    )
  })
  if (!junk.some(Boolean) || junk.every(Boolean)) return new Set()
  const frames = lineFrames(boxes, junk)
  const reach = new Map<number, Reach>([...frames.keys()].map((a) => [a, [0, 0]]))
  const owner = assignMarks(boxes, junk, frames, reach)
  if (owner.size === 0) return new Set()
  const floating = spreadReach(boxes, frames, reach)

  const grown = [...frames].flatMap(([a, f]) => {
    const r = reach.get(a)
    const q = boxes[a]
    return r && q && (r[0] > 0 || r[1] > 0) ? [{ a, box: grow(q, f, r, size) }] : []
  })
  const res = grown.length > 0 ? await reread(grown.map((g) => g.box)) : []
  const done = new Set<number>()
  grown.forEach(({ a, box }, k) => {
    const r = res[k]
    const old = reads[a]
    if (!r || !old) return
    const fresh = clean(r.text)
    const was = clean(old.text)
    const changed = floating ? digitsOf(fresh) !== digitsOf(was) : baseOf(fresh) !== baseOf(was)
    if (changed || dropReason(fresh, r.confidence) !== null) return
    boxes[a] = box
    reads[a] = r
    done.add(a)
  })
  // Marks count as absorbed only where their line was read again.
  return new Set([...owner].filter(([, a]) => done.has(a)).map(([j]) => j))
}
