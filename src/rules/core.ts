/**
 * 规则引擎公共设施：文本扫描、命中回映射、Finding 构造。
 * 规则本身是纯函数：(DocumentFacts, RuleContext) → FindingDraft[]。
 */
import type {
  BBox,
  Confidence,
  DocumentFacts,
  Finding,
  FindingCategory,
  FindingSource,
  Occurrence,
  PageFacts,
  PolicyRef,
  Severity,
  UserTerm,
  VenuePreset,
  Zone,
} from '@/domain/types'
import { LIMITS } from '@/domain/limits'
import { contextAround, originalText, rangeBBoxes } from '@/normalize/mapping'
import { viewRangeToBase } from '@/normalize/views'
import { zoneAtChar } from '@/normalize/zones'
import { freshRegex } from './patterns'

export interface DerivedName {
  /** 原始名字（来自元数据） */
  raw: string
  /** 用于匹配的小写词元 */
  tokens: string[]
  source: string
}

export interface RuleContext {
  preset: VenuePreset
  userTerms: UserTerm[]
  strictShortTerms: boolean
  /** 本次扫描所有文档元数据里的作者名（非匿名占位符） */
  derivedNames: DerivedName[]
  /** 本次扫描所有文档的文件名 */
  allDocs: DocumentFacts[]
}

export interface TextHit {
  page: PageFacts
  start: number
  end: number
  /** 命中所在视图的文本，便于规则读前后文 */
  viewText: string
  viewStart: number
  viewEnd: number
  match: RegExpExecArray
}

/** 在每页三种视图上执行正则，命中映射回基准范围；重叠命中保留较长者。 */
export function scanText(page: PageFacts, re: RegExp, accept?: (hit: TextHit) => boolean): TextHit[] {
  const hits: TextHit[] = []
  for (const view of page.views) {
    const r = freshRegex(re)
    let m: RegExpExecArray | null
    while ((m = r.exec(view.text)) !== null) {
      if (m[0].length === 0) {
        r.lastIndex++
        continue
      }
      const [start, end] = viewRangeToBase(view, m.index, m.index + m[0].length)
      const hit: TextHit = { page, start, end, viewText: view.text, viewStart: m.index, viewEnd: m.index + m[0].length, match: m }
      if (accept && !accept(hit)) continue
      hits.push(hit)
    }
  }
  return dedupeHits(hits)
}

export function dedupeHits(hits: TextHit[]): TextHit[] {
  const sorted = [...hits].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const kept: TextHit[] = []
  for (const h of sorted) {
    if (kept.some((k) => k.start < h.end && h.start < k.end)) continue
    kept.push(h)
  }
  return kept.sort((a, b) => a.start - b.start)
}

export function scanDoc(doc: DocumentFacts, re: RegExp, accept?: (hit: TextHit) => boolean): TextHit[] {
  return doc.pages.flatMap((p) => scanText(p, re, accept))
}

/** 命中前后 n 个视图字符 */
export function around(hit: TextHit, before: number, after = before): { pre: string; post: string } {
  return {
    pre: hit.viewText.slice(Math.max(0, hit.viewStart - before), hit.viewStart),
    post: hit.viewText.slice(hit.viewEnd, hit.viewEnd + after),
  }
}

export function zoneOf(hit: { page: PageFacts; start: number }): Zone {
  return zoneAtChar(hit.page, hit.start)
}

/** 规则产出的草稿；由引擎统一补全 ID、原文、上下文、坐标与政策引用 */
export interface FindingDraft {
  ruleId: string
  category: FindingCategory
  source: FindingSource
  severity: Severity
  confidence: Confidence
  reasons: string[]
  suggestion: string
  /** 文本来源：命中页与基准范围 */
  text?: { page: PageFacts; start: number; end: number }
  /** 附加出现位置（聚合型发现） */
  extra?: Array<{ page: PageFacts; start: number; end: number }>
  /** 非文本来源的页码与框（注释、链接） */
  pageNumber?: number | null
  rect?: BBox | null
  /** 非文本来源的展示内容 */
  snippet?: string
  /** 非文本来源：命中在 snippet 中的位置（用于高亮） */
  snippetMatch?: [number, number] | null
  zone?: Zone | null
  field?: string | null
  linkTarget?: string | null
  visibleText?: string | null
  matchedUserTerm?: boolean
  /** 参与稳定 ID 的额外键（如字段名、注释 ID） */
  key?: string
}

/** FNV-1a 32 位，输出 8 位十六进制；只用于生成稳定 ID，不是安全哈希 */
export function stableHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function snippetFor(page: PageFacts, start: number, end: number): { snippet: string; match: [number, number] } {
  const radius = 48
  const mid = originalText(page, start, end).trim()
  if (mid.length >= LIMITS.snippetMax - 20) return { snippet: clip(mid, LIMITS.snippetMax), match: [0, Math.min(mid.length, LIMITS.snippetMax)] }
  const s0 = Math.max(0, start - radius)
  const e0 = Math.min(page.text.length, end + radius)
  // 截掉被半径切断的半个词；保留与命中之间的原始空格
  let pre = originalText(page, s0, start).trimStart()
  if (s0 > 0) pre = pre.replace(/^\S*\s+/, '')
  let post = originalText(page, end, e0).trimEnd()
  if (e0 < page.text.length) post = post.replace(/\s+\S*$/, '')
  const budget = LIMITS.snippetMax - mid.length
  if (pre.length + post.length > budget) {
    const half = Math.floor(budget / 2)
    pre = pre.slice(Math.max(0, pre.length - half))
    post = post.slice(0, Math.max(0, budget - pre.length))
  }
  const prefix = (s0 > 0 ? '…' : '') + pre
  return {
    snippet: prefix + mid + post + (e0 < page.text.length ? '…' : ''),
    match: [prefix.length, prefix.length + mid.length],
  }
}

export function materialize(doc: DocumentFacts, d: FindingDraft, policyRefs: PolicyRef[], rulesetVersion: string): Finding {
  const occurrences: Occurrence[] = []
  let snippet = d.snippet ?? ''
  let matchInSnippet: [number, number] | null = null
  let context = ''
  let bboxes: BBox[] | null = null
  let approximate = false
  let page: number | null = d.pageNumber ?? null
  let zone: Zone | null = d.zone ?? null

  if (d.text) {
    const { page: p, start, end } = d.text
    const sn = snippetFor(p, start, end)
    snippet = sn.snippet
    matchInSnippet = sn.match
    context = contextAround(p, start, end, LIMITS.contextRadius)
    const rb = rangeBBoxes(p, start, end)
    bboxes = rb.bboxes.length ? rb.bboxes : null
    approximate = rb.approximate
    page = p.pageNumber
    zone = d.zone ?? zoneAtChar(p, start)
    occurrences.push({ page: p.pageNumber, start, end, bboxes, snippet: clip(originalText(p, start, end).trim(), LIMITS.snippetMax) })
    for (const x of d.extra ?? []) {
      const xb = rangeBBoxes(x.page, x.start, x.end)
      occurrences.push({
        page: x.page.pageNumber,
        start: x.start,
        end: x.end,
        bboxes: xb.bboxes.length ? xb.bboxes : null,
        snippet: clip(originalText(x.page, x.start, x.end).trim(), LIMITS.snippetMax),
      })
    }
  } else {
    if (d.rect) bboxes = [d.rect]
    snippet = clip(snippet, LIMITS.snippetMax)
    if (d.snippetMatch && d.snippetMatch[1] <= snippet.length) matchInSnippet = d.snippetMatch
    context = snippet
    occurrences.push({ page, bboxes, snippet })
  }

  // OCR 页的命中：提示可能有识别错误，置信度最高为“中”
  let reasons = d.reasons
  let confidence = d.confidence
  if (d.text?.page.ocr) {
    reasons = [...reasons, '这段文字来自本地 OCR 识别（扫描页 / 图片页），可能有识别错误，请对照原页确认。']
    if (confidence === 'high') confidence = 'medium'
    approximate = true
  }

  const key = [doc.id, d.ruleId, d.source, page ?? 'doc', d.text ? `${d.text.start}-${d.text.end}` : '', d.field ?? '', d.key ?? ''].join('|')
  return {
    id: `f-${stableHash(key)}`,
    documentId: doc.id,
    documentName: doc.displayName,
    documentRole: doc.role,
    ruleId: d.ruleId,
    ruleIds: [d.ruleId],
    ruleVersion: rulesetVersion,
    severity: d.severity,
    confidence,
    category: d.category,
    source: d.source,
    page,
    zone,
    snippet,
    matchInSnippet,
    context,
    bboxes,
    bboxApproximate: approximate,
    occurrences,
    field: d.field ?? null,
    linkTarget: d.linkTarget ?? null,
    visibleText: d.visibleText ?? null,
    reasons,
    suggestion: d.suggestion,
    policyRefs,
    matchedUserTerm: d.matchedUserTerm ?? false,
  }
}

export const ZONE_LABEL: Record<Zone, string> = {
  authorBlock: '首页作者区',
  header: '页眉',
  footer: '页脚',
  acknowledgments: '致谢',
  references: '参考文献',
  appendix: '附录',
  body: '正文',
}

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, info: 1 }
export const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 }

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}
export function maxConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b
}
/** 降一级严重度（high→medium→info） */
export function demote(s: Severity): Severity {
  return s === 'high' ? 'medium' : 'info'
}
