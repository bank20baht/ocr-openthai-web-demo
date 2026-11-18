import { dropReason } from './filter'

describe('dropReason', () => {
  it('drops short, unsure and broken readings', () => {
    expect(dropReason('', 1)).toBe('empty')
    expect(dropReason('สวัสดี', 0.5)).toBe('low_confidence')
    expect(dropReason('ก', 0.99)).toBe('too_short')
    expect(dropReason('สวัสดี', 0.99)).toBeNull()
  })

  it('keeps a lone digit or Latin letter in a full-height box', () => {
    expect(dropReason('2', 0.99, 0.9)).toBeNull()
    expect(dropReason('M', 0.99, 0.9)).toBeNull()
    expect(dropReason('2', 0.99, 0.4)).toBe('too_short')
    expect(dropReason('2', 0.99)).toBe('too_short')
    expect(dropReason('ก', 0.99, 0.9)).toBe('too_short')
  })
})
