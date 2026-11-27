/**
 * 界面语言：中文 / English。偏好单独存一个 localStorage 键；首次打开按浏览器语言选择。
 * 界面文字用消息键（t），规则生成的双语文本用 tx 取当前语言。
 */
import { computed, ref } from 'vue'
import { type Locale, type Text, pick } from '@/domain/text'
import { zh } from './zh'
import { en } from './en'

export type { Locale } from '@/domain/text'

const KEY = 'blindpreflight.locale.v1'
const CATALOG: Record<Locale, Record<string, string>> = { zh, en }

function initial(): Locale {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    if (v === 'zh' || v === 'en') return v
  } catch {
    /* 忽略 */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  return /^zh\b/i.test(nav) || !nav ? 'zh' : 'en'
}

const locale = ref<Locale>(initial())

function applyDocument(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : 'en'
  document.title = translate('app.title')
}

export function setLocale(l: Locale): void {
  locale.value = l
  try {
    globalThis.localStorage?.setItem(KEY, l)
  } catch {
    /* 忽略 */
  }
  applyDocument()
}

export function getLocale(): Locale {
  return locale.value
}

/** 消息键 → 当前语言文字；{name} 形式的占位符用 params 替换 */
export function translate(key: string, params?: Record<string, string | number>, loc: Locale = locale.value): string {
  const msg = CATALOG[loc][key] ?? CATALOG.zh[key] ?? key
  if (!params) return msg
  return msg.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

applyDocument()

export function useI18n() {
  return {
    locale,
    isEn: computed(() => locale.value === 'en'),
    setLocale,
    t: (key: string, params?: Record<string, string | number>) => translate(key, params, locale.value),
    tx: (text: Text | string | null | undefined) => pick(text, locale.value),
  }
}
