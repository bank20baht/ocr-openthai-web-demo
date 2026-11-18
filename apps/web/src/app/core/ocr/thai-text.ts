/**
 * Thai text clean-up, ported from the model's runtime (thai_norm.py and the text helpers in
 * line_engine.py): one canonical spelling for every recognised line, script look-alike fixes,
 * and the spelling test that tells stamps and signatures from real text.
 */

// Legacy Thai glyph variants (shifted/lowered marks, tail-less ฐ ญ) -> standard code points.
const PUA: Record<number, number> = {
  0xf700: 0x0e10,
  0xf701: 0x0e34,
  0xf702: 0x0e35,
  0xf703: 0x0e36,
  0xf704: 0x0e37,
  0xf705: 0x0e48,
  0xf706: 0x0e49,
  0xf707: 0x0e4a,
  0xf708: 0x0e4b,
  0xf709: 0x0e4c,
  0xf70a: 0x0e48,
  0xf70b: 0x0e49,
  0xf70c: 0x0e4a,
  0xf70d: 0x0e4b,
  0xf70e: 0x0e4c,
  0xf70f: 0x0e0d,
  0xf710: 0x0e31,
  0xf711: 0x0e4d,
  0xf712: 0x0e47,
  0xf713: 0x0e48,
  0xf714: 0x0e49,
  0xf715: 0x0e4a,
  0xf716: 0x0e4b,
  0xf717: 0x0e4c,
  0xf718: 0x0e38,
  0xf719: 0x0e39,
  0xf71a: 0x0e3a,
}
const DROP = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0x00ad, 0xfeff])

const VOWEL_MARKS = new Set('ัิีึืฺุู็')
const TONE_MARKS = new Set('่้๊๋์๎')
// Every vowel mark, tone mark and nikhahit (U+0E4D), in runs of two or more.
const MARK_RUN = /[ัิ-ฺ็-๎]{2,}/g
const SARA_AM = /([่-๋]?)ํ([่-๋]?)า/g
const SPACES = /[ \t\f\v]+/g

const markRank = (c: string) => (VOWEL_MARKS.has(c) ? 0 : TONE_MARKS.has(c) ? 1 : 2)

function translate(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (DROP.has(cp)) continue
    if (cp === 0x00a0) out += ' '
    else out += String.fromCodePoint(PUA[cp] ?? cp)
  }
  return out
}

/** Marks after a base in one order (vowel, tone, nikhahit), a doubled mark kept once. */
function orderMarks(run: string): string {
  const out: string[] = []
  for (const ch of Array.from(run).sort((a, b) => markRank(a) - markRank(b))) {
    if (out.at(-1) !== ch) out.push(ch)
  }
  return out.join('')
}

/** thai_norm.canonical: one code-point sequence for every Thai spelling that renders alike. */
export function canonical(input: string): string {
  let text = translate(input).normalize('NFC')
  text = text.replace(MARK_RUN, orderMarks)
  text = text.replace(SARA_AM, (_m, a: string, b: string) => `${a}${b}ำ`)
  text = text.replaceAll('เเ', 'แ').replaceAll('ำำ', 'ำ')
  text = text.replace(/\r\n?/g, '\n')
  return text
    .split('\n')
    .map((line) => line.replace(SPACES, ' ').trim())
    .join('\n')
    .trim()
}

// A lone Latin W glued to Thai letters is a bold พ; a Latin O or 0 inside Thai digits is ๐.
const LONE_W = /(?<![A-Za-z])[Ww](?=\.?[ก-ฮเ-ไ])/g
const ZERO_IN_THAI = /(?<=[๐-๙])[Oo0]|[Oo0](?=[๐-๙])/g

export const fixScripts = (text: string): string =>
  text.replace(LONE_W, 'พ').replace(ZERO_IN_THAI, '๐')

const isThai = (ch: string) => ch >= '฀' && ch <= '๿'
const isCons = (ch: string | undefined) => ch !== undefined && ch >= 'ก' && ch <= 'ฮ'
const MARKS = new Set('ัิีึืฺุู็่้๊๋์ํ๎')
const LEADING = new Set('เแโใไ')

/**
 * Share of Thai characters that break Thai spelling: a mark with no consonant under it, or a
 * leading vowel not followed by a consonant. Stamps and signatures score high.
 */
export function invalidShare(text: string): number {
  let thai = 0
  let bad = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (!isThai(ch)) continue
    thai++
    const prev = i > 0 ? text[i - 1] : ' '
    if (MARKS.has(ch)) {
      const stacked = prev !== undefined && MARKS.has(prev) && i >= 2 && isCons(text[i - 2])
      if (!isCons(prev) && !stacked) bad++
    } else if (LEADING.has(ch) && !isCons(text[i + 1])) {
      bad++
    }
  }
  return thai === 0 ? 0 : bad / thai
}

const ENUM = /^\s*\(?([0-9๐-๙]{1,4})\s*[.)]/
const THAI_DIGIT_ZERO = 0x0e50

/** The number a list item starts with ("12.", "(๓)"), or null. */
export function enumNumber(text: string): number | null {
  const m = ENUM.exec(text)
  if (!m?.[1]) return null
  const ascii = Array.from(m[1])
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0
      return cp >= THAI_DIGIT_ZERO ? String(cp - THAI_DIGIT_ZERO) : c
    })
    .join('')
  return Number(ascii)
}

export const DIGITS = new Set('0123456789๐๑๒๓๔๕๖๗๘๙')

export const LATIN = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')

const isThaiLetter = (ch: string) => ch >= 'ก' && ch <= '๎'

/**
 * Latin letters inside words that also hold Thai letters ("lละพลNSะทU" -> 4): a loopless Thai
 * face read as Latin look-alikes. A Thai word next to an English one does not count.
 */
export function mixedLatin(text: string): number {
  let n = 0
  for (const tok of text.split(/\s+/)) {
    const chars = Array.from(tok)
    if (chars.some(isThaiLetter)) n += chars.filter((ch) => LATIN.has(ch)).length
  }
  return n
}

/** The Arabic and Thai digits of a reading, in order. */
export const digitsOf = (text: string): string =>
  Array.from(text)
    .filter((ch) => DIGITS.has(ch))
    .join('')

const MARK_OR_SPACE = /[ัิ-ฺ็-๎\s]/g

/** A reading without its above/below marks (sara am as its aa) and spaces. */
export const baseOf = (text: string): string => text.replaceAll('ำ', 'า').replace(MARK_OR_SPACE, '')

// Python's \d matches Thai digits too.
const DECIMAL_COMMA = /(?<![0-9๐-๙.,])([0-9๐-๙]{1,3}(?:,[0-9๐-๙]{3})*),([0-9๐-๙]{2})(?![0-9๐-๙.,])/g

/** An amount whose last comma has exactly two digits after it gets a decimal point: "280,00" -> "280.00". */
export const decimalPoint = (text: string): string => text.replace(DECIMAL_COMMA, '$1.$2')

const DIGIT_RUN = /[0-9๐-๙]+/g

/** Share of lines whose first 3 characters (a digit run counted as one) are one of the 2 most common starts. */
export function startRepeat(lines: readonly string[]): number {
  const starts = lines
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map((x) => Array.from(x.replace(DIGIT_RUN, 'D')).slice(0, 3).join(''))
  if (starts.length === 0) return 0
  const counts = new Map<string, number>()
  for (const s of starts) counts.set(s, (counts.get(s) ?? 0) + 1)
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, 2)
  return top.reduce((a, b) => a + b, 0) / starts.length
}
