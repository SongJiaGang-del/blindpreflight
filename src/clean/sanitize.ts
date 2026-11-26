/**
 * 生成“清理版” PDF：只处理能安全自动化的部分，不改动正文内容流。
 *
 * - 元数据：清空 Info 字典（可选保留标题），删除目录与页面上的 XMP、PieceInfo
 * - 批注：删除审阅类注释（便签、高亮、手写、印章、文件附件……），保留链接与表单域
 * - 外部链接（可选）：删除指向网址 / 外部文件的链接注释，可见文字不变
 * - 附件：删除 EmbeddedFiles 名称树与关联文件（AF）
 * - 不可达对象回收：pdf-lib 会把文件中的全部对象（含增量更新残留的旧版本）原样写回，
 *   所以保存前从 trailer 出发做一次可达性标记，删掉没被引用的对象，
 *   否则被“删除”的作者名、附件内容仍会留在新文件的字节里。
 *
 * 全部在浏览器内存中完成；pdf-lib 按需动态加载，不影响首屏体积。
 */
import type { PDFArray, PDFContext, PDFDict, PDFObject } from 'pdf-lib'

export interface SanitizeOptions {
  /** 清空 Info / XMP / PieceInfo */
  metadata: boolean
  /** 元数据清理时同时删除标题 */
  removeTitle: boolean
  /** 删除审阅批注（保留链接与表单域） */
  annotations: boolean
  /** 删除外部链接注释（网址、外部文件），文内跳转保留 */
  externalLinks: boolean
  /** 删除嵌入附件 */
  attachments: boolean
  /** 使用对象流压缩（测试中关闭以便检查原始字节） */
  useObjectStreams?: boolean
}

export const DEFAULT_SANITIZE_OPTIONS: SanitizeOptions = {
  metadata: true,
  removeTitle: false,
  annotations: true,
  externalLinks: false,
  attachments: true,
}

export interface SanitizeReport {
  /** 被删除的 Info 字段名 */
  infoKeys: string[]
  xmpRemoved: number
  annotationsRemoved: number
  /** 按子类型计数 */
  annotationTypes: Record<string, number>
  linksRemoved: number
  attachmentsRemoved: number
  /** 回收的不可达对象数（含增量更新残留） */
  orphansRemoved: number
  bytesBefore: number
  bytesAfter: number
}

export interface SanitizeResult {
  bytes: Uint8Array
  report: SanitizeReport
}

/** 保留的注释类型：链接（单独处理）与表单域；其余视为审阅批注 */
const KEEP_SUBTYPES = new Set(['Link', 'Widget'])

export async function sanitizePdf(input: Uint8Array, opts: SanitizeOptions = DEFAULT_SANITIZE_OPTIONS): Promise<SanitizeResult> {
  const lib = await import('pdf-lib')
  const { PDFDocument, PDFName, PDFDict: Dict, PDFArray: Arr, PDFRef: Ref, PDFStream: Stream } = lib
  const N = (s: string) => PDFName.of(s)

  // updateMetadata: false —— 否则 pdf-lib 会写入自己的 Producer / ModDate
  const doc = await PDFDocument.load(input, { updateMetadata: false, ignoreEncryption: false })
  const ctx = doc.context
  const catalog = doc.catalog
  const report: SanitizeReport = {
    infoKeys: [],
    xmpRemoved: 0,
    annotationsRemoved: 0,
    annotationTypes: {},
    linksRemoved: 0,
    attachmentsRemoved: 0,
    orphansRemoved: 0,
    bytesBefore: input.byteLength,
    bytesAfter: 0,
  }

  const asDict = (o: PDFObject | undefined): PDFDict | undefined => {
    const v = o instanceof Ref ? ctx.lookup(o) : o
    return v instanceof Dict ? v : v instanceof Stream ? v.dict : undefined
  }
  const asArray = (o: PDFObject | undefined): PDFArray | undefined => {
    const v = o instanceof Ref ? ctx.lookup(o) : o
    return v instanceof Arr ? v : undefined
  }
  const nameOf = (o: PDFObject | undefined): string => {
    const v = o instanceof Ref ? ctx.lookup(o) : o
    return v instanceof PDFName ? v.decodeText() : ''
  }

  /* ---------- 元数据 ---------- */
  if (opts.metadata) {
    const info = asDict(ctx.trailerInfo.Info)
    if (info) {
      for (const key of info.keys()) {
        const k = key.decodeText()
        if (k === 'Title' && !opts.removeTitle) continue
        info.delete(key)
        report.infoKeys.push(k)
      }
    }
    for (const holder of [catalog, ...doc.getPages().map((p) => p.node)]) {
      if (holder.has(N('Metadata'))) {
        holder.delete(N('Metadata'))
        report.xmpRemoved++
      }
      holder.delete(N('PieceInfo'))
    }
  }

  /* ---------- 批注与外部链接 ---------- */
  if (opts.annotations || opts.externalLinks) {
    for (const page of doc.getPages()) {
      const annots = asArray(page.node.get(N('Annots')))
      if (!annots) continue
      const keep: PDFObject[] = []
      for (let i = 0; i < annots.size(); i++) {
        const raw = annots.get(i)
        const a = asDict(raw)
        if (!a) continue
        const sub = nameOf(a.get(N('Subtype')))
        if (sub === 'Link') {
          if (opts.externalLinks && isExternalLink(a)) {
            report.linksRemoved++
            continue
          }
          keep.push(raw)
          continue
        }
        if (!opts.annotations || KEEP_SUBTYPES.has(sub)) {
          keep.push(raw)
          continue
        }
        report.annotationsRemoved++
        report.annotationTypes[sub || '未知'] = (report.annotationTypes[sub || '未知'] ?? 0) + 1
      }
      if (keep.length === annots.size()) continue
      if (keep.length) page.node.set(N('Annots'), ctx.obj(keep))
      else page.node.delete(N('Annots'))
    }
  }

  function isExternalLink(a: PDFDict): boolean {
    const action = asDict(a.get(N('A')))
    if (!action) return false
    const s = nameOf(action.get(N('S')))
    return s === 'URI' || s === 'Launch' || s === 'GoToR' || s === 'GoToE' || s === 'SubmitForm' || s === 'ImportData'
  }

  /* ---------- 附件 ---------- */
  if (opts.attachments) {
    const names = asDict(catalog.get(N('Names')))
    const ef = names ? asDict(names.get(N('EmbeddedFiles'))) : undefined
    let efCount = 0
    if (names && ef) {
      efCount = countNameTree(ef)
      names.delete(N('EmbeddedFiles'))
    }
    let afCount = 0
    if (catalog.has(N('AF'))) {
      afCount = asArray(catalog.get(N('AF')))?.size() ?? 1
      catalog.delete(N('AF'))
    }
    // 同一个附件通常同时登记在名称树和 AF 里，不重复计数
    report.attachmentsRemoved += Math.max(efCount, afCount)
    if (!opts.annotations) {
      // 没清理批注时，文件附件注释也必须删掉，否则附件仍在
      for (const page of doc.getPages()) {
        const annots = asArray(page.node.get(N('Annots')))
        if (!annots) continue
        const keep: PDFObject[] = []
        for (let i = 0; i < annots.size(); i++) {
          const raw = annots.get(i)
          if (nameOf(asDict(raw)?.get(N('Subtype'))) === 'FileAttachment') report.attachmentsRemoved++
          else keep.push(raw)
        }
        if (keep.length !== annots.size()) {
          if (keep.length) page.node.set(N('Annots'), ctx.obj(keep))
          else page.node.delete(N('Annots'))
        }
      }
    }
  }

  function countNameTree(node: PDFDict, depth = 0): number {
    if (depth > 32) return 0
    let n = (asArray(node.get(N('Names')))?.size() ?? 0) / 2
    const kids = asArray(node.get(N('Kids')))
    if (kids) for (let i = 0; i < kids.size(); i++) {
      const k = asDict(kids.get(i))
      if (k) n += countNameTree(k, depth + 1)
    }
    return n
  }

  /* ---------- 不可达对象回收 ---------- */
  report.orphansRemoved = collectGarbage(ctx, lib)

  const out = await doc.save({ useObjectStreams: opts.useObjectStreams ?? true, addDefaultPage: false, updateFieldAppearances: false })
  report.bytesAfter = out.byteLength
  return { bytes: out, report }
}

/** 从 trailer（Root、Info）出发标记可达对象，删除其余对象。返回删除数。 */
function collectGarbage(ctx: PDFContext, lib: typeof import('pdf-lib')): number {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = lib
  const seen = new Set<string>()
  const stack: PDFObject[] = []
  const t = ctx.trailerInfo
  for (const r of [t.Root, t.Info]) if (r) stack.push(r)
  while (stack.length) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      const key = o.toString()
      if (seen.has(key)) continue
      seen.add(key)
      const v = ctx.lookup(o)
      if (v) stack.push(v)
    } else if (o instanceof PDFDict) {
      for (const v of o.values()) stack.push(v)
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i))
    } else if (o instanceof PDFStream) {
      stack.push(o.dict)
    }
  }
  let removed = 0
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      ctx.delete(ref)
      removed++
    }
  }
  return removed
}

/** 清理版的中性文件名 */
export function cleanedFilename(docId: string): string {
  if (docId === 'main') return 'paper.pdf'
  const n = docId.replace(/^supp-/, '')
  return `supplement-${n}.pdf`
}
