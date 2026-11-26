import { describe, expect, test } from 'vitest'
import { runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import { DEFAULT_SANITIZE_OPTIONS, cleanedFilename, sanitizePdf } from '@/clean/sanitize'
import { extractBytes, sampleBytes } from './helpers/node-pdf'

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1')

async function scan(bytes: Uint8Array) {
  const r = await extractBytes(bytes, 'x.pdf', 'main', 'main')
  const result = runScan([r.facts], { presetId: 'generic', userTerms: parseUserTerms('Widget Alignment'), strictShortTerms: false })
  return { r, result }
}

describe('清理版 PDF', () => {
  test('删除元数据、XMP、批注与附件；正文与页数不变', async () => {
    const src = sampleBytes('sample-leaky.pdf')
    const before = await scan(src)
    const { bytes, report } = await sanitizePdf(src, { ...DEFAULT_SANITIZE_OPTIONS, useObjectStreams: false })
    const after = await scan(bytes)
    try {
      expect(report.infoKeys).toEqual(expect.arrayContaining(['Author', 'Creator']))
      expect(report.infoKeys).not.toContain('Title')
      expect(report.annotationsRemoved).toBeGreaterThan(0)
      expect(report.attachmentsRemoved).toBe(1)
      expect(report.orphansRemoved).toBeGreaterThan(0)

      expect(after.r.facts.pageCount).toBe(before.r.facts.pageCount)
      expect(after.r.facts.info.Author ?? '').toBe('')
      expect(after.r.facts.info.Title).toBe(before.r.facts.info.Title)
      expect(after.r.facts.xmp).toBeNull()
      expect(after.r.facts.attachments).toHaveLength(0)
      const reviewAnnots = after.r.facts.pages.flatMap((p) => p.annotations).filter((a) => a.subtype !== 'Link' && a.subtype !== 'Widget')
      expect(reviewAnnots).toHaveLength(0)

      // 元数据 / 批注 / 附件类发现全部消失；正文类（邮箱等）仍在
      const ids = (rs: typeof after.result) => new Set(rs.findings.flatMap((f) => f.ruleIds))
      for (const rule of ['R01', 'R17']) expect(ids(before.result).has(rule)).toBe(true)
      expect(ids(after.result).has('R17')).toBe(false)
      // 标题默认保留；它含自定义词，所以只剩这一条元数据发现
      expect(after.result.findings.filter((f) => f.ruleIds.includes('R01')).map((f) => f.field)).toEqual(['Info.Title'])
      expect(after.result.findings.some((f) => f.ruleId === 'R13' && f.source === 'annotation')).toBe(false)
      expect(ids(after.result).has('R02')).toBe(true)
      // 文内链接默认保留
      expect(after.r.facts.pages.flatMap((p) => p.annotations).some((a) => a.subtype === 'Link')).toBe(true)
    } finally {
      await before.r.pdf.loadingTask.destroy()
      await after.r.pdf.loadingTask.destroy()
    }
  })

  test('被删除的内容不残留在新文件的字节里（不可达对象回收）', async () => {
    const { bytes } = await sanitizePdf(sampleBytes('sample-leaky.pdf'), { ...DEFAULT_SANITIZE_OPTIONS, useObjectStreams: false })
    const raw = latin1(bytes)
    expect(raw).not.toMatch(/notes-alex-example/)
    expect(raw).not.toMatch(/Blair Sample/)
    expect(raw).not.toMatch(/x:xmpmeta/)
    expect(raw).not.toMatch(/pdf-lib/)
  })

  test('可选删除外部链接，文内跳转保留', async () => {
    const { bytes, report } = await sanitizePdf(sampleBytes('sample-leaky.pdf'), { ...DEFAULT_SANITIZE_OPTIONS, externalLinks: true })
    const { r } = await scan(bytes)
    try {
      expect(report.linksRemoved).toBeGreaterThan(0)
      expect(r.facts.pages.flatMap((p) => p.annotations).filter((a) => a.subtype === 'Link' && a.url)).toHaveLength(0)
    } finally {
      await r.pdf.loadingTask.destroy()
    }
  })

  test('可选同时删除标题', async () => {
    const { bytes, report } = await sanitizePdf(sampleBytes('sample-leaky.pdf'), { ...DEFAULT_SANITIZE_OPTIONS, removeTitle: true })
    const { r } = await scan(bytes)
    try {
      expect(report.infoKeys).toContain('Title')
      expect(r.facts.info.Title ?? '').toBe('')
    } finally {
      await r.pdf.loadingTask.destroy()
    }
  })

  test('清理版文件名是中性的', () => {
    expect(cleanedFilename('main')).toBe('paper.pdf')
    expect(cleanedFilename('supp-2')).toBe('supplement-2.pdf')
  })
})
