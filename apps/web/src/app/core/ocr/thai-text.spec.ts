import {
  baseOf,
  canonical,
  decimalPoint,
  digitsOf,
  enumNumber,
  fixScripts,
  invalidShare,
  mixedLatin,
  startRepeat,
} from './thai-text'

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

describe('mixedLatin', () => {
  it('counts Latin letters inside Thai words only', () => {
    expect(mixedLatin('lละพลNSะทU')).toBe(4)
    expect(mixedLatin('ราคา Coffee 50 บาท')).toBe(0)
  })
})

describe('decimalPoint', () => {
  it('turns a two-digit last comma into a decimal point', () => {
    expect(decimalPoint('รวม 280,00 บาท')).toBe('รวม 280.00 บาท')
    expect(decimalPoint('88,226,21')).toBe('88,226.21')
    expect(decimalPoint('๒๘๐,๐๐')).toBe('๒๘๐.๐๐')
  })

  it('leaves thousands and longer numbers alone', () => {
    expect(decimalPoint('1,000')).toBe('1,000')
    expect(decimalPoint('1,000.50')).toBe('1,000.50')
    expect(decimalPoint('12,345,67,89')).toBe('12,345,67,89')
  })
})

describe('digitsOf / baseOf', () => {
  it('keeps the digits, and the letters without marks', () => {
    expect(digitsOf('เลขที่ 0105๑')).toBe('0105๑')
    expect(baseOf('น้ำ ใจ')).toBe(baseOf('นา ใจ'))
    expect(baseOf('กัน')).toBe('กน')
  })
})

describe('startRepeat', () => {
  it('is the share of lines starting like the two most common starts', () => {
    expect(startRepeat(['นายก', 'นายข', 'นางค', 'ข้อ'])).toBe(0.75)
    expect(startRepeat(['1. ก', '22. ข', '๓. ค'])).toBe(1)
    expect(startRepeat([])).toBe(0)
  })
})
