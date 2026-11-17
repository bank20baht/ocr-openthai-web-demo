import { Injectable, signal } from '@angular/core'
import type { FromWorker, OcrResult, Stage, ToWorker } from './protocol'

export type ModelState = 'idle' | 'loading' | 'ready' | 'error'

export type ReadProgress = { readonly stage: Stage; readonly done: number; readonly total: number }

type Pending = {
  readonly resolve: (result: OcrResult) => void
  readonly reject: (err: Error) => void
}

/** Where the model files and ONNX Runtime's WebAssembly are served from, next to the app. */
const MODEL_BASE = new URL('models/', document.baseURI).href
const ORT_BASE = new URL('ort/', document.baseURI).href

/**
 * The OCR model, running in a Web Worker on this machine. The first `load()` downloads the two
 * networks (about 4 MB, then cached by the browser); `read()` sends one page and resolves with
 * its text.
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  readonly state = signal<ModelState>('idle')
  readonly backend = signal('')
  readonly loadError = signal<string | null>(null)
  readonly progress = signal<ReadProgress | null>(null)

  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  load(): void {
    if (this.state() === 'loading' || this.state() === 'ready') return
    this.state.set('loading')
    this.loadError.set(null)
    this.post({ type: 'load', base: MODEL_BASE, ortBase: ORT_BASE })
  }

  /** Read one page. The bitmap is transferred to the worker and closed there. */
  read(image: ImageBitmap): Promise<OcrResult> {
    this.load()
    const id = this.nextId++
    this.progress.set({ stage: 'detect', done: 0, total: 1 })
    return new Promise<OcrResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post({ type: 'read', id, image }, [image])
    })
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.ensureWorker().postMessage(message, transfer)
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./ocr.worker', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
      this.receive(event.data)
    })
    worker.addEventListener('error', (event) => {
      this.fail(event.message || 'OCR worker crashed')
    })
    this.worker = worker
    return worker
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case 'loaded':
        this.state.set('ready')
        this.backend.set(msg.backend)
        return
      case 'progress':
        this.progress.set({ stage: msg.stage, done: msg.done, total: msg.total })
        return
      case 'result':
        this.settle(msg.id)?.resolve(msg.result)
        return
      case 'error':
        if (msg.id === null) this.fail(msg.message)
        else this.settle(msg.id)?.reject(new Error(msg.message))
        return
    }
  }

  private settle(id: number): Pending | undefined {
    const p = this.pending.get(id)
    this.pending.delete(id)
    if (this.pending.size === 0) this.progress.set(null)
    return p
  }

  /** The model could not load: every waiting read fails with it. */
  private fail(message: string): void {
    this.state.set('error')
    this.loadError.set(message)
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(new Error(message))
  }
}
