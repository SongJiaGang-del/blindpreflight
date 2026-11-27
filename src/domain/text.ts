/**
 * 双语文本。规则、覆盖说明、预设等在生成时同时给出中英文，界面与报告按当前语言取用；
 * 切换语言不需要重新检查（OCR 页也不用重新识别）。
 */
export type Locale = 'zh' | 'en'
export const LOCALES: Locale[] = ['zh', 'en']

export interface Text {
  zh: string
  en: string
}

export function L(zh: string, en: string): Text {
  return { zh, en }
}

/** 同一段文字两种语言相同（文件名、字段名、用户输入等） */
export function same(s: string): Text {
  return { zh: s, en: s }
}

export function pick(t: Text | string | null | undefined, loc: Locale): string {
  if (t == null) return ''
  return typeof t === 'string' ? t : t[loc]
}

/** 拼接多段双语文本 */
export function join(parts: ReadonlyArray<Text | string>, sep: Text | string = ''): Text {
  return {
    zh: parts.map((p) => pick(p, 'zh')).join(pick(sep, 'zh')),
    en: parts.map((p) => pick(p, 'en')).join(pick(sep, 'en')),
  }
}

/** 对两种语言分别做同样的变换 */
export function mapText(t: Text, fn: (s: string, loc: Locale) => string): Text {
  return { zh: fn(t.zh, 'zh'), en: fn(t.en, 'en') }
}

/** 列表分隔：中文用顿号，英文用逗号 */
export const LIST_SEP: Text = { zh: '、', en: ', ' }
