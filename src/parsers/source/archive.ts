/**
 * 源文件包解析：单个 .tex / .bib，或 LaTeX 工程 / 代码的 .zip。
 * - fflate 在内存中解压（按需加载）；先读中央目录判断条目数与解压后大小，防止压缩炸弹。
 * - 只解码文本类文件，单个文件最多读 2 MB；图片读 EXIF / PNG 文本块，Office 文档读 docProps。
 * - 内容只在内存中，供规则扫描，不写入报告。
 */
import type { SourceFacts, SourceFileFact, SourceFileKind } from '@/domain/types'
import { PreflightError } from '@/domain/errors'
import { parseJpegMeta, parseXmpFields } from '@/parsers/pdf/imagemeta'
import { texAuthorNames } from '@/normalize/tex'

export const SOURCE_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxUnpackedBytes: 300 * 1024 * 1024,
  maxEntries: 5000,
  maxTextBytes: 2 * 1024 * 1024,
  maxTexts: 2000,
} as const

const TEX = /\.(?:tex|sty|cls|ltx|bbx|cbx|dtx|ins)$/i
const BIB = /\.(?:bib|bbl)$/i
const TEXT =
  /\.(?:md|markdown|txt|rst|py|ipynb|json|ya?ml|toml|cfg|ini|conf|js|mjs|cjs|ts|tsx|jsx|r|m|jl|c|cc|cpp|cxx|h|hpp|cu|java|kt|scala|go|rs|rb|php|pl|sh|bash|zsh|ps1|bat|cmake|mk|make|cff|csv|tsv|xml|html?|css|sql|lua|swift|dockerfile|gradle|properties|env)$/i
const TEXT_NAMES = /(?:^|\/)(?:README|LICENSE|LICENCE|COPYING|AUTHORS|CONTRIBUTORS|CITATION|NOTICE|Makefile|Dockerfile|\.gitconfig|\.gitmodules|setup\.cfg|requirements[^/]*)$/i
const BUILD = /\.(?:log|aux|fls|fdb_latexmk|blg|out|toc|lof|lot|synctex(?:\.gz)?|nav|snm|vrb|run\.xml|bcf|xdv|idx|ilg|ind)$/i
/** 构建产物中值得读文本的（含本机绝对路径） */
const BUILD_TEXT = /\.(?:log|fls|fdb_latexmk|blg|synctex(?:\.gz)?|run\.xml|bcf)$/i
const JUNK = /(?:^|\/)(?:__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\.idea\/|\.vscode\/|\.ipynb_checkpoints\/)/i
const VCS = /(?:^|\/)(\.git|\.svn|\.hg)(?:\/|$)/
const IMAGE = /\.(?:jpe?g|png)$/i
const OFFICE = /\.(?:docx|pptx|xlsx)$/i
const ARCHIVE = /\.(?:zip|tar|gz|tgz|7z|rar)$/i

export function classify(path: string): SourceFileKind {
  if (VCS.test(path)) return 'vcs'
  if (JUNK.test(path)) return 'junk'
  if (TEX.test(path)) return 'tex'
  if (BIB.test(path)) return 'bib'
  if (BUILD.test(path)) return 'build'
  if (IMAGE.test(path)) return 'image'
  if (OFFICE.test(path)) return 'office'
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (ARCHIVE.test(path) && !/\.synctex\.gz$/i.test(path)) return 'archive'
  if (TEXT.test(path) || TEXT_NAMES.test(path)) return 'text'
  return 'binary'
}

function decodeText(b: Uint8Array): string {
  const head = b.subarray(0, Math.min(b.length, 8000))
  // 含大量 NUL 视为二进制
  let nul = 0
  for (const x of head) if (x === 0) nul++
  if (nul > head.length / 50) return ''
  return new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, SOURCE_LIMITS.maxTextBytes))
}

/* ---------------- PNG 文本块 ---------------- */

function pngMeta(b: Uint8Array): { fields: Record<string, string>; gps: boolean } {
  const fields: Record<string, string> = {}
  let gps = false
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return { fields, gps }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let i = 8
  const latin1 = (x: Uint8Array) => String.fromCharCode(...x)
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i)
    const type = latin1(b.subarray(i + 4, i + 8))
    const data = b.subarray(i + 8, Math.min(b.length, i + 8 + len))
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const z = data.indexOf(0)
      const key = latin1(data.subarray(0, Math.max(0, z)))
      let val = ''
      if (type === 'tEXt') val = new TextDecoder('latin1').decode(data.subarray(z + 1))
      else if (type === 'iTXt' && data[z + 1] === 0) {
        // 未压缩的 iTXt：关键字\0 压缩标志 压缩方法 语言\0 译名\0 文本
        let p = z + 3
        p = data.indexOf(0, p) + 1
        p = data.indexOf(0, p) + 1
        val = new TextDecoder().decode(data.subarray(p))
      }
      if (key === 'XML:com.adobe.xmp' && val) for (const [k, v] of Object.entries(parseXmpFields(val))) fields[`XMP.${k}`] = v
      else if (val && /^(?:Author|Artist|Copyright|Creator|Source|Comment|Description|Title|Disclaimer|Warning)$/i.test(key))
        fields[`PNG.${key}`] = val.slice(0, 200)
    } else if (type === 'eXIf') {
      // 复用 JPEG 解析：拼一个最小 JPEG APP1 段
      const app1 = new Uint8Array(4 + 6 + data.length + 4)
      app1.set([0xff, 0xd8, 0xff, 0xe1, ((data.length + 8) >> 8) & 0xff, (data.length + 8) & 0xff])
      app1.set(new TextEncoder().encode('Exif\0\0'), 6)
      app1.set(data, 12)
      const m = parseJpegMeta(app1)
      Object.assign(fields, m.fields)
      gps ||= m.gps
    } else if (type === 'IEND') break
    i += 12 + len
  }
  return { fields, gps }
}

/* ---------------- 主入口 ---------------- */

export async function parseSourceArchive(name: string, bytes: Uint8Array): Promise<SourceFacts> {
  if (bytes.byteLength > SOURCE_LIMITS.maxArchiveBytes) throw new PreflightError('SOURCE_TOO_LARGE')
  const facts: SourceFacts = { name, byteSize: bytes.byteLength, files: [], texts: [], meta: [], authorNames: [], vcsDirs: [], warnings: [] }
  const isZip = /\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
  if (!isZip) {
    const kind = classify(name)
    facts.files.push({ path: name, size: bytes.byteLength, kind })
    const text = decodeText(bytes)
    if (!text) throw new PreflightError('SOURCE_UNREADABLE')
    facts.texts.push({ path: name, kind: kind === 'binary' ? 'text' : kind, text })
    if (kind === 'tex') facts.authorNames = texAuthorNames([text])
    return facts
  }

  const { unzip, gunzipSync } = await import('fflate')
  let count = 0
  let unpacked = 0
  let tooBig = false
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (f) => {
          count++
          unpacked += f.originalSize
          if (count > SOURCE_LIMITS.maxEntries || unpacked > SOURCE_LIMITS.maxUnpackedBytes) tooBig = true
          const path = f.name
          if (path.endsWith('/')) return false
          const kind = classify(path)
          facts.files.push({ path, size: f.originalSize, kind })
          if (tooBig) return false
          // 只解压需要读内容的文件
          if (kind === 'vcs') return /(?:^|\/)\.git\/config$|(?:^|\/)\.git\/logs\/HEAD$/.test(path) && f.originalSize < 1024 * 1024
          if (kind === 'build') return BUILD_TEXT.test(path) && f.originalSize < 20 * 1024 * 1024
          if (kind === 'tex' || kind === 'bib' || kind === 'text') return f.originalSize < 20 * 1024 * 1024
          if (kind === 'image' || kind === 'office') return f.originalSize < 30 * 1024 * 1024
          return false
        },
      },
      (err, data) => (err ? reject(new PreflightError('SOURCE_UNREADABLE')) : resolve(data)),
    )
  })
  if (tooBig) throw new PreflightError('SOURCE_TOO_LARGE')

  const vcs = new Set<string>()
  for (const f of facts.files) {
    const m = VCS.exec(f.path)
    if (m) vcs.add(f.path.slice(0, m.index + m[0].length).replace(/\/$/, ''))
  }
  facts.vcsDirs = [...vcs]

  for (const [path, data] of Object.entries(entries)) {
    const kind = classify(path)
    if (kind === 'image') {
      const m = /\.png$/i.test(path) ? pngMeta(data) : parseJpegMeta(data)
      if (Object.keys(m.fields).length || m.gps) facts.meta.push({ path, kind: 'image', ...m })
      continue
    }
    if (kind === 'office') {
      try {
        const inner = (await import('fflate')).unzipSync(data, { filter: (f) => /^docProps\/(?:core|app)\.xml$/.test(f.name) && f.originalSize < 512 * 1024 })
        const fields: Record<string, string> = {}
        const xml = Object.values(inner).map((x) => new TextDecoder().decode(x)).join('\n')
        for (const [tag, label] of [
          ['dc:creator', 'Office.Creator'],
          ['cp:lastModifiedBy', 'Office.LastModifiedBy'],
          ['Company', 'Office.Company'],
          ['Manager', 'Office.Manager'],
        ] as const) {
          const v = new RegExp(`<${tag}>([^<]{1,200})</${tag}>`).exec(xml)?.[1]?.trim()
          if (v) fields[label] = v
        }
        if (Object.keys(fields).length) facts.meta.push({ path, kind: 'office', fields, gps: false })
      } catch {
        facts.warnings.push(`${path}：Office 文档无法解析。`)
      }
      continue
    }
    if (facts.texts.length >= SOURCE_LIMITS.maxTexts) continue
    let raw = data
    if (/\.synctex\.gz$/i.test(path)) {
      try {
        raw = gunzipSync(data).subarray(0, SOURCE_LIMITS.maxTextBytes)
      } catch {
        continue
      }
    }
    const text = decodeText(raw)
    if (text) facts.texts.push({ path, kind, text })
  }
  if (facts.texts.length >= SOURCE_LIMITS.maxTexts) facts.warnings.push(`文本文件超过 ${SOURCE_LIMITS.maxTexts} 个，只检查了前 ${SOURCE_LIMITS.maxTexts} 个。`)
  const pdfs = facts.files.filter((f) => f.kind === 'pdf').length
  if (pdfs) facts.warnings.push(`包内有 ${pdfs} 个 PDF 没有检查；如需检查，请作为主稿或补充材料单独导入。`)
  const nested = facts.files.filter((f) => f.kind === 'archive').length
  if (nested) facts.warnings.push(`包内有 ${nested} 个压缩文件没有展开检查。`)
  facts.files.sort((a, b) => a.path.localeCompare(b.path))
  facts.authorNames = texAuthorNames(facts.texts.filter((t) => t.kind === 'tex').map((t) => t.text))
  return facts
}

/** 文件列表摘要：每类文件个数 */
export function kindCounts(files: SourceFileFact[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of files) out[f.kind] = (out[f.kind] ?? 0) + 1
  return out
}
