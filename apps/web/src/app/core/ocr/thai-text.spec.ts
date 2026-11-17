import { canonical, enumNumber, fixScripts, invalidShare } from './thai-text'

describe('canonical', () => {
  it('orders marks after a base: vowel, then tone', () => {
    // ป + tone ่ + vowel ิ  ->  ป + ิ + ่
    expect(canonical('ป่ิ')).toBe('ปิ่')
  })

  it('composes sara am from nikhahit + aa in either order', () => {
    expect(canonical('นํ้า')).toBe('น้ำ')
    expect(canonical('น้ํา')).toBe('น้ำ')
  })

  it('turns two sara e into sara ae and keeps one of a doubled mark', () => {
    expect(canonical('เเม่่')).toBe('แม่')
  })

  it('maps legacy private-use glyphs and drops zero-width characters', () => {
    expect(canonical('ก​า')).toBe('ก่า')
  })

  it('collapses spaces and trims each line', () => {
    expect(canonical('  ก   ข  \r\n ค  ')).toBe('ก ข\nค')
  })
})

describe('fixScripts', () => {
  it('reads a lone W glued to Thai as พ', () => {
    expect(fixScripts('W.ศ. ๒๕๖๙')).toBe('พ.ศ. ๒๕๖๙')
    expect(fixScripts('Wow')).toBe('Wow')
  })

  it('reads a Latin O or 0 inside Thai digits as ๐', () => {
    expect(fixScripts('๗o.๘๒')).toBe('๗๐.๘๒')
    expect(fixScripts('100')).toBe('100')
  })
})

describe('invalidShare', () => {
  it('is zero for real Thai and high for orphan marks', () => {
    expect(invalidShare('หนังสือรับรอง')).toBe(0)
    expect(invalidShare('ูี้ ไ้')).toBeGreaterThan(0.5)
  })
})

describe('enumNumber', () => {
  it('reads Arabic and Thai list numbers', () => {
    expect(enumNumber('12. ข้อความ')).toBe(12)
    expect(enumNumber('(๑๔๗) ข้อ')).toBe(147)
    expect(enumNumber('ข้อ 1')).toBeNull()
  })
})
