/**
 * 版面区域判定（文档级）：页眉页脚 → 首页作者区 → 章节状态机（致谢 / 参考文献 / 附录）。
 * 只是启发式：区域只影响优先级与说明，不会因此吞掉命中。
 */
import type { LineFact, PageFacts, Zone } from '@/domain/types'

export const ACK_HEADING = /^\s*(?:\d+(?:\.\d+)*[.)]?\s*)?(?:acknowledg(?:e)?ments?|致\s*谢)\s*[:：]?\s*$/iu
export const ACK_RUN_IN = /^\s*(?:\d+(?:\.\d+)*[.)]?\s*)?(?:acknowledg(?:e)?ments?|致\s*谢)\s*[.:：]\s*\S/iu
const REF_HEADING = /^\s*(?:\d+(?:\.\d+)*[.)]?\s*)?(?:references|bibliography|works\s+cited|参考\s*文献)\s*$/iu
const APPENDIX_HEADING = /^\s*(?:appendix|appendices|supplementary\s+material|附\s*录)\b/iu
const LETTER_HEADING = /^\s*[A-H](?:\.\d+)*\.?\s+\p{Lu}/u
const ABSTRACT_HEADING = /^\s*(?:abstract|摘\s*要)\b/iu
const NUMBERED_HEADING = /^\s*(?:\d+(?:\.\d+){0,3}\.?|[IVX]+\.)\s+\p{Lu}[^.!?]{0,80}$/u
const KNOWN_HEADING =
  /^\s*(?:\d+(?:\.\d+)*[.)]?\s*)?(?:abstract|introduction|related\s+work|background|method(?:s|ology)?|experiments?|results|discussion|conclusions?|limitations|broader\s+impacts?|ethics\s+statement|reproducibility\s+statement|摘\s*要|引\s*言|相关工作|方法|实验|结论|讨论)\s*$/iu

/** 文档主体字号：按字符数加权的中位数 */
export function bodyFontSize(pages: PageFacts[]): number {
  const buckets = new Map<number, number>()
  for (const p of pages)
    for (const l of p.lines) {
      const k = Math.round(l.fontSize * 2) / 2
      buckets.set(k, (buckets.get(k) ?? 0) + l.text.length)
    }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  const total = sorted.reduce((n, [, c]) => n + c, 0)
  let acc = 0
  for (const [size, c] of sorted) {
    acc += c
    if (acc >= total / 2) return size
  }
  return 10
}

function headingLike(line: LineFact, body: number): boolean {
  const t = line.text.trim()
  if (t.length === 0 || t.length > 100) return false
  if (KNOWN_HEADING.test(t) || ACK_HEADING.test(t) || REF_HEADING.test(t)) return true
  if (APPENDIX_HEADING.test(t) && t.length < 80) return true
  if (NUMBERED_HEADING.test(t) && t.length < 80 && line.fontSize >= body * 0.98) return true
  return line.fontSize >= body * 1.15 && t.length < 90 && !/[.,;]$/.test(t)
}

function inHeaderBand(line: LineFact, page: PageFacts): boolean {
  return line.box.bottom <= page.viewHeight * 0.09 && line.text.length < 160
}
function inFooterBand(line: LineFact, page: PageFacts): boolean {
  return line.box.top >= page.viewHeight * 0.91 && line.text.length < 160
}

/** 完整句子：作者区里几乎不会出现 */
const PROSE = /^(?=.{50,}$)(?=.*\b(?:we|the|this|our|is|are)\b)(?!.*@).*[.!?]$/iu

function markAuthorBlock(page: PageFacts, body: number): void {
  const lines = page.lines.filter((l) => l.zone === 'body')
  if (lines.length === 0) return
  const byTop = [...lines].sort((a, b) => a.box.top - b.box.top)
  // 标题：顶部起连续的大字号行（至多 3 行），否则取第一行
  let i = 0
  const first = byTop[0]
  if (!first) return
  if (first.fontSize >= body * 1.15) {
    while (i < byTop.length && i < 3 && (byTop[i]?.fontSize ?? 0) >= body * 1.15) i++
  } else i = 1
  const abstractIdx = byTop.findIndex((l) => ABSTRACT_HEADING.test(l.text))
  // 补充材料 / 附录首页：标题本身是章节标题，没有作者区。
  // 但 “A Study of …” 这类以冠词 A 开头的论文标题也像附录编号，所以后面有 Abstract 时仍按论文首页处理
  if (abstractIdx <= i && byTop.slice(0, i).some((l) => APPENDIX_HEADING.test(l.text) || LETTER_HEADING.test(l.text))) return
  let end: number
  if (abstractIdx > i) end = abstractIdx
  else {
    end = byTop.findIndex((l, k) => k >= i && (l.isHeading || l.box.top > page.viewHeight * 0.4 || PROSE.test(l.text)))
    if (end < 0) end = byTop.length
  }
  for (let k = i; k < end; k++) {
    const l = byTop[k]
    if (l && l.box.top <= page.viewHeight * 0.55) l.zone = 'authorBlock'
  }
}

/** 在所有页的 LineFact 上写入 zone 与 isHeading。 */
export function assignZones(pages: PageFacts[]): void {
  if (pages.length === 0) return
  const body = bodyFontSize(pages)

  for (const page of pages) {
    for (const line of page.lines) {
      line.isHeading = headingLike(line, body)
      if (inHeaderBand(line, page)) line.zone = 'header'
      else if (inFooterBand(line, page)) line.zone = 'footer'
      else line.zone = 'body'
    }
  }

  const firstPage = pages[0]
  if (firstPage) markAuthorBlock(firstPage, body)

  // 章节状态机（按阅读顺序）
  let state: Zone = 'body'
  let ackChars = 0
  let ackStartPage = 0
  let seenReferences = false
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.zone === 'header' || line.zone === 'footer' || line.zone === 'authorBlock') continue
      const t = line.text
      if (line.isHeading || ACK_RUN_IN.test(t)) {
        if (ACK_HEADING.test(t) || ACK_RUN_IN.test(t)) {
          state = 'acknowledgments'
          ackChars = 0
          ackStartPage = page.pageNumber
        } else if (REF_HEADING.test(t)) {
          state = 'references'
          seenReferences = true
        } else if (APPENDIX_HEADING.test(t)) {
          state = 'appendix'
        } else if (seenReferences && state === 'references' && LETTER_HEADING.test(t)) {
          state = 'appendix'
        } else if (state === 'acknowledgments') {
          state = seenReferences ? 'appendix' : 'body'
        } else if (state === 'references' && !LETTER_HEADING.test(t) && line.fontSize >= body * 1.15) {
          state = 'appendix'
        }
      }
      if (state === 'acknowledgments') {
        ackChars += t.length
        if (ackChars > 2000 || page.pageNumber - ackStartPage >= 2) state = seenReferences ? 'appendix' : 'body'
      }
      line.zone = state
    }
  }
}

export function zoneAtChar(page: PageFacts, index: number): Zone {
  const line = page.lines[page.charLine[index] ?? -1]
  return line?.zone ?? 'body'
}
