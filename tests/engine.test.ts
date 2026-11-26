import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { DocumentFacts, Finding, ScanOptions } from '@/domain/types'
import { runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import type { ExtractResult } from '@/parsers/pdf/extract'
import { extractSample } from './helpers/node-pdf'

let leaky: ExtractResult
let fixed: ExtractResult
let supp: ExtractResult

beforeAll(async () => {
  leaky = await extractSample('sample-leaky.pdf')
  fixed = await extractSample('sample-fixed.pdf')
  supp = await extractSample('sample-supplement.pdf', 'supplement')
})

afterAll(async () => {
  for (const r of [leaky, fixed, supp]) await r?.pdf.loadingTask.destroy()
})

const opts = (presetId = 'generic', terms = ''): ScanOptions => ({
  presetId,
  userTerms: parseUserTerms(terms),
  strictShortTerms: false,
})

const scan = (docs: DocumentFacts[], presetId?: string, terms?: string) =>
  runScan(docs, opts(presetId, terms), { scanId: 'test', now: () => new Date('2026-11-26T00:00:00Z') })

const has = (fs: Finding[], rule: string, pred: (f: Finding) => boolean = () => true) =>
  fs.some((f) => f.ruleIds.includes(rule) && pred(f))

describe('sample-leaky.pdf（通用预设）', () => {
  let main: Finding[]
  beforeAll(() => {
    main = scan([leaky.facts, supp.facts]).findings.filter((f) => f.documentId === 'sample-leaky.pdf')
  })

  test('元数据作者名为高风险', () => {
    expect(has(main, 'R01', (f) => f.field === 'Info.Author' && f.severity === 'high')).toBe(true)
    expect(has(main, 'R01', (f) => f.field === 'XMP.dc:creator' && f.severity === 'high')).toBe(true)
  })

  test('作者区的姓名、机构、邮箱', () => {
    const block = main.filter((f) => f.zone === 'authorBlock' && f.severity === 'high')
    expect(has(block, 'R03')).toBe(true)
    expect(has(block, 'R04')).toBe(true)
    expect(has(block, 'R02')).toBe(true)
  })

  test('跨行邮箱经由作者名比对被识别', () => {
    expect(has(main, 'R02', (f) => f.page === 2 && f.severity === 'high')).toBe(true)
  })

  test('GitHub 链接：文本命中与链接注释合并为一条', () => {
    const gh = main.filter((f) => f.linkTarget?.includes('github.com/example-lab/widget-align'))
    expect(gh).toHaveLength(1)
    expect(gh[0]?.ruleIds).toEqual(expect.arrayContaining(['R07', 'R10']))
    expect(gh[0]?.severity).toBe('high')
  })

  test('可见文字与真实目标不同的链接', () => {
    const link = main.find((f) => f.ruleId === 'R10' && f.visibleText === 'project page')
    expect(link?.linkTarget).toBe('https://www.example.edu/~aexample/widgets')
    expect(link?.severity).not.toBe('info')
  })

  test('致谢、资助、自引', () => {
    expect(has(main, 'R05', (f) => f.severity === 'high')).toBe(true)
    expect(has(main, 'R06', (f) => f.severity === 'medium')).toBe(true)
    expect(main.filter((f) => f.ruleIds.includes('R08')).length).toBe(2)
  })

  test('页眉作者名聚合为一条 R11，吸收单页 R03 命中', () => {
    const header = main.filter((f) => f.zone === 'header' && f.severity === 'high')
    expect(header).toHaveLength(1)
    expect(header[0]?.ruleIds).toEqual(expect.arrayContaining(['R11', 'R03']))
    expect(header[0]?.occurrences.length).toBeGreaterThanOrEqual(2)
  })

  test('预印本页眉与 arXiv 戳', () => {
    expect(has(main, 'R11', (f) => f.zone === 'header' && f.snippet.includes('Camera-ready'))).toBe(true)
    expect(has(main, 'R11', (f) => f.category === 'identifier')).toBe(true)
  })

  test('批注作者与嵌入附件', () => {
    expect(has(main, 'R13', (f) => f.field === 'Text.author' && f.severity === 'high')).toBe(true)
    expect(has(main, 'R17', (f) => f.severity === 'high')).toBe(true)
  })

  test('每条文本命中都带页码与高亮框', () => {
    for (const f of main.filter((x) => x.source === 'text')) {
      expect(f.page).not.toBeNull()
      expect(f.bboxes?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('结果按严重程度排序且 ID 唯一', () => {
    const rank = { high: 3, medium: 2, low: 1, info: 0 } as Record<string, number>
    for (let i = 1; i < main.length; i++)
      expect(rank[main[i - 1]!.severity]! >= rank[main[i]!.severity]!).toBe(true)
    expect(new Set(main.map((f) => f.id)).size).toBe(main.length)
  })
})

describe('sample-fixed.pdf', () => {
  test('主文件没有高 / 中风险项，匿名仓库链接只作提示', () => {
    const r = scan([fixed.facts])
    const bad = r.findings.filter((f) => f.severity === 'high' || f.severity === 'medium')
    expect(bad).toEqual([])
    expect(has(r.findings, 'R07', (f) => f.severity === 'info' && !!f.linkTarget?.includes('anonymous.4open.science'))).toBe(true)
  })

  test('补充材料中的泄露会被单独报告', () => {
    const r = scan([fixed.facts, supp.facts])
    const s = r.findings.filter((f) => f.documentRole === 'supplement')
    expect(has(s, 'R01', (f) => f.severity === 'high' && f.snippet.includes('Blair Sample'))).toBe(true)
    expect(has(s, 'R06')).toBe(true)
    expect(has(s, 'R07', (f) => !!f.linkTarget?.includes('drive.google.com'))).toBe(true)
    expect(r.coverage.find((c) => c.capability === 'supplements')?.status).toBe('completed')
  })

  test('同一输入两次扫描得到相同的 Finding ID', () => {
    const a = scan([fixed.facts, supp.facts]).findings.map((f) => f.id)
    const b = scan([fixed.facts, supp.facts]).findings.map((f) => f.id)
    expect(a).toEqual(b)
  })
})

describe('会场预设', () => {
  test('NeurIPS：致谢一律高风险，并附政策来源', () => {
    const r = scan([leaky.facts], 'neurips-2026')
    const ack = r.findings.find((f) => f.ruleId === 'R05')
    expect(ack?.severity).toBe('high')
    expect(ack?.policyRefs.length).toBeGreaterThan(0)
    expect(r.findings.find((f) => f.ruleIds.includes('R06'))?.severity).toBe('high')
  })

  test('MobiCom：任何内嵌链接都要求人工确认', () => {
    const generic = scan([fixed.facts], 'generic').findings.filter((f) => f.ruleIds.includes('R10'))
    const mobicom = scan([fixed.facts], 'mobicom-2026').findings.filter((f) => f.ruleIds.includes('R10'))
    expect(generic.every((f) => f.severity === 'info')).toBe(true)
    expect(mobicom.length).toBeGreaterThan(0)
    expect(mobicom.every((f) => f.severity !== 'info')).toBe(true)
  })

  test('未知预设回退到通用预设', () => {
    expect(scan([fixed.facts], 'no-such-venue').preset.id).toBe('generic')
  })
})

describe('自定义词', () => {
  test('用户输入的项目名在正文中被标为高风险', () => {
    const r = scan([fixed.facts], 'generic', 'Widget Alignment')
    expect(r.userTermCount).toBe(1)
    expect(has(r.findings, 'R03', (f) => f.matchedUserTerm)).toBe(true)
  })

  test('规则运行状态覆盖全部规则', () => {
    const r = scan([fixed.facts])
    expect(r.rules.map((x) => x.ruleId)).toEqual(
      expect.arrayContaining(['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R10', 'R11', 'R12', 'R13', 'R17']),
    )
    expect(r.rules.every((x) => x.status === 'ran')).toBe(true)
  })
})
