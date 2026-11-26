/**
 * 规则引擎：执行规则 → 补全 Finding → 合并重复 → 排序。纯同步、无副作用、不访问网络。
 */
import type {
  CoverageEntry,
  DocumentFacts,
  Finding,
  RuleRunStatus,
  ScanOptions,
  ScanResult,
  Severity,
} from '@/domain/types'
import { RULESET_VERSION } from '@/domain/limits'
import { getPreset, policyRefsFor } from '@/presets'
import {
  CONFIDENCE_RANK,
  type FindingDraft,
  type RuleContext,
  SEVERITY_RANK,
  type DerivedName,
  materialize,
  maxConfidence,
  maxSeverity,
} from './core'
import { ruleAttachments, ruleAnnotations, ruleFilename, ruleTextResidue } from './files'
import { ruleEmail, ruleInstitution, ruleMetadata, ruleOrcidPath, ruleUserTerms } from './identity'
import { ruleArxivStamp, ruleHeaderFooter } from './layout'
import { linkTargetsMatch, ruleEmbeddedLinks, ruleUrls } from './links'
import { ruleAcknowledgments, ruleFunding, ruleImplicitIdentity, ruleSelfCitation } from './sections'
import { deriveNames } from './terms'
import { ruleFontNames, ruleImageMetadata, ruleRevisions, ruleTemplateMarker } from './binary'

type RuleFn = (doc: DocumentFacts, ctx: RuleContext) => FindingDraft[]

export interface RuleDef {
  id: string
  title: string
  description: string
  fns: RuleFn[]
}

export const RULES: RuleDef[] = [
  { id: 'R01', title: '文档元数据', description: 'Info 字典与 XMP 中的作者、标题、软件、自定义字段。', fns: [ruleMetadata] },
  { id: 'R02', title: '邮箱地址', description: '正文、分组邮箱 {a,b}@x 与 mailto 链接。', fns: [ruleEmail] },
  { id: 'R03', title: '姓名与自定义词', description: '你输入的姓名 / 机构 / 项目名，以及元数据里出现的作者名。', fns: [ruleUserTerms] },
  { id: 'R04', title: '机构名称', description: '作者区、页眉页脚、致谢中的大学 / 研究所 / 实验室。', fns: [ruleInstitution] },
  { id: 'R05', title: '致谢章节', description: '投稿版中的致谢、人名与资助信息（按会场政策）。', fns: [ruleAcknowledgments] },
  { id: 'R06', title: '资助与项目编号', description: '基金名称、项目编号与 “supported by” 措辞。', fns: [ruleFunding] },
  { id: 'R07', title: '代码 / 主页 / 云盘网址', description: 'GitHub、Hugging Face、个人主页、云盘等正文网址。', fns: [ruleUrls] },
  { id: 'R08', title: '第一人称自引', description: '“our previous work [3]”、“我们此前提出” 等。', fns: [ruleSelfCitation] },
  { id: 'R09', title: '隐式单位暗示', description: '“our lab / 本校” 等暗示作者单位的措辞。', fns: [ruleImplicitIdentity] },
  { id: 'R10', title: '内嵌超链接', description: '链接注释的真实目标与可见文字不一致、或指向可识别作者的站点。', fns: [ruleEmbeddedLinks] },
  { id: 'R11', title: '页眉页脚与版本戳', description: '跨页重复的页眉页脚、预印本 / 终稿声明、arXiv 侧边戳。', fns: [ruleHeaderFooter, ruleArxivStamp] },
  { id: 'R12', title: '文件名', description: '上传文件名里的姓名或 final / camera-ready 字样。', fns: [ruleFilename] },
  { id: 'R13', title: '批注与编辑残留', description: '批注作者 / 内容、表单域值、TODO / 待修改。', fns: [ruleAnnotations, ruleTextResidue] },
  { id: 'R15', title: 'ORCID 与本地路径', description: 'ORCID iD、C:\\Users\\name 等本机路径。', fns: [ruleOrcidPath] },
  { id: 'R17', title: '嵌入附件', description: 'PDF 内嵌文件（只检查文件名与描述）。', fns: [ruleAttachments] },
  { id: 'R18', title: '图片元数据', description: '嵌入图片的 EXIF / IPTC / XMP：作者、版权、设备序列号、GPS 位置、描述文字。', fns: [ruleImageMetadata] },
  { id: 'R19', title: '字体名', description: '页面字体名中的作者名、自定义词或机构词。', fns: [ruleFontNames] },
  { id: 'R20', title: '增量保存的旧版本', description: '文件中残留的旧版本元数据（如改稿前的作者名）与保存版本数。', fns: [ruleRevisions] },
  { id: 'R21', title: '会场模板标记', description: '审稿模式模板应印出的标记（如 CVPR 的 Submission # 与 CONFIDENTIAL REVIEW COPY）。', fns: [ruleTemplateMarker] },
]

export function ruleTitle(id: string): string {
  return RULES.find((r) => r.id === id)?.title ?? id
}

function span(f: Finding): [number, number] | null {
  const o = f.occurrences[0]
  return o?.start != null && o.end != null ? [o.start, o.end] : null
}

/** 页眉页脚聚合项（R11）吸收落在其某一处出现范围内的单点命中 */
function containedIn(host: Finding, f: Finding): boolean {
  if (host.ruleId !== 'R11' || host.documentId !== f.documentId || f.source !== 'text' || f.occurrences.length > 1) return false
  const s = span(f)
  if (!s) return false
  return host.occurrences.some((o) => o.page === f.page && o.start != null && o.end != null && o.start <= s[0] && s[1] <= o.end)
}

/** 两个文本命中重叠超过较长者的一半 → 视为同一处 */
function sameSpot(a: Finding, b: Finding): boolean {
  if (a.documentId !== b.documentId || a.page !== b.page || a.source !== 'text' || b.source !== 'text') return false
  if (a.occurrences.length > 1 || b.occurrences.length > 1) return false
  const sa = span(a)
  const sb = span(b)
  if (!sa || !sb) return false
  const overlap = Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0])
  const longer = Math.max(sa[1] - sa[0], sb[1] - sb[0])
  return overlap > 0 && overlap * 2 >= longer
}

function absorb(into: Finding, other: Finding): void {
  into.severity = maxSeverity(into.severity, other.severity)
  into.confidence = maxConfidence(into.confidence, other.confidence)
  for (const id of other.ruleIds) if (!into.ruleIds.includes(id)) into.ruleIds.push(id)
  for (const r of other.reasons) if (!into.reasons.includes(r)) into.reasons.push(r)
  into.linkTarget ??= other.linkTarget
  into.visibleText ??= other.visibleText
  into.matchedUserTerm ||= other.matchedUserTerm
  for (const p of other.policyRefs) if (!into.policyRefs.some((q) => q.url === p.url)) into.policyRefs.push(p)
}

function better(a: Finding, b: Finding): boolean {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
    (span(a) ? 1 : 0) - (span(b) ? 1 : 0)
  ) >= 0
}

export function mergeFindings(findings: Finding[]): Finding[] {
  // 1) R10 链接注释并入同页同目标的 R07 文本命中
  const out: Finding[] = []
  const links = findings.filter((f) => f.ruleId === 'R10')
  const rest = findings.filter((f) => f.ruleId !== 'R10')
  for (const l of links) {
    const host = rest.find(
      (f) => f.ruleId === 'R07' && f.documentId === l.documentId && f.page === l.page && linkTargetsMatch(f.linkTarget, l.linkTarget),
    )
    if (host) {
      absorb(host, l)
      host.visibleText = l.visibleText
      host.linkTarget = l.linkTarget
    } else out.push(l)
  }
  // 2) 不同规则命中同一段文字
  const kept: Finding[] = []
  for (const f of [...rest].sort((a, b) => (better(a, b) ? -1 : 1))) {
    const twin = kept.find((k) => sameSpot(k, f) || containedIn(k, f))
    if (twin) absorb(twin, f)
    else kept.push(f)
  }
  return [...kept, ...out]
}

export function sortFindings(findings: Finding[], docOrder: string[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      docOrder.indexOf(a.documentId) - docOrder.indexOf(b.documentId) ||
      (a.page ?? 0) - (b.page ?? 0) ||
      (span(a)?.[0] ?? -1) - (span(b)?.[0] ?? -1) ||
      a.id.localeCompare(b.id),
  )
}

function applyOverride(severity: Severity, override: Severity | undefined): Severity {
  // 覆盖只作用于有实际信号的命中；info 级提示保持不变
  if (!override || severity === 'info') return severity
  return override
}

export interface RunMeta {
  runId?: number
  scanId?: string
  now?: () => Date
}

function newScanId(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `scan-${Date.now().toString(36)}`
}

/** 合并本次派生的作者名与会话中较早得到的作者名（后者标注为“上一版”） */
function mergeKnownNames(current: DerivedName[], known: NonNullable<ScanOptions['knownNames']>): DerivedName[] {
  const seen = new Set(current.map((n) => n.raw.toLowerCase()))
  const out = [...current]
  for (const n of known) {
    if (seen.has(n.raw.toLowerCase())) continue
    seen.add(n.raw.toLowerCase())
    out.push({ raw: n.raw, tokens: [...n.tokens], source: n.source.startsWith('上一版') ? n.source : `上一版 ${n.source}` })
  }
  return out
}

export function runScan(documents: DocumentFacts[], options: ScanOptions, meta: RunMeta = {}): ScanResult {
  const now = meta.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const preset = getPreset(options.presetId)
  const ctx: RuleContext = {
    preset,
    userTerms: options.userTerms,
    strictShortTerms: options.strictShortTerms,
    derivedNames: mergeKnownNames(deriveNames(documents), options.knownNames ?? []),
    allDocs: documents,
  }
  const all: Finding[] = []
  const rules: RuleRunStatus[] = []
  for (const rule of RULES) {
    if (preset.disabledRuleIds.includes(rule.id)) {
      rules.push({ ruleId: rule.id, title: rule.title, status: 'disabled', findingCount: 0 })
      continue
    }
    const refs = policyRefsFor(preset, rule.id)
    let count = 0
    for (const doc of documents) {
      for (const fn of rule.fns) {
        for (const draft of fn(doc, ctx)) {
          const f = materialize(doc, draft, refs, RULESET_VERSION)
          f.severity = applyOverride(f.severity, preset.severityOverrides[rule.id])
          all.push(f)
          count++
        }
      }
    }
    rules.push({ ruleId: rule.id, title: rule.title, status: 'ran', findingCount: count })
  }
  // 稳定 ID 去重（同一规则在不同视图重复产出）
  const byId = new Map<string, Finding>()
  for (const f of all) {
    const prev = byId.get(f.id)
    if (prev) absorb(prev, f)
    else byId.set(f.id, f)
  }
  const merged = mergeFindings([...byId.values()])
  const findings = sortFindings(merged, documents.map((d) => d.id))
  // 规则命中计数按合并后的结果重算
  for (const r of rules) if (r.status === 'ran') r.findingCount = findings.filter((f) => f.ruleIds.includes(r.ruleId)).length

  const coverage: CoverageEntry[] = documents.flatMap((d) => d.coverage)
  coverage.push({
    documentId: null,
    capability: 'images',
    status: 'unsupported',
    reason: '不识别图片、扫描页与图表中的文字（无 OCR）。',
  })
  coverage.push({
    documentId: null,
    capability: 'supplements',
    status: documents.some((d) => d.role === 'supplement') ? 'completed' : 'skipped',
    reason: documents.some((d) => d.role === 'supplement')
      ? `已检查 ${documents.filter((d) => d.role === 'supplement').length} 份补充材料 PDF。`
      : '没有导入补充材料；补充材料同样需要匿名。',
  })

  return {
    scanId: meta.scanId ?? newScanId(),
    runId: meta.runId ?? 1,
    startedAt,
    completedAt: now().toISOString(),
    preset,
    rulesetVersion: RULESET_VERSION,
    documents,
    findings,
    coverage,
    rules,
    userTermCount: options.userTerms.length,
  }
}
