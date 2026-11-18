/**
 * Downloads the OpenThai2.1-OCR-Text model files into public/models/, pinned to one Hugging Face
 * revision and checked against the repo's own SHA256SUMS. They are served with the app as static
 * files, so the browser loads the model from the same origin and nothing else is contacted.
 * Runs before `dev` and `build`; files already present with the right hash are kept.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'iapp/OpenThai2.1-OCR-Text-20261118'
/** Tag v2.1.4. */
const REVISION = 'fac2b5ceefc19d66e65de7d32d75ab99c7e927c8'
const FILES = ['det.onnx', 'rec.onnx', 'rec2.onnx', 'rec_dict.txt', 'NOTICE'] as const
const OUT = join(import.meta.dir, '..', 'public', 'models')

const url = (file: string) => `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

async function download(file: string): Promise<Uint8Array> {
  const res = await fetch(url(file))
  if (!res.ok) throw new Error(`${file}: HTTP ${String(res.status)}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function expectedHashes(): Promise<Map<string, string>> {
  const sums = new TextDecoder().decode(await download('SHA256SUMS'))
  const map = new Map<string, string>()
  for (const line of sums.split('\n')) {
    const [hash, path] = line.trim().split(/\s+/)
    if (hash && path) map.set(path.replace(/^\.\//, ''), hash)
  }
  return map
}

mkdirSync(OUT, { recursive: true })
const missing = FILES.filter((file) => !existsSync(join(OUT, file)))
if (missing.length === 0) {
  console.log(`model: ${OUT} is complete`)
  process.exit(0)
}

const hashes = await expectedHashes()
for (const file of FILES) {
  const target = join(OUT, file)
  const want = hashes.get(file)
  if (want === undefined) throw new Error(`${file}: not listed in SHA256SUMS`)
  if (existsSync(target) && sha256(readFileSync(target)) === want) continue
  const data = await download(file)
  const got = sha256(data)
  if (got !== want) throw new Error(`${file}: sha256 ${got}, expected ${want}`)
  writeFileSync(target, data)
  console.log(`model: ${file} (${(data.byteLength / 1024).toFixed(0)} KB)`)
}
