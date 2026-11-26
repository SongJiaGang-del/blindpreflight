/**
 * 直接读取 PDF 对象（pdf-lib）补充 pdf.js 公开 API 拿不到的信息：
 * - 嵌入图片的 EXIF / IPTC / XMP / 注释，以及图片自带的 /Metadata；
 * - 页面资源中的字体名；
 * - 增量保存留下的旧版本的 Info 与 XMP（旧版本里可能还有改稿前的作者名）。
 *
 * 只读；失败不影响主流程（调用方把 coverage 标为部分完成）。
 */
import type { PDFContext, PDFDict, PDFObject, PDFRawStream as RawStream } from 'pdf-lib'
import type { BinaryFacts, FontFact, ImageMetaFact, RevisionFact } from '@/domain/types'
import { parseJpegMeta, parseXmpFields } from './imagemeta'

const MAX_OLD_REVISIONS = 5
const MAX_IMAGES = 400

type PdfLib = typeof import('pdf-lib')

function latin1(b: Uint8Array, from = 0, to = b.length): string {
  let s = ''
  const step = 0x8000
  for (let i = from; i < to; i += step) s += String.fromCharCode(...b.subarray(i, Math.min(to, i + step)))
  return s
}

/** 读出一个对象的文本值（字符串、十六进制字符串、名字） */
function textOf(lib: PdfLib, o: PDFObject | undefined): string {
  if (o instanceof lib.PDFString || o instanceof lib.PDFHexString) return o.decodeText()
  if (o instanceof lib.PDFName) return o.decodeText()
  if (o instanceof lib.PDFNumber) return String(o.asNumber())
  return ''
}

function streamBytes(lib: PdfLib, s: PDFObject | undefined): Uint8Array | null {
  if (!(s instanceof lib.PDFRawStream)) return null
  try {
    return lib.decodePDFRawStream(s).decode()
  } catch {
    return null
  }
}

function infoOf(lib: PdfLib, ctx: PDFContext): Record<string, string> {
  const info = ctx.lookup(ctx.trailerInfo.Info)
  const out: Record<string, string> = {}
  if (!(info instanceof lib.PDFDict)) return out
  for (const [k, v] of info.entries()) {
    const val = textOf(lib, v instanceof lib.PDFRef ? ctx.lookup(v) : v).trim()
    if (val) out[k.decodeText()] = val
  }
  return out
}

function catalogXmp(lib: PdfLib, ctx: PDFContext): Record<string, string> | null {
  const root = ctx.lookup(ctx.trailerInfo.Root)
  if (!(root instanceof lib.PDFDict)) return null
  const bytes = streamBytes(lib, ctx.lookup(root.get(lib.PDFName.of('Metadata'))))
  if (!bytes) return null
  const f = parseXmpFields(new TextDecoder().decode(bytes))
  return Object.keys(f).length ? f : null
}

/** 版本边界：每个 startxref 之后的 %%EOF 结尾；线性化文件的首页段不算一个版本 */
export function revisionEnds(bytes: Uint8Array): number[] {
  const text = latin1(bytes)
  const ends: number[] = []
  let i = text.indexOf('startxref')
  while (i !== -1) {
    const eof = text.indexOf('%%EOF', i)
    if (eof === -1) break
    ends.push(eof + 5)
    i = text.indexOf('startxref', eof)
  }
  const linearized = /\/Linearized\b/.test(text.slice(0, 1024))
  if (linearized && ends.length > 1) ends.shift()
  return ends
}

export async function scanBinary(bytes: Uint8Array): Promise<BinaryFacts> {
  const lib = await import('pdf-lib')
  const { PDFDocument, PDFName, PDFDict, PDFRef, PDFRawStream, PDFArray } = lib
  const N = (s: string) => PDFName.of(s)

  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false })
  const ctx = doc.context
  const deref = (o: PDFObject | undefined) => (o instanceof PDFRef ? ctx.lookup(o) : o)
  const dictOf = (o: PDFObject | undefined): PDFDict | undefined => {
    const v = deref(o)
    return v instanceof PDFDict ? v : v instanceof PDFRawStream ? v.dict : undefined
  }

  /* ---------- 页面 → 图片 / 字体 ---------- */
  const imagePages = new Map<string, Set<number>>()
  const fontPages = new Map<string, Set<number>>()

  const inherited = (node: PDFDict, key: string): PDFObject | undefined => {
    let cur: PDFDict | undefined = node
    for (let d = 0; cur && d < 32; d++) {
      const v = cur.get(N(key))
      if (v) return v
      cur = dictOf(cur.get(N('Parent')))
    }
    return undefined
  }

  const walkResources = (res: PDFDict | undefined, page: number, depth: number, seen: Set<string>) => {
    if (!res || depth > 6) return
    const xobjs = dictOf(res.get(N('XObject')))
    if (xobjs) {
      for (const [, v] of xobjs.entries()) {
        if (!(v instanceof PDFRef)) continue
        const key = v.toString()
        const d = dictOf(v)
        const sub = d?.get(N('Subtype'))
        if (sub === N('Image')) {
          const set = imagePages.get(key) ?? new Set<number>()
          set.add(page)
          imagePages.set(key, set)
        } else if (sub === N('Form') && !seen.has(key)) {
          seen.add(key)
          walkResources(dictOf(d?.get(N('Resources'))), page, depth + 1, seen)
        }
      }
    }
    const fonts = dictOf(res.get(N('Font')))
    if (fonts) {
      for (const [, v] of fonts.entries()) {
        const f = dictOf(v)
        const base = f ? textOf(lib, deref(f.get(N('BaseFont')))) : ''
        const name = base.replace(/^[A-Z]{6}\+/, '').trim()
        if (!name) continue
        const set = fontPages.get(name) ?? new Set<number>()
        set.add(page)
        fontPages.set(name, set)
      }
    }
  }

  doc.getPages().forEach((p, i) => walkResources(dictOf(inherited(p.node, 'Resources')), i + 1, 0, new Set()))

  /* ---------- 图片元数据（含未被引用的残留图片） ---------- */
  const images: ImageMetaFact[] = []
  let imageCount = 0
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(N('Subtype')) !== N('Image')) continue
    imageCount++
    if (images.length >= MAX_IMAGES) continue
    const filterObj = deref(obj.dict.get(N('Filter')))
    const filters = filterObj instanceof PDFArray ? filterObj.asArray().map((f) => textOf(lib, deref(f))) : [textOf(lib, filterObj)]
    const last = filters[filters.length - 1] ?? ''
    const fields: Record<string, string> = {}
    let gps = false
    if (last === 'DCTDecode') {
      // 只有 DCT 一个滤镜时，原始字节就是 JPEG 文件；多滤镜时先解开前面的压缩
      const jpeg = filters.length === 1 ? obj.contents : partialDecode(lib, obj)
      if (jpeg) {
        const m = parseJpegMeta(jpeg)
        Object.assign(fields, m.fields)
        gps = m.gps
      }
    } else if (last === 'JPXDecode') {
      const raw = obj.contents
      const s = latin1(raw, 0, Math.min(raw.length, 256 * 1024))
      const at = s.indexOf('<x:xmpmeta')
      if (at !== -1) for (const [k, v] of Object.entries(parseXmpFields(s.slice(at, s.indexOf('</x:xmpmeta>', at) + 12)))) fields[`XMP.${k}`] = v
    }
    const metaBytes = streamBytes(lib, deref(obj.dict.get(N('Metadata'))))
    if (metaBytes) for (const [k, v] of Object.entries(parseXmpFields(new TextDecoder().decode(metaBytes)))) fields[`Metadata.${k}`] ??= v
    if (!Object.keys(fields).length && !gps) continue
    images.push({ index: imageCount, pages: [...(imagePages.get(ref.toString()) ?? [])].sort((a, b) => a - b), filter: filters.join('+') || '无', fields, gps })
  }

  const fonts: FontFact[] = [...fontPages.entries()].map(([name, set]) => ({ name, pages: [...set].sort((a, b) => a - b) }))

  /* ---------- 增量保存的旧版本 ---------- */
  const ends = revisionEnds(bytes)
  const revisionCount = Math.max(1, ends.length)
  const oldRevisions: RevisionFact[] = []
  const older = ends.slice(0, -1).slice(-MAX_OLD_REVISIONS)
  for (const end of older) {
    try {
      const prev = await PDFDocument.load(bytes.subarray(0, end), { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false })
      oldRevisions.push({ index: ends.indexOf(end) + 1, info: infoOf(lib, prev.context), xmp: catalogXmp(lib, prev.context) })
    } catch {
      /* 旧版本无法单独解析：跳过 */
    }
  }

  return { status: 'completed', images, imageCount, fonts, revisionCount, oldRevisions }
}

function partialDecode(lib: PdfLib, s: RawStream): Uint8Array | null {
  // decodePDFRawStream 会在遇到不支持的 DCTDecode 时停下；去掉最后一个滤镜再解
  try {
    const dict = s.dict.clone()
    const f = dict.lookup(lib.PDFName.of('Filter'))
    if (!(f instanceof lib.PDFArray)) return null
    const arr = f.asArray().slice(0, -1)
    dict.set(lib.PDFName.of('Filter'), s.dict.context.obj(arr))
    return lib.decodePDFRawStream(lib.PDFRawStream.of(dict, s.contents)).decode()
  } catch {
    return null
  }
}
