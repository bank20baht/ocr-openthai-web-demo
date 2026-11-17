/**
 * A picked photo -> something every browser can show and the OCR worker can read. JPEG decodes
 * natively; HEIC (iPhone photos) only does in Safari, so elsewhere it is converted to JPEG on this
 * machine with libheif compiled to WebAssembly (heic-to, loaded on first use). Nothing is uploaded.
 */

export type DecodedImage = {
  /** Object URL of a displayable image (the JPEG itself, or the HEIC converted). */
  readonly url: string
  /** The same pixels, EXIF rotation applied, for the worker. */
  readonly bitmap: ImageBitmap
  readonly converted: boolean
}

export type ImageKind = 'jpeg' | 'heic'

const JPEG = /\.(jpe?g)$/i
const HEIC = /\.(heic|heif)$/i

/** The kind of image a file is, by type or (HEIC often has no type) by name; null if neither. */
export function imageKind(file: Pick<File, 'name' | 'type'>): ImageKind | null {
  const type = file.type.toLowerCase()
  if (type === 'image/jpeg' || JPEG.test(file.name)) return 'jpeg'
  if (/^image\/hei[cf](-sequence)?$/.test(type) || HEIC.test(file.name)) return 'heic'
  return null
}

const bitmapOf = (blob: Blob) => createImageBitmap(blob, { imageOrientation: 'from-image' })

async function heicToJpeg(file: Blob): Promise<Blob> {
  const { heicTo } = await import('heic-to')
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
}

export async function decodeImage(file: File): Promise<DecodedImage> {
  const kind = imageKind(file)
  if (kind === null) throw new Error('รองรับเฉพาะไฟล์ .jpg และ .HEIC')
  if (kind === 'jpeg') {
    return { url: URL.createObjectURL(file), bitmap: await bitmapOf(file), converted: false }
  }
  try {
    // Safari decodes HEIC itself: no conversion, no extra download.
    const bitmap = await bitmapOf(file)
    return { url: URL.createObjectURL(file), bitmap, converted: false }
  } catch {
    const jpeg = await heicToJpeg(file)
    return { url: URL.createObjectURL(jpeg), bitmap: await bitmapOf(jpeg), converted: true }
  }
}
