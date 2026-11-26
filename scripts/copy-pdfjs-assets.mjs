// 将 pdf.js 的 cMaps / standard_fonts / wasm 复制到 public/pdfjs，保证运行时同源加载、不依赖 CDN。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const dest = join(root, 'public', 'pdfjs')
if (!existsSync(src)) {
  console.warn('[copy-pdfjs-assets] pdfjs-dist 未安装，跳过')
  process.exit(0)
}
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(src, dir)
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true })
}
console.log('[copy-pdfjs-assets] 已复制到 public/pdfjs')
