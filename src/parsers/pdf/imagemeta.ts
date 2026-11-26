/**
 * 图片元数据解析：JPEG 的 EXIF（TIFF IFD）、IPTC（Photoshop APP13）、XMP（APP1）与 COM 注释，
 * 以及独立的 XMP 包。只读取少量可能识别身份的字段；全部做越界检查，畸形数据直接跳过。
 */

export interface ImageMeta {
  fields: Record<string, string>
  gps: boolean
}

const MAX_VALUE = 200

function clean(s: string): string {
  const v = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE - 1)}…` : v
}

function put(out: Record<string, string>, key: string, value: string) {
  const v = clean(value)
  if (v) out[key] = out[key] ? `${out[key]}; ${v}` : v
}

const latin1 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
  return s
}
const utf8 = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(b)

/* ---------------- EXIF / TIFF ---------------- */

const IFD0_TAGS: Record<number, string> = {
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x9c9b: 'XPTitle',
  0x9c9c: 'XPComment',
  0x9c9d: 'XPAuthor',
  0x9c9e: 'XPKeywords',
  0x9c9f: 'XPSubject',
}
const EXIF_TAGS: Record<number, string> = {
  0x9286: 'UserComment',
  0xa430: 'CameraOwnerName',
  0xa431: 'BodySerialNumber',
  0xa435: 'LensSerialNumber',
}

function parseTiff(t: Uint8Array, out: Record<string, string>): boolean {
  if (t.length < 8) return false
  const le = t[0] === 0x49 && t[1] === 0x49
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return false
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength)
  const u16 = (o: number) => (o + 2 <= t.length ? dv.getUint16(o, le) : -1)
  const u32 = (o: number) => (o + 4 <= t.length ? dv.getUint32(o, le) : -1)
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
  let gps = false
  const seen = new Set<number>()

  const readIfd = (off: number, tags: Record<number, string>, depth: number) => {
    if (depth > 3 || off <= 0 || off >= t.length || seen.has(off)) return
    seen.add(off)
    const n = u16(off)
    if (n < 0 || n > 512) return
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12
      if (e + 12 > t.length) return
      const tag = u16(e)
      const type = u16(e + 2)
      const count = u32(e + 4)
      const size = (SIZES[type] ?? 0) * count
      if (tag === 0x8769) readIfd(u32(e + 8), EXIF_TAGS, depth + 1)
      if (tag === 0x8825) {
        const g = u32(e + 8)
        // GPS IFD 里有经纬度（tag 2 / 4）即视为含位置
        if (g > 0 && g < t.length) {
          const gn = u16(g)
          for (let j = 0; j < Math.max(0, Math.min(gn, 64)); j++) {
            const gt = u16(g + 2 + j * 12)
            if (gt === 2 || gt === 4) gps = true
          }
        }
      }
      const name = tags[tag]
      if (!name || size <= 0 || size > 64 * 1024) continue
      const vo = size <= 4 ? e + 8 : u32(e + 8)
      if (vo < 0 || vo + size > t.length) continue
      const raw = t.subarray(vo, vo + size)
      if (name.startsWith('XP')) {
        // UCS-2 LE，以 0 结尾
        put(out, `EXIF.${name}`, new TextDecoder('utf-16le').decode(raw).replace(/\0+$/, ''))
      } else if (name === 'UserComment') {
        const head = latin1(raw.subarray(0, 8))
        const body = raw.subarray(8)
        put(out, 'EXIF.UserComment', head.startsWith('UNICODE') ? new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body) : latin1(body))
      } else if (type === 2) {
        put(out, `EXIF.${name}`, utf8(raw).replace(/\0+$/, ''))
      }
    }
  }
  readIfd(u32(4), IFD0_TAGS, 0)
  return gps
}

/* ---------------- IPTC（Photoshop APP13） ---------------- */

const IPTC_TAGS: Record<number, string> = { 80: 'By-line', 85: 'By-lineTitle', 110: 'Credit', 115: 'Source', 116: 'Copyright', 118: 'Contact', 120: 'Caption', 122: 'Writer' }

function parseIptc(b: Uint8Array, out: Record<string, string>) {
  let i = 0
  while (i + 5 <= b.length) {
    if (b[i] !== 0x1c) {
      i++
      continue
    }
    const rec = b[i + 1]!
    const ds = b[i + 2]!
    const len = (b[i + 3]! << 8) | b[i + 4]!
    const start = i + 5
    if (len & 0x8000 || start + len > b.length) return
    if (rec === 2 && IPTC_TAGS[ds]) put(out, `IPTC.${IPTC_TAGS[ds]}`, utf8(b.subarray(start, start + len)))
    i = start + len
  }
}

function parsePhotoshop(b: Uint8Array, out: Record<string, string>) {
  let i = 0
  while (i + 12 <= b.length) {
    if (latin1(b.subarray(i, i + 4)) !== '8BIM') return
    const id = (b[i + 4]! << 8) | b[i + 5]!
    const nameLen = b[i + 6]!
    let p = i + 7 + nameLen
    if ((nameLen + 1) % 2) p++
    if (p + 4 > b.length) return
    const size = ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0
    const data = p + 4
    if (data + size > b.length) return
    if (id === 0x0404) parseIptc(b.subarray(data, data + size), out)
    i = data + size + (size % 2)
  }
}

/* ---------------- XMP ---------------- */

/** 与身份相关、值得报告的 XMP 属性（小写） */
const XMP_KEYS = new Set([
  'dc:creator',
  'dc:rights',
  'dc:description',
  'dc:title',
  'xmp:creatortool',
  'pdf:author',
  'pdf:producer',
  'photoshop:authorsposition',
  'photoshop:credit',
  'photoshop:captionwriter',
  'xmprights:owner',
  'xmprights:webstatement',
  'tiff:artist',
  'tiff:copyright',
  'exif:usercomment',
  'aux:serialnumber',
  'aux:ownername',
  'exifex:cameraownername',
  'exifex:bodyserialnumber',
  'iptc4xmpcore:ciemailwork',
  'iptc4xmpcore:ciurlwork',
])

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/** 只读 XMP 中的少量键；返回 { 'dc:creator': 'A; B', ... }（键为小写） */
export function parseXmpFields(xml: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!/<x:xmpmeta|<rdf:RDF/i.test(xml)) return out
  // 元素形式：<dc:creator><rdf:Seq><rdf:li>A</rdf:li>…</rdf:Seq></dc:creator>
  // 逐个键查找：通用的“任意元素”正则会先匹配外层 <x:xmpmeta> 而吞掉里面的元素
  for (const key of XMP_KEYS) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const m of xml.matchAll(new RegExp(`<${k}\\b[^>]*?>([\\s\\S]*?)</${k}>`, 'gi'))) {
      const items = [...m[1]!.matchAll(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((x) => x[1]!)
      const vals = (items.length ? items : [m[1]!]).map((v) => decodeEntities(v.replace(/<[^>]+>/g, ' ')))
      for (const v of vals) put(out, key, v)
    }
  }
  // 属性形式：<rdf:Description xmp:CreatorTool="…">
  for (const m of xml.matchAll(/\s([A-Za-z][\w.-]*:[\w.-]+)="([^"]*)"/g)) {
    const key = m[1]!.toLowerCase()
    if (XMP_KEYS.has(key) && !out[key]) put(out, key, decodeEntities(m[2]!))
  }
  return out
}

/* ---------------- JPEG ---------------- */

const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0'

export function parseJpegMeta(b: Uint8Array): ImageMeta {
  const fields: Record<string, string> = {}
  let gps = false
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return { fields, gps }
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break
    const marker = b[i + 1]!
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i++
      continue
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!
    if (len < 2 || i + 2 + len > b.length) break
    const seg = b.subarray(i + 4, i + 2 + len)
    if (marker === 0xe1) {
      const head = latin1(seg.subarray(0, 29))
      if (head.startsWith('Exif\0')) {
        try {
          if (parseTiff(seg.subarray(6), fields)) gps = true
        } catch {
          /* 畸形 EXIF：跳过 */
        }
      } else if (head.startsWith(XMP_SIG)) {
        for (const [k, v] of Object.entries(parseXmpFields(utf8(seg.subarray(XMP_SIG.length))))) put(fields, `XMP.${k}`, v)
      }
    } else if (marker === 0xed && latin1(seg.subarray(0, 14)) === 'Photoshop 3.0\0') {
      try {
        parsePhotoshop(seg.subarray(14), fields)
      } catch {
        /* 跳过 */
      }
    } else if (marker === 0xfe) {
      put(fields, 'JPEG.Comment', utf8(seg))
    }
    i += 2 + len
  }
  return { fields, gps }
}

/**
 * 清理 JPEG：删除 APP1（EXIF / XMP）、APP13（IPTC）与 COM 注释段，其余（含 APP0 JFIF、APP2 ICC、APP14 Adobe 颜色信息）原样保留。
 * 返回 null 表示没有需要删除的段或格式无法识别。
 */
export function stripJpegMeta(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  const keep: Array<[number, number]> = [[0, 2]]
  let removed = false
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xda || marker === 0xd9) {
      keep.push([i, b.length])
      break
    }
    if (marker === 0xff) {
      i++
      continue
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!
    if (len < 2 || i + 2 + len > b.length) return null
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) removed = true
    else keep.push([i, i + 2 + len])
    i += 2 + len
  }
  if (!removed) return null
  const total = keep.reduce((n, [a, z]) => n + (z - a), 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const [a, z] of keep) {
    out.set(b.subarray(a, z), o)
    o += z - a
  }
  return out
}
