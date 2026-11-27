import { afterAll, describe, expect, test } from 'vitest'
import type { ScanResult } from '@/domain/types'
import { runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import type { ExtractResult } from '@/parsers/pdf/extract'
import { parseJpegMeta, parseXmpFields, stripJpegMeta } from '@/parsers/pdf/imagemeta'
import { revisionEnds } from '@/parsers/pdf/binary'
import { DEFAULT_SANITIZE_OPTIONS, sanitizePdf } from '@/clean/sanitize'
import { extractBytes, sampleBytes } from './helpers/node-pdf'
import { appendRevision, makeBinaryPaper, makeJpegWithMeta } from './helpers/make-binary'
import { makePaper } from './helpers/make-pdf'

const opened: ExtractResult[] = []
afterAll(async () => {
  for (const r of opened) await r.pdf.loadingTask.destroy()
})

async function scan(bytes: Uint8Array, presetId = 'generic', terms = ''): Promise<{ r: ExtractResult; result: ScanResult }> {
  const r = await extractBytes(bytes, 'paper.pdf', 'main', 'main')
  opened.push(r)
  return { r, result: runScan([r.facts], { presetId, userTerms: parseUserTerms(terms), strictShortTerms: false }) }
}
const byRule = (res: ScanResult, id: string) => res.findings.filter((f) => f.ruleIds.includes(id))

const FULL_META = {
  artist: 'Alex Example',
  copyright: '(c) Example State University',
  xpAuthor: 'Alex Example',
  gps: true,
  xmpCreator: 'Blair Sample',
  iptcByline: 'Blair Sample',
  comment: 'shot in the Example Lab',
}

describe('JPEG 元数据解析', () => {
  test('读出 EXIF / XP / GPS / XMP / IPTC / 注释', () => {
    const m = parseJpegMeta(makeJpegWithMeta(FULL_META))
    expect(m.gps).toBe(true)
    expect(m.fields['EXIF.Artist']).toBe('Alex Example')
    expect(m.fields['EXIF.Copyright']).toBe('(c) Example State University')
    expect(m.fields['EXIF.XPAuthor']).toBe('Alex Example')
    expect(m.fields['XMP.dc:creator']).toBe('Blair Sample')
    expect(m.fields['IPTC.By-line']).toBe('Blair Sample')
    expect(m.fields['JPEG.Comment']).toBe('shot in the Example Lab')
  })

  test('去掉元数据段后仍是 JPEG，图像段保留', () => {
    const src = makeJpegWithMeta(FULL_META)
    const out = stripJpegMeta(src)!
    expect(out.length).toBeLessThan(src.length)
    expect([out[0], out[1]]).toEqual([0xff, 0xd8])
    expect(parseJpegMeta(out)).toEqual({ fields: {}, gps: false })
    // SOF0 仍在
    expect([...out].some((b, i) => b === 0xff && out[i + 1] === 0xc0)).toBe(true)
    expect(stripJpegMeta(out)).toBeNull()
  })

  test('畸形数据不抛错', () => {
    expect(parseJpegMeta(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]))).toEqual({ fields: {}, gps: false })
    expect(parseJpegMeta(new Uint8Array([1, 2, 3]))).toEqual({ fields: {}, gps: false })
    expect(parseXmpFields('not xml')).toEqual({})
  })
})

describe('R18 图片元数据 / R19 字体名', () => {
  test('页面图片与残留图片的元数据都被报告；GPS 与作者为高优先级', async () => {
    const bytes = await makeBinaryPaper({
      author: 'Alex Example',
      image: FULL_META,
      orphanImage: { artist: 'Blair Sample' },
      body: ['We describe the widget alignment method in detail.'],
    })
    const { r, result } = await scan(bytes)
    expect(r.facts.binary?.imageCount).toBe(2)
    const r18 = byRule(result, 'R18')
    expect(r18).toHaveLength(2)
    expect(r18.every((f) => f.severity === 'high')).toBe(true)
    const onPage = r18.find((f) => f.page === 1)!
    expect(onPage.snippet).toContain('GPS')
    expect(onPage.reasons.map((r) => r.zh).join()).toMatch(/GPS/)
    const orphan = r18.find((f) => f.page == null)!
    expect(orphan.reasons.map((r) => r.zh).join()).toMatch(/没有任何页面引用/)
    expect(r.facts.coverage.find((c) => c.capability === 'images')?.status).toBe('partial')
  })

  test('字体名含作者名或自定义词时报告；普通字体不报', async () => {
    const withName = await scan(await makeBinaryPaper({ author: 'Alex Example', fontName: 'ABCDEF+AlexExampleSans-Bold' }))
    const r19 = byRule(withName.result, 'R19')
    expect(r19).toHaveLength(1)
    expect(r19[0]!.snippet).toBe('AlexExampleSans-Bold')

    const term = await scan(await makeBinaryPaper({ fontName: 'QuasarLabMono' }), 'generic', 'QuasarLab')
    expect(byRule(term.result, 'R19')).toHaveLength(1)
    expect(byRule(term.result, 'R19')[0]!.matchedUserTerm).toBe(true)

    const plain = await scan(await makeBinaryPaper({ author: 'Alex Example', fontName: 'ABCDEF+LMRoman10-Regular' }))
    expect(byRule(plain.result, 'R19')).toHaveLength(0)
  })

  test('清理版去掉图片元数据；字体名无法自动处理，仍然报告', async () => {
    const bytes = await makeBinaryPaper({ author: 'Alex Example', image: FULL_META, orphanImage: { artist: 'Blair Sample' }, fontName: 'AlexExampleSans' })
    const { bytes: cleaned, report } = await sanitizePdf(bytes, { ...DEFAULT_SANITIZE_OPTIONS, useObjectStreams: false })
    expect(report.imagesCleaned).toBeGreaterThanOrEqual(1)
    const raw = Buffer.from(cleaned).toString('latin1')
    expect(raw).not.toMatch(/Blair Sample|Example Lab|Exif\0/)
    const { result } = await scan(cleaned, 'generic', 'Alex Example')
    expect(byRule(result, 'R18')).toHaveLength(0)
    expect(byRule(result, 'R19')).toHaveLength(1)
  })
})

describe('R20 增量保存的旧版本', () => {
  test('版本边界：普通文件 1 个版本，追加后 2 个', async () => {
    const base = await makePaper({})
    expect(revisionEnds(base)).toHaveLength(1)
    const two = await appendRevision(base, { Title: 'A Study of Synthetic Widgets' })
    expect(revisionEnds(two)).toHaveLength(2)
  })

  test('旧版本的作者名被报告，并继续用于查找正文中的姓名', async () => {
    const original = await makePaper({ author: 'Alex Example', authorLines: ['Alex Example', 'Example State University'] })
    const edited = await appendRevision(original, { Title: 'A Study of Synthetic Widgets', Producer: 'Edited' })
    const { r, result } = await scan(edited)
    expect(r.facts.info.Author ?? '').toBe('')
    expect(r.facts.binary?.revisionCount).toBe(2)
    const r20 = byRule(result, 'R20')
    const author = r20.find((f) => f.field === 'rev1:Info.Author')
    expect(author?.severity).toBe('high')
    expect(author?.snippet).toBe('Alex Example')
    expect(r20.find((f) => f.field === 'revisions')?.severity).toBe('medium')
    // 当前元数据里已经没有作者名，但旧版本里有，正文作者区的姓名仍被 R03 找到
    expect(byRule(result, 'R03').some((f) => f.snippet.includes('Alex Example') && f.reasons.map((r) => r.zh).join().includes('旧版本 1'))).toBe(true)
    expect(r.facts.coverage.find((c) => c.capability === 'hiddenContent')?.reason.zh).toMatch(/2 个保存版本/)
  })

  test('清理版只剩一个版本', async () => {
    const edited = await appendRevision(await makePaper({ author: 'Alex Example' }), { Title: 'T' })
    const { bytes } = await sanitizePdf(edited)
    expect(revisionEnds(bytes)).toHaveLength(1)
    const { result } = await scan(bytes)
    expect(byRule(result, 'R20')).toHaveLength(0)
  })

  test('没有增量保存时不报告', async () => {
    const { result } = await scan(sampleBytes('sample-leaky.pdf'))
    expect(byRule(result, 'R20')).toHaveLength(0)
  })
})

describe('R21 会场模板标记与补全的预设', () => {
  test('CVPR：缺少审稿模板标记时提示；有标记时不提示', async () => {
    const missing = await scan(sampleBytes('sample-fixed.pdf'), 'cvpr-2026')
    expect(byRule(missing.result, 'R21')).toHaveLength(1)
    expect(byRule(missing.result, 'R21')[0]!.severity).toBe('medium')

    const ok = await scan(
      await makePaper({ authorLines: ['Anonymous CVPR submission', 'CVPR 2026 Submission #1234. CONFIDENTIAL REVIEW COPY. DO NOT DISTRIBUTE.'] }),
      'cvpr-2026',
    )
    expect(byRule(ok.result, 'R21')).toHaveLength(0)
  })

  test('通用预设不检查模板标记', async () => {
    const { result } = await scan(sampleBytes('sample-fixed.pdf'))
    expect(byRule(result, 'R21')).toHaveLength(0)
  })

  test('CVPR / USENIX / CCS 预设已按条款实现：致谢禁止、资助升为高优先级', async () => {
    const { getPreset } = await import('@/presets')
    for (const id of ['cvpr-2026', 'usenix-sec-2026', 'ccs-2026']) {
      const p = getPreset(id)
      expect(p.implementationStatus).toBe('implemented')
      expect(p.ackPolicy).toBe('forbidden')
      expect(p.severityOverrides.R06).toBe('high')
    }
    const { result } = await scan(sampleBytes('sample-leaky.pdf'), 'usenix-sec-2026')
    expect(byRule(result, 'R06').every((f) => f.severity === 'high')).toBe(true)
  })
})
