import type { Quad } from './geometry'
import { cutLine, flatten, toGray, turnQuad, type Gray } from './pixels'

const gray = (width: number, height: number, f: (x: number, y: number) => number): Gray => {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = f(x, y)
  return { width, height, data }
}

describe('toGray', () => {
  it('weights R, G, B as OpenCV does', () => {
    const g = toGray(Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1)
    expect([...g.data]).toEqual([76, 150, 29])
  })
})

describe('cutLine', () => {
  it('scales the box to the target height, width by aspect', () => {
    const page = gray(200, 100, (x) => (x < 100 ? 0 : 255))
    const q: Quad = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]
    const line = cutLine(page, q, 48, 3200)
    expect(line.height).toBe(48)
    expect(line.width).toBe(96)
    expect(line.data[10 * 96 + 5]).toBe(0)
    expect(line.data[10 * 96 + 90]).toBe(255)
  })

  it('turns a quad a quarter either way', () => {
    const q: Quad = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    expect(turnQuad(q, 1)[0]).toEqual([1, 0])
    expect(turnQuad(q, -1)[0]).toEqual([0, 1])
  })
})

describe('flatten', () => {
  it('gives dark text on white whether the text is dark or light', () => {
    const ink = (x: number, y: number) => x >= 20 && x < 40 && y >= 16 && y < 32
    const dark = flatten(gray(60, 48, (x, y) => (ink(x, y) ? 20 : 230)))
    const light = flatten(gray(60, 48, (x, y) => (ink(x, y) ? 230 : 20)))
    for (const out of [dark, light]) {
      expect(out.data[24 * 60 + 30]).toBe(0)
      expect(out.data[2 * 60 + 5]).toBe(255)
    }
  })
})
