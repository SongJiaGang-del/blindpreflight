/**
 * 本地 OCR：对扫描页 / 图片页 / 乱码页做文字识别，把识别出的词转成与 pdf.js 文字项相同的结构，
 * 交给同一套版面与规则处理。
 *
 * - tesseract.js 的 worker、内核与语言包都从本站 public/ocr 加载（不走 CDN）；
 *   不使用 blob worker（会继承页面 CSP），也不把语言包缓存进 IndexedDB。
 * - 页面图像只在内存 canvas 中，识别完即释放。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageFacts } from '@/domain/types'
import type { RawPage, RawTextItem } from '@/normalize/raw'
import { buildPage } from '@/normalize/layout'
import { PreflightError } from '@/domain/errors'

export type OcrLang = 'eng' | 'eng+chi_sim'

/** 一次检查最多识别的页数（整组） */
export const OCR_MAX_PAGES = 40
const MIN_CONFIDENCE = 35

export interface OcrWord {
  text: string
  confidence: number
  /** 画布像素坐标（左上原点） */
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/** 视口坐标换算接口（pdf.js PageViewport 的子集），便于测试 */
export interface PointMapper {
  convertToPdfPoint(x: number, y: number): number[]
}

/** 识别出的词 → 文字项（PDF 用户空间，基线在词框底边） */
export function wordsToItems(words: OcrWord[], vp: PointMapper): RawTextItem[] {
  const out: RawTextItem[] = []
  for (const w of words) {
    const text = w.text.trim()
    if (!text || w.confidence < MIN_CONFIDENCE) continue
    const [x0, yb] = vp.convertToPdfPoint(w.bbox.x0, w.bbox.y1) as [number, number]
    const [x1, yt] = vp.convertToPdfPoint(w.bbox.x1, w.bbox.y0) as [number, number]
    // 字形框按基线下 0.22h、上 0.9h 计算（见 sliceCorners），据此从词框反推字号与基线
    const boxH = Math.abs(yt - yb)
    const width = Math.abs(x1 - x0)
    if (boxH <= 0 || width <= 0) continue
    const h = boxH / 1.12
    out.push({ str: text, transform: [h, 0, 0, h, Math.min(x0, x1), Math.min(yb, yt) + 0.22 * h], width, height: h })
  }
  return out
}

/** 稀疏页：保留原文字项，只补充不与原文字重叠的 OCR 词 */
export function mergeItems(original: RawTextItem[], ocr: RawTextItem[]): RawTextItem[] {
  const boxes = original.map((it) => {
    const x = it.transform[4] ?? 0
    const y = it.transform[5] ?? 0
    return { x0: x, x1: x + it.width, y0: y, y1: y + Math.max(it.height, Math.abs(it.transform[3] ?? 0)) }
  })
  const extra = ocr.filter((o) => {
    const x0 = o.transform[4] ?? 0
    const y0 = o.transform[5] ?? 0
    const x1 = x0 + o.width
    const y1 = y0 + o.height
    return !boxes.some((b) => x0 < b.x1 && b.x0 < x1 && y0 < b.y1 && b.y0 < y1)
  })
  return [...original, ...extra]
}

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

export interface OcrSession {
  recognizePage(pdf: PDFDocumentProxy, base: PageFacts, signal?: AbortSignal): Promise<PageFacts>
  terminate(): Promise<void>
}

export async function createOcrSession(lang: OcrLang, onStatus?: (s: string) => void): Promise<OcrSession> {
  let worker: import('tesseract.js').Worker
  try {
    // tesseract.js 是 CommonJS 包：开发模式下只有 default 导出，构建后可能有具名导出
    const mod = (await import('tesseract.js')) as unknown as { default?: typeof import('tesseract.js') } & typeof import('tesseract.js')
    const T = mod.default ?? mod
    // OEM 1 = 只用 LSTM（与复制到 public/ocr/core 的内核一致）
    worker = await T.createWorker(lang, 1, {
      workerPath: assetUrl('ocr/worker.min.js'),
      corePath: assetUrl('ocr/core'),
      langPath: assetUrl('ocr/lang'),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: (m: { status: string }) => onStatus?.(m.status),
    })
  } catch {
    throw new PreflightError('OCR_FAILED')
  }

  return {
    async recognizePage(pdf, base, signal) {
      if (signal?.aborted) throw new PreflightError('CANCELLED')
      const page = await pdf.getPage(base.pageNumber)
      const vp1 = page.getViewport({ scale: 1 })
      // 约 200 dpi，长边不超过 2400 像素
      const scale = Math.min(200 / 72, 2400 / Math.max(vp1.width, vp1.height))
      const vp = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(vp.width)
      canvas.height = Math.ceil(vp.height)
      try {
        await page.render({ canvas, viewport: vp }).promise
        if (signal?.aborted) throw new PreflightError('CANCELLED')
        const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false, hocr: false, tsv: false })
        const words: OcrWord[] = []
        for (const b of data.blocks ?? [])
          for (const p of b.paragraphs)
            for (const l of p.lines) for (const w of l.words) words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox })
        const ocrItems = wordsToItems(words, vp)
        const raw: RawPage = {
          documentId: base.documentId,
          pageNumber: base.pageNumber,
          view: [...page.view],
          rotation: page.rotate,
          viewTransform: [...vp1.transform],
          viewWidth: vp1.width,
          viewHeight: vp1.height,
          // 乱码 / 空白页整页换成 OCR；稀疏页保留原文字再补充
          items: base.textQuality === 'sparse' ? mergeItems(rawItemsOf(base), ocrItems) : ocrItems,
          annotations: base.annotations,
          extractionStatus: 'completed',
        }
        const built = buildPage(raw)
        return { ...built, ocr: true }
      } finally {
        canvas.width = 0
        canvas.height = 0
        page.cleanup()
      }
    },
    async terminate() {
      await worker.terminate().catch(() => {})
    },
  }
}

/** 从已构建的页面还原文字项（用于稀疏页合并） */
function rawItemsOf(p: PageFacts): RawTextItem[] {
  return p.items.map((it) => ({
    str: it.str,
    transform: [it.geom.ux * it.geom.h, it.geom.uy * it.geom.h, it.geom.vx * it.geom.h, it.geom.vy * it.geom.h, it.geom.ox, it.geom.oy],
    width: it.geom.w,
    height: it.geom.h,
  }))
}
