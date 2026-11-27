/**
 * 对象层规则：R18 图片元数据、R19 字体名、R20 增量保存的旧版本、R21 会场模板标记。
 */
import type { DocumentFacts, Severity } from '@/domain/types'
import { normalizeText } from '@/normalize/unicode'
import type { FindingDraft, RuleContext } from './core'
import { hasUserTerm, identityTokens } from './identity'
import { INSTITUTION, freshRegex } from './patterns'
import { isAmbiguousTerm, isAnonymousPlaceholder, termRegex } from './terms'
import { L, LIST_SEP, type Text, join } from '@/domain/text'

const RANK: Record<Severity, number> = { high: 3, medium: 2, info: 1 }
const maxSev = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b)

function pagesText(pages: number[]): Text {
  if (!pages.length)
    return L('没有任何页面引用这张图片（可能是删除后残留在文件里的对象）', 'is not used on any page (probably an object left behind after deletion)')
  const list = `${pages.slice(0, 8).join(', ')}${pages.length > 8 ? '…' : ''}`
  return L(`出现在第 ${pages.slice(0, 8).join('、')}${pages.length > 8 ? '…' : ''} 页`, `appears on page(s) ${list}`)
}

// ---------------------------------------------------------------------------
// R18 图片元数据
// ---------------------------------------------------------------------------

/** 作者 / 版权 / 所有者一类字段 */
const ID_KEY = /(artist|author|creator(?!tool)|copyright|rights|owner|by-?line|contact|credit|captionwriter|writer|ciemail|ciurl)/i
const SERIAL_KEY = /serial/i
/** 只是设备 / 软件清单，单独出现时不报告 */
const INVENTORY_KEY = /(make|model|software|creatortool|producer)$/i
const TEXT_KEY = /(description|comment|caption|title|subject|keywords|source)/i

export function ruleImageMetadata(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const img of doc.binary?.images ?? []) {
    let severity: Severity | null = null
    const reasons: Text[] = []
    const shown: string[] = []
    let matchedUserTerm = false
    for (const [key, value] of Object.entries(img.fields)) {
      const tokens = identityTokens(value, ctx)
      if (hasUserTerm(tokens)) matchedUserTerm = true
      if (tokens.length) {
        severity = maxSev(severity ?? 'high', 'high')
        reasons.push(L(`${key}：${join(tokens, LIST_SEP).zh}。`, `${key} ${join(tokens, LIST_SEP).en}.`))
        shown.push(`${key}: ${value}`)
      } else if (ID_KEY.test(key) && !isAnonymousPlaceholder(value)) {
        severity = maxSev(severity ?? 'high', 'high')
        reasons.push(L(`${key} 是作者 / 版权 / 所有者字段，值非空。`, `${key} is an author / copyright / owner field and is set.`))
        shown.push(`${key}: ${value}`)
      } else if (SERIAL_KEY.test(key)) {
        severity = maxSev(severity ?? 'medium', 'medium')
        reasons.push(L(`${key} 是设备序列号，可能把照片和作者的设备关联起来。`, `${key} is a device serial number that can link the photo to the authors’ device.`))
        shown.push(`${key}: ${value}`)
      } else if (TEXT_KEY.test(key) && !INVENTORY_KEY.test(key)) {
        severity = maxSev(severity ?? 'info', 'info')
        reasons.push(L(`${key} 含描述文字，请确认其中没有姓名、机构或项目名。`, `${key} contains descriptive text; make sure it has no names, institutions or project names.`))
        shown.push(`${key}: ${value}`)
      }
    }
    if (img.gps) {
      severity = 'high'
      reasons.unshift(L('图片带有 GPS 拍摄位置，可能指向作者所在的城市或机构。', 'The image has a GPS location that may point to the authors’ city or institution.'))
      shown.unshift('GPS')
    }
    if (!severity) continue
    const where = pagesText(img.pages)
    reasons.push(L(`图片 #${img.index}（${img.filter}）${where.zh}。`, `Image #${img.index} (${img.filter}) ${where.en}.`))
    out.push({
      ruleId: 'R18',
      category: 'imageMetadata',
      source: 'image',
      severity,
      confidence: severity === 'info' ? 'low' : 'high',
      pageNumber: img.pages[0] ?? null,
      zone: null,
      field: `img:${img.index}`,
      snippet: shown.join('; '),
      reasons,
      matchedUserTerm,
      key: `img-${img.index}`,
      suggestion: L(
        '用“清理 PDF”去除图片元数据；或在源文件中换成去掉元数据的图片（重新导出、截图另存，或用 exiftool -all= 处理）后重新生成 PDF。',
        'Use “Clean PDF” to strip image metadata, or replace the images in the source with metadata-free copies (re-export, re-save a screenshot or run exiftool -all=) and rebuild the PDF.',
      ),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// R19 字体名
// ---------------------------------------------------------------------------

/** “AlexExampleSans-Bold” → “Alex Example Sans Bold” */
function fontWords(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_,.+]+/g, ' ')
    .trim()
}

export function ruleFontNames(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const font of doc.binary?.fonts ?? []) {
    const words = normalizeText(fontWords(font.name))
    const compact = font.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const hits: Text[] = []
    let matchedUserTerm = false
    for (const t of ctx.userTerms) {
      if (t.ambiguous) continue
      const c = t.normalized.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (termRegex(t.normalized).test(words) || (c.length >= 5 && compact.includes(c))) {
        hits.push(L(`自定义词「${t.raw}」`, `your term “${t.raw}”`))
        matchedUserTerm = true
      }
    }
    for (const n of ctx.derivedNames) {
      const surname = (n.tokens[n.tokens.length - 1] ?? '').replace(/[^a-z]/g, '')
      if (termRegex(n.raw).test(words) || (surname.length >= 4 && !isAmbiguousTerm(surname) && compact.includes(surname))) hits.push(L(`作者名「${n.raw}」`, `the author name “${n.raw}”`))
    }
    if (freshRegex(INSTITUTION).test(words)) hits.push(L('机构词', 'an institution word'))
    if (!hits.length) continue
    out.push({
      ruleId: 'R19',
      category: 'fontName',
      source: 'font',
      severity: 'medium',
      confidence: 'medium',
      pageNumber: font.pages[0] ?? null,
      zone: null,
      field: `font:${font.name}`,
      snippet: font.name,
      reasons: [
        L(
          `字体名中含${join(hits, LIST_SEP).zh}。字体名会写进 PDF，任何人都能在“文档属性 → 字体”中看到。`,
          `The font name contains ${join(hits, LIST_SEP).en}. Font names are stored in the PDF and visible to anyone under Document Properties → Fonts.`,
        ),
        L(`用于第 ${font.pages.slice(0, 8).join('、')} 页。`, `Used on page(s) ${font.pages.slice(0, 8).join(', ')}.`),
      ],
      matchedUserTerm,
      key: `font-${font.name}`,
      suggestion: L(
        '换用会场模板默认字体，或在导出前把自制 / 机构定制字体改为通用字体；字体名无法在 PDF 中安全地改写。',
        'Use the template’s default fonts, or switch custom / institutional fonts to common ones before exporting; font names cannot be safely rewritten inside a PDF.',
      ),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// R20 增量保存的旧版本
// ---------------------------------------------------------------------------

const AUTHOR_KEY = /^(?:Author|dc:creator|pdf:author|xmp:author)$/i
const SKIP_KEY = /^(?:CreationDate|ModDate|Trapped|xmp:createdate|xmp:modifydate)$/i

export function ruleRevisions(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const b = doc.binary
  if (!b || b.revisionCount <= 1) return []
  const out: FindingDraft[] = []
  const current = new Set([...Object.values(doc.info), ...Object.values(doc.xmp ?? {})].map((v) => v.trim().toLowerCase()))
  for (const rev of b.oldRevisions) {
    const groups: Array<[string, Record<string, string> | null]> = [
      ['Info', rev.info],
      ['XMP', rev.xmp],
    ]
    for (const [group, dict] of groups) {
      for (const [key, raw] of Object.entries(dict ?? {})) {
        const value = raw.trim()
        if (!value || SKIP_KEY.test(key) || current.has(value.toLowerCase())) continue
        const tokens = identityTokens(value, ctx)
        const author = AUTHOR_KEY.test(key) && !isAnonymousPlaceholder(value)
        if (!author && !tokens.length) continue
        out.push({
          ruleId: 'R20',
          category: 'revision',
          source: 'revision',
          severity: 'high',
          confidence: 'high',
          pageNumber: null,
          zone: null,
          field: `rev${rev.index}:${group}.${key}`,
          snippet: value,
          reasons: [
            L(
              `文件是增量保存的（共 ${b.revisionCount} 个版本），第 ${rev.index} 个版本的 ${group}.${key} 仍留在文件里，用常见工具即可恢复。`,
              `The file was saved incrementally (${b.revisionCount} revisions); ${group}.${key} of revision ${rev.index} is still in the file and easy to recover.`,
            ),
            ...(author ? [L('这是作者字段，且不是匿名占位符。', 'It is an author field and not an anonymous placeholder.')] : []),
            ...tokens,
          ],
          matchedUserTerm: hasUserTerm(tokens),
          key: `rev-${rev.index}-${group}-${key}`,
          suggestion: L(
            '用“清理 PDF”生成单一版本的文件，或在源文件中重新完整导出 / “另存为”（不要用增量保存），再检查一次。',
            'Use “Clean PDF” to produce a single-revision file, or export / “Save As” fully from the source (no incremental save), then check again.',
          ),
        })
      }
    }
  }
  out.push({
    ruleId: 'R20',
    category: 'revision',
    source: 'revision',
    severity: out.length ? 'medium' : 'info',
    confidence: 'medium',
    pageNumber: null,
    zone: null,
    field: 'revisions',
    snippet: `revisions=${b.revisionCount}`,
    snippetText: L(`共 ${b.revisionCount} 个保存版本`, `${b.revisionCount} saved revisions`),
    reasons: [
      L(
        '文件末尾追加过修改（增量保存），旧版本的内容仍在文件中。本工具只检查了旧版本的元数据，没有检查旧版本的正文与批注。',
        'Changes were appended to the end of the file (incremental save), so earlier content is still inside. Only the metadata of earlier revisions was checked, not their text or annotations.',
      ),
    ],
    key: 'rev-count',
    suggestion: L(
      '提交前用“清理 PDF”或从源文件重新完整导出，得到只有一个版本的文件。',
      'Before submitting, use “Clean PDF” or export fully from the source to get a single-revision file.',
    ),
  })
  return out
}

// ---------------------------------------------------------------------------
// R21 会场模板标记
// ---------------------------------------------------------------------------

export function ruleTemplateMarker(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const m = ctx.preset.templateMarker
  if (!m || doc.role !== 'main') return []
  const first = doc.pages[0]
  if (!first || first.textQuality === 'empty') return []
  const text = doc.pages
    .slice(0, 2)
    .map((p) => p.text)
    .join('\n')
  if (new RegExp(m.pattern, 'iu').test(text)) return []
  return [
    {
      ruleId: 'R21',
      category: 'template',
      source: 'text',
      severity: 'medium',
      confidence: 'low',
      pageNumber: 1,
      zone: null,
      field: 'template',
      snippet: m.label,
      snippetText: L(`未找到：${m.label}`, `Not found: ${m.label}`),
      reasons: [
        L(
          `${ctx.preset.venue.zh} 的投稿模板在审稿模式下会印出“${m.label}”。前两页没有找到它，可能用了终稿（camera-ready）或非匿名模式。`,
          `${ctx.preset.venue.en}’s template prints “${m.label}” in review mode. It was not found on the first two pages, so the camera-ready or non-anonymous mode may be in use.`,
        ),
        L('如果会场今年调整了模板文字，这条可能是误报，请对照官方模板确认。', 'If the venue changed its template wording this year, this may be a false positive; compare with the official template.'),
      ],
      key: 'template',
      suggestion: m.suggestion,
    },
  ]
}
