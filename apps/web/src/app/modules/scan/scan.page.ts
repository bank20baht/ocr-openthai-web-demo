import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core'
import type { FormDefinition, TabItem } from 'bank20baht-ui'
import { BAHT_UI, BahtToastDirective } from 'bank20baht-ui-angular'
import { decodeImage, imageKind } from '../../core/image/decode'
import { OcrService } from '../../core/ocr/ocr.service'
import { pageConfidence, type OcrLine, type OcrResult } from '../../core/ocr/protocol'

const MAX_BYTES = 40 * 1024 * 1024

type Preview = { readonly url: string; readonly name: string; readonly converted: boolean }

type ScanState = 'empty' | 'decoding' | 'reading' | 'done' | 'failed'

/** One scan: pick a photo on the left, read its text on the right. Everything stays on this machine. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BAHT_UI],
  selector: 'app-scan-page',
  templateUrl: './scan.page.html',
  styleUrl: './scan.page.css',
})
export class ScanPage {
  protected readonly ocr = inject(OcrService)
  private readonly toast = viewChild.required(BahtToastDirective)

  protected readonly uploadForm: FormDefinition = {
    form_id: 'scan-upload',
    form_name: 'Scan',
    fields: [
      {
        order: 1,
        type: 'file',
        key: 'document',
        label: 'ภาพเอกสาร',
        help: 'ประมวลผลในเบราว์เซอร์นี้ ไฟล์ไม่ถูกอัปโหลดไปที่ใด',
        accept: '.jpg,.jpeg,.heic,.heif',
        max_size: MAX_BYTES,
        width: 'full',
        value: null,
      },
    ],
  }

  protected readonly state = signal<ScanState>('empty')
  protected readonly preview = signal<Preview | null>(null)
  protected readonly result = signal<OcrResult | null>(null)
  protected readonly error = signal<string | null>(null)
  protected readonly hovered = signal<number | null>(null)
  protected readonly tab = signal('text')
  protected readonly tabs = computed<TabItem[]>(() => [
    { key: 'text', label: 'ข้อความ' },
    { key: 'lines', label: 'รายบรรทัด', badge: String(this.result()?.lines.length ?? 0) },
  ])

  protected readonly busy = computed(
    () => this.state() === 'decoding' || this.state() === 'reading',
  )

  protected readonly modelBadge = computed(() => {
    switch (this.ocr.state()) {
      case 'loading':
        return { tone: 'info', label: 'กำลังโหลดโมเดล', busy: true } as const
      case 'ready':
        return { tone: 'success', label: 'โมเดลพร้อม', busy: false } as const
      case 'error':
        return { tone: 'danger', label: 'โหลดโมเดลไม่สำเร็จ', busy: false } as const
      case 'idle':
        return { tone: 'neutral', label: 'ยังไม่โหลดโมเดล', busy: false } as const
    }
  })

  protected readonly progressValue = computed(() => {
    const p = this.ocr.progress()
    if (this.state() === 'decoding' || !p) return null
    if (p.stage === 'detect') return p.done === 0 ? 5 : 15
    return 15 + Math.round((85 * p.done) / Math.max(p.total, 1))
  })

  protected readonly progressLabel = computed(() => {
    if (this.state() === 'decoding') return 'กำลังเปิดภาพ…'
    const p = this.ocr.progress()
    if (this.ocr.state() === 'loading') return 'กำลังโหลดโมเดล (ครั้งแรกประมาณ 4 MB)…'
    if (!p || p.stage === 'detect') return 'กำลังหาบรรทัดข้อความ…'
    return `กำลังอ่านข้อความ ${String(p.done)}/${String(p.total)} บรรทัด`
  })

  protected readonly summary = computed(() => {
    const r = this.result()
    if (!r) return ''
    const conf = Math.round(pageConfidence(r.lines) * 100)
    const secs = ((r.timing.detMs + r.timing.recMs) / 1000).toFixed(1)
    return `${String(r.lines.length)} บรรทัด · ความมั่นใจเฉลี่ย ${String(conf)}% · ${secs} วินาที`
  })

  /** SVG polygon points per line, in the image's own pixels. */
  protected readonly polygons = computed(() =>
    (this.result()?.lines ?? []).map((line) =>
      line.box.map(([x, y]) => `${String(x)},${String(y)}`).join(' '),
    ),
  )

  constructor() {
    // Start fetching the model while the user looks for a file.
    this.ocr.load()
    inject(DestroyRef).onDestroy(() => {
      this.revokePreview()
    })
  }

  protected onChange(detail: { key: string; value: unknown }): void {
    if (detail.key !== 'document') return
    const file = Array.isArray(detail.value) ? (detail.value[0] as unknown) : detail.value
    if (file instanceof File) void this.scan(file)
  }

  private async scan(file: File): Promise<void> {
    if (imageKind(file) === null) {
      this.error.set('รองรับเฉพาะไฟล์ .jpg และ .HEIC')
      return
    }
    if (file.size > MAX_BYTES) {
      this.error.set('ไฟล์ใหญ่เกิน 40 MB')
      return
    }
    this.error.set(null)
    this.result.set(null)
    this.hovered.set(null)
    this.revokePreview()
    this.preview.set(null)
    this.state.set('decoding')
    try {
      const image = await decodeImage(file)
      this.preview.set({ url: image.url, name: file.name, converted: image.converted })
      this.state.set('reading')
      this.result.set(await this.ocr.read(image.bitmap))
      this.state.set('done')
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err))
      this.state.set('failed')
    }
  }

  protected retryModel(): void {
    this.ocr.load()
  }

  protected async copy(): Promise<void> {
    const text = this.result()?.text ?? ''
    try {
      await navigator.clipboard.writeText(text)
      this.toast().element.show({ message: 'คัดลอกแล้ว', tone: 'success' })
    } catch {
      this.toast().element.show({ message: 'คัดลอกไม่ได้', tone: 'danger' })
    }
  }

  protected download(): void {
    const r = this.result()
    if (!r) return
    const base = (this.preview()?.name ?? 'scan').replace(/\.[^.]+$/, '')
    const url = URL.createObjectURL(new Blob([r.text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${base}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  protected percent(value: number): string {
    return `${String(Math.round(value * 100))}%`
  }

  protected tone(line: OcrLine): 'success' | 'warning' {
    return line.confidence >= 0.95 ? 'success' : 'warning'
  }

  private revokePreview(): void {
    const p = this.preview()
    if (p) URL.revokeObjectURL(p.url)
  }
}
