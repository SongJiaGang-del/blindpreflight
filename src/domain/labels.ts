import type {
  Confidence,
  CoverageCapability,
  CoverageStatus,
  FindingCategory,
  FindingSource,
  ReviewStatus,
  Severity,
  Zone,
} from './types'
import { L, type Locale, type Text } from './text'

export const SEVERITY_LABEL: Record<Severity, Text> = {
  high: L('高优先级', 'High'),
  medium: L('需核实', 'Check'),
  info: L('提示', 'Info'),
}
export const CONFIDENCE_LABEL: Record<Confidence, Text> = { high: L('高', 'high'), medium: L('中', 'medium'), low: L('低', 'low') }

export const CATEGORY_LABEL: Record<FindingCategory, Text> = {
  metadata: L('元数据', 'Metadata'),
  email: L('邮箱', 'Email'),
  userTerm: L('姓名 / 自定义词', 'Names / custom terms'),
  institution: L('机构', 'Institution'),
  acknowledgments: L('致谢', 'Acknowledgments'),
  funding: L('资助', 'Funding'),
  repository: L('代码仓库', 'Code repository'),
  selfCitation: L('自引', 'Self-citation'),
  implicitIdentity: L('隐式身份', 'Implicit identity'),
  link: L('链接', 'Links'),
  headerFooter: L('页眉页脚', 'Header / footer'),
  filename: L('文件名', 'File name'),
  annotation: L('批注', 'Annotations'),
  editResidue: L('编辑残留', 'Editing residue'),
  attachment: L('附件', 'Attachments'),
  identifier: L('编号 / 戳记', 'IDs / stamps'),
  imageMetadata: L('图片元数据', 'Image metadata'),
  fontName: L('字体名', 'Font names'),
  revision: L('旧版本残留', 'Old revisions'),
  template: L('会场模板', 'Venue template'),
  sourceAuthor: L('源码作者信息', 'Source author info'),
  sourceComment: L('源码注释与隐藏内容', 'Source comments'),
  sourceArtifact: L('版本库与构建残留', 'VCS / build leftovers'),
  sourceMetadata: L('包内文件元数据', 'Archive file metadata'),
}

export const SOURCE_LABEL: Record<FindingSource, Text> = {
  metadata: L('文档元数据', 'document metadata'),
  text: L('正文', 'page text'),
  link: L('链接注释', 'link annotation'),
  annotation: L('批注 / 表单', 'annotation / form'),
  filename: L('文件名', 'file name'),
  attachment: L('嵌入附件', 'embedded attachment'),
  image: L('嵌入图片', 'embedded image'),
  font: L('字体资源', 'font resources'),
  revision: L('增量保存的旧版本', 'earlier saved revision'),
  source: L('源文件包', 'source archive'),
}

export const REVIEW_LABEL: Record<ReviewStatus, Text> = {
  open: L('未处理', 'Open'),
  'needs-review': L('待核实', 'Needs review'),
  'dismissed-citation': L('忽略：正常的第三方引用', 'Dismissed: normal third-party citation'),
  'dismissed-third-party': L('忽略：不是作者本人信息', 'Dismissed: not the authors’ own info'),
  'dismissed-required': L('忽略：会场要求保留', 'Dismissed: required by the venue'),
  'dismissed-irrelevant': L('忽略：误报', 'Dismissed: false positive'),
  resolved: L('已在源文件中修改', 'Fixed in the source'),
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

export const CAPABILITY_LABEL: Record<CoverageCapability, Text> = {
  metadata: L('元数据', 'Metadata'),
  text: L('正文文字', 'Page text'),
  links: L('链接', 'Links'),
  annotations: L('批注与表单', 'Annotations & forms'),
  attachments: L('嵌入附件', 'Attachments'),
  images: L('图片 / 扫描内容', 'Images / scanned content'),
  hiddenContent: L('隐藏内容', 'Hidden content'),
  supplements: L('补充材料', 'Supplements'),
  sourceFiles: L('源文件包', 'Source archive'),
}

export const COVERAGE_LABEL: Record<CoverageStatus, Text> = {
  completed: L('已检查', 'checked'),
  partial: L('部分检查', 'partly checked'),
  skipped: L('未检查', 'not checked'),
  unsupported: L('不支持', 'not supported'),
  failed: L('失败', 'failed'),
}

export const ZONE_LABEL: Record<Zone, Text> = {
  authorBlock: L('首页作者区', 'first-page author block'),
  header: L('页眉', 'page header'),
  footer: L('页脚', 'page footer'),
  acknowledgments: L('致谢', 'acknowledgments'),
  references: L('参考文献', 'references'),
  appendix: L('附录', 'appendix'),
  body: L('正文', 'body text'),
}

/** 文档在界面上的称呼（不用文件名，避免截图泄露） */
export const DOC_LABEL: Record<string, Text> = {
  main: L('主稿', 'Main paper'),
  'supp-1': L('补充材料 1', 'Supplement 1'),
  'supp-2': L('补充材料 2', 'Supplement 2'),
  src: L('源文件包', 'Source archive'),
}

export const DISCLAIMER: Text = L(
  'BlindPreflight 只在当前浏览器中分析文件，不上传文件或正文，也不调用云端 AI。结果只是提示，不保证投稿满足匿名要求；扫描页、图片内容、外部网站与补充材料中的其他文件仍需人工复核。请以会场官方说明为准。',
  'BlindPreflight analyzes files only in this browser: nothing is uploaded and no cloud AI is used. Results are hints, not a guarantee that a submission meets anonymity requirements; scanned pages, image content, external websites and other supplementary files still need a manual check. The venue’s official instructions take precedence.',
)

/**
 * 定位字段的显示文字。规则产出的是与语言无关的标识（img:2、font:X、rev1:Info.Author、revisions、template、*），
 * 这样发现 ID 与修复前后对比不受界面语言影响。
 */
export function formatField(field: string | null, loc: Locale): string | null {
  if (!field) return null
  const zh = loc === 'zh'
  let m = /^img:(\d+)$/.exec(field)
  if (m) return zh ? `图片 #${m[1]}` : `Image #${m[1]}`
  m = /^font:(.+)$/.exec(field)
  if (m) return zh ? `字体 ${m[1]}` : `Font ${m[1]}`
  m = /^rev(\d+):(.+)$/.exec(field)
  if (m) return zh ? `版本 ${m[1]} · ${m[2]}` : `Revision ${m[1]} · ${m[2]}`
  if (field === 'revisions') return zh ? '保存版本' : 'Saved revisions'
  if (field === 'template') return zh ? '模板标记' : 'Template marker'
  if (field === '*') return zh ? '多个文件' : 'Multiple files'
  if (field === 'software') return zh ? '生成软件' : 'Producer / creator'
  if (field === 'filename') return zh ? '文件名' : 'File name'
  if (field === 'attachment') return zh ? '附件' : 'Attachment'
  return field
}
