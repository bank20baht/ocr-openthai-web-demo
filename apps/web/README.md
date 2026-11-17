# web — OpenThai OCR in the browser

Live: <https://openthai-ocr-text-demo.pages.dev>

Angular app that reads Thai and English text from a photo of a document with
[OpenThai2.0-OCR-Text](https://huggingface.co/iapp/OpenThai2.0-OCR-Text). There is no server:
the model runs on the user's machine (ONNX Runtime Web, WebAssembly, in a Web Worker), and the
picked file never leaves the browser. UI is bank20baht-ui.

```sh
bun run dev      # http://localhost:4200 — fetches the model into public/models/ first
bun run build    # static site in dist/web/browser
```

- **Input**: `.jpg` / `.jpeg` and `.HEIC` / `.heif`. Safari decodes HEIC itself; other browsers
  convert it to JPEG locally with `heic-to` (libheif in WebAssembly, loaded only when needed).
- **Model files**: `scripts/fetch-model.ts` downloads `det.onnx`, `rec.onnx` and `rec_dict.txt`
  at a pinned Hugging Face revision and checks them against the repo's `SHA256SUMS`. They are
  served with the app (about 4 MB), gitignored.
- **Threads**: ONNX Runtime uses up to 4 threads when the page is cross-origin isolated. The dev
  server sends `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`; set the same headers on the static host, or it
  runs on one thread (slower, still correct).

## Layout

```
src/app/core/ocr/      the model's runtime (runtime/line_engine.py) ported to TypeScript
  engine.ts            detector -> DB boxes -> deskew -> line crops -> recognizer -> CTC -> text
  geometry.ts          minAreaRect, unclip, connected regions (what OpenCV/pyclipper did)
  pixels.ts            greyscale, line cutting at height 48, background flattening
  layout.ts            skew, reading order (rows, prose columns), mark fragments
  thai-text.ts         thai_norm.canonical, script fixes, the spelling filter
  ocr.worker.ts        loads the two ONNX sessions, reads pages off the main thread
  ocr.service.ts       Angular side of the worker (signals: model state, progress)
src/app/core/image/    JPEG/HEIC -> displayable URL + ImageBitmap
src/app/modules/scan/  the page: document preview with line boxes (left), text (right)
```

Not ported from the Python runtime: quarter-turn orientation (sideways / upside-down pages),
splitting a detected line at a wide blank gap, and word boxes.

## Deploy

Cloudflare Pages project `openthai-ocr-text-demo` (wrangler must be logged in):

```sh
bun run deploy   # build, then wrangler pages deploy dist/web/browser
```

`public/_headers` sets the COOP/COEP headers for threads and caches the model files.
