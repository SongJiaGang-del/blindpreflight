/**
 * BlindPreflight 领域模型。
 *
 * 约定：
 * - 坐标 BBox 统一为「未旋转的 PDF 用户空间」，原点在左下；渲染时由 viewport 转换。
 * - page = null 表示文档级（元数据、文件名、附件），不得用 0 / 1 冒充真实页码。
 * - 原始 File / ArrayBuffer / PDFDocumentProxy 不进入本文件中的任何可序列化类型。
 */

export type DocumentRole = 'main' | 'supplement' | 'source'
export type Severity = 'high' | 'medium' | 'info'
export type Confidence = 'high' | 'medium' | 'low'

export type FindingSource = 'metadata' | 'text' | 'link' | 'annotation' | 'filename' | 'attachment' | 'image' | 'font' | 'revision' | 'source'

export type FindingCategory =
  | 'metadata'
  | 'email'
  | 'userTerm'
  | 'institution'
  | 'acknowledgments'
  | 'funding'
  | 'repository'
  | 'selfCitation'
  | 'implicitIdentity'
  | 'link'
  | 'headerFooter'
  | 'filename'
  | 'annotation'
  | 'editResidue'
  | 'attachment'
  | 'identifier'
  | 'imageMetadata'
  | 'fontName'
  | 'revision'
  | 'template'
  | 'sourceAuthor'
  | 'sourceComment'
  | 'sourceArtifact'
  | 'sourceMetadata'

/** 版面区域：决定同一命中的优先级。 */
export type Zone =
  | 'authorBlock'
  | 'header'
  | 'footer'
  | 'acknowledgments'
  | 'references'
  | 'appendix'
  | 'body'

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

/** 显示坐标（viewport scale=1、含页面自身旋转，原点左上）。仅用于版面分析。 */
export interface DisplayBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 文本项几何：用户空间中的基线原点 o、基线方向单位向量 u、字形「上」方向单位向量 v、
 * 沿基线宽度 w、字号 h。按字符比例切分高亮时在 u 方向插值，任意旋转都成立。
 */
export interface ItemGeometry {
  ox: number
  oy: number
  ux: number
  uy: number
  vx: number
  vy: number
  w: number
  h: number
}

export interface TextItemFact {
  index: number
  str: string
  geom: ItemGeometry
  /** PDF 用户空间的近似外接框 */
  bbox: BBox
  /** 显示坐标外接框 */
  box: DisplayBox
  fontSize: number
  /** 文字是否近似水平（可按字符比例切分高亮） */
  horizontal: boolean
}

export interface LineFact {
  index: number
  /** 规范化后的行文本 */
  text: string
  itemIndices: number[]
  box: DisplayBox
  column: 'single' | 'left' | 'right' | 'span'
  /** 行内主要字号（按字符数加权） */
  fontSize: number
  zone: Zone
  /** 在 page.text 中的起止（不含换行） */
  start: number
  end: number
  isHeading: boolean
}

/**
 * 文本视图：在 page.text（基准视图）之上做的去断行 / 去连字符变换。
 * toBase[i] = 该视图第 i 个字符对应基准视图的下标。
 */
export interface TextView {
  /**
   * flat：换行→空格；dehyphenated：同栏行尾「字母-」+下行小写时合并；
   * joined：行尾/行首是 @ . / _ - : 时直接拼接（邮箱、URL 跨行）。
   */
  name: 'flat' | 'dehyphenated' | 'joined'
  text: string
  toBase: number[]
}

export type TextQuality = 'ok' | 'sparse' | 'garbled' | 'empty'

export interface AnnotationFact {
  id: string
  subtype: string
  /** PDF 用户空间矩形 */
  rect: BBox | null
  /** Link: 外部目标（只做字符串检查，从不访问） */
  url: string | null
  /** Link: 内部跳转 */
  hasDest: boolean
  /** 批注作者（/T） */
  author: string
  contents: string
  /** 表单域值 */
  fieldValue: string
  /** 链接矩形下方的可见文字（若能找到） */
  visibleText: string
}

export interface PageFacts {
  documentId: string
  pageNumber: number
  /** 未旋转页面尺寸（PDF 单位） */
  width: number
  height: number
  rotation: number
  /** 显示尺寸（scale=1，含旋转） */
  viewWidth: number
  viewHeight: number
  items: TextItemFact[]
  lines: LineFact[]
  /** 基准视图：规范化后的行按阅读顺序以 \n 连接 */
  text: string
  /** 每个字符对应的 TextItem 下标；插入的空格/换行为 -1 */
  charItem: number[]
  /** 每个字符在源 TextItem.str 中的偏移（近似） */
  charOffset: number[]
  /** 每个字符所属行号；换行符归属上一行 */
  charLine: number[]
  views: TextView[]
  annotations: AnnotationFact[]
  textQuality: TextQuality
  visibleCharCount: number
  extractionStatus: 'completed' | 'failed'
  extractionError?: string
  twoColumn: boolean
  /** 文字来自本地 OCR（扫描页 / 图片页） */
  ocr?: boolean
}

export interface AttachmentFact {
  filename: string
  rawFilename: string
  description: string
  byteSize: number | null
}

export type CoverageStatus = 'completed' | 'partial' | 'skipped' | 'unsupported' | 'failed'

export type CoverageCapability =
  | 'metadata'
  | 'text'
  | 'links'
  | 'annotations'
  | 'attachments'
  | 'images'
  | 'hiddenContent'
  | 'supplements'
  | 'sourceFiles'

export interface CoverageEntry {
  documentId: string | null
  capability: CoverageCapability
  status: CoverageStatus
  reason: string
  pageNumbers?: number[]
}

/** 嵌入图片的元数据（EXIF / IPTC / XMP / 注释） */
export interface ImageMetaFact {
  /** 文档内序号，从 1 开始 */
  index: number
  /** 引用该图片的页码；空数组 = 没有任何页面引用（删除后残留） */
  pages: number[]
  filter: string
  fields: Record<string, string>
  gps: boolean
}

/** 页面资源里的字体名（已去掉子集前缀） */
export interface FontFact {
  name: string
  pages: number[]
}

/** 增量保存的旧版本（不含最新版本） */
export interface RevisionFact {
  /** 第几个版本，从 1 开始；最新版本是 revisionCount */
  index: number
  info: Record<string, string>
  xmp: Record<string, string> | null
}

/** 直接读 PDF 对象得到的信息（pdf.js 公开 API 拿不到的部分） */
export interface BinaryFacts {
  status: 'completed' | 'failed'
  images: ImageMetaFact[]
  imageCount: number
  fonts: FontFact[]
  /** 版本数（增量保存次数 + 1）；线性化文件的首页段不计 */
  revisionCount: number
  oldRevisions: RevisionFact[]
}

/** 源文件包中的一个文件 */
export type SourceFileKind = 'tex' | 'bib' | 'text' | 'image' | 'office' | 'pdf' | 'archive' | 'vcs' | 'build' | 'junk' | 'binary'

export interface SourceFileFact {
  path: string
  size: number
  kind: SourceFileKind
}

/**
 * 源文件包（LaTeX 工程 / 代码 zip / 单个 .tex）。文本内容只在内存中，供规则扫描，不进入报告。
 */
export interface SourceFacts {
  name: string
  byteSize: number
  files: SourceFileFact[]
  /** 已解码的文本文件（tex / bib / 代码 / 说明 / 构建日志） */
  texts: Array<{ path: string; kind: SourceFileKind; text: string }>
  /** 包内图片与 Office 文档的元数据 */
  meta: Array<{ path: string; kind: 'image' | 'office'; fields: Record<string, string>; gps: boolean }>
  /** \author{} 中解析出的姓名（只用于继续查找，不对外发送） */
  authorNames: string[]
  /** 版本库目录（.git / .svn / .hg） */
  vcsDirs: string[]
  warnings: string[]
}

export interface DocumentFacts {
  id: string
  role: DocumentRole
  displayName: string
  byteSize: number
  pageCount: number
  parseStatus: 'completed' | 'partial' | 'failed'
  /** PDF Info 字典（字符串化） */
  info: Record<string, string>
  /** XMP 解析结果；null = 文件中没有 XMP（不是解析失败） */
  xmp: Record<string, string> | null
  pages: PageFacts[]
  attachments: AttachmentFact[]
  internalLinkCount: number
  coverage: CoverageEntry[]
  warnings: string[]
  /** 图片元数据、字体名、增量保存旧版本；读取失败或未运行时为 undefined */
  binary?: BinaryFacts
}

export interface PolicyRef {
  presetId: string
  label: string
  url: string
  note: string
}

/** 一处出现位置。聚合型发现（如重复页眉）可有多处。 */
export interface Occurrence {
  page: number | null
  /** 基准视图中的字符范围，仅 text 来源有 */
  start?: number
  end?: number
  bboxes: BBox[] | null
  snippet: string
}

export type ReviewStatus =
  | 'open'
  | 'needs-review'
  | 'dismissed-citation'
  | 'dismissed-third-party'
  | 'dismissed-required'
  | 'dismissed-irrelevant'
  | 'resolved'

export interface Finding {
  /** 稳定 ID：documentId + ruleId + source + page + span/field 的哈希 */
  id: string
  documentId: string
  documentName: string
  documentRole: DocumentRole
  ruleId: string
  ruleIds: string[]
  ruleVersion: string
  severity: Severity
  confidence: Confidence
  category: FindingCategory
  source: FindingSource
  /** 第一处出现的页码；文档级为 null */
  page: number | null
  zone: Zone | null
  /** 原文（不是规范化替代文本）或字段值，最长约 240 字 */
  snippet: string
  /** 命中在 snippet 中的位置，便于高亮 */
  matchInSnippet: [number, number] | null
  /** 前后文 */
  context: string
  bboxes: BBox[] | null
  /** 高亮框是按字体宽度比例估算的 */
  bboxApproximate: boolean
  occurrences: Occurrence[]
  /** 元数据字段名、注释字段名等 */
  field: string | null
  /** 链接真实目标 */
  linkTarget: string | null
  /** 链接可见文字 */
  visibleText: string | null
  reasons: string[]
  suggestion: string
  policyRefs: PolicyRef[]
  matchedUserTerm: boolean
}

export interface UserTerm {
  raw: string
  normalized: string
  /** 短词：两字母英文缩写、单字中文等，默认不提升到高优先级 */
  ambiguous: boolean
}

export interface PresetSource {
  label: string
  url: string
  section: string
}

export type AckPolicy = 'forbidden' | 'aiDisclosureOnly' | 'noIdentity'

export interface VenuePreset {
  id: string
  venue: string
  year: number | null
  track: string
  phase: string
  version: string
  verifiedAt: string | null
  verificationStatus: 'verified' | 'partial' | 'unverified'
  /** 产品实现程度：与「资料已核验」相互独立 */
  implementationStatus: 'implemented' | 'partial' | 'reference'
  summary: string[]
  sources: PresetSource[]
  ackPolicy: AckPolicy
  /** 外链：任意可点击链接都需提示（如 MobiCom 格式条款） */
  flagAllEmbeddedLinks: boolean
  linkNote: string | null
  disabledRuleIds: string[]
  severityOverrides: Record<string, Severity>
  limitations: string[]
  /** 审稿模式模板会印出的标记（正则源码，忽略大小写）；找不到时提示可能用了终稿模板 */
  templateMarker?: { pattern: string; label: string; suggestion: string } | null
  /** 用户自定义的预设（保存在本机 localStorage） */
  custom?: boolean
}

export interface ScanOptions {
  presetId: string
  userTerms: UserTerm[]
  strictShortTerms: boolean
  /**
   * 本次会话中较早扫描从元数据得到的作者名。删掉元数据后（清理版、改过的新版本）
   * 仍用这些名字查正文，避免“元数据没了 → 工具不知道作者是谁 → 正文里的名字被当成已修复”。
   * 只在内存中，不写入报告。
   */
  knownNames?: Array<{ raw: string; tokens: string[]; source: string }>
  /** 可选的源文件包（LaTeX / zip） */
  source?: SourceFacts | null
}

export interface RuleRunStatus {
  ruleId: string
  title: string
  status: 'ran' | 'disabled'
  findingCount: number
}

export interface ScanResult {
  scanId: string
  runId: number
  startedAt: string
  completedAt: string
  preset: VenuePreset
  rulesetVersion: string
  documents: DocumentFacts[]
  findings: Finding[]
  coverage: CoverageEntry[]
  rules: RuleRunStatus[]
  /** 本次扫描使用的自定义词条数（词条本身不写入报告） */
  userTermCount: number
  /** 源文件包摘要（不含文件内容）；没有时为 null */
  source: { name: string; byteSize: number; fileCount: number; textCount: number; warnings: string[] } | null
}

export interface ReviewDecision {
  findingId: string
  status: ReviewStatus
  reason: string
  createdAt: string
}
