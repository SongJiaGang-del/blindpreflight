import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { Finding, ScanResult } from '@/domain/types'
import { runScan, RULES } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import type { ExtractResult } from '@/parsers/pdf/extract'
import { parseSourceArchive } from '@/parsers/source/archive'
import { buildReport, DEFAULT_REPORT_OPTIONS } from '@/report/build'
import { renderReportHtml } from '@/report/html'
import { checklistFor } from '@/app/checklist'
import { PRESETS } from '@/presets'
import { formatField } from '@/domain/labels'
import { zh } from '@/i18n/zh'
import { en } from '@/i18n/en'
import { extractBytes, extractSample } from './helpers/node-pdf'
import { appendRevision, makeBinaryPaper } from './helpers/make-binary'
import { makePaper } from './helpers/make-pdf'

const HAN = /[\u4e00-\u9fff]/
const ROOT = join(import.meta.dirname, '..')
const opened: ExtractResult[] = []
let results: ScanResult[] = []

beforeAll(async () => {
  const leaky = await extractSample('sample-leaky.pdf')
  const supp = await extractSample('sample-supplement.pdf', 'supplement')
  const binary = await extractBytes(
    await appendRevision(
      await makeBinaryPaper({ author: 'Alex Example', image: { artist: 'Alex Example', gps: true }, orphanImage: { artist: 'Blair Sample' }, fontName: 'AlexExampleSans' }),
      { Title: 'T' },
    ),
    'b.pdf',
    'main',
    'main',
  )
  const tex = String.raw`\documentclass{article}
\usepackage[final]{neurips_2026}
\author{Alex Example \And Blair Sample}
% contact alex@example-state.edu
\iffalse thanks to Blair Sample \fi
`
  const source = await parseSourceArchive(
    'p.zip',
    zipSync({ 'main.tex': strToU8(tex), '.git/config': strToU8('[core]'), 'main.log': strToU8('C:\\Users\\aexample\\x.tex'), 'LICENSE': strToU8('Copyright (c) 2026 Blair Sample') }),
  )
  opened.push(leaky, supp, binary)
  const opts = { userTerms: parseUserTerms('Widget Alignment'), strictShortTerms: false }
  results = [
    runScan([leaky.facts, supp.facts], { ...opts, presetId: 'generic' }),
    runScan([leaky.facts], { ...opts, presetId: 'neurips-2026' }),
    runScan([leaky.facts], { ...opts, presetId: 'mobicom-2026' }),
    runScan([binary.facts], { ...opts, presetId: 'cvpr-2026' }),
    runScan([], { ...opts, presetId: 'generic', source }),
  ]
})
afterAll(async () => {
  for (const r of opened) await r.pdf.loadingTask.destroy()
})

/** 去掉稿件原文（引号内的命中、文件名、路径）后再判断是否还有中文 */
function stripEvidence(s: string): string {
  return s.replace(/“[^”]*”|「[^」]*」|"[^"]*"/g, '')
}

describe('规则生成的双语文本', () => {
  test('每条发现的原因与建议都有中英文，英文里没有漏翻的中文', () => {
    const all: Finding[] = results.flatMap((r) => r.findings)
    expect(all.length).toBeGreaterThan(40)
    const ruleIds = new Set(all.flatMap((f) => f.ruleIds))
    // 覆盖面：绝大多数规则都产出了发现
    expect(ruleIds.size).toBeGreaterThanOrEqual(18)
    const leftovers: string[] = []
    for (const f of all) {
      for (const t of [...f.reasons, f.suggestion, ...(f.snippetText ? [f.snippetText] : [])]) {
        expect(t.zh.trim().length).toBeGreaterThan(0)
        expect(t.en.trim().length).toBeGreaterThan(0)
        if (HAN.test(stripEvidence(t.en))) leftovers.push(`${f.ruleId}: ${t.en}`)
      }
    }
    expect(leftovers).toEqual([])
  })

  test('覆盖说明、规则标题、预设与清单都有英文', () => {
    for (const r of results) {
      for (const c of r.coverage) expect(HAN.test(stripEvidence(c.reason.en)), c.reason.en).toBe(false)
      for (const item of checklistFor(r)) for (const t of [item.title, item.detail, ...(item.emphasis ? [item.emphasis] : [])]) expect(HAN.test(t.en), t.en).toBe(false)
    }
    for (const r of RULES) expect(HAN.test(r.title.en + r.description.en)).toBe(false)
    for (const p of PRESETS)
      for (const t of [p.venue, p.track, p.phase, ...p.summary, ...p.limitations, ...(p.linkNote ? [p.linkNote] : [])]) expect(HAN.test(t.en), t.en).toBe(false)
  })

  test('定位字段按语言显示', () => {
    expect(formatField('rev1:Info.Author', 'zh')).toBe('版本 1 · Info.Author')
    expect(formatField('rev1:Info.Author', 'en')).toBe('Revision 1 · Info.Author')
    expect(formatField('img:3', 'en')).toBe('Image #3')
    expect(formatField('main.tex:5', 'en')).toBe('main.tex:5')
  })
})

describe('英文报告', () => {
  test('英文报告仍然脱敏，界面文字是英文', async () => {
    const r = results[0]!
    const report = buildReport(r, new Map(), { ...DEFAULT_REPORT_OPTIONS, locale: 'en' })
    expect(report.options.locale).toBe('en')
    const html = renderReportHtml(report)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('anonymity preflight report')
    for (const re of [/Alex\b/i, /Blair/i, /example\.edu/i, /sample-leaky/i]) expect(html, String(re)).not.toMatch(re)
    const visible = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ')
    expect(HAN.test(visible)).toBe(false)
    expect(report.documents[0]!.name).toBe('Main paper')
  })

  test('中文报告保持中文', () => {
    const report = buildReport(results[0]!, new Map(), DEFAULT_REPORT_OPTIONS)
    expect(renderReportHtml(report)).toContain('匿名性预检报告')
  })
})

describe('界面消息表', () => {
  test('中英文键完全一致，且没有空值', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    // 语言切换按钮在英文界面里显示目标语言（中文），方便中文用户找到
    const switchKeys = new Set(['app.lang', 'app.langShort'])
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim().length, k).toBeGreaterThan(0)
      if (!switchKeys.has(k)) expect(HAN.test(v), `${k}: ${v}`).toBe(false)
    }
  })

  test('组件里用到的每个消息键都存在', () => {
    const dir = join(ROOT, 'src', 'components')
    const files = [...readdirSync(dir).map((f) => join(dir, f)), join(ROOT, 'src', 'App.vue')]
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) if (!(m[1]! in zh)) missing.push(`${f}: ${m[1]}`)
      for (const m of src.matchAll(/(?:error|renderError)\.value = '([\w.]+)'/g)) if (!(m[1]! in zh)) missing.push(`${f}: ${m[1]}`)
    }
    expect(missing).toEqual([])
    for (const s of ['implemented', 'partial', 'reference']) expect(zh[`preset.impl.${s}`]).toBeTruthy()
    for (const s of ['verified', 'partial', 'unverified']) expect(zh[`preset.verify.${s}`]).toBeTruthy()
  })
})

describe('OCR 与清理流程的英文提示', () => {
  test('makePaper 夹具（无发现时）也能生成英文覆盖说明', async () => {
    const r = await extractBytes(await makePaper({}), 'x.pdf', 'main', 'main')
    opened.push(r)
    const res = runScan([r.facts], { presetId: 'generic', userTerms: [], strictShortTerms: false })
    for (const c of res.coverage) expect(HAN.test(c.reason.en), c.reason.en).toBe(false)
  })
})
