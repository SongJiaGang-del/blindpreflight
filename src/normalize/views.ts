import type { PageFacts, TextView } from '@/domain/types'

const JOIN_BEFORE = new Set(['@', '.', '/', '_', '-', ':'])
const JOIN_AFTER = new Set(['@', '.', '/'])

/**
 * 在基准文本上生成三种匹配视图：
 * - flat：换行→空格（长度不变，toBase 为恒等）
 * - dehyphenated：仅同栏相邻行、上一行「字母-」结尾且下一行小写字母开头时合并
 * - joined：行尾/行首为 URL/邮箱分隔符时直接拼接，用于跨行邮箱与网址
 * 三个视图的命中最终都映射回基准下标后去重。
 */
export function buildViews(page: Pick<PageFacts, 'text' | 'charLine' | 'lines'>): TextView[] {
  const t = page.text
  const flatChars: string[] = []
  const flatMap: number[] = []
  const dehy: string[] = []
  const dehyMap: number[] = []
  const joined: string[] = []
  const joinedMap: number[] = []

  for (let i = 0; i < t.length; i++) {
    const ch = t[i] ?? ''
    if (ch !== '\n') {
      flatChars.push(ch)
      flatMap.push(i)
      dehy.push(ch)
      dehyMap.push(i)
      joined.push(ch)
      joinedMap.push(i)
      continue
    }
    flatChars.push(' ')
    flatMap.push(i)

    const prev = t[i - 1] ?? ''
    const prev2 = t[i - 2] ?? ''
    const next = t[i + 1] ?? ''
    const lineA = page.lines[page.charLine[i - 1] ?? -1]
    const lineB = page.lines[page.charLine[i + 1] ?? -1]
    const sameColumn = !!lineA && !!lineB && lineA.column === lineB.column
    // 两行之间的空白不超过约一行高：页脚页码、侧边戳不会被拼进上一行的网址
    const adjacent =
      !!lineA && !!lineB && lineB.box.top - lineA.box.bottom < Math.max(lineA.fontSize, lineB.fontSize) * 1.2

    if (prev === '-' && /\p{L}/u.test(prev2) && /\p{Ll}/u.test(next) && sameColumn) {
      dehy.pop()
      dehyMap.pop()
    } else {
      dehy.push(' ')
      dehyMap.push(i)
    }

    // 句号 / 冒号后接大写字母是句子边界，而不是被折行的网址
    const sentenceBreak = (prev === '.' || prev === ':') && /\p{Lu}/u.test(next)
    if (sameColumn && adjacent && !sentenceBreak && (JOIN_BEFORE.has(prev) || JOIN_AFTER.has(next))) {
      // 直接拼接
    } else {
      joined.push(' ')
      joinedMap.push(i)
    }
  }

  return [
    { name: 'flat', text: flatChars.join(''), toBase: flatMap },
    { name: 'dehyphenated', text: dehy.join(''), toBase: dehyMap },
    { name: 'joined', text: joined.join(''), toBase: joinedMap },
  ]
}

/** 视图范围 [start, end) → 基准范围 [start, end) */
export function viewRangeToBase(view: TextView, start: number, end: number): [number, number] {
  const s = view.toBase[start] ?? 0
  const e = (view.toBase[Math.max(start, end - 1)] ?? s) + 1
  return [s, e]
}
