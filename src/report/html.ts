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
import { ZONE_LABEL } from '@/rules/core'
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

function location(f: ReportFinding): string {
  const parts = [e(f.document)]
  if (f.page == null) parts.push('文档级')
  else parts.push(f.pages.length > 1 ? `第 ${f.pages.map(String).join('、')} 页` : `第 ${f.page} 页`)
  if (f.zone) parts.push(e(ZONE_LABEL[f.zone]))
  if (f.field) parts.push(e(f.field))
  return parts.join(' · ')
}

function findingHtml(f: ReportFinding): string {
  const refs = f.policyRefs.length
    ? `<div class="small muted">政策来源：${f.policyRefs.map((p) => `${e(p.label)} <span class="url">${e(p.url)}</span>${p.note ? `（${e(p.note)}）` : ''}`).join('；')}</div>`
    : ''
  return `<div class="finding sev-${f.severity}">
<div><b class="${f.severity}">${e(SEVERITY_LABEL[f.severity])}</b> · ${e(f.ruleIds.join(' + '))} · ${e(CATEGORY_LABEL[f.category])} · 置信度 ${e(CONFIDENCE_LABEL[f.confidence])}${f.matchedUserTerm ? ' · 匹配了你提供的词' : ''}</div>
<div class="meta">${location(f)} · 来源：${e(SOURCE_LABEL[f.source])}</div>
<div class="evidence">${e(f.snippet)}</div>
${f.linkTarget ? `<div class="small">真实链接目标：<span class="url">${e(f.linkTarget)}</span>${f.visibleText ? `；可见文字：${e(f.visibleText)}` : ''}</div>` : ''}
<ul>${f.reasons.map((r) => `<li>${e(r)}</li>`).join('')}</ul>
<div><b>建议：</b>${e(f.suggestion)}</div>
${refs}
${f.review ? `<div class="small">复核状态：${e(REVIEW_LABEL[f.review.status])}${f.review.reason ? `（${e(f.review.reason)}）` : ''}</div>` : ''}
</div>`
}

export function renderReportHtml(r: Report): string {
  const s = r.summary
  const docs = r.documents
    .map((d) => `<tr><td>${e(d.name)}</td><td>${d.role === 'main' ? '主稿' : '补充材料'}</td><td>${d.pageCount}</td><td>${e(d.parseStatus)}</td></tr>`)
    .join('')
  const cov = r.coverage
    .map(
      (c) =>
        `<tr><td>${e(c.document ?? '全部')}</td><td>${e(CAPABILITY_LABEL[c.capability])}</td><td>${e(COVERAGE_LABEL[c.status])}</td><td>${e(c.reason)}${c.pageNumbers?.length ? `（页：${c.pageNumbers.join('、')}）` : ''}</td></tr>`,
    )
    .join('')
  const disabled = r.rules.filter((x) => x.status === 'disabled')
  const sources = r.preset.sources.map((x) => `<li>${e(x.label)} ${x.section ? `· ${e(x.section)}` : ''}<br><span class="url">${e(x.url)}</span></li>`).join('')
  const groups: Array<[string, ReportFinding[]]> = [
    ['高优先级', r.findings.filter((f) => f.severity === 'high')],
    ['需核实', r.findings.filter((f) => f.severity === 'medium')],
    ['提示', r.findings.filter((f) => f.severity === 'info')],
  ]
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>BlindPreflight 匿名性预检报告</title><style>${CSS}</style></head><body>
<h1>BlindPreflight 匿名性预检报告</h1>
<div class="muted small">生成于 ${e(r.generatedAt)} · 扫描 ${e(r.scanId)} · 应用 ${e(r.appVersion)} · 规则集 ${e(r.rulesetVersion)} · 报告格式 ${e(r.schemaVersion)}</div>
<div class="muted small">${r.options.redactEvidence ? '证据片段已脱敏。' : '包含完整证据原文，请勿外传。'}${r.options.hideFilenames ? '文件名已隐藏。' : ''}${r.options.includeDismissed ? '' : `已排除 ${s.excludedFromReport} 条已忽略的发现。`}</div>

<div class="counts">
<div class="count high"><b>${s.bySeverity.high}</b>高优先级</div>
<div class="count medium"><b>${s.bySeverity.medium}</b>需核实</div>
<div class="count info"><b>${s.bySeverity.info}</b>提示</div>
<div class="count"><b>${s.pagesChecked}</b>已检查页</div>
</div>
<div class="small">已标记修改 ${s.resolved} 条 · 已忽略 ${s.dismissed} 条 · 文字过少或疑似乱码的页 ${s.pagesWithWeakText} 页 · 使用自定义词 ${r.userTermCount} 个（词条本身不写入报告）</div>

<h2>会场预设</h2>
<div><b>${e(r.preset.venue)}</b> ${e(r.preset.track)} · ${e(r.preset.phase)} · 预设版本 ${e(r.preset.version)} · 资料核验：${e(r.preset.verificationStatus)}${r.preset.verifiedAt ? `（${e(r.preset.verifiedAt)}）` : ''} · 实现程度：${e(r.preset.implementationStatus)}</div>
${sources ? `<ul class="small">${sources}</ul>` : ''}
${r.preset.limitations.length ? `<ul class="small muted">${r.preset.limitations.map((l) => `<li>${e(l)}</li>`).join('')}</ul>` : ''}

<h2>文件</h2>
<table><tr><th>文件</th><th>角色</th><th>页数</th><th>解析</th></tr>${docs}</table>

<h2>覆盖范围与未检查项</h2>
<table><tr><th>文件</th><th>能力</th><th>状态</th><th>说明</th></tr>${cov}</table>
${disabled.length ? `<div class="small">当前预设未启用的检查：${disabled.map((x) => e(`${x.ruleId} ${x.title}`)).join('、')}</div>` : ''}

${
  r.comparison
    ? `<h2>与上一版对比</h2><div>已修复 <b>${r.comparison.fixed}</b> 条 · 仍存在 <b>${r.comparison.remaining}</b> 条 · 新增 <b>${r.comparison.added}</b> 条${r.comparison.reopened ? ` · 标记为已修改但仍存在 <b class="high">${r.comparison.reopened}</b> 条` : ''}</div>${r.comparison.presetChanged ? '<div class="small muted">两次检查使用的会场预设不同。</div>' : ''}`
    : ''
}
${
  r.checklist
    ? `<h2>人工核对清单（${r.checklist.filter((c) => c.checked).length} / ${r.checklist.length}）</h2><ul class="check">${r.checklist.map((c) => `<li><span class="box">${c.checked ? '☑' : '☐'}</span> ${e(c.title)}</li>`).join('')}</ul>`
    : ''
}

${groups
  .map(([title, list]) => `<h2>${e(title)}（${list.length}）</h2>${list.length ? list.map(findingHtml).join('\n') : '<div class="muted">无</div>'}`)
  .join('\n')}

<div class="disclaimer small">${e(r.disclaimer)}</div>
</body></html>`
}
