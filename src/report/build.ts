/**
 * 报告模型：只包含摘要、发现、覆盖与复核决定。
 * 不包含 PDF 字节、全文、页面文字或自定义身份词清单。
 */
import type {
  CoverageEntry,
  Finding,
  ReviewDecision,
  ReviewStatus,
  ScanResult,
  Severity,
} from '@/domain/types'
import { APP_VERSION, REPORT_SCHEMA_VERSION } from '@/domain/limits'
import { DISCLAIMER, isDismissed } from '@/domain/labels'
import { parseLink } from '@/rules/links'
import { maskQuoted, maskText, maskUrl, maskUrlsIn } from '@/utils/safe-text'

export interface ReportOptions {
  /** 片段、上下文、链接目标脱敏 */
  redactEvidence: boolean
  /** 文件名替换为 “主稿 / 补充材料 n” */
  hideFilenames: boolean
  /** 包含已忽略的发现（总数始终保留） */
  includeDismissed: boolean
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  redactEvidence: true,
  hideFilenames: true,
  includeDismissed: true,
}

/** 报告附加信息：人工核对清单与修复前后对比（都只含条目与计数，不含稿件内容） */
export interface ReportExtras {
  checklist?: { items: ReadonlyArray<{ id: string; title: string }>; checked: ReadonlySet<string> }
  comparison?: { fixed: number; remaining: number; added: number; reopened: number; presetChanged: boolean } | null
}

export interface ReportFinding {
  id: string
  ruleIds: string[]
  severity: Severity
  confidence: Finding['confidence']
  category: Finding['category']
  source: Finding['source']
  document: string
  documentRole: Finding['documentRole']
  page: number | null
  pages: number[]
  zone: Finding['zone']
  field: string | null
  snippet: string
  linkTarget: string | null
  visibleText: string | null
  reasons: string[]
  suggestion: string
  policyRefs: Array<{ label: string; url: string; note: string }>
  matchedUserTerm: boolean
  review: { status: ReviewStatus; reason: string } | null
}

export interface Report {
  schemaVersion: string
  appVersion: string
  rulesetVersion: string
  scanId: string
  runId: number
  startedAt: string
  completedAt: string
  generatedAt: string
  options: ReportOptions
  preset: {
    id: string
    venue: string
    track: string
    phase: string
    version: string
    verifiedAt: string | null
    verificationStatus: string
    implementationStatus: string
    sources: Array<{ label: string; url: string; section: string }>
    limitations: string[]
  }
  documents: Array<{ id: string; name: string; role: string; pageCount: number; byteSize: number; parseStatus: string; warnings: string[] }>
  summary: {
    total: number
    bySeverity: Record<Severity, number>
    dismissed: number
    resolved: number
    excludedFromReport: number
    pagesChecked: number
    pagesWithWeakText: number
  }
  coverage: Array<Omit<CoverageEntry, 'documentId'> & { document: string | null }>
  rules: ScanResult['rules']
  userTermCount: number
  findings: ReportFinding[]
  /** 人工核对清单；未提供时为 null */
  checklist: Array<{ id: string; title: string; checked: boolean }> | null
  /** 与上一版的对比计数；没有对比时为 null */
  comparison: { fixed: number; remaining: number; added: number; reopened: number; presetChanged: boolean } | null
  disclaimer: string
}

function docAlias(result: ScanResult, id: string, hide: boolean): string {
  if (id === 'src') return hide ? '源文件包' : (result.source?.name ?? '源文件包')
  const doc = result.documents.find((d) => d.id === id)
  if (!doc) return id
  if (!hide) return doc.displayName
  if (doc.role === 'main') return '主稿'
  const n = result.documents.filter((d) => d.role === 'supplement').indexOf(doc) + 1
  return `补充材料 ${n}`
}

/** 公共平台的主机名不识别作者，保留以便读报告的人知道是哪类链接；其余主机名（机构、个人主页）打码 */
const PUBLIC_HOST_KINDS = new Set(['repository', 'modelHub', 'cloudDrive', 'videoSocial', 'scholarly', 'anonymous'])
function keepHost(url: string): boolean {
  const link = parseLink(url)
  return !!link && PUBLIC_HOST_KINDS.has(link.kind)
}
const maskLink = (url: string) => maskUrl(url, keepHost(url))

const CONTEXT = 24
const EMAIL_OR_URL = /https?:\/\/[^\s，。；、)）\]]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|\{[^{}@\n]{1,80}\}@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu

/** 邮箱地址与单独出现的 @域名 一并打码（机构域名同样可识别身份） */
function maskEmailsIn(s: string): string {
  return s.replace(/[\p{L}\p{N}._%+-]*@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, (m) => maskText(m))
}

/** 所有发现命中的原文（以及链接显示文字），用于在其他发现的上下文中一并打码 */
export function collectSensitiveTerms(findings: readonly Finding[]): string[] {
  const set = new Set<string>()
  for (const f of findings) {
    if (f.matchInSnippet) {
      const hit = f.snippet.slice(f.matchInSnippet[0], f.matchInSnippet[1]).trim()
      if (hit.length >= 3) set.add(hit)
    }
    if (f.visibleText && f.visibleText.trim().length >= 3) set.add(f.visibleText.trim())
  }
  return [...set].sort((a, b) => b.length - a.length)
}

function sensitiveRanges(text: string, terms: readonly string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const lower = text.toLowerCase()
  for (const t of terms) {
    const needle = t.toLowerCase()
    let i = lower.indexOf(needle)
    while (i !== -1) {
      ranges.push([i, i + needle.length])
      i = lower.indexOf(needle, i + needle.length)
    }
  }
  for (const m of text.matchAll(EMAIL_OR_URL)) ranges.push([m.index, m.index + m[0].length])
  // 词级兜底：上下文窗口可能把相邻命中截断（如 “…t of Computer Science”），整词匹配不到，
  // 所以凡是出现在任一命中里的实词都打码；宁可多遮，不可漏遮
  const words = sensitiveWords(terms)
  if (words.size) {
    for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
      if (words.has(m[0].toLowerCase())) ranges.push([m.index, m.index + m[0].length])
    }
  }
  return ranges
}

const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'from', 'our', 'this', 'that', 'are', 'was', 'were', 'has', 'have', 'not', 'but', 'its', 'via', 'into'])
const wordCache = new WeakMap<readonly string[], Set<string>>()

function sensitiveWords(terms: readonly string[]): Set<string> {
  const hit = wordCache.get(terms)
  if (hit) return hit
  const set = new Set<string>()
  for (const t of terms) {
    for (const w of t.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
      if ([...w].length >= 3 && !STOPWORDS.has(w)) set.add(w)
    }
  }
  wordCache.set(terms, set)
  return set
}

/** 对 [from, to) 片段打码：与敏感区间重叠的部分逐段 maskText */
function maskPart(text: string, from: number, to: number, ranges: ReadonlyArray<[number, number]>): string {
  const marks = new Uint8Array(to - from)
  for (const [a, b] of ranges) for (let i = Math.max(a, from); i < Math.min(b, to); i++) marks[i - from] = 1
  let out = ''
  let i = from
  while (i < to) {
    let j = i
    const m = marks[i - from]
    while (j < to && marks[j - from] === m) j++
    const piece = text.slice(i, j)
    out += m ? maskText(piece) : piece
    i = j
  }
  return out
}

export function redactSnippet(f: Finding, terms: readonly string[] = []): string {
  const text = f.snippet
  const [s, e] = f.matchInSnippet ?? [0, text.length]
  const from = Math.max(0, s - CONTEXT)
  const to = Math.min(text.length, e + CONTEXT)
  const ranges = sensitiveRanges(text, terms)
  const before = maskPart(text, from, s, ranges)
  const after = maskPart(text, e, to, ranges)
  return `${from > 0 ? '…' : ''}${before}[${maskText(text.slice(s, e))}]${after}${to < text.length ? '…' : ''}`
}

export function buildReport(
  result: ScanResult,
  decisions: ReadonlyMap<string, ReviewDecision>,
  options: ReportOptions,
  now: () => Date = () => new Date(),
  extras: ReportExtras = {},
): Report {
  const statusOf = (f: Finding): ReviewStatus => decisions.get(f.id)?.status ?? 'open'
  const shown = result.findings.filter((f) => options.includeDismissed || !isDismissed(statusOf(f)))
  const redact = options.redactEvidence
  const hide = options.hideFilenames
  const terms = redact ? collectSensitiveTerms(result.findings) : []
  const scrubName = (s: string) => {
    if (!hide) return s
    let out = s
    for (const d of result.documents) if (d.displayName) out = out.split(d.displayName).join(docAlias(result, d.id, true))
    return out
  }

  const findings: ReportFinding[] = shown.map((f) => {
    const d = decisions.get(f.id)
    const pages = [...new Set(f.occurrences.map((o) => o.page).filter((p): p is number => p != null))]
    return {
      id: f.id,
      ruleIds: [...f.ruleIds],
      severity: f.severity,
      confidence: f.confidence,
      category: f.category,
      source: f.source,
      document: docAlias(result, f.documentId, hide),
      documentRole: f.documentRole,
      page: f.page,
      pages,
      zone: f.zone,
      field: f.field,
      snippet: scrubName(redact ? redactSnippet(f, terms) : f.snippet),
      linkTarget: f.linkTarget ? (redact ? maskLink(f.linkTarget) : f.linkTarget) : null,
      visibleText: f.visibleText ? (redact ? maskText(f.visibleText) : f.visibleText) : null,
      reasons: f.reasons.map((r) => scrubName(redact ? maskEmailsIn(maskUrlsIn(maskQuoted(r), keepHost)) : r)),
      suggestion: f.suggestion,
      policyRefs: f.policyRefs.map((p) => ({ label: p.label, url: p.url, note: p.note })),
      matchedUserTerm: f.matchedUserTerm,
      review: d ? { status: d.status, reason: redact ? maskQuoted(d.reason) : d.reason } : null,
    }
  })

  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, info: 0 }
  for (const f of result.findings) bySeverity[f.severity]++
  const allPages = result.documents.flatMap((d) => d.pages)

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    rulesetVersion: result.rulesetVersion,
    scanId: result.scanId,
    runId: result.runId,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    generatedAt: now().toISOString(),
    options: { ...options },
    preset: {
      id: result.preset.id,
      venue: result.preset.venue,
      track: result.preset.track,
      phase: result.preset.phase,
      version: result.preset.version,
      verifiedAt: result.preset.verifiedAt,
      verificationStatus: result.preset.verificationStatus,
      implementationStatus: result.preset.implementationStatus,
      sources: result.preset.sources.map((s) => ({ ...s })),
      limitations: [...result.preset.limitations],
    },
    documents: result.documents.map((d, i) => ({
      // 不沿用内部 ID：调用方可能用文件名作 ID
      id: `doc-${i + 1}`,
      name: docAlias(result, d.id, hide),
      role: d.role,
      pageCount: d.pageCount,
      byteSize: d.byteSize,
      parseStatus: d.parseStatus,
      warnings: d.warnings.map(scrubName),
    })).concat(
      result.source
        ? [
            {
              id: 'src',
              name: docAlias(result, 'src', hide),
              role: 'source',
              pageCount: 0,
              byteSize: result.source.byteSize,
              parseStatus: 'completed',
              warnings: result.source.warnings.map(scrubName),
            },
          ]
        : [],
    ),
    summary: {
      total: result.findings.length,
      bySeverity,
      dismissed: result.findings.filter((f) => isDismissed(statusOf(f))).length,
      resolved: result.findings.filter((f) => statusOf(f) === 'resolved').length,
      excludedFromReport: result.findings.length - shown.length,
      pagesChecked: allPages.filter((p) => p.extractionStatus === 'completed').length,
      pagesWithWeakText: allPages.filter((p) => p.textQuality !== 'ok').length,
    },
    coverage: result.coverage.map(({ documentId, ...c }) => ({
      ...c,
      reason: scrubName(c.reason),
      document: documentId ? docAlias(result, documentId, hide) : null,
    })),
    rules: result.rules.map((r) => ({ ...r })),
    userTermCount: result.userTermCount,
    findings,
    checklist: extras.checklist
      ? extras.checklist.items.map((i) => ({ id: i.id, title: i.title, checked: extras.checklist!.checked.has(i.id) }))
      : null,
    comparison: extras.comparison ? { ...extras.comparison } : null,
    disclaimer: DISCLAIMER,
  }
}

export function reportJson(report: Report): string {
  return JSON.stringify(report, null, 2)
}

/** 通用报告文件名：不含论文题名或作者名 */
export function reportFilename(report: Report, ext: 'json' | 'html'): string {
  const stamp = report.completedAt.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return `blindpreflight-report-${stamp}.${ext}`
}
