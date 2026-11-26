/**
 * 自定义会场预设：在某个内置预设的基础上调整致谢政策、外链提示、规则级别与模板标记。
 * 只是规则设置，不含任何稿件内容；保存在本机 localStorage，可导出 / 导入 JSON 与合作者共享。
 */
import type { AckPolicy, Severity, VenuePreset } from '@/domain/types'

export interface CustomPresetSpec {
  id: string
  venue: string
  baseId: string
  ackPolicy: AckPolicy
  flagAllEmbeddedLinks: boolean
  /** 规则 → 级别；'off' 表示停用 */
  rules: Record<string, Severity | 'off'>
  templateMarker: { pattern: string; label: string } | null
  note: string
}

export const CUSTOM_KEY = 'blindpreflight.presets.v1'
export const CUSTOM_FILE_KIND = 'blindpreflight-presets'
const MAX_PRESETS = 30
const ACK: AckPolicy[] = ['forbidden', 'aiDisclosureOnly', 'noIdentity']
const LEVELS = new Set(['high', 'medium', 'info', 'off'])

export const ACK_LABEL: Record<AckPolicy, string> = {
  forbidden: '投稿版不得包含致谢',
  aiDisclosureOnly: '只允许 AI 使用说明',
  noIdentity: '可以有致谢，但不得含身份信息',
}

export function newCustomId(): string {
  const c = globalThis.crypto
  const r = c && 'randomUUID' in c ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `custom-${r}`
}

/** 正则是否可用（空串视为“不检查”） */
export function validPattern(p: string): boolean {
  if (!p.trim()) return true
  try {
    new RegExp(p, 'iu')
    return true
  } catch {
    return false
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** 校验并规范化一条外部来源的数据（localStorage / 导入文件）；不合格返回 null */
export function sanitizeSpec(raw: unknown, knownRuleIds: readonly string[], knownBaseIds: readonly string[]): CustomPresetSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.id, 64)
  const venue = str(o.venue, 60).trim()
  if (!/^custom-[\w-]{1,40}$/.test(id) || !venue) return null
  const baseId = knownBaseIds.includes(str(o.baseId, 64)) ? str(o.baseId, 64) : 'generic'
  const ackPolicy = ACK.includes(o.ackPolicy as AckPolicy) ? (o.ackPolicy as AckPolicy) : 'noIdentity'
  const rules: CustomPresetSpec['rules'] = {}
  if (o.rules && typeof o.rules === 'object') {
    for (const [k, v] of Object.entries(o.rules as Record<string, unknown>)) {
      if (knownRuleIds.includes(k) && typeof v === 'string' && LEVELS.has(v)) rules[k] = v as Severity | 'off'
    }
  }
  let templateMarker: CustomPresetSpec['templateMarker'] = null
  const tm = o.templateMarker as Record<string, unknown> | null | undefined
  if (tm && typeof tm === 'object') {
    const pattern = str(tm.pattern, 300)
    if (pattern.trim() && validPattern(pattern)) templateMarker = { pattern, label: str(tm.label, 120) || pattern }
  }
  return { id, venue, baseId, ackPolicy, flagAllEmbeddedLinks: o.flagAllEmbeddedLinks === true, rules, templateMarker, note: str(o.note, 300) }
}

export function toPreset(spec: CustomPresetSpec, base: VenuePreset): VenuePreset {
  const disabled = Object.entries(spec.rules).filter(([, v]) => v === 'off').map(([k]) => k)
  const overrides: Record<string, Severity> = { ...base.severityOverrides }
  for (const [k, v] of Object.entries(spec.rules)) if (v !== 'off') overrides[k] = v
  for (const k of disabled) delete overrides[k]
  const changed = Object.keys(spec.rules).length
  return {
    ...base,
    id: spec.id,
    venue: spec.venue,
    year: null,
    version: 'custom',
    verifiedAt: null,
    verificationStatus: 'unverified',
    implementationStatus: 'implemented',
    summary: [
      ...(spec.note ? [spec.note] : []),
      `基于“${base.venue}${base.year ? ` ${base.year}` : ''}”。致谢：${ACK_LABEL[spec.ackPolicy]}。`,
      changed ? `调整了 ${changed} 条规则${disabled.length ? `（停用 ${disabled.join('、')}）` : ''}。` : '规则级别与基础预设相同。',
      ...(spec.flagAllEmbeddedLinks ? ['所有可点击外链都列为待确认项。'] : []),
    ],
    sources: [],
    ackPolicy: spec.ackPolicy,
    flagAllEmbeddedLinks: spec.flagAllEmbeddedLinks,
    linkNote: spec.flagAllEmbeddedLinks ? '该自定义预设把所有内嵌外部链接列为待确认项。' : null,
    disabledRuleIds: [...new Set([...base.disabledRuleIds, ...disabled])],
    severityOverrides: overrides,
    limitations: [...base.limitations, '这是你自己定义的预设，条款内容没有经过核验。'],
    // 没有自己的模板标记时沿用基础预设的；要关掉这项检查，把 R21 设为停用
    templateMarker: spec.templateMarker
      ? { ...spec.templateMarker, suggestion: '确认使用了会场模板的审稿（匿名）模式。' }
      : (base.templateMarker ?? null),
    custom: true,
  }
}

export function loadCustomSpecs(knownRuleIds: readonly string[], knownBaseIds: readonly string[]): CustomPresetSpec[] {
  try {
    const raw = globalThis.localStorage?.getItem(CUSTOM_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr
      .slice(0, MAX_PRESETS)
      .map((x) => sanitizeSpec(x, knownRuleIds, knownBaseIds))
      .filter((x): x is CustomPresetSpec => !!x)
  } catch {
    return []
  }
}

export function saveCustomSpecs(list: CustomPresetSpec[]): void {
  try {
    globalThis.localStorage?.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, MAX_PRESETS)))
  } catch {
    /* 隐私模式等：忽略 */
  }
}

export function exportSpecsJson(list: CustomPresetSpec[]): string {
  return JSON.stringify({ kind: CUSTOM_FILE_KIND, version: 1, presets: list }, null, 2)
}

/** 解析导入的 JSON；返回合格的条目（id 冲突时由调用方决定覆盖） */
export function parseSpecsJson(text: string, knownRuleIds: readonly string[], knownBaseIds: readonly string[]): CustomPresetSpec[] {
  const data: unknown = JSON.parse(text)
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { presets?: unknown }).presets : null
  if (!Array.isArray(list)) throw new Error('format')
  return list
    .slice(0, MAX_PRESETS)
    .map((x) => sanitizeSpec(x, knownRuleIds, knownBaseIds))
    .filter((x): x is CustomPresetSpec => !!x)
}
