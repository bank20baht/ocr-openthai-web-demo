/**
 * The line filter (line_engine.LineOCR._drop_reason with the model's config.json): what drops a
 * stamp, a signature or a speck instead of printing it as text.
 */
import { canonical, DIGITS, fixScripts, invalidShare, LATIN } from './thai-text'

const FILTER = {
  dropBelow: 0.8,
  minChars: 2,
  /**
   * A line of digits or Latin letters only may be this short (a quantity "2" in a table cell, a
   * timetable day code "M") if its box is at least minCharsDigitsHeight of the page's line height;
   * floating marks and ornaments read as "9" or "๘" are shorter.
   */
  minCharsDigits: 1,
  minCharsDigitsHeight: 0.62,
  junkBelow: 0.9,
  junkInvalid: 0.05,
} as const

export type DropReason = 'empty' | 'low_confidence' | 'too_short' | 'invalid_thai'

/** One spelling for a recognised line: canonical Thai, script look-alikes fixed. */
export const clean = (text: string): string => fixScripts(canonical(text))

const shortClass = (ch: string) => DIGITS.has(ch) || LATIN.has(ch)

/**
 * Why the filter drops a cleaned reading, or null to keep it. hratio: the box's height over the
 * page's line height, for the short digit / Latin exception (null: no exception).
 */
export function dropReason(
  text: string,
  confidence: number,
  hratio: number | null = null,
): DropReason | null {
  const f = FILTER
  if (!text) return 'empty'
  if (confidence < f.dropBelow) return 'low_confidence'
  const bare = Array.from(text.replaceAll(' ', ''))
  const lone = bare.every(shortClass) && hratio !== null && hratio >= f.minCharsDigitsHeight
  if (bare.length < (lone ? f.minCharsDigits : f.minChars)) return 'too_short'
  if (confidence < f.junkBelow && invalidShare(text) > f.junkInvalid) return 'invalid_thai'
  return null
}
