/**
 * 用户自定义词条与元数据派生姓名：规范化、歧义判定、构造匹配正则。
 */
import type { DocumentFacts, UserTerm } from '@/domain/types'
import { isCjk, normalizeText } from '@/normalize/unicode'
import type { DerivedName } from './core'
import { ANON_PLACEHOLDER, escapeRegExp } from './patterns'

/** 常见英文词（单独作为词条时极易误报） */
const COMMON_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'model', 'models', 'data', 'learning', 'network', 'networks', 'method', 'paper',
  'example', 'sample', 'test', 'lab', 'group', 'team', 'university', 'institute', 'school', 'college', 'center',
  'young', 'long', 'wang', 'li', 'zhang', 'liu', 'chen', 'yang', 'huang', 'zhao', 'wu', 'zhou', 'xu', 'sun', 'ma', 'lee',
  'kim', 'park', 'smith', 'brown', 'white', 'green', 'black', 'king', 'hall', 'wood', 'may', 'rose', 'lu', 'he', 'hu',
])

export function isAmbiguousTerm(normalized: string): boolean {
  const t = normalized.trim()
  if (t.length === 0) return true
  const chars = [...t]
  if (chars.every((c) => isCjk(c))) return chars.length < 2
  if (/\s/.test(t)) return false
  if (t.length <= 3) return true
  return COMMON_WORDS.has(t.toLowerCase())
}

/** 解析用户输入（每行一个，或用逗号 / 分号分隔），去重 */
export function parseUserTerms(input: string): UserTerm[] {
  const seen = new Set<string>()
  const out: UserTerm[] = []
  for (const piece of input.split(/[\n,;，；、]+/u)) {
    const normalized = normalizeText(piece)
    if (!normalized || normalized.length > 120) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ raw: piece.trim(), normalized, ambiguous: isAmbiguousTerm(normalized) })
  }
  return out
}

const WORDISH = /[\p{L}\p{N}]/u

/**
 * 词条 → 正则：词内空白匹配任意空白（含跨行），连字符/点可有可无空白；
 * 拉丁字母边界用 Unicode 字母数字前后断言，中文词条不加边界。
 */
export function termRegex(normalized: string): RegExp {
  const t = normalized.trim()
  const body = [...t]
    .map((ch) => (/\s/.test(ch) ? '\\s+' : ch === '-' ? '\\s?-\\s?' : escapeRegExp(ch)))
    .join('')
  const first = t[0] ?? ''
  const last = t[t.length - 1] ?? ''
  const pre = WORDISH.test(first) && !isCjk(first) ? '(?<![\\p{L}\\p{N}])' : ''
  const post = WORDISH.test(last) && !isCjk(last) ? '(?![\\p{L}\\p{N}])' : ''
  return new RegExp(pre + body + post, 'giu')
}

export function isAnonymousPlaceholder(value: string): boolean {
  const v = normalizeText(value)
  if (!v) return true
  return ANON_PLACEHOLDER.test(v)
}

/** 从作者字段拆出姓名：分号、逗号、and、& 分隔 */
export function splitNames(value: string): string[] {
  return normalizeText(value)
    .split(/\s*(?:[;,，；、]|\band\b|&|\|)\s*/iu)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isAnonymousPlaceholder(s))
}

function plausibleName(name: string): boolean {
  if (/[@/\\:]/.test(name) || /\d/.test(name)) return false
  const chars = [...name]
  if (chars.every((c) => isCjk(c))) return chars.length >= 2 && chars.length <= 5
  const tokens = name.split(/\s+/).filter(Boolean)
  return tokens.length >= 2 && tokens.length <= 5 && tokens.every((t) => /^\p{L}[\p{L}.'-]*$/u.test(t))
}

const AUTHOR_FIELDS = [/^Author$/i, /^dc:creator$/i, /^pdf:author$/i, /^xmp:author$/i, /^Custom\.(?:Authors?|Creator)$/i]

/** 汇总所有文档元数据中的真实作者姓名（只用于在正文中继续查找，不对外发送） */
export function deriveNames(docs: DocumentFacts[]): DerivedName[] {
  const out: DerivedName[] = []
  const seen = new Set<string>()
  for (const doc of docs) {
    const fields: Array<[string, string]> = [
      ...Object.entries(doc.info).map(([k, v]): [string, string] => [`Info.${k}`, v]),
      ...Object.entries(doc.xmp ?? {}).map(([k, v]): [string, string] => [`XMP.${k}`, v]),
    ]
    for (const [field, value] of fields) {
      const bare = field.replace(/^(?:Info|XMP)\./, '')
      if (!AUTHOR_FIELDS.some((re) => re.test(bare))) continue
      for (const name of splitNames(value)) {
        if (!plausibleName(name)) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const tokens = [...name].every((c) => isCjk(c)) ? [name] : name.toLowerCase().split(/\s+/).filter((t) => t.length >= 2)
        out.push({ raw: name, tokens, source: `${doc.displayName} 的 ${field}` })
      }
    }
  }
  return out
}

/** 邮箱本地部分是否像这些姓名之一（alex.example / aexample / alex_e） */
export function localPartMatchesName(local: string, names: Array<{ tokens: string[] }>): boolean {
  const l = local.toLowerCase().replace(/[^a-z0-9]/g, ' ')
  const parts = l.split(/\s+/).filter(Boolean)
  const compact = parts.join('')
  for (const n of names) {
    const toks = n.tokens.map((t) => t.toLowerCase().replace(/[^a-z]/g, '')).filter((t) => t.length >= 2)
    if (toks.length === 0) continue
    const surname = toks[toks.length - 1] ?? ''
    const given = toks[0] ?? ''
    if (surname.length >= 3 && parts.includes(surname)) return true
    if (surname.length >= 4 && compact.includes(surname) && (compact.startsWith(given[0] ?? '#') || compact.includes(given)))
      return true
    if (given.length >= 3 && parts.includes(given) && compact.length <= given.length + 3) return true
  }
  return false
}
