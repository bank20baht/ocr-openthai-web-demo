/// <reference lib="webworker" />
/**
 * The OCR worker: loads the two ONNX networks once (ONNX Runtime Web, WebAssembly on the CPU)
 * and reads pages off the main thread, so the page stays responsive while a scan is read.
 */
import * as ort from 'onnxruntime-web/wasm'
import { LineOcr, type Net } from './engine'
import type { FromWorker, ToWorker } from './protocol'

declare const self: DedicatedWorkerGlobalScope

let engine: Promise<LineOcr> | null = null

const post = (message: FromWorker) => {
  self.postMessage(message)
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function network(url: string): Promise<Net> {
  const session = await ort.InferenceSession.create(await fetchBytes(url), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const input = session.inputNames[0] ?? 'x'
  const output = session.outputNames[0] ?? ''
  return async (data, dims) => {
    const result = await session.run({ [input]: new ort.Tensor('float32', data, dims) })
    const tensor = result[output]
    if (!tensor) throw new Error(`no output ${output}`)
    return { data: tensor.data as Float32Array, dims: tensor.dims }
  }
}

async function load(base: string, ortBase: string): Promise<LineOcr> {
  ort.env.wasm.wasmPaths = ortBase
  // Threads need a cross-origin isolated page (COOP/COEP headers); one thread otherwise.
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, self.navigator.hardwareConcurrency || 1)
    : 1
  const [det, rec, dict] = await Promise.all([
    network(`${base}det.onnx`),
    network(`${base}rec.onnx`),
    fetch(`${base}rec_dict.txt`).then((r) => r.text()),
  ])
  return new LineOcr(det, rec, LineOcr.charset(dict))
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const msg = event.data
  if (msg.type === 'load') {
    engine ??= load(msg.base, msg.ortBase)
    engine.then(
      () => {
        const threads = ort.env.wasm.numThreads ?? 1
        post({ type: 'loaded', backend: `WebAssembly · ${String(threads)} thread(s)` })
      },
      (err: unknown) => {
        engine = null
        post({ type: 'error', id: null, message: errorText(err) })
      },
    )
    return
  }
  const { id, image } = msg
  void (async () => {
    try {
      if (!engine) throw new Error('model not loaded')
      const ocr = await engine
      const result = await ocr.read(image, (stage, done, total) => {
        post({ type: 'progress', id, stage, done, total })
      })
      post({ type: 'result', id, result })
    } catch (err) {
      post({ type: 'error', id, message: errorText(err) })
    } finally {
      image.close()
    }
  })()
})
