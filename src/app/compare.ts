/**
 * 修复前后对比。
 *
 * 发现 ID 含字符位置，改稿后位置会变，所以对比用“内容键”：
 * 文件槽 + 规则 + 来源 + 字段 + 规范化后的命中文字（链接用真实目标）。
 * 同一个键可能出现多次（如多处同一邮箱），按出现顺序一一配对。
 * 只比较前后两次都存在的文件，避免“移除了补充材料”被算成“全部修复”。
 */
import type { Finding, ReviewDecision, ScanResult } from '@/domain/types'

export interface Comparison {
  previousAt: string
  previousPreset: string
  presetChanged: boolean
  fixed: Finding[]
  remaining: Array<{ prev: Finding; next: Finding }>
  added: Finding[]
  /** 上一版标记为“已修改”、但在新版本中仍然存在的发现（新 ID） */
  reopened: string[]
}

export type CompareTag = 'remaining' | 'added'

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function matchKey(f: Finding): string {
  const hit = f.linkTarget ?? (f.matchInSnippet ? f.snippet.slice(f.matchInSnippet[0], f.matchInSnippet[1]) : f.snippet)
  return [f.documentId, f.ruleId, f.source, f.field ?? '', norm(hit)].join('|')
}

export function compareScans(prev: ScanResult, next: ScanResult): Omit<Comparison, 'reopened'> {
  const both = new Set(prev.documents.map((d) => d.id).filter((id) => next.documents.some((d) => d.id === id)))
  const pool = new Map<string, Finding[]>()
  for (const f of prev.findings) {
    if (!both.has(f.documentId)) continue
    const k = matchKey(f)
    const list = pool.get(k)
    if (list) list.push(f)
    else pool.set(k, [f])
  }
  const remaining: Comparison['remaining'] = []
  const added: Finding[] = []
  for (const f of next.findings) {
    if (!both.has(f.documentId)) continue
    const prevF = pool.get(matchKey(f))?.shift()
    if (prevF) remaining.push({ prev: prevF, next: f })
    else added.push(f)
  }
  const fixed = [...pool.values()].flat()
  // 保持原来的发现顺序
  const order = new Map(prev.findings.map((f, i) => [f.id, i]))
  fixed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return {
    previousAt: prev.completedAt,
    previousPreset: prev.preset.id,
    presetChanged: prev.preset.id !== next.preset.id,
    fixed,
    remaining,
    added,
  }
}

/**
 * 把上一版的复核决定带到新版本：
 * - 忽略类（引用他人、第三方、会场要求、误报）原样沿用；
 * - “已修改”却仍然存在的，不沿用，记入 reopened，提醒用户其实没改掉。
 */
export function migrateDecisions(
  cmp: Pick<Comparison, 'remaining'>,
  prevDecisions: ReadonlyMap<string, ReviewDecision>,
): { decisions: Map<string, ReviewDecision>; reopened: string[] } {
  const decisions = new Map<string, ReviewDecision>()
  const reopened: string[] = []
  for (const { prev, next } of cmp.remaining) {
    const d = prevDecisions.get(prev.id)
    if (!d) continue
    if (d.status === 'resolved') reopened.push(next.id)
    else decisions.set(next.id, { ...d, findingId: next.id })
  }
  return { decisions, reopened }
}

export function compareTags(cmp: Comparison | null): Map<string, CompareTag> {
  const m = new Map<string, CompareTag>()
  if (!cmp) return m
  for (const { next } of cmp.remaining) m.set(next.id, 'remaining')
  for (const f of cmp.added) m.set(f.id, 'added')
  return m
}
