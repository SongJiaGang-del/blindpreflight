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
  SourceFacts,
} from '@/domain/types'
import { L, same, type Text, join } from '@/domain/text'
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
import { SOURCE_RULE_FNS } from './source'

type RuleFn = (doc: DocumentFacts, ctx: RuleContext) => FindingDraft[]

export interface RuleDef {
  id: string
  title: Text
  description: Text
  fns: RuleFn[]
}

export const RULES: RuleDef[] = [
  {
    id: 'R01',
    title: L('文档元数据', 'Document metadata'),
    description: L('Info 字典与 XMP 中的作者、标题、软件、自定义字段。', 'Author, title, producer and custom fields in the Info dictionary and XMP.'),
    fns: [ruleMetadata],
  },
  {
    id: 'R02',
    title: L('邮箱地址', 'Email addresses'),
    description: L('正文、分组邮箱 {a,b}@x 与 mailto 链接。', 'Emails in the text, grouped {a,b}@x addresses and mailto links.'),
    fns: [ruleEmail],
  },
  {
    id: 'R03',
    title: L('姓名与自定义词', 'Names and custom terms'),
    description: L('你输入的姓名 / 机构 / 项目名，以及元数据里出现的作者名。', 'Names / institutions / project names you entered, plus author names found in metadata.'),
    fns: [ruleUserTerms],
  },
  {
    id: 'R04',
    title: L('机构名称', 'Institution names'),
    description: L('作者区、页眉页脚、致谢中的大学 / 研究所 / 实验室。', 'Universities / institutes / labs in the author block, headers, footers and acknowledgments.'),
    fns: [ruleInstitution],
  },
  {
    id: 'R05',
    title: L('致谢章节', 'Acknowledgments'),
    description: L('投稿版中的致谢、人名与资助信息（按会场政策）。', 'Acknowledgments, names and funding in the submission (per venue policy).'),
    fns: [ruleAcknowledgments],
  },
  {
    id: 'R06',
    title: L('资助与项目编号', 'Funding and grant numbers'),
    description: L('基金名称、项目编号与 “supported by” 措辞。', 'Funding agencies, grant numbers and “supported by” wording.'),
    fns: [ruleFunding],
  },
  {
    id: 'R07',
    title: L('代码 / 主页 / 云盘网址', 'Code / homepage / cloud URLs'),
    description: L('GitHub、Hugging Face、个人主页、云盘等正文网址。', 'GitHub, Hugging Face, personal homepages, cloud drives and other URLs in the text.'),
    fns: [ruleUrls],
  },
  {
    id: 'R08',
    title: L('第一人称自引', 'First-person self-citation'),
    description: L('“our previous work [3]”、“我们此前提出” 等。', '“our previous work [3]”, “we previously proposed”, etc.'),
    fns: [ruleSelfCitation],
  },
  {
    id: 'R09',
    title: L('隐式单位暗示', 'Implicit affiliation hints'),
    description: L('“our lab / 本校” 等暗示作者单位的措辞。', 'Wording such as “our lab / our university” that hints at the affiliation.'),
    fns: [ruleImplicitIdentity],
  },
  {
    id: 'R10',
    title: L('内嵌超链接', 'Embedded hyperlinks'),
    description: L('链接注释的真实目标与可见文字不一致、或指向可识别作者的站点。', 'Link annotations whose target differs from the visible text or points to identifying sites.'),
    fns: [ruleEmbeddedLinks],
  },
  {
    id: 'R11',
    title: L('页眉页脚与版本戳', 'Headers, footers and stamps'),
    description: L('跨页重复的页眉页脚、预印本 / 终稿声明、arXiv 侧边戳。', 'Repeated headers / footers, preprint / camera-ready notices and arXiv side stamps.'),
    fns: [ruleHeaderFooter, ruleArxivStamp],
  },
  {
    id: 'R12',
    title: L('文件名', 'File names'),
    description: L('上传文件名里的姓名或 final / camera-ready 字样。', 'Names or final / camera-ready in the uploaded file name.'),
    fns: [ruleFilename],
  },
  {
    id: 'R13',
    title: L('批注与编辑残留', 'Annotations and editing residue'),
    description: L('批注作者 / 内容、表单域值、TODO / 待修改。', 'Annotation authors / contents, form field values, TODOs.'),
    fns: [ruleAnnotations, ruleTextResidue],
  },
  {
    id: 'R15',
    title: L('ORCID 与本地路径', 'ORCID and local paths'),
    description: L('ORCID iD、C:\\Users\\name 等本机路径。', 'ORCID iDs and local paths such as C:\\Users\\name.'),
    fns: [ruleOrcidPath],
  },
  {
    id: 'R17',
    title: L('嵌入附件', 'Embedded attachments'),
    description: L('PDF 内嵌文件（只检查文件名与描述）。', 'Files embedded in the PDF (only names and descriptions are checked).'),
    fns: [ruleAttachments],
  },
  {
    id: 'R18',
    title: L('图片元数据', 'Image metadata'),
    description: L('嵌入图片的 EXIF / IPTC / XMP：作者、版权、设备序列号、GPS 位置、描述文字。', 'EXIF / IPTC / XMP of embedded images: author, copyright, serial numbers, GPS, descriptions.'),
    fns: [ruleImageMetadata],
  },
  {
    id: 'R19',
    title: L('字体名', 'Font names'),
    description: L('页面字体名中的作者名、自定义词或机构词。', 'Author names, custom terms or institution words in font names.'),
    fns: [ruleFontNames],
  },
  {
    id: 'R20',
    title: L('增量保存的旧版本', 'Earlier saved revisions'),
    description: L('文件中残留的旧版本元数据（如改稿前的作者名）与保存版本数。', 'Metadata left in earlier revisions (e.g. author names before editing) and the revision count.'),
    fns: [ruleRevisions],
  },
  {
    id: 'R21',
    title: L('会场模板标记', 'Venue template marker'),
    description: L(
      '审稿模式模板应印出的标记（如 CVPR 的 Submission # 与 CONFIDENTIAL REVIEW COPY）。',
      'The marker a review-mode template prints (e.g. CVPR’s Submission # and CONFIDENTIAL REVIEW COPY).',
    ),
    fns: [ruleTemplateMarker],
  },
  {
    id: 'R22',
    title: L('源码作者信息', 'Source author info'),
    description: L(String.raw`源文件包：\author、\thanks、\affiliation、pdfauthor 与终稿开关。`, String.raw`Source archive: \author, \thanks, \affiliation, pdfauthor and camera-ready switches.`),
    fns: [],
  },
  {
    id: 'R23',
    title: L('源码注释与隐藏内容', 'Source comments and hidden content'),
    description: L(
      String.raw`源文件包：LaTeX 注释、\iffalse 块，以及代码 / 说明文件中的姓名、邮箱、路径、版权人。`,
      String.raw`Source archive: LaTeX comments, \iffalse blocks, and names, emails, paths and copyright holders in code / docs.`,
    ),
    fns: [],
  },
  {
    id: 'R24',
    title: L('版本库与构建残留', 'VCS and build leftovers'),
    description: L('源文件包：.git 目录、编译日志 / synctex 中的本机路径、临时文件。', 'Source archive: .git directories, local paths in build logs / synctex, temp files.'),
    fns: [],
  },
  {
    id: 'R25',
    title: L('包内文件元数据', 'Archive file metadata'),
    description: L('源文件包：图片 EXIF / PNG 文本、Office 文档属性、含姓名的文件名。', 'Source archive: image EXIF / PNG text, Office properties, file names with names.'),
    fns: [],
  },
]

export function ruleTitle(id: string): Text {
  return RULES.find((r) => r.id === id)?.title ?? same(id)
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
    const earlier = n.source.zh.startsWith('上一版')
    out.push({
      raw: n.raw,
      tokens: [...n.tokens],
      source: earlier ? n.source : L(`上一版 ${n.source.zh}`, `earlier version: ${n.source.en}`),
    })
  }
  return out
}

/** 源文件包在发现里以 “src” 文档出现；规则构造只用到 id / 名称 / 角色 */
function sourceDoc(src: SourceFacts): DocumentFacts {
  return { id: 'src', role: 'source', displayName: src.name, byteSize: src.byteSize, pageCount: 0, parseStatus: 'completed', info: {}, xmp: null, pages: [], attachments: [], internalLinkCount: 0, coverage: [], warnings: [] }
}

export function runScan(documents: DocumentFacts[], options: ScanOptions, meta: RunMeta = {}): ScanResult {
  const now = meta.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const preset = getPreset(options.presetId)
  const ctx: RuleContext = {
    preset,
    userTerms: options.userTerms,
    strictShortTerms: options.strictShortTerms,
    derivedNames: mergeKnownNames(deriveNames(documents), [
      ...(options.knownNames ?? []),
      ...(options.source?.authorNames ?? []).map((raw) => ({
        raw,
        tokens: [...raw].every((c) => /\p{Script=Han}/u.test(c)) ? [raw] : raw.toLowerCase().split(/\s+/).filter((t) => t.length >= 2),
        source: L(String.raw`源文件的 \author`, String.raw`\author in the source`),
      })),
    ]),
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
    const srcFn = SOURCE_RULE_FNS[rule.id]
    if (srcFn && options.source) {
      for (const draft of srcFn(options.source, ctx)) {
        const f = materialize(sourceDoc(options.source), draft, refs, RULESET_VERSION)
        f.severity = applyOverride(f.severity, preset.severityOverrides[rule.id])
        all.push(f)
        count++
      }
    }
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
  const findings = sortFindings(merged, [...documents.map((d) => d.id), 'src'])
  // 规则命中计数按合并后的结果重算
  for (const r of rules) if (r.status === 'ran') r.findingCount = findings.filter((f) => f.ruleIds.includes(r.ruleId)).length

  const coverage: CoverageEntry[] = documents.flatMap((d) => d.coverage)
  const ocrPages = documents.reduce((n, d) => n + d.pages.filter((p) => p.ocr).length, 0)
  coverage.push({
    documentId: null,
    capability: 'images',
    status: ocrPages ? 'partial' : 'unsupported',
    reason: ocrPages
      ? L(
          `已对 ${ocrPages} 页扫描 / 图片页做本地 OCR；文字正常的页面里的插图、图表与截图中的文字没有识别。`,
          `Local OCR ran on ${ocrPages} scanned / image page(s); text inside figures, charts and screenshots on normal pages was not read.`,
        )
      : L(
          '没有做 OCR：图片、扫描页与图表中的文字没有检查。可以在“放入稿件”中开启本地 OCR。',
          'No OCR: text in images, scanned pages and charts was not checked. Local OCR can be turned on under “Add your paper”.',
        ),
  })
  const src = options.source
  coverage.push({
    documentId: null,
    capability: 'sourceFiles',
    status: src ? (src.warnings.length ? 'partial' : 'completed') : 'skipped',
    reason: src
      ? join([
          L(
            `已检查源文件包中的 ${src.texts.length} 个文本文件与 ${src.meta.length} 个带元数据的图片 / 文档（共 ${src.files.length} 个文件）。`,
            `Checked ${src.texts.length} text file(s) and ${src.meta.length} image / document(s) with metadata in the source archive (${src.files.length} files in total).`,
          ),
          ...src.warnings.map((w) => join([same(' '), w])),
        ])
      : L(
          '没有导入源文件包（LaTeX / zip）。若要公开源码或随补充材料提交代码，建议一并检查。',
          'No source archive (LaTeX / zip) was added. If you will publish the source or ship code as a supplement, check it too.',
        ),
  })
  coverage.push({
    documentId: null,
    capability: 'supplements',
    status: documents.some((d) => d.role === 'supplement') ? 'completed' : 'skipped',
    reason: documents.some((d) => d.role === 'supplement')
      ? L(`已检查 ${documents.filter((d) => d.role === 'supplement').length} 份补充材料 PDF。`, `Checked ${documents.filter((d) => d.role === 'supplement').length} supplementary PDF(s).`)
      : L('没有导入补充材料；补充材料同样需要匿名。', 'No supplementary material was added; supplements must be anonymous too.'),
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
    source: src ? { name: src.name, byteSize: src.byteSize, fileCount: src.files.length, textCount: src.texts.length, warnings: [...src.warnings] } : null,
  }
}
