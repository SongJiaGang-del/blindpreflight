/**
 * 对象层测试夹具（全部虚构）：带 EXIF / IPTC / XMP / GPS 的 JPEG、含自定义字体名的页面、增量保存。
 */
import { PDFDocument, PDFName } from 'pdf-lib'
import { makePaper, type PaperSpec } from './make-pdf'

const enc = new TextEncoder()

function u16le(n: number) {
  return [n & 0xff, (n >> 8) & 0xff]
}
function u32le(n: number) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
}
function seg(marker: number, payload: number[] | Uint8Array): number[] {
  const len = payload.length + 2
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload]
}

export interface JpegMetaSpec {
  artist?: string
  copyright?: string
  xpAuthor?: string
  gps?: boolean
  xmpCreator?: string
  iptcByline?: string
  comment?: string
}

/** 小端 TIFF：IFD0（Artist / Copyright / GPS 指针 / XPAuthor）+ 可选 GPS IFD */
function tiff(spec: JpegMetaSpec): number[] {
  type Entry = { tag: number; type: number; count: number; data: number[] }
  const entries: Entry[] = []
  const ascii = (s: string) => [...enc.encode(s), 0]
  if (spec.artist) entries.push({ tag: 0x013b, type: 2, count: ascii(spec.artist).length, data: ascii(spec.artist) })
  if (spec.copyright) entries.push({ tag: 0x8298, type: 2, count: ascii(spec.copyright).length, data: ascii(spec.copyright) })
  if (spec.gps) entries.push({ tag: 0x8825, type: 4, count: 1, data: [] })
  if (spec.xpAuthor) {
    const ucs = [...spec.xpAuthor, '\0'].flatMap((c) => u16le(c.charCodeAt(0)))
    entries.push({ tag: 0x9c9d, type: 1, count: ucs.length, data: ucs })
  }
  const ifd0 = 8
  const ifdSize = 2 + entries.length * 12 + 4
  const dataOff = ifd0 + ifdSize
  const data: number[] = []
  const gpsIfdAt = () => dataOff + data.length
  const head = [0x49, 0x49, 0x2a, 0x00, ...u32le(ifd0)]
  const body: number[] = [...u16le(entries.length)]
  let gpsPtrIndex = -1
  for (const e of entries) {
    body.push(...u16le(e.tag), ...u16le(e.type), ...u32le(e.count))
    if (e.tag === 0x8825) {
      gpsPtrIndex = body.length
      body.push(0, 0, 0, 0)
    } else if (e.data.length <= 4) body.push(...e.data, ...new Array(4 - e.data.length).fill(0))
    else {
      body.push(...u32le(dataOff + data.length))
      data.push(...e.data)
    }
  }
  body.push(0, 0, 0, 0)
  if (gpsPtrIndex >= 0) {
    const at = gpsIfdAt()
    body.splice(gpsPtrIndex, 4, ...u32le(at))
    // GPS IFD：一个 GPSLatitude（RATIONAL ×3）
    const ratAt = at + 2 + 12 + 4
    data.push(...u16le(1), ...u16le(0x0002), ...u16le(5), ...u32le(3), ...u32le(ratAt), 0, 0, 0, 0)
    data.push(...u32le(40), ...u32le(1), ...u32le(26), ...u32le(1), ...u32le(0), ...u32le(1))
  }
  return [...head, ...body, ...data]
}

export function makeJpegWithMeta(spec: JpegMetaSpec): Uint8Array {
  const out: number[] = [0xff, 0xd8]
  out.push(...seg(0xe0, [...enc.encode('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]))
  if (spec.artist || spec.copyright || spec.xpAuthor || spec.gps) out.push(...seg(0xe1, [...enc.encode('Exif\0\0'), ...tiff(spec)]))
  if (spec.xmpCreator) {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>${spec.xmpCreator}</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`
    out.push(...seg(0xe1, [...enc.encode('http://ns.adobe.com/xap/1.0/\0'), ...enc.encode(xmp)]))
  }
  if (spec.iptcByline) {
    const v = enc.encode(spec.iptcByline)
    const iptc = [0x1c, 0x02, 80, (v.length >> 8) & 0xff, v.length & 0xff, ...v]
    const res = [...enc.encode('8BIM'), 0x04, 0x04, 0, 0, ...[0, 0, (iptc.length >> 8) & 0xff, iptc.length & 0xff], ...iptc]
    if (iptc.length % 2) res.push(0)
    out.push(...seg(0xed, [...enc.encode('Photoshop 3.0\0'), ...res]))
  }
  if (spec.comment) out.push(...seg(0xfe, [...enc.encode(spec.comment)]))
  // SOF0：1×1、3 通道（pdf-lib 只读尺寸与通道数）
  out.push(...seg(0xc0, [8, 0, 1, 0, 1, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]))
  out.push(0xff, 0xd9)
  return new Uint8Array(out)
}

export interface BinaryPaperSpec extends PaperSpec {
  /** 页面上绘制的图片 */
  image?: JpegMetaSpec
  /** 嵌入但不在任何页面上使用的图片 */
  orphanImage?: JpegMetaSpec
  /** 额外登记到第 1 页资源里的字体名 */
  fontName?: string
}

export async function makeBinaryPaper(spec: BinaryPaperSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePaper(spec), { updateMetadata: false })
  const page = doc.getPage(0)
  if (spec.image) {
    const img = await doc.embedJpg(makeJpegWithMeta(spec.image))
    page.drawImage(img, { x: 420, y: 60, width: 60, height: 60 })
  }
  if (spec.orphanImage) await doc.embedJpg(makeJpegWithMeta(spec.orphanImage))
  if (spec.fontName) {
    const f = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: spec.fontName }))
    page.node.setFontDictionary(PDFName.of('FX'), f)
  }
  return doc.save({ useObjectStreams: false })
}

/** 先存成经典 xref 表，再在文件末尾追加一次增量保存：新的 Info 字典（不含作者） */
export async function appendRevision(bytes: Uint8Array, info: Record<string, string>): Promise<Uint8Array> {
  const base = await (await PDFDocument.load(bytes, { updateMetadata: false })).save({ useObjectStreams: false })
  const tail = new TextDecoder('latin1').decode(base.subarray(Math.max(0, base.length - 2048)))
  const root = /\/Root\s+(\d+)\s+0\s+R/.exec(tail)?.[1]
  const size = Number(/\/Size\s+(\d+)/.exec(tail)?.[1])
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail)?.[1])
  if (!root || !size || Number.isNaN(prev)) throw new Error('fixture: cannot parse trailer')
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const dict = Object.entries(info).map(([k, v]) => `/${k} (${esc(v)})`).join(' ')
  const objOff = base.length + 1
  const obj = `${size} 0 obj\n<< ${dict} >>\nendobj\n`
  const xrefOff = objOff + obj.length
  const pad = (n: number) => String(n).padStart(10, '0')
  const append = `\n${obj}xref\n0 1\n0000000000 65535 f \n${size} 1\n${pad(objOff)} 00000 n \ntrailer\n<< /Size ${size + 1} /Root ${root} 0 R /Info ${size} 0 R /Prev ${prev} >>\nstartxref\n${xrefOff}\n%%EOF\n`
  const out = new Uint8Array(base.length + append.length)
  out.set(base)
  out.set(enc.encode(append), base.length)
  return out
}
