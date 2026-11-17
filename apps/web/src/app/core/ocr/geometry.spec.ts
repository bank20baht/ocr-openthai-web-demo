import {
  applyAffine,
  convexHull,
  insideQuad,
  invertAffine,
  minAreaRect,
  orderPoints,
  quadMean,
  rectCorners,
  regionBorders,
  unclip,
  type Affine,
  type Quad,
} from './geometry'

const close = (a: number, b: number) => {
  expect(a).toBeCloseTo(b, 6)
}

describe('orderPoints', () => {
  it('orders corners top-left, top-right, bottom-right, bottom-left', () => {
    expect(
      orderPoints([
        [10, 5],
        [0, 5],
        [10, 0],
        [0, 0],
      ]),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ])
  })
})

describe('convexHull + minAreaRect', () => {
  it('drops inner points and finds an axis-aligned box', () => {
    const pts: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
      [2, 1],
    ]
    expect(convexHull(pts)).toHaveLength(4)
    const r = minAreaRect(pts)
    close(Math.max(r.w, r.h), 4)
    close(Math.min(r.w, r.h), 2)
    close(r.cx, 2)
    close(r.cy, 1)
  })

  it('finds the tilt of a rotated rectangle', () => {
    const a = Math.PI / 12
    const rect = rectCorners({ cx: 50, cy: 40, w: 60, h: 10, angle: a })
    const r = minAreaRect(rect)
    close(r.w * r.h, 600)
    expect(
      Math.abs(Math.tan(r.angle) - Math.tan(a)) < 1e-6 ||
        Math.abs(Math.tan(r.angle) + 1 / Math.tan(a)) < 1e-6,
    ).toBe(true)
  })
})

describe('unclip', () => {
  it('pushes each side out by area * ratio / perimeter', () => {
    const r = unclip({ cx: 0, cy: 0, w: 30, h: 10, angle: 0 }, 1.5)
    // d = 300 * 1.5 / 80 = 5.625
    close(r?.w ?? 0, 41.25)
    close(r?.h ?? 0, 21.25)
    expect(unclip({ cx: 0, cy: 0, w: 0, h: 0, angle: 0 }, 1.5)).toBeNull()
  })
})

describe('insideQuad / quadMean', () => {
  const q: Quad = [
    [1, 1],
    [3, 1],
    [3, 2],
    [1, 2],
  ]

  it('counts edges as inside', () => {
    expect(insideQuad(q, 1, 1)).toBe(true)
    expect(insideQuad(q, 2, 1.5)).toBe(true)
    expect(insideQuad(q, 0, 1)).toBe(false)
  })

  it('averages the map over the quad', () => {
    const map = new Float32Array(4 * 4)
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [3, 1],
    ]) {
      map[(y ?? 0) * 4 + (x ?? 0)] = 1
    }
    close(quadMean(map, 4, 4, q), 0.5)
  })
})

describe('regionBorders', () => {
  it('separates 8-connected blobs', () => {
    // two blobs: a 3x2 block and a diagonal pair
    const bitmap = Uint8Array.from([
      1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1,
    ])
    const regions = regionBorders(bitmap, 6, 4)
    expect(regions).toHaveLength(2)
    expect(regions[0]).toHaveLength(6)
    expect(regions[1]).toHaveLength(2)
  })
})

describe('affine', () => {
  it('inverts a rotation with translation', () => {
    const c = Math.cos(0.3)
    const s = Math.sin(0.3)
    const m: Affine = [c, -s, 12, s, c, -4]
    const [x, y] = applyAffine(invertAffine(m), applyAffine(m, [7, 9]))
    close(x, 7)
    close(y, 9)
  })
})
