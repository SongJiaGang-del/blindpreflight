// 把运行时需要的静态资源复制到 public/，保证同源加载、不依赖 CDN：
// - pdf.js 的 cMaps / standard_fonts / wasm / iccs → public/pdfjs
// - 本地 OCR（tesseract.js）的 worker、LSTM 内核与语言包 → public/ocr
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')

// ---------- pdf.js ----------
const pdfjs = join(nm, 'pdfjs-dist')
const pdfDest = join(root, 'public', 'pdfjs')
if (!existsSync(pdfjs)) {
  console.warn('[copy-assets] pdfjs-dist 未安装，跳过')
} else {
  rmSync(pdfDest, { recursive: true, force: true })
  mkdirSync(pdfDest, { recursive: true })
  for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    const from = join(pdfjs, dir)
    if (existsSync(from)) cpSync(from, join(pdfDest, dir), { recursive: true })
  }
  console.log('[copy-assets] 已复制 pdf.js 资源到 public/pdfjs')
}

// ---------- 本地 OCR ----------
const ocrDest = join(root, 'public', 'ocr')
const worker = join(nm, 'tesseract.js', 'dist', 'worker.min.js')
const core = join(nm, 'tesseract.js-core')
const langs = [
  ['eng', join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz')],
  ['chi_sim', join(nm, '@tesseract.js-data', 'chi_sim', '4.0.0_best_int', 'chi_sim.traineddata.gz')],
]
if (!existsSync(worker) || !existsSync(core)) {
  console.warn('[copy-assets] tesseract.js 未安装，跳过 OCR 资源')
} else {
  rmSync(ocrDest, { recursive: true, force: true })
  mkdirSync(join(ocrDest, 'core'), { recursive: true })
  mkdirSync(join(ocrDest, 'lang'), { recursive: true })
  copyFileSync(worker, join(ocrDest, 'worker.min.js'))
  // 只需要 LSTM 内核（OEM 1）；按浏览器能力在三个变体中选择
  for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
    copyFileSync(join(core, f), join(ocrDest, 'core', f))
  }
  for (const [lang, file] of langs) {
    if (existsSync(file)) copyFileSync(file, join(ocrDest, 'lang', `${lang}.traineddata.gz`))
    else console.warn(`[copy-assets] 缺少 ${lang} 语言包`)
  }
  console.log('[copy-assets] 已复制 OCR 资源到 public/ocr')
}
