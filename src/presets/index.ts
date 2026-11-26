/**
 * 会场预设。资料核验日期与链接见 sources；规则只是“自检提示”，以会场官方页面为准。
 * implementationStatus：
 *   implemented — 已按该会场条款调整规则；
 *   partial     — 只实现了部分条款；
 *   reference   — 仅提供条款摘要卡片，检查按通用规则执行。
 */
import type { PolicyRef, VenuePreset } from '@/domain/types'

const VERIFIED_AT = '2026-11-09'

const COMMON_LIMITS = [
  '不检查图片、扫描页和图表中的文字（无 OCR）。',
  '不访问任何外部链接，无法确认仓库 / 主页内容是否已匿名。',
  '不能判断第三人称自引是否“过多”——这需要人工判断。',
]

export const PRESETS: VenuePreset[] = [
  {
    id: 'generic',
    venue: '通用双盲',
    year: null,
    track: '—',
    phase: '投稿',
    version: '1',
    verifiedAt: null,
    verificationStatus: 'unverified',
    implementationStatus: 'implemented',
    summary: [
      '作者区、页眉页脚、元数据、批注中不得出现姓名、邮箱、机构。',
      '致谢与资助信息在投稿版中匿名或删除。',
      '自引使用第三人称；代码与数据使用匿名托管。',
    ],
    sources: [],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: COMMON_LIMITS,
  },
  {
    id: 'arr',
    venue: 'ACL Rolling Review',
    year: 2026,
    track: '长文 / 短文',
    phase: '投稿',
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'verified',
    implementationStatus: 'implemented',
    summary: [
      '投稿须匿名；不得包含致谢（AI 写作助手使用说明可按 ARR 要求披露）。',
      '自引用第三人称，不要写 “our previous work”。',
      '代码 / 数据链接须匿名。',
    ],
    sources: [
      { label: 'ARR Author Checklist', url: 'https://aclrollingreview.org/authorchecklist', section: 'Anonymity' },
      { label: 'ARR Call for Papers', url: 'https://aclrollingreview.org/cfp', section: 'Anonymity period / Submission' },
    ],
    ackPolicy: 'aiDisclosureOnly',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: [...COMMON_LIMITS, 'ARR 对预印本的政策随周期调整，请以当期 CFP 为准。'],
  },
  {
    id: 'neurips-2026',
    venue: 'NeurIPS',
    year: 2026,
    track: 'Main Track',
    phase: '投稿',
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'verified',
    implementationStatus: 'implemented',
    summary: [
      '使用模板的匿名选项；投稿版不得包含致谢与资助信息。',
      '补充材料同样必须匿名。',
      '代码链接使用匿名仓库。',
    ],
    sources: [
      { label: 'NeurIPS 2026 Main Track Handbook', url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook', section: 'Double-blind reviewing' },
    ],
    ackPolicy: 'forbidden',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: { R06: 'high' },
    limitations: COMMON_LIMITS,
  },
  {
    id: 'iclr-2026',
    venue: 'ICLR',
    year: 2026,
    track: 'Main',
    phase: '投稿',
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'verified',
    implementationStatus: 'implemented',
    summary: [
      '投稿须匿名（OpenReview 上公开）；致谢放最终版。',
      '页眉应为 “Under review as a conference paper at ICLR 2026”。',
    ],
    sources: [{ label: 'ICLR 2026 Author Guide', url: 'https://www.iclr.cc/Conferences/2026/AuthorGuide', section: 'Anonymity' }],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: COMMON_LIMITS,
  },
  {
    id: 'cvpr-2026',
    venue: 'CVPR',
    year: 2026,
    track: 'Main',
    phase: '投稿',
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'reference',
    summary: [
      '使用 review 模式模板（含行号与 Paper ID），不写作者与致谢。',
      '补充材料与视频同样需要匿名。',
      '本预设只提供条款摘要；检查按通用规则执行。',
    ],
    sources: [{ label: 'CVPR 2026 Author Guidelines', url: 'https://cvpr.thecvf.com/Conferences/2026/AuthorGuidelines', section: 'Blind review' }],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: [...COMMON_LIMITS, '未实现：Paper ID、行号等模板格式检查。'],
  },
  {
    id: 'mobicom-2026',
    venue: 'ACM MobiCom',
    year: 2026,
    track: 'Main',
    phase: '投稿',
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'partial',
    summary: [
      '双盲投稿；格式条款要求检查投稿 PDF 中的外部超链接。',
      '本预设会提示所有可点击外链；其余按通用规则执行。',
    ],
    sources: [{ label: 'MobiCom 2026 Call for Papers', url: 'https://www.sigmobile.org/mobicom/2026/cfp.html', section: 'Submission guidelines' }],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: true,
    linkNote: '该预设把所有内嵌外部链接列为待确认项。',
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: [...COMMON_LIMITS, '未实现：页数、字体与版式检查。'],
  },
  {
    id: 'usenix-sec-2026',
    venue: 'USENIX Security',
    year: 2026,
    track: '—',
    phase: '投稿',
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'reference',
    summary: ['双盲；不在投稿中写作者、致谢与可识别的资助信息。', '本预设只提供条款摘要；检查按通用规则执行。'],
    sources: [
      { label: 'USENIX Security ’26 Call for Papers', url: 'https://www.usenix.org/conference/usenixsecurity26/call-for-papers', section: 'Anonymity' },
    ],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: [...COMMON_LIMITS, '未实现：伦理附录与 Open Science 附录的专项检查。'],
  },
  {
    id: 'ccs-2026',
    venue: 'ACM CCS',
    year: 2026,
    track: '—',
    phase: '投稿',
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'reference',
    summary: ['双盲；作者信息、致谢、资助在投稿版中删除。', '本预设只提供条款摘要；检查按通用规则执行。'],
    sources: [
      { label: 'CCS 2026 Call for Papers', url: 'https://www.sigsac.org/ccs/CCS2026/call-for/call-for-papers.html', section: 'Anonymous submission' },
    ],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: COMMON_LIMITS,
  },
]

export function getPreset(id: string): VenuePreset {
  return PRESETS.find((p) => p.id === id) ?? (PRESETS[0] as VenuePreset)
}

/** 每条规则在当前预设下引用的条款 */
export function policyRefsFor(preset: VenuePreset, ruleId: string): PolicyRef[] {
  return preset.sources.map((s) => ({
    presetId: preset.id,
    label: `${s.label}${s.section ? ' · ' + s.section : ''}`,
    url: s.url,
    note: ruleId === 'R10' && preset.linkNote ? preset.linkNote : `核验于 ${preset.verifiedAt ?? '—'}`,
  }))
}
