/**
 * 浏览器端 pdf.js 装配：worker 与 cMap / 标准字体 / wasm / ICC 资源全部同源，
 * 不使用 CDN；资源路径基于 document.baseURI，兼容任意子路径部署。
 */
import type { PdfjsLib, PdfAssets } from './extract'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let cached: Promise<PdfjsLib> | null = null

export function loadPdfjs(): Promise<PdfjsLib> {
  if (!cached) {
    cached = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib as unknown as PdfjsLib
    })
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

export function browserAssets(): PdfAssets {
  const base = (p: string) => new URL(`pdfjs/${p}/`, document.baseURI).href
  return {
    cMapUrl: base('cmaps'),
    standardFontDataUrl: base('standard_fonts'),
    wasmUrl: base('wasm'),
    iccUrl: base('iccs'),
  }
}
