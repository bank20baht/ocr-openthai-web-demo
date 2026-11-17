import { imageKind } from './decode'

describe('imageKind', () => {
  it('knows JPEG by type or name', () => {
    expect(imageKind({ name: 'scan.JPG', type: '' })).toBe('jpeg')
    expect(imageKind({ name: 'x', type: 'image/jpeg' })).toBe('jpeg')
  })

  it('knows HEIC by type or name (browsers often give no type)', () => {
    expect(imageKind({ name: 'IMG_0001.HEIC', type: '' })).toBe('heic')
    expect(imageKind({ name: 'a', type: 'image/heif' })).toBe('heic')
  })

  it('refuses anything else', () => {
    expect(imageKind({ name: 'doc.png', type: 'image/png' })).toBeNull()
    expect(imageKind({ name: 'doc.pdf', type: 'application/pdf' })).toBeNull()
  })
})
