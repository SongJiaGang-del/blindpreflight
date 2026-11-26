import type {
  Confidence,
  CoverageCapability,
  CoverageStatus,
  FindingCategory,
  FindingSource,
  ReviewStatus,
  Severity,
} from './types'

export const SEVERITY_LABEL: Record<Severity, string> = { high: '高优先级', medium: '需核实', info: '提示' }
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '高', medium: '中', low: '低' }

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  metadata: '元数据',
  email: '邮箱',
  userTerm: '姓名 / 自定义词',
  institution: '机构',
  acknowledgments: '致谢',
  funding: '资助',
  repository: '代码仓库',
  selfCitation: '自引',
  implicitIdentity: '隐式身份',
  link: '链接',
  headerFooter: '页眉页脚',
  filename: '文件名',
  annotation: '批注',
  editResidue: '编辑残留',
  attachment: '附件',
  identifier: '编号 / 戳记',
}

export const SOURCE_LABEL: Record<FindingSource, string> = {
  metadata: '文档元数据',
  text: '正文',
  link: '链接注释',
  annotation: '批注 / 表单',
  filename: '文件名',
  attachment: '嵌入附件',
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  open: '未处理',
  'needs-review': '待核实',
  'dismissed-citation': '忽略：正常的第三方引用',
  'dismissed-third-party': '忽略：不是作者本人信息',
  'dismissed-required': '忽略：会场要求保留',
  'dismissed-irrelevant': '忽略：误报',
  resolved: '已在源文件中修改',
}

export const REVIEW_ORDER: ReviewStatus[] = [
  'open',
  'needs-review',
  'resolved',
  'dismissed-citation',
  'dismissed-third-party',
  'dismissed-required',
  'dismissed-irrelevant',
]

export function isDismissed(s: ReviewStatus): boolean {
  return s.startsWith('dismissed')
}

export const CAPABILITY_LABEL: Record<CoverageCapability, string> = {
  metadata: '元数据',
  text: '正文文字',
  links: '链接',
  annotations: '批注与表单',
  attachments: '嵌入附件',
  images: '图片 / 扫描内容',
  hiddenContent: '隐藏内容',
  supplements: '补充材料',
}

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  completed: '已检查',
  partial: '部分检查',
  skipped: '未检查',
  unsupported: '不支持',
  failed: '失败',
}

export const DISCLAIMER =
  'BlindPreflight 只在当前浏览器中分析文件，不上传文件或正文，也不调用云端 AI。结果只是提示，不保证投稿满足匿名要求；扫描页、图片内容、外部网站与补充材料中的其他文件仍需人工复核。请以会场官方说明为准。'
