/**
 * PDF 抽取适配层：只使用 pdf.js 公开 API，输出可序列化的 DocumentFacts。
 * pdf.js 实例由调用方注入（浏览器版 / Node legacy 版），便于测试。
 */
import type * as Pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  AnnotationFact,
  AttachmentFact,
  BinaryFacts,
  CoverageEntry,
  DocumentFacts,
  DocumentRole,
  PageFacts,
} from '@/domain/types'
import { LIMITS } from '@/domain/limits'
import { PreflightError } from '@/domain/errors'
import { rectToBBox } from '@/utils/geometry'
import { buildPage } from '@/normalize/layout'
import { assignZones } from '@/normalize/zones'
import type { RawPage, RawTextItem } from '@/normalize/raw'
import { validatePdfBytes } from './validate'
import { scanBinary } from './binary'

export type PdfjsLib = typeof Pdfjs

export interface PdfAssets {
  cMapUrl?: string
  standardFontDataUrl?: string
  wasmUrl?: string
  iccUrl?: string
}

export interface ExtractInput {
  id: string
  role: DocumentRole
  displayName: string
  bytes: Uint8Array
}

export interface ExtractOptions {
  lib: PdfjsLib
  assets?: PdfAssets
  signal?: AbortSignal
  /** 本文档还能处理的页数（整组预算） */
  pageBudget?: number
  onProgress?: (done: number, total: number) => void
}

export interface ExtractResult {
  facts: DocumentFacts
  /** 仅用于渲染预览；不得放入响应式状态或报告 */
  pdf: PDFDocumentProxy
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PreflightError('CANCELLED')
}

function errName(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
}

function stringifyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => stringifyValue(x) ?? '').filter(Boolean).join('; ')
  if (typeof v === 'object' && 'name' in (v as object)) return String((v as { name: unknown }).name)
  return null
}

/** Info 字典展平：Custom 子字典展开为 Custom.<key> */
export function flattenInfo(info: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!info || typeof info !== 'object') return out
  for (const [k, v] of Object.entries(info as Record<string, unknown>)) {
    if (k === 'Custom' && v && typeof v === 'object') {
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
        const s = stringifyValue(cv)
        if (s !== null) out[`Custom.${ck}`] = s
      }
      continue
    }
    const s = stringifyValue(v)
    if (s !== null) out[k] = s
  }
  return out
}

interface MetadataLike {
  [Symbol.iterator](): Iterator<[string, unknown]>
}

export function flattenXmp(metadata: unknown): Record<string, string> | null {
  if (!metadata || typeof metadata !== 'object' || !(Symbol.iterator in metadata)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of metadata as MetadataLike) {
    const s = stringifyValue(v)
    if (s) out[k] = s
  }
  return out
}

function strOf(obj: unknown): string {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  if (typeof obj === 'object' && 'str' in obj) return String((obj as { str: unknown }).str ?? '')
  return ''
}

// pdf.js 注释对象没有公开类型定义，这里只读取文档化的字段
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAnnotationFact(a: any, index: number, pageNumber: number): AnnotationFact {
  const url = typeof a?.url === 'string' ? a.url : typeof a?.unsafeUrl === 'string' ? a.unsafeUrl : null
  const fv = a?.fieldValue
  return {
    id: String(a?.id ?? `p${pageNumber}-a${index}`),
    subtype: String(a?.subtype ?? 'Unknown'),
    rect: rectToBBox(Array.isArray(a?.rect) ? a.rect : null),
    url,
    hasDest: !!a?.dest || !!a?.action,
    author: strOf(a?.titleObj) || (typeof a?.title === 'string' ? a.title : ''),
    contents: strOf(a?.contentsObj) || (typeof a?.contents === 'string' ? a.contents : ''),
    fieldValue: Array.isArray(fv) ? fv.join('; ') : typeof fv === 'string' ? fv : '',
    visibleText: '',
  }
}

async function readAttachments(pdf: PDFDocumentProxy): Promise<AttachmentFact[]> {
  const map = await pdf.getAttachments()
  if (!map) return []
  const out: AttachmentFact[] = []
  const entries = map instanceof Map ? [...map.values()] : Object.values(map as Record<string, unknown>)
  for (const raw of entries) {
    const a = raw as { filename?: string; rawFilename?: string; description?: string; content?: Uint8Array | null }
    out.push({
      filename: a.filename ?? '',
      rawFilename: a.rawFilename ?? a.filename ?? '',
      description: a.description ?? '',
      byteSize: a.content ? a.content.length : null,
    })
  }
  return out
}

async function openDocument(lib: PdfjsLib, bytes: Uint8Array, assets?: PdfAssets): Promise<PDFDocumentProxy> {
  const task = lib.getDocument({
    // getDocument 会转移（detach）传入的缓冲区，这里传副本
    data: bytes.slice(),
    enableXfa: false,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
    ...assets,
  })
  try {
    return await task.promise
  } catch (err) {
    void task.destroy()
    const name = errName(err)
    if (name === 'PasswordException') throw new PreflightError('ENCRYPTED_PDF')
    if (name === 'InvalidPDFException') throw new PreflightError('CORRUPT_PDF')
    const msg = err instanceof Error ? err.message : ''
    if (/worker/i.test(msg)) throw new PreflightError('WORKER_FAILED')
    throw new PreflightError('CORRUPT_PDF')
  }
}

export async function extractDocument(input: ExtractInput, opts: ExtractOptions): Promise<ExtractResult> {
  validatePdfBytes(input.bytes)
  checkAbort(opts.signal)
  // 先读对象层（图片元数据、字体、旧版本）：pdf.js 打开后可能转移缓冲区
  let binary: BinaryFacts | undefined
  try {
    binary = await scanBinary(input.bytes)
  } catch {
    binary = undefined
  }
  checkAbort(opts.signal)
  const pdf = await openDocument(opts.lib, input.bytes, opts.assets)
  try {
    checkAbort(opts.signal)
    const pageCount = pdf.numPages
    const budget = Math.min(LIMITS.maxPagesPerDoc, opts.pageBudget ?? LIMITS.maxPagesTotal)
    if (pageCount > budget) throw new PreflightError('PAGE_LIMIT', `${pageCount} 页`)

    const warnings: string[] = []
    const coverage: CoverageEntry[] = []
    const cov = (capability: CoverageEntry['capability'], status: CoverageEntry['status'], reason: string, pageNumbers?: number[]) =>
      coverage.push({ documentId: input.id, capability, status, reason, ...(pageNumbers ? { pageNumbers } : {}) })

    // 元数据
    let info: Record<string, string> = {}
    let xmp: Record<string, string> | null = null
    try {
      const meta = await pdf.getMetadata()
      info = flattenInfo(meta.info)
      xmp = flattenXmp(meta.metadata)
      cov('metadata', 'completed', xmp ? '已读取 Info 字典与 XMP。' : '已读取 Info 字典；文件中没有 XMP 元数据。')
    } catch {
      cov('metadata', 'failed', '元数据读取失败。')
    }

    // 附件
    let attachments: AttachmentFact[] = []
    try {
      attachments = await readAttachments(pdf)
      cov('attachments', 'completed', attachments.length ? `发现 ${attachments.length} 个嵌入附件（仅检查文件名与描述，不解析内容）。` : '没有嵌入附件。')
    } catch {
      cov('attachments', 'failed', '附件列表读取失败。')
    }

    // 逐页
    const pages: PageFacts[] = []
    let internalLinkCount = 0
    const failedText: number[] = []
    const failedAnnots: number[] = []
    for (let n = 1; n <= pageCount; n++) {
      checkAbort(opts.signal)
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const raw: RawPage = {
        documentId: input.id,
        pageNumber: n,
        view: [...page.view],
        rotation: page.rotate,
        viewTransform: [...viewport.transform],
        viewWidth: viewport.width,
        viewHeight: viewport.height,
        items: [],
        annotations: [],
        extractionStatus: 'completed',
      }
      try {
        const tc = await page.getTextContent()
        const items: RawTextItem[] = []
        for (const it of tc.items) {
          if (!('str' in it)) continue
          items.push({ str: it.str, transform: [...it.transform], width: it.width, height: it.height })
        }
        raw.items = items
      } catch (err) {
        raw.extractionStatus = 'failed'
        raw.extractionError = err instanceof Error ? err.name : 'Error'
        failedText.push(n)
      }
      try {
        const annots = await page.getAnnotations({ intent: 'any' })
        raw.annotations = annots.map((a, i) => toAnnotationFact(a, i, n))
        internalLinkCount += raw.annotations.filter((a) => a.subtype === 'Link' && !a.url && a.hasDest).length
      } catch {
        failedAnnots.push(n)
      }
      pages.push(buildPage(raw))
      page.cleanup()
      opts.onProgress?.(n, pageCount)
      // 让出主线程，保持界面可响应
      await new Promise((r) => setTimeout(r, 0))
    }
    assignZones(pages)

    const weak = pages.filter((p) => p.textQuality !== 'ok').map((p) => p.pageNumber)
    if (failedText.length === pageCount) cov('text', 'failed', '所有页面文本抽取失败。', failedText)
    else if (weak.length > 0) {
      const empty = pages.filter((p) => p.textQuality === 'empty').length
      cov(
        'text',
        'partial',
        `${weak.length} 页文本为空、过少或疑似乱码（${empty} 页无文本），可能是扫描页、图片或轮廓化文字；这些页面的正文规则未能覆盖。`,
        weak,
      )
      if (empty === pageCount) warnings.push('整份文件没有可抽取的文字，可能是扫描件。本工具不做 OCR。')
    } else cov('text', 'completed', `已抽取全部 ${pageCount} 页文本。`)

    cov(
      'links',
      failedAnnots.length ? 'partial' : 'completed',
      failedAnnots.length ? `${failedAnnots.length} 页的链接注释读取失败。` : '已检查所有 Link 注释的外部目标。',
      failedAnnots.length ? failedAnnots : undefined,
    )
    cov(
      'annotations',
      failedAnnots.length ? 'partial' : 'completed',
      failedAnnots.length ? `${failedAnnots.length} 页注释读取失败。` : '已检查批注作者、内容与表单域值。',
      failedAnnots.length ? failedAnnots : undefined,
    )
    if (binary) {
      cov(
        'images',
        'partial',
        `已检查 ${binary.imageCount} 张嵌入图片的 EXIF / IPTC / XMP 元数据${binary.images.length ? `（${binary.images.length} 张带元数据）` : ''}；图片中的文字没有检查（无 OCR）。`,
      )
      cov(
        'hiddenContent',
        'partial',
        binary.revisionCount > 1
          ? `文件有 ${binary.revisionCount} 个保存版本，已检查旧版本的元数据；旧版本的正文、白色 / 被遮挡文字与可选内容层（OCG）没有检查。`
          : '没有增量保存的旧版本；白色 / 被遮挡文字与可选内容层（OCG）没有检查。',
      )
    } else {
      cov('images', 'failed', '无法读取图片对象，图片元数据没有检查；图片中的文字也没有检查（无 OCR）。')
      cov('hiddenContent', 'unsupported', '无法读取对象层：增量保存的旧版本、白色 / 被遮挡文字与可选内容层（OCG）都没有检查。')
    }

    const parseStatus: DocumentFacts['parseStatus'] =
      failedText.length === pageCount ? 'failed' : failedText.length > 0 || failedAnnots.length > 0 ? 'partial' : 'completed'

    const facts: DocumentFacts = {
      id: input.id,
      role: input.role,
      displayName: input.displayName,
      byteSize: input.bytes.length,
      pageCount,
      parseStatus,
      info,
      xmp,
      pages,
      attachments,
      internalLinkCount,
      coverage,
      warnings,
      ...(binary ? { binary } : {}),
    }
    return { facts, pdf }
  } catch (err) {
    await pdf.loadingTask.destroy()
    throw err
  }
}
