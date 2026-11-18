import type { Quad } from './geometry'
import { attachMarks, type Reading } from './marks'

describe('attachMarks', () => {
  const box = (x: number, y: number, w: number, h: number): Quad => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
  const page = () => {
    const boxes = [0, 50, 100, 150].map((y) => box(0, y, 400, 30))
    boxes.push(box(50, 40, 10, 6)) // a tone mark floating above the second line
    const reads: Reading[] = [
      ...boxes.slice(0, 4).map(() => ({ text: 'สวัสดีครับ', confidence: 0.95 })),
      { text: '่', confidence: 0.6 },
    ]
    return { boxes, reads }
  }

  it('grows the line under a floating mark and keeps the new reading', async () => {
    const { boxes, reads } = page()
    const grown: Quad[] = []
    const absorbed = await attachMarks(
      boxes,
      reads,
      new Set(),
      { width: 500, height: 300 },
      (b) => {
        grown.push(...b)
        return Promise.resolve(b.map(() => ({ text: 'สวัสดี่ครับ', confidence: 0.96 })))
      },
    )
    expect([...absorbed]).toEqual([4])
    expect(grown).toHaveLength(1)
    expect(boxes[1]?.[0][1]).toBeCloseTo(40, 6)
    expect(reads[1]?.text).toBe('สวัสดี่ครับ')
  })

  it('rejects a re-read that changes a letter', async () => {
    const { boxes, reads } = page()
    const absorbed = await attachMarks(boxes, reads, new Set(), { width: 500, height: 300 }, (b) =>
      Promise.resolve(b.map(() => ({ text: 'สวัสดีคราบ', confidence: 0.96 }))),
    )
    expect(absorbed.size).toBe(0)
    expect(reads[1]?.text).toBe('สวัสดีครับ')
    expect(boxes[1]?.[0][1]).toBe(50)
  })
})
