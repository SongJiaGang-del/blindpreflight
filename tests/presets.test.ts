import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { PRESETS, allPresets, getBuiltinPreset, getPreset, setCustomPresets } from '@/presets'
import { type CustomPresetSpec, exportSpecsJson, parseSpecsJson, sanitizeSpec, toPreset, validPattern } from '@/presets/custom'
import { RULES, runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import type { ExtractResult } from '@/parsers/pdf/extract'
import { extractSample } from './helpers/node-pdf'

const RULE_IDS = RULES.map((r) => r.id)
const BASE_IDS = PRESETS.map((p) => p.id)

const spec: CustomPresetSpec = {
  id: 'custom-test1',
  venue: 'Example Workshop',
  baseId: 'neurips-2026',
  ackPolicy: 'noIdentity',
  flagAllEmbeddedLinks: true,
  rules: { R06: 'off', R07: 'high', R03: 'info' },
  templateMarker: { pattern: 'Anonymous\\s+Workshop\\s+Submission', label: 'Anonymous Workshop Submission' },
  note: '只用于测试',
}

let leaky: ExtractResult
beforeAll(async () => {
  leaky = await extractSample('sample-leaky.pdf')
})
afterAll(async () => {
  setCustomPresets([])
  await leaky?.pdf.loadingTask.destroy()
})

describe('自定义预设', () => {
  test('在基础预设上覆盖致谢、外链、规则级别与模板标记', () => {
    const p = toPreset(spec, getBuiltinPreset('neurips-2026'))
    expect(p.custom).toBe(true)
    expect(p.ackPolicy).toBe('noIdentity')
    expect(p.flagAllEmbeddedLinks).toBe(true)
    expect(p.disabledRuleIds).toContain('R06')
    // 基础预设把 R06 升为高；停用后不应再有这条覆盖
    expect(p.severityOverrides.R06).toBeUndefined()
    expect(p.severityOverrides.R07).toBe('high')
    expect(p.templateMarker?.label).toBe('Anonymous Workshop Submission')
    expect(p.verificationStatus).toBe('unverified')
    expect(p.limitations.map((l) => l.zh).join()).toMatch(/没有经过核验/)
  })

  test('没有自己的模板标记时沿用基础预设的', () => {
    const p = toPreset({ ...spec, baseId: 'cvpr-2026', templateMarker: null }, getBuiltinPreset('cvpr-2026'))
    expect(p.templateMarker?.label).toMatch(/CONFIDENTIAL REVIEW COPY/)
  })

  test('登记后可被 getPreset 找到，并影响扫描结果', () => {
    setCustomPresets([toPreset(spec, getBuiltinPreset(spec.baseId))])
    expect(allPresets().some((p) => p.id === spec.id)).toBe(true)
    expect(getPreset(spec.id).venue.zh).toBe('Example Workshop')

    const opts = { userTerms: parseUserTerms('Widget Alignment'), strictShortTerms: false }
    const base = runScan([leaky.facts], { ...opts, presetId: 'neurips-2026' })
    const custom = runScan([leaky.facts], { ...opts, presetId: spec.id })
    expect(base.findings.some((f) => f.ruleIds.includes('R06'))).toBe(true)
    expect(custom.findings.some((f) => f.ruleIds.includes('R06'))).toBe(false)
    expect(custom.rules.find((r) => r.ruleId === 'R06')?.status).toBe('disabled')
    expect(custom.findings.filter((f) => f.ruleId === 'R07').every((f) => f.severity === 'high')).toBe(true)
    expect(custom.findings.filter((f) => f.ruleId === 'R03').every((f) => f.severity === 'info')).toBe(true)
    expect(custom.findings.some((f) => f.ruleId === 'R21')).toBe(true)
  })

  test('校验：拒绝畸形数据，过滤未知规则、非法级别与无效正则', () => {
    expect(sanitizeSpec(null, RULE_IDS, BASE_IDS)).toBeNull()
    expect(sanitizeSpec({ ...spec, id: 'generic' }, RULE_IDS, BASE_IDS)).toBeNull()
    expect(sanitizeSpec({ ...spec, venue: '   ' }, RULE_IDS, BASE_IDS)).toBeNull()
    const s = sanitizeSpec(
      { ...spec, baseId: 'nope', ackPolicy: 'whatever', rules: { R06: 'off', R99: 'high', R07: 'loud' }, templateMarker: { pattern: '(' } },
      RULE_IDS,
      BASE_IDS,
    )!
    expect(s.baseId).toBe('generic')
    expect(s.ackPolicy).toBe('noIdentity')
    expect(s.rules).toEqual({ R06: 'off' })
    expect(s.templateMarker).toBeNull()
    expect(validPattern('(')).toBe(false)
    expect(validPattern('')).toBe(true)
  })

  test('导出 / 导入往返', () => {
    const json = exportSpecsJson([spec])
    expect(JSON.parse(json).kind).toBe('blindpreflight-presets')
    expect(parseSpecsJson(json, RULE_IDS, BASE_IDS)).toEqual([spec])
    expect(() => parseSpecsJson('{"x":1}', RULE_IDS, BASE_IDS)).toThrow()
  })
})
