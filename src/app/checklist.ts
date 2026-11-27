/**
 * 人工核对清单：规则查不到、只能由作者本人确认的事项。
 * 勾选状态只在本次会话的内存中，可写入导出报告（只写条目和是否勾选，不写任何稿件内容）。
 */
import type { ScanResult, VenuePreset } from '@/domain/types'
import { L, type Text } from '@/domain/text'

export interface ChecklistItem {
  id: string
  title: Text
  detail: Text
  /** 结合本次结果特别提醒 */
  emphasis: Text | null
}

function ackDetail(p: VenuePreset): Text {
  if (p.ackPolicy === 'forbidden')
    return L(
      `${p.venue.zh} 投稿版不得包含致谢；资助编号、基金名称同样删除，录用后再补回。`,
      `${p.venue.en} submissions must not contain acknowledgments; remove grant numbers and funder names too and add them back after acceptance.`,
    )
  if (p.ackPolicy === 'aiDisclosureOnly')
    return L(
      `${p.venue.zh} 投稿版只允许保留 AI 写作助手使用说明，其余致谢删除。`,
      `${p.venue.en} submissions may keep only an AI writing-assistant disclosure; remove all other acknowledgments.`,
    )
  return L(
    '致谢和资助信息不得包含能识别作者的人名、机构或项目编号；不确定时整段删除。',
    'Acknowledgments and funding must not contain identifying names, institutions or grant numbers; when unsure, remove the whole section.',
  )
}

export function checklistFor(result: ScanResult): ChecklistItem[] {
  const p = result.preset
  const weakPages = result.documents.reduce((n, d) => n + d.pages.filter((pg) => pg.textQuality !== 'ok' && !pg.ocr).length, 0)
  const has = (...rules: string[]) => result.findings.some((f) => f.ruleIds.some((r) => rules.includes(r)))
  const repoLinks = result.findings.filter((f) => f.category === 'repository' || f.category === 'link').length

  return [
    {
      id: 'repo',
      title: L('代码 / 数据仓库已匿名', 'Code / data repositories are anonymous'),
      detail: L(
        '用匿名托管（如 anonymous.4open.science）或随补充材料提交；确认 README、提交记录、LICENSE、issue、贡献者列表、notebook 输出中没有姓名、机构和个人路径。',
        'Use anonymous hosting (e.g. anonymous.4open.science) or ship them as supplements; make sure README, commit history, LICENSE, issues, contributor lists and notebook outputs have no names, institutions or personal paths.',
      ),
      emphasis: repoLinks
        ? L(
            `本次发现 ${repoLinks} 条与链接 / 仓库相关的项目，请逐个在隐私浏览窗口中打开核对。`,
            `This check found ${repoLinks} link / repository item(s); open each in a private window to verify.`,
          )
        : null,
    },
    {
      id: 'images',
      title: L('图片、图表和截图中没有身份信息', 'Figures, charts and screenshots have no identity info'),
      detail: L(
        '本地 OCR 只识别扫描页 / 图片页，普通页面里的插图不识别。检查图中的 Logo、机构名、用户名、文件路径、终端提示符、浏览器书签栏和地图标注。',
        'Local OCR only reads scanned / image pages, not figures on normal pages. Check figures for logos, institution names, user names, file paths, terminal prompts, browser bookmarks and map labels.',
      ),
      emphasis: weakPages
        ? L(`有 ${weakPages} 页文字过少或疑似图片页，这些页没有被文字规则覆盖。`, `${weakPages} page(s) have little or no text and were not covered by the text rules.`)
        : null,
    },
    {
      id: 'supp-files',
      title: L('补充材料中的非 PDF 文件已匿名', 'Non-PDF supplementary files are anonymous'),
      detail: L(
        '代码、数据、视频、压缩包里的作者信息、文件元数据、视频片头片尾、人声和人脸、水印都需要检查。',
        'Check code, data, videos and archives for author info, file metadata, video intros / outros, voices and faces, and watermarks.',
      ),
      emphasis: null,
    },
    {
      id: 'self-cite',
      title: L('自引以第三人称书写，且不过度集中', 'Self-citations are in the third person and not concentrated'),
      detail: L(
        '不仅是 “our previous work”，还要看是否大量引用同一组作者、是否写了“扩展了 [3] 的工作”这类能直接指向作者的表述。',
        'Beyond “our previous work”, check whether one group of authors is cited heavily and whether phrases like “extending the work of [3]” point straight to you.',
      ),
      emphasis: has('R08') ? L('本次检测到第一人称自引，请修改后再确认整体比例。', 'First-person self-citations were found; fix them, then review the overall balance.') : null,
    },
    {
      id: 'inferable',
      title: L('没有可直接推断作者的独有信息', 'Nothing unique that reveals the authors'),
      detail: L(
        '独有的数据集或设备名、实验地点、内部系统或项目代号、合作单位名称，都可能让审稿人一眼认出作者。可以在自定义身份词里加上这些名称再查一遍。',
        'Unique dataset or device names, study locations, internal system or project code names and partner names can give you away. Add them as custom terms and check again.',
      ),
      emphasis: result.userTermCount
        ? null
        : L('本次没有填写自定义身份词，建议补充作者名、系统名后重新检查。', 'No custom terms were entered; add author and system names and check again.'),
    },
    {
      id: 'ack',
      title: L('致谢与资助已按会场要求处理', 'Acknowledgments and funding follow the venue rules'),
      detail: ackDetail(p),
      emphasis: has('R05', 'R06') ? L('本次检测到致谢或资助段落。', 'An acknowledgments or funding passage was found.') : null,
    },
    {
      id: 'preprint',
      title: L('预印本与公开宣传符合会场政策', 'Preprints and publicity follow the venue policy'),
      detail: L(
        '如果论文已在 arXiv 或社交媒体公开，确认会场允许，且正文中没有提及该预印本；投稿版不要带 arXiv 侧边戳。',
        'If the paper is on arXiv or social media, make sure the venue allows it and the text does not mention the preprint; the submission must not carry an arXiv stamp.',
      ),
      emphasis: has('R11') ? L('本次检测到页眉页脚或版本戳相关问题。', 'Header / footer or version-stamp issues were found.') : null,
    },
    {
      id: 'system',
      title: L('投稿系统中填写的内容与上传文件一致', 'Submission-system entries match the files'),
      detail: L(
        '投稿系统里的标题、摘要、关键词、上传文件名和补充材料说明不含身份信息；不要在“给审稿人的说明”里写作者名。',
        'Title, abstract, keywords, file names and supplement descriptions in the submission system carry no identity info; never put author names in notes to reviewers.',
      ),
      emphasis: p.flagAllEmbeddedLinks
        ? L(`${p.venue.zh} 对稿件中的可点击链接有额外要求，请再核对一遍链接列表。`, `${p.venue.en} has extra rules for clickable links; review the link list once more.`)
        : null,
    },
  ]
}
