import type { PageFacts } from '@/domain/types'
import { bboxContains } from '@/utils/geometry'
import { originalText } from './mapping'

/** 找出链接矩形覆盖的可见文字（只用于展示「可见文本 vs 真实目标」） */
export function attachLinkText(page: PageFacts): void {
  const links = page.annotations.filter((a) => a.rect && (a.url || a.hasDest))
  if (links.length === 0) return
  for (const link of links) {
    const rect = link.rect
    if (!rect) continue
    const hit: number[] = []
    for (let i = 0; i < page.text.length; i++) {
      const itemIndex = page.charItem[i] ?? -1
      if (itemIndex < 0) continue
      const item = page.items[itemIndex]
      if (!item) continue
      const g = item.geom
      const len = Math.max(1, item.str.length)
      const f = ((page.charOffset[i] ?? 0) + 0.5) / len
      const px = g.ox + g.ux * g.w * f + g.vx * 0.35 * g.h
      const py = g.oy + g.uy * g.w * f + g.vy * 0.35 * g.h
      if (bboxContains(rect, px, py, 1)) hit.push(i)
    }
    if (hit.length === 0) continue
    // 连续段落合并
    const parts: string[] = []
    let s = hit[0] ?? 0
    let prev = s
    for (let k = 1; k <= hit.length; k++) {
      const cur = hit[k]
      if (cur !== undefined && cur <= prev + 2) {
        prev = cur
        continue
      }
      parts.push(originalText(page, s, prev + 1).trim())
      if (cur !== undefined) {
        s = cur
        prev = cur
      }
    }
    link.visibleText = parts.filter(Boolean).join(' ').slice(0, 240)
  }
}
