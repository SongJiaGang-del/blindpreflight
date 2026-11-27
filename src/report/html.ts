/**
 * 可打印 HTML 报告：单文件、无脚本、无外部资源；所有内容经 escapeHtml 转义。
 * 政策链接以纯文本展示，不生成可点击链接。
 */
import {
  CAPABILITY_LABEL,
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  COVERAGE_LABEL,
  REVIEW_LABEL,
  SEVERITY_LABEL,
  SOURCE_LABEL,
} from '@/domain/labels'
import { ZONE_LABEL } from '@/domain/labels'
import { type Locale, type Text, pick } from '@/domain/text'
import { escapeHtml as e } from '@/utils/safe-text'
import type { Report, ReportFinding } from './build'

const CSS = `
*{box-sizing:border-box}
body{font:13px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1c2430;margin:24px auto;max-width:900px;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #e3e7ee;padding-bottom:4px}
.muted{color:#5b6676}.small{font-size:12px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #e3e7ee;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f6f7f9;font-weight:600}
.counts{display:flex;gap:12px;margin:12px 0}.count{border:1px solid #e3e7ee;border-radius:6px;padding:8px 14px;min-width:110px}.count b{display:block;font-size:20px}
.high{color:#c0392b}.medium{color:#9a6512}.info{color:#3b6ea5}
.finding{border:1px solid #e3e7ee;border-left:4px solid #3b6ea5;border-radius:4px;padding:10px 12px;margin:10px 0;break-inside:avoid}
.finding.sev-high{border-left-color:#c0392b}.finding.sev-medium{border-left-color:#b7791f}
.finding .meta{font-size:12px;color:#5b6676}.evidence{font-family:ui-monospace,Consolas,monospace;background:#f6f7f9;padding:6px 8px;border-radius:4px;white-space:pre-wrap;word-break:break-all;margin:6px 0}
ul{margin:4px 0;padding-left:20px}.url{font-family:ui-monospace,Consolas,monospace;word-break:break-all}
.check{list-style:none;padding:0}.check li{padding:2px 0}.box{display:inline-block;width:14px;font-family:ui-monospace,Consolas,monospace}
.disclaimer{border:1px solid #e3e7ee;background:#fbfbfc;padding:10px 12px;border-radius:4px;margin-top:24px}
@media print{body{margin:0;max-width:none}.finding{page-break-inside:avoid}h2{page-break-after:avoid}}
`

type Phrase = Record<Locale, string>
const P = {
  title: { zh: 'BlindPreflight 匿名性预检报告', en: 'BlindPreflight anonymity preflight report' },
  docLevel: { zh: '文档级', en: 'document-level' },
  policy: { zh: '政策来源', en: 'Policy sources' },
  confidence: { zh: '置信度', en: 'confidence' },
  matchedTerm: { zh: ' · 匹配了你提供的词', en: ' · matched one of your terms' },
  source: { zh: '来源', en: 'source' },
  linkTarget: { zh: '真实链接目标', en: 'Real link target' },
  visible: { zh: '可见文字', en: 'visible text' },
  suggestion: { zh: '建议', en: 'Suggestion' },
  review: { zh: '复核状态', en: 'Review status' },
  main: { zh: '主稿', en: 'Main paper' },
  supplement: { zh: '补充材料', en: 'Supplement' },
  sourceArchive: { zh: '源文件包', en: 'Source archive' },
  all: { zh: '全部', en: 'All' },
  generated: { zh: '生成于', en: 'Generated' },
  scan: { zh: '扫描', en: 'scan' },
  app: { zh: '应用', en: 'app' },
  ruleset: { zh: '规则集', en: 'ruleset' },
  schema: { zh: '报告格式', en: 'report format' },
  redacted: { zh: '证据片段已脱敏。', en: 'Evidence is redacted. ' },
  notRedacted: { zh: '包含完整证据原文，请勿外传。', en: 'Contains full evidence text; do not share. ' },
  namesHidden: { zh: '文件名已隐藏。', en: 'File names are hidden. ' },
  high: { zh: '高优先级', en: 'High' },
  medium: { zh: '需核实', en: 'Check' },
  info: { zh: '提示', en: 'Info' },
  pagesChecked: { zh: '已检查页', en: 'pages checked' },
  preset: { zh: '会场预设', en: 'Venue preset' },
  presetVersion: { zh: '预设版本', en: 'preset version' },
  verification: { zh: '资料核验', en: 'verification' },
  implementation: { zh: '实现程度', en: 'implementation' },
  files: { zh: '文件', en: 'Files' },
  file: { zh: '文件', en: 'File' },
  role: { zh: '角色', en: 'Role' },
  pageCount: { zh: '页数', en: 'Pages' },
  parse: { zh: '解析', en: 'Parsing' },
  coverage: { zh: '覆盖范围与未检查项', en: 'Coverage and gaps' },
  capability: { zh: '能力', en: 'Capability' },
  status: { zh: '状态', en: 'Status' },
  note: { zh: '说明', en: 'Notes' },
  compare: { zh: '与上一版对比', en: 'Compared with the previous version' },
  presetChanged: { zh: '两次检查使用的会场预设不同。', en: 'The two checks used different venue presets.' },
  checklist: { zh: '人工核对清单', en: 'Manual checklist' },
  none: { zh: '无', en: 'None' },
} satisfies Record<string, Phrase>

function location(f: ReportFinding, loc: Locale): string {
  const parts = [e(f.document)]
  if (f.page == null) parts.push(P.docLevel[loc])
  else if (loc === 'zh') parts.push(f.pages.length > 1 ? `第 ${f.pages.map(String).join('、')} 页` : `第 ${f.page} 页`)
  else parts.push(f.pages.length > 1 ? `pages ${f.pages.map(String).join(', ')}` : `page ${f.page}`)
  if (f.zone) parts.push(e(pick(ZONE_LABEL[f.zone], loc)))
  if (f.field) parts.push(e(f.field))
  return parts.join(' · ')
}

function findingHtml(f: ReportFinding, loc: Locale): string {
  const L = (t: Text) => e(pick(t, loc))
  const paren = (s: string) => (loc === 'zh' ? `（${s}）` : ` (${s})`)
  const refs = f.policyRefs.length
    ? `<div class="small muted">${P.policy[loc]}: ${f.policyRefs.map((p) => `${e(p.label)} <span class="url">${e(p.url)}</span>${p.note ? paren(e(p.note)) : ''}`).join('; ')}</div>`
    : ''
  return `<div class="finding sev-${f.severity}">
<div><b class="${f.severity}">${L(SEVERITY_LABEL[f.severity])}</b> · ${e(f.ruleIds.join(' + '))} · ${L(CATEGORY_LABEL[f.category])} · ${P.confidence[loc]} ${L(CONFIDENCE_LABEL[f.confidence])}${f.matchedUserTerm ? P.matchedTerm[loc] : ''}</div>
<div class="meta">${location(f, loc)} · ${P.source[loc]}: ${L(SOURCE_LABEL[f.source])}</div>
<div class="evidence">${e(f.snippet)}</div>
${f.linkTarget ? `<div class="small">${P.linkTarget[loc]}: <span class="url">${e(f.linkTarget)}</span>${f.visibleText ? `; ${P.visible[loc]}: ${e(f.visibleText)}` : ''}</div>` : ''}
<ul>${f.reasons.map((r) => `<li>${e(r)}</li>`).join('')}</ul>
<div><b>${P.suggestion[loc]}:</b> ${e(f.suggestion)}</div>
${refs}
${f.review ? `<div class="small">${P.review[loc]}: ${L(REVIEW_LABEL[f.review.status])}${f.review.reason ? paren(e(f.review.reason)) : ''}</div>` : ''}
</div>`
}

export function renderReportHtml(r: Report): string {
  const loc: Locale = r.options.locale ?? 'zh'
  const zh = loc === 'zh'
  const L = (t: Text) => e(pick(t, loc))
  const s = r.summary
  const role = (x: string) => (x === 'main' ? P.main[loc] : x === 'source' ? P.sourceArchive[loc] : P.supplement[loc])
  const docs = r.documents
    .map((d) => `<tr><td>${e(d.name)}</td><td>${role(d.role)}</td><td>${d.role === 'source' ? '—' : d.pageCount}</td><td>${e(d.parseStatus)}</td></tr>`)
    .join('')
  const pagesNote = (pages?: number[]) => (pages?.length ? (zh ? `（页：${pages.join('、')}）` : ` (pages: ${pages.join(', ')})`) : '')
  const cov = r.coverage
    .map(
      (c) =>
        `<tr><td>${e(c.document ?? P.all[loc])}</td><td>${L(CAPABILITY_LABEL[c.capability])}</td><td>${L(COVERAGE_LABEL[c.status])}</td><td>${e(c.reason)}${pagesNote(c.pageNumbers)}</td></tr>`,
    )
    .join('')
  const disabled = r.rules.filter((x) => x.status === 'disabled')
  const sources = r.preset.sources.map((x) => `<li>${e(x.label)} ${x.section ? `· ${e(x.section)}` : ''}<br><span class="url">${e(x.url)}</span></li>`).join('')
  const groups: Array<[string, ReportFinding[]]> = [
    [P.high[loc], r.findings.filter((f) => f.severity === 'high')],
    [P.medium[loc], r.findings.filter((f) => f.severity === 'medium')],
    [P.info[loc], r.findings.filter((f) => f.severity === 'info')],
  ]
  const totals = zh
    ? `已标记修改 ${s.resolved} 条 · 已忽略 ${s.dismissed} 条 · 文字过少或疑似乱码的页 ${s.pagesWithWeakText} 页 · 使用自定义词 ${r.userTermCount} 个（词条本身不写入报告）`
    : `${s.resolved} marked fixed · ${s.dismissed} dismissed · ${s.pagesWithWeakText} page(s) with little or garbled text · ${r.userTermCount} custom term(s) used (the terms themselves are not in this report)`
  const excluded = r.options.includeDismissed ? '' : zh ? `已排除 ${s.excludedFromReport} 条已忽略的发现。` : `${s.excludedFromReport} dismissed finding(s) excluded.`
  const presetLine = `<b>${e(r.preset.venue)}</b> ${e(r.preset.track)} · ${e(r.preset.phase)} · ${P.presetVersion[loc]} ${e(r.preset.version)} · ${P.verification[loc]}: ${e(r.preset.verificationStatus)}${r.preset.verifiedAt ? ` (${e(r.preset.verifiedAt)})` : ''} · ${P.implementation[loc]}: ${e(r.preset.implementationStatus)}`
  const disabledLine = disabled.length
    ? `<div class="small">${zh ? '当前预设未启用的检查：' : 'Checks disabled by this preset: '}${disabled.map((x) => e(`${x.ruleId} ${x.title}`)).join(zh ? '、' : ', ')}</div>`
    : ''
  const comparison = r.comparison
    ? zh
      ? `<h2>${P.compare.zh}</h2><div>已修复 <b>${r.comparison.fixed}</b> 条 · 仍存在 <b>${r.comparison.remaining}</b> 条 · 新增 <b>${r.comparison.added}</b> 条${r.comparison.reopened ? ` · 标记为已修改但仍存在 <b class="high">${r.comparison.reopened}</b> 条` : ''}</div>`
      : `<h2>${P.compare.en}</h2><div>Fixed <b>${r.comparison.fixed}</b> · still present <b>${r.comparison.remaining}</b> · new <b>${r.comparison.added}</b>${r.comparison.reopened ? ` · marked fixed but still present <b class="high">${r.comparison.reopened}</b>` : ''}</div>`
    : ''
  const presetChanged = r.comparison?.presetChanged ? `<div class="small muted">${P.presetChanged[loc]}</div>` : ''
  const checklist = r.checklist
    ? `<h2>${P.checklist[loc]}${zh ? '（' : ' ('}${r.checklist.filter((c) => c.checked).length} / ${r.checklist.length}${zh ? '）' : ')'}</h2><ul class="check">${r.checklist.map((c) => `<li><span class="box">${c.checked ? '☑' : '☐'}</span> ${e(c.title)}</li>`).join('')}</ul>`
    : ''
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${P.title[loc]}</title><style>${CSS}</style></head><body>
<h1>${P.title[loc]}</h1>
<div class="muted small">${P.generated[loc]} ${e(r.generatedAt)} · ${P.scan[loc]} ${e(r.scanId)} · ${P.app[loc]} ${e(r.appVersion)} · ${P.ruleset[loc]} ${e(r.rulesetVersion)} · ${P.schema[loc]} ${e(r.schemaVersion)}</div>
<div class="muted small">${r.options.redactEvidence ? P.redacted[loc] : P.notRedacted[loc]}${r.options.hideFilenames ? P.namesHidden[loc] : ''}${excluded}</div>

<div class="counts">
<div class="count high"><b>${s.bySeverity.high}</b>${P.high[loc]}</div>
<div class="count medium"><b>${s.bySeverity.medium}</b>${P.medium[loc]}</div>
<div class="count info"><b>${s.bySeverity.info}</b>${P.info[loc]}</div>
<div class="count"><b>${s.pagesChecked}</b>${P.pagesChecked[loc]}</div>
</div>
<div class="small">${totals}</div>

<h2>${P.preset[loc]}</h2>
<div>${presetLine}</div>
${sources ? `<ul class="small">${sources}</ul>` : ''}
${r.preset.limitations.length ? `<ul class="small muted">${r.preset.limitations.map((l) => `<li>${e(l)}</li>`).join('')}</ul>` : ''}

<h2>${P.files[loc]}</h2>
<table><tr><th>${P.file[loc]}</th><th>${P.role[loc]}</th><th>${P.pageCount[loc]}</th><th>${P.parse[loc]}</th></tr>${docs}</table>

<h2>${P.coverage[loc]}</h2>
<table><tr><th>${P.file[loc]}</th><th>${P.capability[loc]}</th><th>${P.status[loc]}</th><th>${P.note[loc]}</th></tr>${cov}</table>
${disabledLine}

${comparison}${presetChanged}
${checklist}

${groups
  .map(([title, list]) => `<h2>${e(title)}${zh ? '（' : ' ('}${list.length}${zh ? '）' : ')'}</h2>${list.length ? list.map((f) => findingHtml(f, loc)).join('\n') : `<div class="muted">${P.none[loc]}</div>`}`)
  .join('\n')}

<div class="disclaimer small">${e(r.disclaimer)}</div>
</body></html>`
}
