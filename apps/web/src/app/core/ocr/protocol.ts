/** What the page and the OCR worker say to each other. */
import type { Point } from './geometry'

export type OcrLine = {
  readonly text: string
  readonly confidence: number
  /** Row in reading order; lines that share a row were read left to right. */
  readonly row: number
  /** Corners in the input image's pixels: top-left, top-right, bottom-right, bottom-left. */
  readonly box: readonly Point[]
}

export type OcrResult = {
  /** The page's text in reading order, one row per line. */
  readonly text: string
  readonly lines: readonly OcrLine[]
  /** Lines the filter dropped (stamps, signatures, specks). */
  readonly dropped: number
  /** Degrees the page was straightened by before reading. */
  readonly deskew: number
  readonly width: number
  readonly height: number
  readonly timing: { readonly detMs: number; readonly recMs: number; readonly lines: number }
}

export type ToWorker =
  | { readonly type: 'load'; readonly base: string; readonly ortBase: string }
  | { readonly type: 'read'; readonly id: number; readonly image: ImageBitmap }

export type Stage = 'detect' | 'recognize'

export type FromWorker =
  | { readonly type: 'loaded'; readonly backend: string }
  | {
      readonly type: 'progress'
      readonly id: number
      readonly stage: Stage
      readonly done: number
      readonly total: number
    }
  | { readonly type: 'result'; readonly id: number; readonly result: OcrResult }
  | { readonly type: 'error'; readonly id: number | null; readonly message: string }

/** Mean confidence over lines, weighted by their length. */
export function pageConfidence(lines: readonly OcrLine[]): number {
  const chars = lines.reduce((n, l) => n + l.text.length, 0)
  if (chars === 0) return 0
  return lines.reduce((s, l) => s + l.confidence * l.text.length, 0) / chars
}
