import { ctcDecode, dbBoxes, LineOcr } from './engine'

describe('LineOcr.charset', () => {
  it('is blank, the dictionary, then a space', () => {
    expect(LineOcr.charset('ก\nข\n')).toEqual(['', 'ก', 'ข', ' '])
  })
})

describe('ctcDecode', () => {
  const chars = ['', 'ก', 'ข', ' ']
  const frames = (...best: number[]) => {
    const p = new Float32Array(best.length * 4)
    best.forEach((c, t) => {
      p[t * 4 + c] = 0.9
    })
    return p
  }

  it('collapses runs and drops blanks', () => {
    const r = ctcDecode(frames(1, 1, 0, 1, 2, 2, 3, 2), 0, 8, 4, chars)
    expect(r.text).toBe('กกข ข')
    expect(r.confidence).toBeCloseTo(0.9, 6)
  })

  it('reads a batch item at its offset', () => {
    const p = new Float32Array([...frames(1, 1), ...frames(2, 0)])
    expect(ctcDecode(p, 8, 2, 4, chars).text).toBe('ข')
  })

  it('has zero confidence when nothing is read', () => {
    expect(ctcDecode(frames(0, 0), 0, 2, 4, chars)).toEqual({ text: '', confidence: 0 })
  })
})

describe('dbBoxes', () => {
  it('finds one unclipped box per confident region', () => {
    const w = 64
    const h = 32
    const prob = new Float32Array(w * h)
    for (let y = 10; y < 20; y++) for (let x = 8; x < 48; x++) prob[y * w + x] = 0.9
    // a speck under min_size
    prob[2 * w + 2] = 0.9
    const boxes = dbBoxes(prob, w, h)
    expect(boxes).toHaveLength(1)
    const [tl, , br] = boxes[0] ?? []
    expect(tl?.[0]).toBeLessThan(8)
    expect(br?.[0]).toBeGreaterThan(47)
    expect(tl?.[1]).toBeLessThan(10)
    expect(br?.[1]).toBeGreaterThan(19)
  })
})
