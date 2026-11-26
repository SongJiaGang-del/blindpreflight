/**
 * 逐码点 Unicode 规范化，并保留到源字符串的偏移映射。
 *
 * - NFKC：连字 ﬁ→fi、全角 ＠→@、上标数字等兼容字符；
 * - 删除：软连字符 U+00AD、零宽字符、BOM、双向控制字符（只用于匹配视图，原文展示另取）；
 * - NBSP / 各类空格 → 普通空格；
 * - 各类连字符/减号 → '-'。
 */

const REMOVE = new Set([
  0x00ad, // soft hyphen
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, // zero width
  0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, // bidi
])

const HYPHENS = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2212, 0xfe63, 0xff0d])

function isSpaceCode(cp: number): boolean {
  return (
    cp === 0x20 ||
    cp === 0x09 ||
    cp === 0x0a ||
    cp === 0x0d ||
    cp === 0xa0 ||
    cp === 0x3000 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x202f ||
    cp === 0x205f
  )
}

export interface MappedText {
  text: string
  /** 每个输出 UTF-16 单元对应源字符串中的 UTF-16 偏移 */
  offsets: number[]
}

export function normalizeWithMap(src: string): MappedText {
  let text = ''
  const offsets: number[] = []
  let i = 0
  while (i < src.length) {
    const cp = src.codePointAt(i) ?? 0
    const unitLen = cp > 0xffff ? 2 : 1
    let out: string
    if (REMOVE.has(cp)) out = ''
    else if (isSpaceCode(cp)) out = ' '
    else if (HYPHENS.has(cp)) out = '-'
    else if (cp < 0x80) out = String.fromCharCode(cp)
    else out = String.fromCodePoint(cp).normalize('NFKC')
    for (let k = 0; k < out.length; k++) {
      text += out[k]
      offsets.push(i)
    }
    i += unitLen
  }
  return { text, offsets }
}

/** 纯字符串规范化（用户词条、元数据字段） */
export function normalizeText(src: string): string {
  return normalizeWithMap(src).text.replace(/\s+/g, ' ').trim()
}

const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ가-힯]/u

export function isCjk(ch: string | undefined): boolean {
  return !!ch && CJK_RE.test(ch)
}

/** 显示前清理双向控制字符，防止报告里的文字被视觉重排。 */
export function stripBidi(s: string): string {
  return s.replace(/[‪-‮⁦-⁩‎‏]/g, '')
}
