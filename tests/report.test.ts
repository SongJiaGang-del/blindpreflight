import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ReviewDecision, ScanResult } from '@/domain/types'
import { runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import type { ExtractResult } from '@/parsers/pdf/extract'
import { DEFAULT_REPORT_OPTIONS, buildReport, reportFilename, reportJson, type Report } from '@/report/build'
import { renderReportHtml } from '@/report/html'
import { extractSample } from './helpers/node-pdf'

let leaky: ExtractResult
let supp: ExtractResult
let result: ScanResult

/** 示例稿件里的全部虚构身份信息：脱敏报告中一个都不应出现 */
const IDENTITY = [
  /Alex\b/i,
  /Blair/i,
  /aexample/i,
  /example-lab/i,
  /Institute of Technology/i,
  /Computer Science/i,
  /example\.edu/i,
  /alex\.example/i,
  /notes-alex/i,
]
const SECRET_TERM = 'QuasarTermZeta'
const NOW = () => new Date('2026-11-26T00:00:00Z')

beforeAll(async () => {
  leaky = await extractSample('sample-leaky.pdf')
  supp = await extractSample('sample-supplement.pdf', 'supplement')
  result = runScan(
    [leaky.facts, supp.facts],
    { presetId: 'generic', userTerms: parseUserTerms(`Widget Alignment\n${SECRET_TERM}`), strictShortTerms: false },
    { scanId: 'report-test', now: NOW },
  )
})

afterAll(async () => {
  for (const r of [leaky, supp]) await r?.pdf.loadingTask.destroy()
})

const build = (opts = DEFAULT_REPORT_OPTIONS, decisions = new Map<string, ReviewDecision>()) =>
  buildReport(result, decisions, opts, NOW)

/** 报告里所有用户可见的字符串（不含政策引用与免责声明这类固定文案） */
function evidenceStrings(r: Report): string[] {
  return r.findings.flatMap((f) => [f.snippet, f.linkTarget ?? '', f.visibleText ?? '', ...f.reasons, f.review?.reason ?? ''])
}

describe('默认导出（脱敏 + 隐藏文件名）', () => {
  test('默认选项为脱敏、隐藏文件名', () => {
    expect(DEFAULT_REPORT_OPTIONS.redactEvidence).toBe(true)
    expect(DEFAULT_REPORT_OPTIONS.hideFilenames).toBe(true)
  })

  test('证据、原因、链接目标中不含任何身份信息（包括相邻发现的上下文）', () => {
    const r = build()
    expect(r.findings.length).toBeGreaterThan(10)
    const leaks = evidenceStrings(r).filter((s) => IDENTITY.some((re) => re.test(s)))
    expect(leaks).toEqual([])
  })

  test('整份 JSON 与 HTML 都不含身份信息', () => {
    const r = build()
    for (const out of [reportJson(r), renderReportHtml(r)]) {
      for (const re of IDENTITY) expect(out, String(re)).not.toMatch(re)
    }
  })

  test('机构 / 个人主页的主机名打码，公共平台保留', () => {
    const r = build()
    const targets = r.findings.map((f) => f.linkTarget).filter((t): t is string => !!t)
    expect(targets.some((t) => t.startsWith('https://github.com/'))).toBe(true)
    expect(targets.filter((t) => /example\.edu/i.test(t))).toEqual([])
  })

  test('文件名替换为 主稿 / 补充材料 n', () => {
    const r = build()
    expect(r.documents.map((d) => d.name)).toEqual(['主稿', '补充材料 1'])
    expect(new Set(r.findings.map((f) => f.document))).toEqual(new Set(['主稿', '补充材料 1']))
    const json = reportJson(r)
    expect(json).not.toContain('sample-leaky')
    expect(json).not.toContain('sample-supplement')
  })

  test('报告文件名不含论文信息', () => {
    const r = build()
    expect(reportFilename(r, 'html')).toMatch(/^blindpreflight-report-\d{8}-\d{6}\.html$/)
    expect(reportFilename(r, 'json')).toMatch(/^blindpreflight-report-\d{8}-\d{6}\.json$/)
  })
})

describe('报告不携带稿件本身', () => {
  test('不含 PDF 字节、整页文字或自定义词清单', () => {
    for (const opts of [DEFAULT_REPORT_OPTIONS, { redactEvidence: false, hideFilenames: false, includeDismissed: true, locale: 'zh' as const }]) {
      const r = build(opts)
      const json = reportJson(r)
      expect(json).not.toContain('%PDF')
      expect(json).not.toContain(SECRET_TERM)
      // 每一页的整页文字都不应原样出现（证据只截取命中附近）
      for (const p of leaky.facts.pages) {
        const pageText = p.text.replace(/\s+/g, ' ').trim()
        if (pageText.length > 300) expect(json.replace(/\s+/g, ' ')).not.toContain(pageText.slice(0, 300))
      }
      const keys = new Set<string>()
      JSON.parse(json, (k, v) => {
        keys.add(k)
        return v
      })
      for (const k of ['bytes', 'text', 'items', 'lines', 'views', 'userTerms', 'terms']) expect(keys.has(k), k).toBe(false)
      expect(r.userTermCount).toBe(2)
    }
  })

  test('关闭脱敏时才出现原文', () => {
    const r = build({ redactEvidence: false, hideFilenames: false, includeDismissed: true, locale: 'zh' as const })
    expect(reportJson(r)).toMatch(/Alex Example/)
    expect(r.documents[0]?.name).toBe('sample-leaky.pdf')
  })
})

describe('复核决定', () => {
  test('排除已忽略的发现时总数保留，复核理由脱敏', () => {
    const [a, b] = result.findings
    const decisions = new Map<string, ReviewDecision>([
      [a!.id, { findingId: a!.id, status: 'dismissed-third-party', reason: '这是「Alex Example」的公开库', createdAt: NOW().toISOString() }],
      [b!.id, { findingId: b!.id, status: 'resolved', reason: '', createdAt: NOW().toISOString() }],
    ])
    const r = build({ ...DEFAULT_REPORT_OPTIONS, includeDismissed: false }, decisions)
    expect(r.summary.total).toBe(result.findings.length)
    expect(r.summary.excludedFromReport).toBe(1)
    expect(r.summary.resolved).toBe(1)
    expect(r.findings.find((f) => f.id === a!.id)).toBeUndefined()
    const withDismissed = build(DEFAULT_REPORT_OPTIONS, decisions)
    const reason = withDismissed.findings.find((f) => f.id === a!.id)?.review?.reason ?? ''
    expect(reason).not.toMatch(/Alex/)
  })
})

describe('HTML 报告转义', () => {
  function hostile(): Report {
    const r = build({ redactEvidence: false, hideFilenames: false, includeDismissed: true, locale: 'zh' as const })
    const f = r.findings[0]!
    f.snippet = '</script><script>alert(1)</script><img src=x onerror=alert(2)>'
    f.reasons = ['"quoted" \'single\' `tick` & <b>bold</b>']
    f.visibleText = 'evil‮txt.exe'
    f.linkTarget = 'javascript:alert(3)'
    r.documents[0]!.name = '<iframe src="https://example.invalid/">.pdf'
    return r
  }

  test('不生成任何脚本、标签或可点击链接', () => {
    const html = renderReportHtml(hostile())
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<img/i)
    expect(html).not.toMatch(/<iframe/i)
    expect(html).not.toMatch(/<a\s/i)
    expect(html).not.toMatch(/<[^>]*\son\w+=/i)
    expect(html).not.toMatch(/href=/i)
  })

  test('特殊字符被转义，双向控制字符可视化', () => {
    const html = renderReportHtml(hostile())
    expect(html).toContain('&lt;/script&gt;')
    expect(html).toContain('&quot;quoted&quot;')
    expect(html).toContain('&#39;single&#39;')
    expect(html).toContain('&#96;tick&#96;')
    expect(html).toContain('&amp; &lt;b&gt;bold&lt;/b&gt;')
    expect(html).toContain('⟨U+202E⟩')
    expect(html).not.toContain('‮')
  })

  test('带有禁止外部资源的 CSP 与 no-referrer', () => {
    const html = renderReportHtml(build())
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`)
    expect(html).toContain('<meta name="referrer" content="no-referrer">')
  })
})
