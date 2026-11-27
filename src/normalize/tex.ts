/**
 * LaTeX 源码的轻量工具：不做完整解析，只处理匿名检查需要的几件事——
 * 带平衡花括号的命令参数、注释与被关掉的代码块、\author 中的姓名。
 */

export interface TexArg {
  /** 命令起点（反斜杠位置） */
  start: number
  /** 参数结束（右花括号之后） */
  end: number
  /** 参数内容（不含外层花括号） */
  content: string
  /** 参数内容在原文中的起点 */
  contentStart: number
}

/** 找出所有 \name[可选]{参数}，参数允许嵌套花括号；跳过被注释掉的命令 */
export function texCommands(text: string, name: string, comments?: ReadonlyArray<[number, number]>): TexArg[] {
  const out: TexArg[] = []
  const re = new RegExp(`\\\\${name}\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`, 'g')
  for (const m of text.matchAll(re)) {
    const start = m.index
    if (comments && inRanges(start, comments)) continue
    const open = start + m[0].length - 1
    let depth = 0
    let i = open
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '\\') {
        i++
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) continue
    out.push({ start, end: i + 1, content: text.slice(open + 1, i), contentStart: open + 1 })
  }
  return out
}

export function inRanges(pos: number, ranges: ReadonlyArray<[number, number]>): boolean {
  for (const [a, b] of ranges) if (pos >= a && pos < b) return true
  return false
}

/**
 * 注释与被关掉的内容：行内 %（未转义）到行尾、\iffalse … \fi、\begin{comment} … \end{comment}。
 * 这些内容不会出现在 PDF 里，但会随源码（arXiv、补充材料）一起公开。
 */
export function texHiddenRanges(text: string): Array<[number, number, 'comment' | 'iffalse' | 'commentEnv']> {
  const out: Array<[number, number, 'comment' | 'iffalse' | 'commentEnv']> = []
  let lineStart = 0
  while (lineStart <= text.length) {
    let nl = text.indexOf('\n', lineStart)
    if (nl === -1) nl = text.length
    for (let i = lineStart; i < nl; i++) {
      if (text[i] === '\\') {
        i++
        continue
      }
      if (text[i] === '%') {
        out.push([i, nl, 'comment'])
        break
      }
    }
    lineStart = nl + 1
  }
  const commented = out.map(([a, b]) => [a, b] as [number, number])
  for (const m of text.matchAll(/\\iffalse\b/g)) {
    if (inRanges(m.index, commented)) continue
    // 找到匹配的 \fi（允许嵌套 \if…）
    let depth = 1
    const re = /\\(if[a-zA-Z@]*|fi)\b/g
    re.lastIndex = m.index + m[0].length
    let end = text.length
    for (let x = re.exec(text); x; x = re.exec(text)) {
      if (inRanges(x.index, commented)) continue
      if (x[1] === 'fi') depth--
      else depth++
      if (depth === 0) {
        end = x.index + x[0].length
        break
      }
    }
    out.push([m.index, end, 'iffalse'])
  }
  for (const m of text.matchAll(/\\begin\{comment\}([\s\S]*?)\\end\{comment\}/g)) {
    if (!inRanges(m.index, commented)) out.push([m.index, m.index + m[0].length, 'commentEnv'])
  }
  return out
}

/** 去掉 LaTeX 标记，留下可读文字（用于姓名提取） */
function plain(s: string): string {
  return s
    .replace(/\\(?:thanks|footnote|footnotemark|textsuperscript|inst|affil|email|orcid|institution|affiliation)\*?\s*(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\(?:textbf|textit|emph|textrm|textsc|mbox|text|bf|it|rm|sc)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NOT_NAME = /^(?:anonymous|authors?|submission|paper|id|university|institute|department|lab|laboratory|school|college|inc|ltd|corp|and)$/i

function plausibleName(s: string): boolean {
  if (/[@/\\:\d]/.test(s)) return false
  if ([...s].every((c) => /\p{Script=Han}/u.test(c))) return s.length >= 2 && s.length <= 5
  const tokens = s.split(/\s+/).filter(Boolean)
  if (tokens.length < 2 || tokens.length > 5) return false
  if (tokens.some((t) => NOT_NAME.test(t))) return false
  return tokens.every((t) => /^\p{Lu}[\p{L}.'’-]*$/u.test(t))
}

/** \author{…} 中的姓名（用 \and / \AND / \\ / 逗号 / 换行分隔） */
export function texAuthorNames(texts: string[]): string[] {
  const out = new Set<string>()
  for (const text of texts) {
    const hidden = texHiddenRanges(text).map(([a, b]) => [a, b] as [number, number])
    for (const a of texCommands(text, 'author', hidden)) {
      // 先去掉注释，再按分隔符切开
      const body = a.content.replace(/(^|[^\\])%[^\n]*/g, '$1')
      // \and（article）、\And / \AND（NeurIPS、ICML 等）
      for (const part of body.split(/\\and\b|\\\\|,|;|\n/i)) {
        const name = plain(part)
        if (plausibleName(name)) out.add(name)
      }
    }
  }
  return [...out]
}

/** 原文中某个位置所在的行号（从 1 开始）与行文本 */
export function lineAt(text: string, pos: number): { line: number; start: number; text: string } {
  let line = 1
  let start = 0
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      start = i + 1
    }
  }
  let end = text.indexOf('\n', start)
  if (end === -1) end = text.length
  return { line, start, text: text.slice(start, end) }
}
