/**
 * Page layout from the detected line boxes, ported from line_engine.py: skew, line height,
 * reading order (rows, and prose columns read one after another) and mark fragments.
 */
import { DIGITS, enumNumber, startRepeat } from './thai-text'
import { dist, mean, median, quadHeight, quadWidth, type Quad } from './geometry'

const RAD = 180 / Math.PI

/** Median text-line angle in degrees, from boxes at least 3x wider than tall. */
export function pageSkew(boxes: readonly Quad[]): number {
  const angles: number[] = []
  for (const b of boxes) {
    const dx = b[1][0] - b[0][0]
    const dy = b[1][1] - b[0][1]
    if (Math.hypot(dx, dy) >= 3 * Math.max(quadHeight(b), 1)) angles.push(Math.atan2(dy, dx) * RAD)
  }
  return angles.length > 0 ? median(angles) : 0
}

/** Typical line height: the median over line-shaped boxes (at least twice as wide as tall). */
export function lineHeight(boxes: readonly Quad[]): number {
  const hs = boxes.map((b) => Math.max(quadHeight(b), 1))
  const lines = boxes.flatMap((b, i) => {
    const h = hs[i] ?? 1
    return quadWidth(b) >= 2 * h ? [h] : []
  })
  if (hs.length === 0) return 1
  return median(lines.length >= 3 ? lines : hs)
}

/** x0, x1, y0, y1 of a box. */
type Extent = readonly [number, number, number, number]

/** Empty bands between intervals, at least minGap wide. */
function gaps(
  intervals: readonly (readonly [number, number])[],
  minGap: number,
): [number, number][] {
  const iv = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: [number, number][] = []
  const [first, ...rest] = iv
  if (!first) return out
  let reach = first[1]
  for (const [lo, hi] of rest) {
    if (lo - reach >= minGap) out.push([reach, lo])
    reach = Math.max(reach, hi)
  }
  return out
}

/**
 * The list guard in the column test (line_engine DEFAULTS["cols"]): two sides of a gap that are
 * the columns of a list are read row by row. 0 turns a test off.
 */
export type ListRules = {
  /** Mean share of each side's lines that start alike (see startRepeat). */
  readonly listRep: number
  /** Share of the shorter side's lines facing a line of the other side, both sides narrow. */
  readonly listFacing: number
  /** Narrow: median line width under this many line heights. */
  readonly listMaxW: number
  /** Share of the left side's lines numbered, facing at least 0.6. */
  readonly listEnum: number
}

const LIST_RULES: ListRules = { listRep: 0.6, listFacing: 0, listMaxW: 10, listEnum: 0 }

type Ctx = {
  ext: readonly Extent[]
  hmed: number
  texts: readonly string[] | null
  rules: ListRules | null
}

const NO_EXTENT: Extent = [0, 0, 0, 0]
const ext0 = (c: Ctx, i: number): Extent => c.ext[i] ?? NO_EXTENT

/** The column of `side` that touches the gutter (a side can hold several). */
function nextTo(side: number[], c: Ctx, gutterOnRight: boolean): number[] {
  if (side.length === 0) return side
  const g = gaps(
    side.map((i) => [ext0(c, i)[0], ext0(c, i)[1]] as const),
    0.8 * c.hmed,
  )
  const first = g[0]
  const last = g.at(-1)
  if (!first || !last) return side
  return gutterOnRight
    ? side.filter((i) => ext0(c, i)[0] >= last[1])
    : side.filter((i) => ext0(c, i)[1] <= first[0])
}

/** A column of prose: enough long lines, most filling the column, not mostly digits. */
function prose(col: number[], c: Ctx): boolean {
  if (col.length < 12) return false
  const widths = col.map((i) => ext0(c, i)[1] - ext0(c, i)[0])
  const span =
    Math.max(...col.map((i) => ext0(c, i)[1])) - Math.min(...col.map((i) => ext0(c, i)[0]))
  if (median(widths) < 7 * c.hmed || mean(widths.map((w) => (w >= 0.75 * span ? 1 : 0))) < 0.35)
    return false
  const texts = c.texts
  if (texts) {
    const chars = col.flatMap((i) => Array.from(texts[i] ?? '').filter((ch) => ch.trim() !== ''))
    if (chars.length > 0 && chars.filter((ch) => DIGITS.has(ch)).length > 0.3 * chars.length)
      return false
    // Prose never repeats a line; a list's value column does.
    if (new Set(col.map((i) => (texts[i] ?? '').trim())).size < 0.8 * col.length) return false
  }
  return true
}

/**
 * Two sides of a gap that are the columns of a list, read row by row (a name and a position, a
 * label and its value): lines that start alike, or narrow sides whose lines face one to one.
 */
function listPair(lcol: number[], rcol: number[], c: Ctx): boolean {
  const r = c.rules
  if (!r || !(r.listRep || r.listFacing || r.listEnum) || lcol.length === 0 || rcol.length === 0)
    return false
  const texts = c.texts
  if (r.listRep && texts) {
    const rep = mean([lcol, rcol].map((col) => startRepeat(col.map((i) => texts[i] ?? ''))))
    if (rep >= r.listRep) return true
  }
  const [small, other] = lcol.length <= rcol.length ? [lcol, rcol] : [rcol, lcol]
  const cy = (i: number) => (ext0(c, i)[2] + ext0(c, i)[3]) / 2
  const face = mean(
    small.map((i) => (other.some((j) => Math.abs(cy(i) - cy(j)) <= 0.5 * c.hmed) ? 1 : 0)),
  )
  const wide =
    Math.max(...[lcol, rcol].map((col) => median(col.map((i) => ext0(c, i)[1] - ext0(c, i)[0])))) /
    c.hmed
  if (r.listFacing && face >= r.listFacing && wide < r.listMaxW) return true
  if (r.listEnum && texts && face >= 0.6)
    return mean(lcol.map((i) => (enumNumber(texts[i] ?? '') === null ? 0 : 1))) >= r.listEnum
  return false
}

/** Two prose columns either side of a gutter, not a numbered list or a list read row by row. */
const columnPair = (lcol: number[], rcol: number[], c: Ctx): boolean =>
  prose(lcol, c) && prose(rcol, c) && !numberedAcross(lcol, rcol, c) && !listPair(lcol, rcol, c)

/** Most facing lines numbered n (left) and n+1 (right): a list that reads across. */
function numberedAcross(lcol: number[], rcol: number[], c: Ctx): boolean {
  const texts = c.texts
  if (!texts) return false
  const cy = (i: number) => (ext0(c, i)[2] + ext0(c, i)[3]) / 2
  let pairs = 0
  for (const i of lcol) {
    const a = enumNumber(texts[i] ?? '')
    if (a === null) continue
    const facing = rcol.some(
      (j) => enumNumber(texts[j] ?? '') === a + 1 && Math.abs(cy(j) - cy(i)) <= 0.5 * c.hmed,
    )
    if (facing) pairs++
  }
  return pairs >= 0.5 * Math.min(lcol.length, rcol.length)
}

/** Recursive XY-cut into reading-order blocks (line_engine._blocks). */
function blocks(idx: number[], c: Ctx, depth = 0): number[][] {
  if (idx.length < 6 || depth > 12) return [idx]
  let cut: { width: number; left: number[]; right: number[] } | null = null
  for (const [g0, g1] of gaps(
    idx.map((i) => [ext0(c, i)[0], ext0(c, i)[1]] as const),
    0.8 * c.hmed,
  )) {
    const left = idx.filter((i) => ext0(c, i)[1] <= g0)
    const right = idx.filter((i) => ext0(c, i)[0] >= g1)
    const lcol = nextTo(left, c, true)
    const rcol = nextTo(right, c, false)
    if (columnPair(lcol, rcol, c)) {
      if (!cut || g1 - g0 > cut.width) cut = { width: g1 - g0, left, right }
    }
  }
  if (cut) return [...blocks(cut.left, c, depth + 1), ...blocks(cut.right, c, depth + 1)]
  const hg = gaps(
    idx.map((i) => [ext0(c, i)[2], ext0(c, i)[3]] as const),
    0.8 * c.hmed,
  )
  if (hg.length === 0) return bandedColumns(idx, c, depth) ?? [idx]
  const [g0, g1] = hg.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
  const top = idx.filter((i) => ext0(c, i)[3] <= g0)
  const bottom = idx.filter((i) => ext0(c, i)[2] >= g1)
  return [...blocks(top, c, depth + 1), ...blocks(bottom, c, depth + 1)]
}

/**
 * Prose columns that a few full-width lines cross (a title over both columns, a footer, a
 * caption between sections), where no plain gutter or horizontal gap exists. Lines at least 0.55
 * of the block's width, at most 15 % of its lines, are set aside; in the rest a gutter is an x
 * band in the middle 70 % of the block, at least 0.4 line heights wide, that at most 3 % of the
 * lines cross. If it lies between two prose columns, the wide lines and the lines crossing the
 * whole gutter cut the page into bands, each read left of the gutter, then right of it, then the
 * crossing line under it. Null when the block is not like that.
 */
function bandedColumns(idx: number[], c: Ctx, depth: number): number[][] | null {
  const x0 = Math.min(...idx.map((i) => ext0(c, i)[0]))
  const x1 = Math.max(...idx.map((i) => ext0(c, i)[1]))
  const wide = idx.filter((i) => ext0(c, i)[1] - ext0(c, i)[0] >= 0.55 * (x1 - x0))
  if (wide.length > 0.15 * idx.length) return null
  const wideSet = new Set(wide)
  const rest = idx.filter((i) => !wideSet.has(i))
  if (rest.length < 24) return null
  const gutter = bestGutter(rest, freeRuns(rest, x0, x1, c), c)
  return gutter ? bands(rest, wide, gutter, c, depth) : null
}

/** X bands in the middle 70 % of [x0, x1], at least 0.4 line heights wide, that at most 3 % of the lines cross. */
function freeRuns(rest: number[], x0: number, x1: number, c: Ctx): [number, number][] {
  const lo = Math.trunc(x0 + 0.15 * (x1 - x0))
  const n = Math.trunc(0.7 * (x1 - x0)) + 1
  const cover = new Int32Array(n)
  for (const i of rest) {
    const a = Math.max(0, Math.trunc(ext0(c, i)[0]) - lo)
    const b = Math.min(n, Math.ceil(ext0(c, i)[1]) - lo)
    for (let x = a; x < b; x++) cover[x] = (cover[x] ?? 0) + 1
  }
  const limit = Math.max(1, Math.trunc(0.03 * rest.length))
  const runs: [number, number][] = []
  let start: number | null = null
  for (let x = 0; x <= n; x++) {
    const free = x < n && (cover[x] ?? 0) <= limit
    if (free) start ??= x
    else if (start !== null) {
      if (x - start >= 0.4 * c.hmed) runs.push([lo + start, lo + x])
      start = null
    }
  }
  return runs
}

/** The widest run with a prose column on each side, or null. */
function bestGutter(rest: number[], runs: [number, number][], c: Ctx): [number, number] | null {
  let best: [number, number] | null = null
  for (const [k, [g0, g1]] of runs.entries()) {
    const prev = runs[k - 1]
    const next = runs[k + 1]
    // The column on each side ends at the neighbouring gutter (three columns: two gutters).
    const lcol = rest.filter((i) => ext0(c, i)[1] <= g0 && (!prev || ext0(c, i)[0] >= prev[1]))
    const rcol = rest.filter((i) => ext0(c, i)[0] >= g1 && (!next || ext0(c, i)[1] <= next[0]))
    if (columnPair(lcol, rcol, c) && (!best || g1 - g0 > best[1] - best[0])) best = [g0, g1]
  }
  return best
}

/** The block cut into bands by the lines crossing the gutter; each band left, right, then its separator. */
function bands(
  rest: number[],
  wide: number[],
  [g0, g1]: [number, number],
  c: Ctx,
  depth: number,
): number[][] {
  const cy = (i: number) => (ext0(c, i)[2] + ext0(c, i)[3]) / 2
  const cx = (i: number) => (ext0(c, i)[0] + ext0(c, i)[1]) / 2
  // Narrower lines that still cross the whole gutter.
  const mid = rest.filter((i) => ext0(c, i)[0] < g0 && ext0(c, i)[1] > g1)
  const midSet = new Set(mid)
  const seps = [...wide, ...mid].sort((p, q) => cy(p) - cy(q))
  const out: number[][] = []
  for (let b = 0; b <= seps.length; b++) {
    const prev = seps[b - 1]
    const sep = seps[b]
    const top = prev === undefined ? -Infinity : cy(prev)
    const bottom = sep === undefined ? Infinity : cy(sep)
    const band = rest.filter((i) => !midSet.has(i) && top < cy(i) && cy(i) <= bottom)
    // A line that only touches the gutter goes to the side of its centre.
    const left = band.filter((i) => cx(i) < (g0 + g1) / 2)
    const right = band.filter((i) => cx(i) >= (g0 + g1) / 2)
    if (left.length > 0) out.push(...blocks(left, c, depth + 1))
    if (right.length > 0) out.push(...blocks(right, c, depth + 1))
    if (sep !== undefined) out.push([sep])
  }
  return out
}

type RowGeometry = {
  readonly cy: readonly number[]
  readonly rx: readonly number[]
  readonly hs: readonly number[]
  readonly hmed: number
}

/**
 * One block's rows: full-height lines grouped by vertical overlap with the row's running centre;
 * small boxes (detached marks) then join the nearest row without moving it, or start their own.
 */
function blockRows(blk: readonly number[], g: RowGeometry): number[][] {
  const at = (v: readonly number[], i: number) => v[i] ?? 0
  const tol = 0.5 * g.hmed
  const tall = blk.filter((i) => at(g.hs, i) >= 0.6 * g.hmed)
  const full = tall.length > 0 ? tall : [...blk]
  const fullSet = new Set(full)
  const rows: number[][] = []
  const centre: number[] = []
  for (const i of [...full].sort((p, q) => at(g.cy, p) - at(g.cy, q))) {
    const last = rows.at(-1)
    if (last && Math.abs(at(g.cy, i) - mean(last.map((j) => at(g.cy, j)))) <= tol) last.push(i)
    else rows.push([i])
  }
  for (const r of rows) centre.push(mean(r.map((j) => at(g.cy, j))))
  for (const i of blk.filter((k) => !fullSet.has(k))) {
    const d = centre.map((c) => Math.abs(at(g.cy, i) - c))
    const best = d.indexOf(Math.min(...d))
    const row = rows[best]
    if (row && at(d, best) <= tol + 0.5 * at(g.hs, i)) row.push(i)
    else {
      rows.push([i])
      centre.push(at(g.cy, i))
    }
  }
  return rows
    .map((_, r) => r)
    .sort((p, q) => at(centre, p) - at(centre, q))
    .map((r) => [...(rows[r] ?? [])].sort((p, q) => at(g.rx, p) - at(g.rx, q)))
}

/**
 * Rows top to bottom, each left to right, in deskewed coordinates, block by block: prose
 * columns are read one after the other. Small boxes (detached marks) join the nearest row.
 */
export function readingOrder(
  boxes: readonly Quad[],
  angle: number,
  texts: readonly string[] | null = null,
  rules: ListRules | null = LIST_RULES,
): number[][] {
  if (boxes.length === 0) return []
  const a = -angle / RAD
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const ext: Extent[] = boxes.map((b) => {
    const xs = b.map((p) => p[0] * cos - p[1] * sin)
    const ys = b.map((p) => p[0] * sin + p[1] * cos)
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  })
  const hmed = lineHeight(boxes)
  const ctx: Ctx = { ext, hmed, texts, rules }
  const geo: RowGeometry = {
    cy: ext.map((e) => (e[2] + e[3]) / 2),
    rx: ext.map((e) => (e[0] + e[1]) / 2),
    hs: boxes.map((b) => Math.max(quadHeight(b), 1)),
    hmed,
  }
  const all = boxes.map((_, i) => i)
  let blks = blocks(all, ctx)
  if (a !== 0) {
    // The skew can be 1-2 degrees off on a straight page; rotated by it, a gutter about one em
    // wide is covered by the column's line ends. The unrotated frame is used for the blocks when
    // it finds more of them; rows are still grouped in the rotated frame.
    const flat: Extent[] = boxes.map((b) => {
      const xs = b.map((p) => p[0])
      const ys = b.map((p) => p[1])
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    })
    const alt = blocks(all, { ...ctx, ext: flat })
    if (alt.length > blks.length) blks = alt
  }
  return blks.flatMap((blk) => blockRows(blk, geo))
}

/**
 * Boxes that are pieces of a neighbouring line (a stacked mark detected on its own): at most 3
 * characters, under 35 % of the line height, touching a full-height line above or below.
 */
export function fragments(boxes: readonly Quad[], texts: readonly string[]): Set<number> {
  const out = new Set<number>()
  if (boxes.length < 3) return out
  const hs = boxes.map((b) => dist(b[0], b[3]))
  const hmed = lineHeight(boxes)
  const extent = (b: Quad) => {
    const xs = b.map((p) => p[0])
    const ys = b.map((p) => p[1])
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] as const
  }
  boxes.forEach((b, i) => {
    if ((hs[i] ?? 0) >= 0.35 * hmed || (texts[i] ?? '').replaceAll(' ', '').length > 3) return
    const [x0, x1, y0, y1] = extent(b)
    const touches = boxes.some((c, j) => {
      if (j === i || (hs[j] ?? 0) < 0.6 * hmed) return false
      const [cx0, cx1, cy0, cy1] = extent(c)
      return (
        cx0 <= x1 && x0 <= cx1 && Math.min(Math.abs(y0 - cy1), Math.abs(cy0 - y1)) <= 0.5 * hmed
      )
    })
    if (touches) out.add(i)
  })
  return out
}
