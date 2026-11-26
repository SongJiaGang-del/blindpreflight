import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Finding, ReviewDecision, ScanResult } from '@/domain/types'
import { runScan } from '@/rules/engine'
import { deriveNames, parseUserTerms } from '@/rules/terms'
import type { ExtractResult } from '@/parsers/pdf/extract'
import { compareScans, compareTags, matchKey, migrateDecisions } from '@/app/compare'
import { checklistFor } from '@/app/checklist'
import { buildReport, DEFAULT_REPORT_OPTIONS } from '@/report/build'
import { renderReportHtml } from '@/report/html'
import { sanitizePdf } from '@/clean/sanitize'
import { extractBytes, sampleBytes } from './helpers/node-pdf'

const opts = { presetId: 'generic', userTerms: parseUserTerms('Widget Alignment'), strictShortTerms: false }
const opened: ExtractResult[] = []

async function scanMain(bytes: Uint8Array, presetId = 'generic'): Promise<ScanResult> {
  const r = await extractBytes(bytes, 'paper.pdf', 'main', 'main')
  opened.push(r)
  return runScan([r.facts], { ...opts, presetId })
}

let leaky: ScanResult
let fixed: ScanResult
let leakyAgain: ScanResult

beforeAll(async () => {
  leaky = await scanMain(sampleBytes('sample-leaky.pdf'))
  fixed = await scanMain(sampleBytes('sample-fixed.pdf'))
  leakyAgain = await scanMain(sampleBytes('sample-leaky.pdf'))
})
afterAll(async () => {
  for (const r of opened) await r.pdf.loadingTask.destroy()
})

const decide = (f: Finding, status: ReviewDecision['status']): [string, ReviewDecision] => [
  f.id,
  { findingId: f.id, status, reason: '', createdAt: '2026-11-26T00:00:00Z' },
]

describe('修复前后对比', () => {
  test('同一个文件扫两次：全部“仍存在”，没有修复也没有新增', () => {
    const cmp = compareScans(leaky, leakyAgain)
    expect(cmp.fixed).toHaveLength(0)
    expect(cmp.added).toHaveLength(0)
    expect(cmp.remaining).toHaveLength(leaky.findings.length)
  })

  test('泄露版 → 修复版：大部分问题被识别为已修复', () => {
    const cmp = compareScans(leaky, fixed)
    expect(cmp.fixed.length).toBeGreaterThan(leaky.findings.length / 2)
    expect(cmp.fixed.length + cmp.remaining.length).toBe(leaky.findings.length)
    expect(cmp.remaining.length + cmp.added.length).toBe(fixed.findings.length)
    // 元数据作者、邮箱都已修复
    expect(cmp.fixed.some((f) => f.ruleId === 'R01')).toBe(true)
    expect(cmp.fixed.some((f) => f.ruleId === 'R02')).toBe(true)
  })

  test('清理版只消除元数据 / 批注 / 附件类发现；正文类发现仍存在', async () => {
    const { bytes } = await sanitizePdf(sampleBytes('sample-leaky.pdf'), { metadata: true, removeTitle: true, annotations: true, externalLinks: false, attachments: true, imageMetadata: true })
    // 带上清理前从元数据得到的作者名，否则正文中的作者名会因“工具不再知道作者是谁”而被误判为已修复
    const r = await extractBytes(bytes, 'paper.pdf', 'main', 'main')
    opened.push(r)
    const knownNames = deriveNames(opened[0]!.facts ? [opened[0]!.facts] : [])
    const cleaned = runScan([r.facts], { ...opts, knownNames })
    const cmp = compareScans(leaky, cleaned)
    expect(cmp.added).toHaveLength(0)
    expect(cmp.fixed.filter((f) => !['metadata', 'annotation', 'attachment'].includes(f.source)).map((f) => [f.ruleId, f.source, f.field, f.snippet])).toEqual([])
    expect(cmp.remaining.some(({ next }) => next.ruleId === 'R03' && next.reasons.some((x) => x.includes('上一版')))).toBe(true)
    expect(cmp.remaining.every(({ next }) => next.source === 'text' || next.source === 'link' || next.source === 'filename')).toBe(true)
  })

  test('只比较前后都存在的文件', () => {
    const withSupp: ScanResult = { ...leaky, documents: [...leaky.documents, { ...leaky.documents[0]!, id: 'supp-1', role: 'supplement' }] }
    const suppFinding = { ...leaky.findings[0]!, id: 'f-supp', documentId: 'supp-1' }
    const prev: ScanResult = { ...withSupp, findings: [...leaky.findings, suppFinding] }
    const cmp = compareScans(prev, leakyAgain)
    expect(cmp.fixed).toHaveLength(0)
  })

  test('内容键不依赖字符位置', () => {
    const f = leaky.findings.find((x) => x.source === 'text')!
    const moved: Finding = { ...f, id: 'other', page: 99, occurrences: [{ ...f.occurrences[0]!, page: 99, start: 1, end: 5 }] }
    expect(matchKey(moved)).toBe(matchKey(f))
  })

  test('沿用忽略类决定；“已修改”却仍存在的恢复为待处理并记入 reopened', () => {
    const cmp = compareScans(leaky, leakyAgain)
    const [a, b] = [cmp.remaining[0]!, cmp.remaining[1]!]
    const prevDecisions = new Map([decide(a.prev, 'dismissed-citation'), decide(b.prev, 'resolved')])
    const mig = migrateDecisions(cmp, prevDecisions)
    expect(mig.decisions.get(a.next.id)?.status).toBe('dismissed-citation')
    expect(mig.decisions.get(a.next.id)?.findingId).toBe(a.next.id)
    expect(mig.decisions.has(b.next.id)).toBe(false)
    expect(mig.reopened).toEqual([b.next.id])
  })

  test('对比标签', () => {
    const cmp = { ...compareScans(leaky, fixed), reopened: [] }
    const tags = compareTags(cmp)
    for (const f of cmp.added) expect(tags.get(f.id)).toBe('added')
    for (const r of cmp.remaining) expect(tags.get(r.next.id)).toBe('remaining')
    expect(compareTags(null).size).toBe(0)
  })
})

describe('人工核对清单与报告', () => {
  test('清单随会场预设调整致谢说明', async () => {
    const neurips = await scanMain(sampleBytes('sample-leaky.pdf'), 'neurips-2026')
    const ack = checklistFor(neurips).find((i) => i.id === 'ack')!
    expect(ack.detail).toMatch(/NeurIPS/)
    expect(ack.detail).toMatch(/不得包含致谢/)
  })

  test('报告写入清单勾选与对比计数；未提供时为 null', () => {
    const items = checklistFor(leaky)
    const r = buildReport(leaky, new Map(), DEFAULT_REPORT_OPTIONS, () => new Date('2026-11-26T00:00:00Z'), {
      checklist: { items, checked: new Set(['repo', 'images']) },
      comparison: { fixed: 12, remaining: 3, added: 1, reopened: 1, presetChanged: false },
    })
    expect(r.schemaVersion).toBe('1.1.0')
    expect(r.checklist).toHaveLength(items.length)
    expect(r.checklist!.filter((c) => c.checked).map((c) => c.id)).toEqual(['repo', 'images'])
    expect(r.comparison?.fixed).toBe(12)
    const html = renderReportHtml(r)
    expect(html).toContain('人工核对清单（2 / 8）')
    expect(html).toContain('与上一版对比')

    const plain = buildReport(leaky, new Map(), DEFAULT_REPORT_OPTIONS)
    expect(plain.checklist).toBeNull()
    expect(plain.comparison).toBeNull()
    expect(renderReportHtml(plain)).not.toContain('人工核对清单')
  })
})
