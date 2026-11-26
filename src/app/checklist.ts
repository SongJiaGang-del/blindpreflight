/**
 * 人工核对清单：规则查不到、只能由作者本人确认的事项。
 * 勾选状态只在本次会话的内存中，可写入导出报告（只写条目和是否勾选，不写任何稿件内容）。
 */
import type { ScanResult, VenuePreset } from '@/domain/types'

export interface ChecklistItem {
  id: string
  title: string
  detail: string
  /** 结合本次结果特别提醒 */
  emphasis: string | null
}

function ackDetail(p: VenuePreset): string {
  if (p.ackPolicy === 'forbidden') return `${p.venue} 投稿版不得包含致谢；资助编号、基金名称同样删除，录用后再补回。`
  if (p.ackPolicy === 'aiDisclosureOnly') return `${p.venue} 投稿版只允许保留 AI 写作助手使用说明，其余致谢删除。`
  return '致谢和资助信息不得包含能识别作者的人名、机构或项目编号；不确定时整段删除。'
}

export function checklistFor(result: ScanResult): ChecklistItem[] {
  const p = result.preset
  const cov = (cap: string) => result.coverage.some((c) => c.capability === cap && c.status !== 'completed')
  const weakPages = result.documents.reduce((n, d) => n + d.pages.filter((pg) => pg.textQuality !== 'ok').length, 0)
  const has = (...rules: string[]) => result.findings.some((f) => f.ruleIds.some((r) => rules.includes(r)))
  const repoLinks = result.findings.filter((f) => f.category === 'repository' || f.category === 'link').length

  return [
    {
      id: 'repo',
      title: '代码 / 数据仓库已匿名',
      detail: '用匿名托管（如 anonymous.4open.science）或随补充材料提交；确认 README、提交记录、LICENSE、issue、贡献者列表、notebook 输出中没有姓名、机构和个人路径。',
      emphasis: repoLinks ? `本次发现 ${repoLinks} 条与链接 / 仓库相关的项目，请逐个在隐私浏览窗口中打开核对。` : null,
    },
    {
      id: 'images',
      title: '图片、图表和截图中没有身份信息',
      detail: '本工具没有 OCR。检查图中的 Logo、机构名、用户名、文件路径、终端提示符、浏览器书签栏和地图标注。',
      emphasis: weakPages || cov('images') ? `有 ${weakPages} 页文字过少或疑似图片页，这些页没有被文字规则覆盖。` : null,
    },
    {
      id: 'supp-files',
      title: '补充材料中的非 PDF 文件已匿名',
      detail: '代码、数据、视频、压缩包里的作者信息、文件元数据、视频片头片尾、人声和人脸、水印都需要检查。',
      emphasis: null,
    },
    {
      id: 'self-cite',
      title: '自引以第三人称书写，且不过度集中',
      detail: '不仅是 “our previous work”，还要看是否大量引用同一组作者、是否写了“扩展了 [3] 的工作”这类能直接指向作者的表述。',
      emphasis: has('R08') ? '本次检测到第一人称自引，请修改后再确认整体比例。' : null,
    },
    {
      id: 'inferable',
      title: '没有可直接推断作者的独有信息',
      detail: '独有的数据集或设备名、实验地点、内部系统或项目代号、合作单位名称，都可能让审稿人一眼认出作者。可以在自定义身份词里加上这些名称再查一遍。',
      emphasis: result.userTermCount ? null : '本次没有填写自定义身份词，建议补充作者名、系统名后重新检查。',
    },
    {
      id: 'ack',
      title: '致谢与资助已按会场要求处理',
      detail: ackDetail(p),
      emphasis: has('R05', 'R06') ? '本次检测到致谢或资助段落。' : null,
    },
    {
      id: 'preprint',
      title: '预印本与公开宣传符合会场政策',
      detail: '如果论文已在 arXiv 或社交媒体公开，确认会场允许，且正文中没有提及该预印本；投稿版不要带 arXiv 侧边戳。',
      emphasis: has('R11') ? '本次检测到页眉页脚或版本戳相关问题。' : null,
    },
    {
      id: 'system',
      title: '投稿系统中填写的内容与上传文件一致',
      detail: '投稿系统里的标题、摘要、关键词、上传文件名和补充材料说明不含身份信息；不要在“给审稿人的说明”里写作者名。',
      emphasis: p.flagAllEmbeddedLinks ? `${p.venue} 对稿件中的可点击链接有额外要求，请再核对一遍链接列表。` : null,
    },
  ]
}
