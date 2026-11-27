/**
 * 会场预设。资料核验日期与链接见 sources；规则只是“自检提示”，以会场官方页面为准。
 * implementationStatus：
 *   implemented — 已按该会场条款调整规则；
 *   partial     — 只实现了部分条款；
 *   reference   — 仅提供条款摘要卡片，检查按通用规则执行。
 */
import type { PolicyRef, VenuePreset } from '@/domain/types'
import { L, same, type Locale, type Text, pick } from '@/domain/text'

const VERIFIED_AT = '2026-11-09'
const SUBMISSION = L('投稿', 'Submission')
const DASH = same('—')

const COMMON_LIMITS: Text[] = [
  L(
    '本地 OCR 默认关闭；开启后只识别扫描页 / 图片页，文字正常的页面里的插图与图表不识别。',
    'Local OCR is off by default; when on, it only reads scanned / image-only pages, not figures on normal pages.',
  ),
  L('不访问任何外部链接，无法确认仓库 / 主页内容是否已匿名。', 'External links are never visited, so repository / homepage contents cannot be confirmed as anonymous.'),
  L('不能判断第三人称自引是否“过多”——这需要人工判断。', 'Whether third-person self-citations are “too many” needs human judgement.'),
]

export const PRESETS: VenuePreset[] = [
  {
    id: 'generic',
    venue: L('通用双盲', 'Generic double-blind'),
    year: null,
    track: DASH,
    phase: SUBMISSION,
    version: '1',
    verifiedAt: null,
    verificationStatus: 'unverified',
    implementationStatus: 'implemented',
    summary: [
      L('作者区、页眉页脚、元数据、批注中不得出现姓名、邮箱、机构。', 'No names, emails or institutions in the author block, headers / footers, metadata or annotations.'),
      L('致谢与资助信息在投稿版中匿名或删除。', 'Acknowledgments and funding are anonymized or removed in the submission.'),
      L('自引使用第三人称；代码与数据使用匿名托管。', 'Self-citations in the third person; code and data on anonymous hosting.'),
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
    venue: same('ACL Rolling Review'),
    year: 2026,
    track: L('长文 / 短文', 'Long / short papers'),
    phase: SUBMISSION,
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'verified',
    implementationStatus: 'implemented',
    summary: [
      L(
        '投稿须匿名；不得包含致谢（AI 写作助手使用说明可按 ARR 要求披露）。',
        'Submissions must be anonymous with no acknowledgments (AI writing-assistant use may be disclosed as ARR requires).',
      ),
      L('自引用第三人称，不要写 “our previous work”。', 'Cite yourself in the third person; avoid “our previous work”.'),
      L('代码 / 数据链接须匿名。', 'Code / data links must be anonymous.'),
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
    limitations: [...COMMON_LIMITS, L('ARR 对预印本的政策随周期调整，请以当期 CFP 为准。', 'ARR’s preprint policy changes by cycle; follow the current CFP.')],
  },
  {
    id: 'neurips-2026',
    venue: same('NeurIPS'),
    year: 2026,
    track: same('Main Track'),
    phase: SUBMISSION,
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'verified',
    implementationStatus: 'implemented',
    summary: [
      L('使用模板的匿名选项；投稿版不得包含致谢与资助信息。', 'Use the template’s anonymous option; no acknowledgments or funding in the submission.'),
      L('补充材料同样必须匿名。', 'Supplementary material must be anonymous too.'),
      L('代码链接使用匿名仓库。', 'Link code through anonymous repositories.'),
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
    venue: same('ICLR'),
    year: 2026,
    track: same('Main'),
    phase: SUBMISSION,
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'verified',
    implementationStatus: 'implemented',
    summary: [
      L('投稿须匿名（OpenReview 上公开）；致谢放最终版。', 'Submissions are anonymous (public on OpenReview); acknowledgments go in the final version.'),
      L('页眉应为 “Under review as a conference paper at ICLR 2026”。', 'The header should read “Under review as a conference paper at ICLR 2026”.'),
    ],
    sources: [{ label: 'ICLR 2026 Author Guide', url: 'https://www.iclr.cc/Conferences/2026/AuthorGuide', section: 'Anonymity' }],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: COMMON_LIMITS,
    templateMarker: {
      pattern: String.raw`Under\s+review\s+as\s+a\s+conference\s+paper\s+at\s+ICLR`,
      label: 'Under review as a conference paper at ICLR',
      suggestion: L(
        String.raw`使用 ICLR 官方模板的默认（投稿）模式，不要加 \iclrfinalcopy。`,
        String.raw`Use the official ICLR template in its default (submission) mode, without \iclrfinalcopy.`,
      ),
    },
  },
  {
    id: 'cvpr-2026',
    venue: same('CVPR'),
    year: 2026,
    track: same('Main'),
    phase: SUBMISSION,
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'implemented',
    summary: [
      L('使用 review 模式模板（含行号与 Paper ID），不写作者与致谢。', 'Use the review-mode template (line numbers and Paper ID); no authors or acknowledgments.'),
      L('补充材料与视频同样需要匿名。', 'Supplementary material and videos must be anonymous too.'),
      L(
        '本预设：致谢按“禁止”处理，资助信息升为高优先级，并检查审稿模板标记。',
        'This preset forbids acknowledgments, raises funding to High and checks the review-template marker.',
      ),
    ],
    sources: [{ label: 'CVPR 2026 Author Guidelines', url: 'https://cvpr.thecvf.com/Conferences/2026/AuthorGuidelines', section: 'Blind review' }],
    ackPolicy: 'forbidden',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: { R06: 'high' },
    limitations: [
      ...COMMON_LIMITS,
      L('未实现：行号与 Paper ID 数字本身的检查；补充视频需人工核对。', 'Not implemented: checking line numbers or the Paper ID itself; supplementary videos need a manual check.'),
    ],
    templateMarker: {
      pattern: String.raw`CONFIDENTIAL\s+REVIEW\s+COPY|Submission\s*#`,
      label: 'CVPR 20xx Submission #… CONFIDENTIAL REVIEW COPY',
      suggestion: L(
        String.raw`使用 CVPR 官方模板的 review 模式（\usepackage[review]{cvpr}）并填入 Paper ID。`,
        String.raw`Use the official CVPR template in review mode (\usepackage[review]{cvpr}) and fill in the Paper ID.`,
      ),
    },
  },
  {
    id: 'mobicom-2026',
    venue: same('ACM MobiCom'),
    year: 2026,
    track: same('Main'),
    phase: SUBMISSION,
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'partial',
    summary: [
      L('双盲投稿；格式条款要求检查投稿 PDF 中的外部超链接。', 'Double-blind; the formatting rules require checking external hyperlinks in the PDF.'),
      L('本预设会提示所有可点击外链；其余按通用规则执行。', 'This preset flags every clickable external link; everything else follows the generic rules.'),
    ],
    sources: [{ label: 'MobiCom 2026 Call for Papers', url: 'https://www.sigmobile.org/mobicom/2026/cfp.html', section: 'Submission guidelines' }],
    ackPolicy: 'noIdentity',
    flagAllEmbeddedLinks: true,
    linkNote: L('该预设把所有内嵌外部链接列为待确认项。', 'This preset lists every embedded external link for review.'),
    disabledRuleIds: [],
    severityOverrides: {},
    limitations: [...COMMON_LIMITS, L('未实现：页数、字体与版式检查。', 'Not implemented: page-count, font and layout checks.')],
  },
  {
    id: 'usenix-sec-2026',
    venue: same('USENIX Security'),
    year: 2026,
    track: DASH,
    phase: SUBMISSION,
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'implemented',
    summary: [
      L('双盲；不在投稿中写作者、致谢与可识别的资助信息。', 'Double-blind; no authors, acknowledgments or identifying funding in the submission.'),
      L('本预设：致谢按“禁止”处理，资助信息升为高优先级。', 'This preset forbids acknowledgments and raises funding to High.'),
    ],
    sources: [
      { label: 'USENIX Security ’26 Call for Papers', url: 'https://www.usenix.org/conference/usenixsecurity26/call-for-papers', section: 'Anonymity' },
    ],
    ackPolicy: 'forbidden',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: { R06: 'high' },
    limitations: [
      ...COMMON_LIMITS,
      L('未实现：伦理附录与 Open Science 附录的专项检查。', 'Not implemented: specific checks of the ethics and open-science appendices.'),
    ],
  },
  {
    id: 'ccs-2026',
    venue: same('ACM CCS'),
    year: 2026,
    track: DASH,
    phase: SUBMISSION,
    version: '2026.1',
    verifiedAt: VERIFIED_AT,
    verificationStatus: 'partial',
    implementationStatus: 'implemented',
    summary: [
      L('双盲；作者信息、致谢、资助在投稿版中删除。', 'Double-blind; author info, acknowledgments and funding are removed in the submission.'),
      L(
        '本预设：致谢按“禁止”处理，资助信息升为高优先级，并检查 acmart 匿名模式标记。',
        'This preset forbids acknowledgments, raises funding to High and checks the acmart anonymous-mode marker.',
      ),
    ],
    sources: [
      { label: 'CCS 2026 Call for Papers', url: 'https://www.sigsac.org/ccs/CCS2026/call-for/call-for-papers.html', section: 'Anonymous submission' },
    ],
    ackPolicy: 'forbidden',
    flagAllEmbeddedLinks: false,
    linkNote: null,
    disabledRuleIds: [],
    severityOverrides: { R06: 'high' },
    limitations: [...COMMON_LIMITS, L('未实现：页数与 ACM 格式检查。', 'Not implemented: page-count and ACM format checks.')],
    templateMarker: {
      pattern: String.raw`Anonymous\s+Authors?\s*\(s\)|Anonymous\s+Author`,
      label: 'Anonymous Author(s)',
      suggestion: L(
        String.raw`使用 \documentclass[sigconf,review,anonymous]{acmart}，由模板自动隐去作者信息。`,
        String.raw`Use \documentclass[sigconf,review,anonymous]{acmart} so the template hides the authors.`,
      ),
    },
  },
]

/** 自定义预设（由会话从 localStorage 载入后登记）；内置预设列表保持不变 */
let customPresets: VenuePreset[] = []

export function setCustomPresets(list: VenuePreset[]): void {
  customPresets = list
}

export function allPresets(): VenuePreset[] {
  return [...PRESETS, ...customPresets]
}

export function getBuiltinPreset(id: string): VenuePreset {
  return PRESETS.find((p) => p.id === id) ?? (PRESETS[0] as VenuePreset)
}

export function getPreset(id: string): VenuePreset {
  return PRESETS.find((p) => p.id === id) ?? customPresets.find((p) => p.id === id) ?? (PRESETS[0] as VenuePreset)
}

/** 预设显示名：“NeurIPS 2026”“通用双盲” */
export function presetName(p: VenuePreset, loc: Locale): string {
  return `${pick(p.venue, loc)}${p.year ? ` ${p.year}` : ''}`
}

/** 每条规则在当前预设下引用的条款 */
export function policyRefsFor(preset: VenuePreset, ruleId: string): PolicyRef[] {
  return preset.sources.map((s) => ({
    presetId: preset.id,
    label: `${s.label}${s.section ? ' · ' + s.section : ''}`,
    url: s.url,
    note: ruleId === 'R10' && preset.linkNote ? preset.linkNote : L(`核验于 ${preset.verifiedAt ?? '—'}`, `verified ${preset.verifiedAt ?? '—'}`),
  }))
}
