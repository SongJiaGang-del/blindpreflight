/**
 * 纯文本安全工具：界面一律用 Vue 文本插值（自动转义），这里只处理
 * - 双向控制字符可视化（防止 “文件名.fdp.exe” 一类的视觉欺骗）
 * - 打印报告 HTML 的转义
 * - 外链只允许 http(s)
 */

const BIDI = /[‎‏‪-‮⁦-⁩؜]/gu

/** 把双向控制字符显示为 ⟨U+202E⟩，原文其它字符不变 */
export function visibleText(s: string): string {
  return s.replace(BIDI, (c) => `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`)
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

export function escapeHtml(s: string): string {
  return visibleText(s).replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c] ?? c)
}

/** 只有 http(s) 才可被用户主动打开；javascript: / data: / file: 等一律拒绝 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** 在用户确认后以 noopener / noreferrer 打开 */
export function openExternal(raw: string): boolean {
  const url = safeExternalUrl(raw)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

/** 脱敏：每个词保留首字符，其余替换为 • ；CJK 每个字替换 */
export function maskText(s: string): string {
  return s.replace(/[\p{L}\p{N}][\p{L}\p{N}._%+-]*/gu, (w) => {
    if (/\p{Script=Han}/u.test(w)) return '•'.repeat([...w].length)
    const chars = [...w]
    return chars[0] + '•'.repeat(Math.max(0, chars.length - 1))
  })
}

/** 脱敏原因文字中被「」或 “” 引起来的部分（姓名、自定义词、网址） */
export function maskQuoted(s: string): string {
  return s.replace(/「([^」]*)」/gu, (_, a: string) => `「${maskText(a)}」`).replace(/“([^”]*)”/gu, (_, a: string) => `“${maskText(a)}”`)
}

/** 主机名脱敏：保留顶级域，其余每段打码（机构域名本身可识别身份） */
function maskHost(host: string): string {
  const labels = host.split('.')
  return labels.map((l, i) => (i === labels.length - 1 ? l : maskText(l))).join('.')
}

/** 网址脱敏：路径逐段打码；主机名只有 keepHost 为真（公共平台）时保留 */
export function maskUrl(raw: string, keepHost = true): string {
  try {
    const u = new URL(raw)
    const path = u.pathname
      .split('/')
      .map((seg) => (seg ? maskText(seg) : seg))
      .join('/')
    const host = keepHost ? u.host : maskHost(u.hostname) + (u.port ? `:${u.port}` : '')
    return `${u.protocol}//${host}${path}${u.search ? '?…' : ''}`
  } catch {
    return maskText(raw)
  }
}

/** 文本中出现的网址逐个脱敏 */
export function maskUrlsIn(s: string, keepHost: (url: string) => boolean = () => true): string {
  return s.replace(/https?:\/\/[^\s，。；、)）\]]+/giu, (u) => maskUrl(u, keepHost(u)))
}
