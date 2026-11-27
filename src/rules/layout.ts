/**
 * 版面残留：R11 页眉页脚（跨页重复文字、版本戳）、arXiv 侧边戳。
 */
import type { DocumentFacts, LineFact, PageFacts, Severity } from '@/domain/types'
import { normalizeText } from '@/normalize/unicode'
import { type FindingDraft, type RuleContext, ZONE_LABEL, scanDoc } from './core'
import { identityTokens } from './identity'
import { ARXIV_STAMP } from './patterns'
import { L, LIST_SEP, type Text, join } from '@/domain/text'

/** 匿名投稿模板里常见、本身不泄露身份的页眉页脚 */
const BENIGN =
  /^(?:#+|page\s*#+(?:\s*of\s*#+)?|#+\s*\/\s*#+|-\s*#+\s*-|under\s+review(?:\s+as\s+a\s+(?:conference|workshop|journal)\s+paper)?(?:\s+at\s+.*)?|anonymous\s+(?:authors?|submission|for\s+review).*|(?:paper|submission)\s*(?:id|#)?\s*#+.*|confidential\s+review\s+copy.*|do\s+not\s+distribute\.?|.*submission\s*#+.*|第\s*#+\s*页.*|匿名.*)$/iu

/** 版本戳：说明这是预印本 / 终稿而不是投稿版 */
const VERSION_STAMP =
  /\b(?:preprint|camera[- ]ready|accepted\s+(?:at|to|for|in)|published\s+as\s+a\s+(?:conference|workshop)\s+paper|to\s+appear\s+in|in\s+proceedings\s+of|proceedings\s+of\s+the|copyright\s*(?:©|\(c\))?\s*\d{4}|©\s*\d{4}|permission\s+to\s+make\s+digital|all\s+rights\s+reserved)\b|(?:预印本|已录用|终稿|版权所有)/iu

function keyOf(text: string): string {
  return normalizeText(text).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

interface Group {
  key: string
  lines: Array<{ page: PageFacts; line: LineFact }>
}

export function ruleHeaderFooter(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  const groups = new Map<string, Group>()
  const title = keyOf(doc.info.Title ?? doc.xmp?.['dc:title'] ?? '')
  for (const page of doc.pages) {
    for (const line of page.lines) {
      if (line.zone !== 'header' && line.zone !== 'footer') continue
      const key = keyOf(line.text)
      if (!key || key.replace(/[#\s\p{P}]/gu, '').length === 0) continue
      const g = groups.get(key) ?? { key, lines: [] }
      if (!g.lines.some((x) => x.page === page)) g.lines.push({ page, line })
      groups.set(key, g)
    }
  }
  const pages = Math.max(1, doc.pages.length)
  for (const g of groups.values()) {
    const first = g.lines[0]
    if (!first) continue
    const text = first.line.text
    const pageCount = g.lines.length
    const repeated = pageCount >= 2 && pageCount / pages > 0.5
    const tokens = identityTokens(text, ctx)
    const stamp = VERSION_STAMP.test(text)
    const benign = BENIGN.test(g.key) || (title.length > 8 && (g.key === title || title.includes(g.key)))
    let severity: Severity | null = null
    const reasons: Text[] = []
    const checkTex = L(
      '在 LaTeX 中检查 \\fancyhead / \\fancyfoot、\\thanks 与模板选项（如 [final]、[preprint]）。',
      'In LaTeX check \\fancyhead / \\fancyfoot, \\thanks and template options (e.g. [final], [preprint]).',
    )
    let suggestion: Text = checkTex
    if (tokens.length) {
      severity = 'high'
      const z = ZONE_LABEL[first.line.zone]
      reasons.push(L(`${z.zh}中${join(tokens, LIST_SEP).zh}。`, `The ${z.en} ${join(tokens, LIST_SEP).en}.`))
      suggestion = join([L('把页眉页脚改回会场匿名模板的默认内容。', 'Restore the venue’s anonymous template header / footer. '), checkTex])
    } else if (stamp) {
      severity = 'medium'
      reasons.push(
        L(
          '页眉页脚含有预印本 / 终稿 / 版权声明，说明使用的不是匿名投稿模板。',
          'The header / footer has a preprint / camera-ready / copyright notice, so this is not the anonymous submission template.',
        ),
      )
      suggestion = L(
        '切换到会场模板的匿名投稿选项（例如去掉 [final]、[preprint]、camera-ready 选项）。',
        'Switch to the template’s anonymous submission option (e.g. drop [final], [preprint] or camera-ready options).',
      )
    } else if (repeated && !benign) {
      severity = 'info'
      reasons.push(
        L(
          '这段文字在多数页面的页眉/页脚重复出现，请确认没有课题组、项目或个人信息。',
          'This text repeats in the header / footer of most pages; make sure it has no group, project or personal info.',
        ),
      )
    }
    if (!severity) continue
    if (repeated) reasons.push(L(`出现在 ${pageCount} / ${pages} 页。`, `Appears on ${pageCount} / ${pages} pages.`))
    out.push({
      ruleId: 'R11',
      category: 'headerFooter',
      source: 'text',
      severity,
      confidence: tokens.length ? 'high' : stamp ? 'medium' : 'low',
      text: { page: first.page, start: first.line.start, end: first.line.end },
      extra: g.lines.slice(1).map(({ page, line }) => ({ page, start: line.start, end: line.end })),
      zone: first.line.zone,
      reasons,
      suggestion,
      key: g.key,
    })
  }
  return out
}

/** arXiv 左侧竖排戳（arXiv:2501.01234v1 [cs.CL] 日期） */
export function ruleArxivStamp(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  void ctx
  return scanDoc(doc, ARXIV_STAMP).map((hit) => ({
    ruleId: 'R11',
    category: 'identifier' as const,
    source: 'text' as const,
    severity: 'medium' as const,
    confidence: 'high' as const,
    text: hit,
    reasons: [L('PDF 中带有 arXiv 编号戳：审稿人可以直接查到同名预印本及其作者。', 'The PDF carries an arXiv stamp: reviewers can find the preprint and its authors directly.')],
    suggestion: L(
      '提交会场模板编译的版本，而不是从 arXiv 下载的 PDF；同时确认会场对预印本的政策。',
      'Submit the version compiled with the venue template, not the PDF downloaded from arXiv, and check the venue’s preprint policy.',
    ),
    key: 'arxiv',
  }))
}
