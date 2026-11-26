/**
 * 命中回映射：基准文本范围 → 原始 TextItem 片段 → bbox / 原文。
 */
import type { BBox, PageFacts } from '@/domain/types'
import { sliceBBox, unionBBox } from '@/utils/geometry'
import { stripBidi } from './unicode'

function codeUnitLen(s: string, offset: number): number {
  const cp = s.codePointAt(offset) ?? 0
  return cp > 0xffff ? 2 : 1
}

interface ItemSpan {
  item: number
  min: number
  max: number
}

/** 按出现顺序收集 [start,end) 涉及的 item 及其源偏移范围 */
function itemSpans(page: PageFacts, start: number, end: number): Array<{ line: number; spans: ItemSpan[] }> {
  const out: Array<{ line: number; spans: ItemSpan[] }> = []
  for (let i = Math.max(0, start); i < Math.min(end, page.text.length); i++) {
    const item = page.charItem[i] ?? -1
    if (item < 0) continue
    const off = page.charOffset[i] ?? 0
    const line = page.charLine[i] ?? 0
    let bucket = out[out.length - 1]
    if (!bucket || bucket.line !== line) {
      bucket = { line, spans: [] }
      out.push(bucket)
    }
    const last = bucket.spans[bucket.spans.length - 1]
    if (last && last.item === item) {
      last.min = Math.min(last.min, off)
      last.max = Math.max(last.max, off)
    } else {
      bucket.spans.push({ item, min: off, max: off })
    }
  }
  return out
}

export interface RangeBoxes {
  bboxes: BBox[]
  approximate: boolean
}

/** 每行一个框；命中跨两行时得到两个框。字符宽度按等分估算时标 approximate。 */
export function rangeBBoxes(page: PageFacts, start: number, end: number): RangeBoxes {
  const bboxes: BBox[] = []
  let approximate = false
  for (const { spans } of itemSpans(page, start, end)) {
    const parts: BBox[] = []
    for (const sp of spans) {
      const item = page.items[sp.item]
      if (!item) continue
      const len = Math.max(1, item.str.length)
      const endOff = sp.max + codeUnitLen(item.str, sp.max)
      const f0 = sp.min / len
      const f1 = endOff / len
      if (f0 > 0.001 || f1 < 0.999) approximate = true
      parts.push(sliceBBox(item.geom, f0, f1))
    }
    const u = unionBBox(parts)
    if (u) bboxes.push(u)
  }
  return { bboxes, approximate }
}

/**
 * 取原文（来自 TextItem.str，不是规范化替代文本）。
 * 插入的分隔（空格/换行）原样保留，换行显示为空格。
 */
export function originalText(page: PageFacts, start: number, end: number): string {
  let out = ''
  let i = Math.max(0, start)
  const stop = Math.min(end, page.text.length)
  while (i < stop) {
    const item = page.charItem[i] ?? -1
    if (item < 0) {
      out += page.text[i] === '\n' ? ' ' : (page.text[i] ?? '')
      i++
      continue
    }
    const min = page.charOffset[i] ?? 0
    let max = min
    let j = i + 1
    while (j < stop && page.charItem[j] === item) {
      const off = page.charOffset[j] ?? 0
      // 同一 item 内偏移倒退说明是另一段（极少见），截断
      if (off < min) break
      max = Math.max(max, off)
      j++
    }
    const str = page.items[item]?.str ?? ''
    out += str.slice(min, max + codeUnitLen(str, max))
    i = j
  }
  return stripBidi(out).replace(/\s+/g, ' ')
}

/** 前后文（各 radius 个基准字符），用于展开查看 */
export function contextAround(page: PageFacts, start: number, end: number, radius: number): string {
  const s = Math.max(0, start - radius)
  const e = Math.min(page.text.length, end + radius)
  const pre = s > 0 ? '…' : ''
  const post = e < page.text.length ? '…' : ''
  return pre + originalText(page, s, e).trim() + post
}

/** 页面内一行的原文 */
export function lineOriginal(page: PageFacts, lineIndex: number): string {
  const line = page.lines[lineIndex]
  if (!line) return ''
  return originalText(page, line.start, line.end).trim()
}
