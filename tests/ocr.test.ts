import { describe, expect, test } from 'vitest'
import type { DocumentFacts } from '@/domain/types'
import { buildPage } from '@/normalize/layout'
import { assignZones } from '@/normalize/zones'
import type { RawPage } from '@/normalize/raw'
import { type OcrWord, mergeItems, wordsToItems } from '@/ocr/ocr'
import { runScan } from '@/rules/engine'

/** 模拟 scale=2 的视口：画布像素（左上原点）→ PDF 用户空间（左下原点） */
const H = 792
const mapper = { convertToPdfPoint: (x: number, y: number) => [x / 2, H - y / 2] }

/** 在画布上按行排一串词（每个字符 14 像素宽、24 像素高） */
function line(words: string[], x: number, y: number, confidence = 90): OcrWord[] {
  const out: OcrWord[] = []
  let cx = x
  for (const w of words) {
    out.push({ text: w, confidence, bbox: { x0: cx, y0: y, x1: cx + w.length * 14, y1: y + 24 } })
    cx += w.length * 14 + 14
  }
  return out
}

function page(items: RawPage['items']): RawPage {
  return {
    documentId: 'main',
    pageNumber: 1,
    view: [0, 0, 612, 792],
    rotation: 0,
    viewTransform: [1, 0, 0, -1, 0, 792],
    viewWidth: 612,
    viewHeight: 792,
    items,
    annotations: [],
    extractionStatus: 'completed',
  }
}

describe('OCR 结果转文字项', () => {
  test('词框换算到用户空间，低置信度的词被丢弃', () => {
    const items = wordsToItems([...line(['Hello'], 100, 100), { text: '~~', confidence: 10, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }], mapper)
    expect(items).toHaveLength(1)
    const it = items[0]!
    expect(it.str).toBe('Hello')
    expect(it.transform[4]).toBeCloseTo(50)
    expect(it.width).toBeCloseTo(35)
    // 字形框（-0.22h ~ 0.9h）应覆盖原词框（用户空间 y：792-62=730 到 792-50=742）
    const base = it.transform[5]!
    const h = it.height
    expect(base - 0.22 * h).toBeCloseTo(730, 0)
    expect(base + 0.9 * h).toBeCloseTo(742, 0)
  })

  test('词被重新拼成行，规则在 OCR 页上照常工作，并注明来自 OCR', () => {
    const words = [
      ...line(['Robust', 'Widget', 'Alignment'], 200, 120),
      ...line(['Alex', 'Example'], 330, 170),
      ...line(['alex.example@example-state.edu'], 260, 200),
      ...line(['1', 'Introduction'], 120, 400),
      ...line(['We', 'study', 'widgets.'], 120, 440),
    ]
    const built = { ...buildPage(page(wordsToItems(words, mapper))), ocr: true }
    expect(built.text).toContain('Alex Example')
    expect(built.text).toContain('alex.example@example-state.edu')
    const pages = [built]
    assignZones(pages)
    const doc: DocumentFacts = {
      id: 'main',
      role: 'main',
      displayName: 'scan.pdf',
      byteSize: 1,
      pageCount: 1,
      parseStatus: 'completed',
      info: {},
      xmp: null,
      pages,
      attachments: [],
      internalLinkCount: 0,
      coverage: [],
      warnings: [],
    }
    const r = runScan([doc], { presetId: 'generic', userTerms: [], strictShortTerms: false })
    const email = r.findings.find((f) => f.ruleIds.includes('R02'))
    expect(email).toBeDefined()
    expect(email!.reasons.join()).toMatch(/本地 OCR/)
    expect(email!.confidence).not.toBe('high')
    expect(email!.bboxes?.length).toBeGreaterThan(0)
    expect(r.coverage.find((c) => c.capability === 'images' && c.documentId == null)?.status).toBe('partial')
  })

  test('稀疏页：只补充不与原文字重叠的 OCR 词', () => {
    const original = wordsToItems(line(['Page', '3'], 100, 700), mapper)
    const ocr = wordsToItems([...line(['Page', '3'], 100, 700), ...line(['Alex', 'Example'], 300, 300)], mapper)
    const merged = mergeItems(original, ocr)
    expect(merged.map((i) => i.str)).toEqual(['Page', '3', 'Alex', 'Example'])
  })
})
