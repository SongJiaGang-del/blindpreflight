/**
 * 版面重建：TextItem → 行 → 阅读顺序 → 基准文本 + 逐字符来源映射。
 *
 * 不能把 items.map(str).join(' ') 当全文：这里先按显示坐标的基线聚行，
 * 在跨越页面中线的大间隙处切开（双栏），再按栏序输出。
 */
import type { DisplayBox, LineFact, PageFacts, TextItemFact, TextQuality } from '@/domain/types'
import { LIMITS } from '@/domain/limits'
import { applyMatrix, bboxFromPoints, boxFromPoints, sliceCorners, itemGeometry } from '@/utils/geometry'
import { isCjk, normalizeWithMap, type MappedText } from './unicode'
import type { RawPage } from './raw'
import { buildViews } from './views'
import { attachLinkText } from './links'

interface Work {
  fact: TextItemFact
  norm: MappedText
  cy: number
}

interface Segment {
  works: Work[]
  box: DisplayBox
  fontSize: number
  /** 来自同一基线组的序号，单栏时保持左右顺序 */
  group: number
}

function unionBox(boxes: DisplayBox[]): DisplayBox {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  }
}

function weightedFont(works: Work[]): number {
  let sum = 0
  let n = 0
  for (const w of works) {
    const k = Math.max(1, w.norm.text.trim().length)
    sum += w.fact.fontSize * k
    n += k
  }
  return n > 0 ? sum / n : 0
}

export function toItemFacts(raw: RawPage): TextItemFact[] {
  return raw.items.map((it, index) => {
    const geom = itemGeometry(it.transform, it.width, it.height)
    const corners = sliceCorners(geom, 0, geom.w)
    const bbox = bboxFromPoints(corners)
    const box = boxFromPoints(corners.map(([x, y]) => applyMatrix(raw.viewTransform, x, y)))
    const [dx0, dy0] = applyMatrix(raw.viewTransform, geom.ox, geom.oy)
    const [dx1, dy1] = applyMatrix(raw.viewTransform, geom.ox + geom.ux, geom.oy + geom.uy)
    const ddx = dx1 - dx0
    const ddy = dy1 - dy0
    const horizontal = ddx > 0 && Math.abs(ddy) <= 0.1 * Math.abs(ddx)
    return { index, str: it.str, geom, bbox, box, fontSize: geom.h, horizontal }
  })
}

/** 同一基线聚组（锚定首项，避免链式漂移） */
function clusterBaselines(works: Work[]): Work[][] {
  const sorted = [...works].sort((a, b) => a.cy - b.cy || a.fact.box.left - b.fact.box.left)
  const groups: Array<{ anchor: number; h: number; works: Work[] }> = []
  for (const w of sorted) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(w.cy - g.anchor) <= 0.45 * Math.max(g.h, w.fact.fontSize)) {
      g.works.push(w)
      g.h = Math.max(g.h, w.fact.fontSize)
    } else {
      groups.push({ anchor: w.cy, h: w.fact.fontSize, works: [w] })
    }
  }
  return groups.map((g) => g.works.sort((a, b) => a.fact.box.left - b.fact.box.left))
}

function splitSegments(group: Work[], groupIndex: number, pageWidth: number): Segment[] {
  const mid = pageWidth / 2
  const out: Segment[] = []
  let cur: Work[] = []
  const flush = () => {
    if (cur.length === 0) return
    out.push({
      works: cur,
      box: unionBox(cur.map((w) => w.fact.box)),
      fontSize: weightedFont(cur),
      group: groupIndex,
    })
    cur = []
  }
  for (const w of group) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const gap = w.fact.box.left - prev.fact.box.right
      const fs = Math.max(prev.fact.fontSize, w.fact.fontSize, 1)
      const straddlesMid = prev.fact.box.right <= mid + 0.05 * pageWidth && w.fact.box.left >= mid - 0.05 * pageWidth
      if ((straddlesMid && gap > 1.0 * fs) || gap > 4 * fs) flush()
    }
    cur.push(w)
  }
  flush()
  return out
}

interface BuiltLine {
  text: string
  charItem: number[]
  charOffset: number[]
}

function assembleLine(works: Work[]): BuiltLine {
  let text = ''
  const charItem: number[] = []
  const charOffset: number[] = []
  let prev: Work | null = null
  for (const w of works) {
    const t = w.norm.text
    if (t.length === 0) continue
    if (prev) {
      const gap = w.fact.box.left - prev.fact.box.right
      const fs = Math.max(1, Math.min(prev.fact.fontSize, w.fact.fontSize))
      const last = text[text.length - 1]
      const first = t[0]
      const cjkJoin = isCjk(last) && isCjk(first)
      const threshold = cjkJoin ? 0.5 * fs : 0.12 * fs
      if (gap > threshold && last !== ' ' && first !== ' ') {
        text += ' '
        charItem.push(-1)
        charOffset.push(-1)
      }
    }
    for (let k = 0; k < t.length; k++) {
      text += t[k]
      charItem.push(w.fact.index)
      charOffset.push(w.norm.offsets[k] ?? 0)
    }
    prev = w
  }
  // 行首尾空白裁掉，映射同步
  let s = 0
  let e = text.length
  while (s < e && text[s] === ' ') s++
  while (e > s && text[e - 1] === ' ') e--
  // 行内连续空格压成一个
  let outText = ''
  const outItem: number[] = []
  const outOff: number[] = []
  for (let i = s; i < e; i++) {
    const ch = text[i] ?? ''
    if (ch === ' ' && outText[outText.length - 1] === ' ') continue
    outText += ch
    outItem.push(charItem[i] ?? -1)
    outOff.push(charOffset[i] ?? -1)
  }
  return { text: outText, charItem: outItem, charOffset: outOff }
}

type Column = LineFact['column']

function classify(box: DisplayBox, width: number): Column {
  const mid = width / 2
  if (box.right <= mid + 0.02 * width) return 'left'
  if (box.left >= mid - 0.02 * width) return 'right'
  return 'span'
}

interface OrderedSeg {
  seg: Segment
  column: Column
}

function orderSegments(
  segs: Segment[],
  width: number,
  height: number,
): { ordered: OrderedSeg[]; twoColumn: boolean } {
  // 页眉页脚带内的短行不参与分栏（否则双栏页的页码会插进左栏中间）
  const inBand = (b: DisplayBox) => b.bottom <= height * 0.09 || b.top >= height * 0.91
  const cls = segs.map((seg) => ({ seg, column: inBand(seg.box) ? ('span' as Column) : classify(seg.box, width) }))
  const charsOf = (s: Segment) => s.works.reduce((n, w) => n + w.norm.text.length, 0)
  const left = cls.filter((c) => c.column === 'left')
  const right = cls.filter((c) => c.column === 'right')
  const total = cls.reduce((n, c) => n + charsOf(c.seg), 0)
  const rightChars = right.reduce((n, c) => n + charsOf(c.seg), 0)
  const leftChars = left.reduce((n, c) => n + charsOf(c.seg), 0)
  const twoColumn =
    left.length >= 5 && right.length >= 5 && total > 0 && rightChars / total >= 0.2 && leftChars / total >= 0.2

  if (!twoColumn) {
    const ordered = cls
      .sort((a, b) => a.seg.group - b.seg.group || a.seg.box.left - b.seg.box.left)
      .map((c) => ({ seg: c.seg, column: 'single' as Column }))
    return { ordered, twoColumn }
  }

  // 双栏：跨栏行（标题、通栏图注）作为分隔，分隔之间先左栏后右栏
  const byTop = [...cls].sort((a, b) => a.seg.box.top - b.seg.box.top || a.seg.box.left - b.seg.box.left)
  const ordered: OrderedSeg[] = []
  let bandL: OrderedSeg[] = []
  let bandR: OrderedSeg[] = []
  const flush = () => {
    ordered.push(...bandL, ...bandR)
    bandL = []
    bandR = []
  }
  for (const c of byTop) {
    if (c.column === 'span') {
      flush()
      ordered.push(c)
    } else if (c.column === 'left') bandL.push(c)
    else bandR.push(c)
  }
  flush()
  return { ordered, twoColumn }
}

function textQualityOf(text: string, visible: number): TextQuality {
  if (visible === 0) return 'empty'
  if (visible < LIMITS.sparsePageChars) return 'sparse'
  let odd = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfffd || (cp >= 0xe000 && cp <= 0xf8ff) || (cp < 0x20 && cp !== 0x0a)) odd++
  }
  return odd / visible > 0.3 ? 'garbled' : 'ok'
}

export function buildPage(raw: RawPage): PageFacts {
  const items = toItemFacts(raw)
  const works: Work[] = []
  const vertical: Work[] = []
  for (const fact of items) {
    const norm = normalizeWithMap(fact.str)
    if (norm.text.trim().length === 0) continue
    const w: Work = { fact, norm, cy: (fact.box.top + fact.box.bottom) / 2 }
    if (fact.horizontal) works.push(w)
    else vertical.push(w)
  }

  const segs: Segment[] = []
  clusterBaselines(works).forEach((g, gi) => segs.push(...splitSegments(g, gi, raw.viewWidth)))
  const { ordered, twoColumn } = orderSegments(segs, raw.viewWidth, raw.viewHeight)
  // 竖排/旋转文字（如侧边 arXiv 标记）各自成行，放在最后
  for (const w of vertical) {
    ordered.push({
      seg: { works: [w], box: w.fact.box, fontSize: w.fact.fontSize, group: Number.MAX_SAFE_INTEGER },
      column: 'span',
    })
  }

  let text = ''
  const charItem: number[] = []
  const charOffset: number[] = []
  const charLine: number[] = []
  const lines: LineFact[] = []
  for (const { seg, column } of ordered) {
    const built = assembleLine(seg.works)
    if (built.text.length === 0) continue
    if (lines.length > 0) {
      text += '\n'
      charItem.push(-1)
      charOffset.push(-1)
      charLine.push(lines.length - 1)
    }
    const start = text.length
    text += built.text
    charItem.push(...built.charItem)
    charOffset.push(...built.charOffset)
    for (let k = 0; k < built.text.length; k++) charLine.push(lines.length)
    lines.push({
      index: lines.length,
      text: built.text,
      itemIndices: [...new Set(seg.works.map((w) => w.fact.index))],
      box: seg.box,
      column,
      fontSize: seg.fontSize,
      zone: 'body',
      start,
      end: text.length,
      isHeading: false,
    })
  }

  const visibleCharCount = text.replace(/\s/g, '').length
  const page: PageFacts = {
    documentId: raw.documentId,
    pageNumber: raw.pageNumber,
    width: Math.abs((raw.view[2] ?? 0) - (raw.view[0] ?? 0)),
    height: Math.abs((raw.view[3] ?? 0) - (raw.view[1] ?? 0)),
    rotation: raw.rotation,
    viewWidth: raw.viewWidth,
    viewHeight: raw.viewHeight,
    items,
    lines,
    text,
    charItem,
    charOffset,
    charLine,
    views: [],
    annotations: raw.annotations,
    textQuality: raw.extractionStatus === 'failed' ? 'empty' : textQualityOf(text, visibleCharCount),
    visibleCharCount,
    extractionStatus: raw.extractionStatus,
    extractionError: raw.extractionError,
    twoColumn,
  }
  page.views = buildViews(page)
  attachLinkText(page)
  return page
}
