import type { Quad } from './geometry'
import { fragments, lineHeight, pageSkew, readingOrder } from './layout'

const box = (x: number, y: number, w: number, h: number): Quad => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]

describe('pageSkew', () => {
  it('is the median angle of long lines', () => {
    const t = Math.tan((5 * Math.PI) / 180)
    const tilted = (y: number): Quad => [
      [0, y],
      [300, y + 300 * t],
      [300, y + 300 * t + 20],
      [0, y + 20],
    ]
    expect(pageSkew([tilted(0), tilted(50), tilted(100)])).toBeCloseTo(5, 3)
    expect(pageSkew([box(0, 0, 30, 30)])).toBe(0)
  })
})

describe('lineHeight', () => {
  it('ignores small fragments when there are enough lines', () => {
    const lines = [box(0, 0, 400, 30), box(0, 50, 400, 30), box(0, 100, 400, 30)]
    const marks = [box(10, 0, 8, 8), box(20, 0, 8, 8), box(30, 0, 8, 8), box(40, 0, 8, 8)]
    expect(lineHeight([...lines, ...marks])).toBe(30)
  })
})

describe('readingOrder', () => {
  it('reads rows top to bottom, each left to right', () => {
    // right cell first in input, slightly higher than its row neighbour
    const boxes = [box(300, 2, 100, 20), box(0, 0, 100, 20), box(0, 40, 100, 20)]
    expect(readingOrder(boxes, 0)).toEqual([[1, 0], [2]])
  })

  it('reads two prose columns one after the other', () => {
    const left = Array.from({ length: 12 }, (_, i) => box(0, i * 30, 400, 20))
    const right = Array.from({ length: 12 }, (_, i) => box(500, i * 30, 400, 20))
    const rows = readingOrder([...left, ...right], 0)
    expect(rows.flat()).toEqual(Array.from({ length: 24 }, (_, i) => i))
  })

  it('keeps a table with short cells in row order', () => {
    const left = Array.from({ length: 12 }, (_, i) => box(0, i * 30, 80, 20))
    const right = Array.from({ length: 12 }, (_, i) => box(500, i * 30, 80, 20))
    const rows = readingOrder([...left, ...right], 0)
    expect(rows[0]).toEqual([0, 12])
  })
})

describe('fragments', () => {
  it('flags a tiny mark box touching a full line', () => {
    const boxes = [
      box(0, 0, 400, 30),
      box(0, 50, 400, 30),
      box(0, 100, 400, 30),
      box(50, 82, 10, 6),
    ]
    expect([...fragments(boxes, ['ก', 'ข', 'ค', '่'])]).toEqual([3])
  })
})
