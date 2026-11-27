/**
 * 文件级规则：R12 文件名，R13 批注 / 表单域 / 编辑残留，R17 嵌入附件。
 */
import type { DocumentFacts } from '@/domain/types'
import { normalizeText } from '@/normalize/unicode'
import { type FindingDraft, type RuleContext } from './core'
import { identityTokens } from './identity'
import { EDIT_RESIDUE, EMAIL, freshRegex } from './patterns'
import { isAmbiguousTerm, isAnonymousPlaceholder, termRegex } from './terms'
import { L, LIST_SEP, type Text, join } from '@/domain/text'

const FILENAME_HINT = /(?:author|camera[-_ ]?ready|final|姓名|作者|终稿)/iu

/** 文件名里的分隔符替换成空格，便于按词匹配姓名 */
function filenameWords(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[_\-.+]+/g, ' ')
}

export function ruleFilename(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const name = doc.displayName
  const words = filenameWords(name)
  const hits: Text[] = []
  for (const t of ctx.userTerms)
    if (termRegex(t.normalized).test(words) || termRegex(t.normalized).test(name)) hits.push(L(`自定义词「${t.raw}」`, `your term “${t.raw}”`))
  for (const n of ctx.derivedNames) {
    const surname = n.tokens[n.tokens.length - 1] ?? ''
    if (termRegex(n.raw).test(words) || (!isAmbiguousTerm(surname) && termRegex(surname).test(words))) hits.push(L(`作者名「${n.raw}」`, `the author name “${n.raw}”`))
  }
  const hint = FILENAME_HINT.exec(name)
  if (!hits.length && !hint) return []
  return [
    {
      ruleId: 'R12',
      category: 'filename',
      source: 'filename',
      severity: hits.length ? 'high' : 'info',
      confidence: hits.length ? 'high' : 'low',
      snippet: name,
      field: 'filename',
      reasons: hits.length
        ? [
            L(
              `文件名包含${join(hits, LIST_SEP).zh}；多数系统会把上传文件名展示给审稿人或保留在下载链接中。`,
              `The file name contains ${join(hits, LIST_SEP).en}; many systems show upload names to reviewers or keep them in download links.`,
            ),
          ]
        : [L(`文件名含 “${hint?.[0] ?? ''}”，可能暴露版本或身份信息。`, `The file name contains “${hint?.[0] ?? ''}”, which may reveal the version or identity.`)],
      suggestion: L('上传前改成中性文件名，例如 submission.pdf、supplementary.pdf。', 'Rename it to something neutral before uploading, e.g. submission.pdf, supplementary.pdf.'),
      key: 'filename',
    },
  ]
}

export function ruleAnnotations(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const page of doc.pages) {
    for (const a of page.annotations) {
      if (a.subtype === 'Link') continue
      const fields: Array<[string, string]> = [
        ['author', a.author],
        ['contents', a.contents],
        ['fieldValue', a.fieldValue],
      ]
      for (const [field, raw] of fields) {
        const value = normalizeText(raw)
        if (!value) continue
        const label = field === 'author' ? L('批注作者', 'annotation author') : field === 'contents' ? L('批注内容', 'annotation content') : L('表单域值', 'form field value')
        const tokens = identityTokens(value, ctx)
        const realAuthor = field === 'author' && !isAnonymousPlaceholder(value)
        const residue = EDIT_RESIDUE.test(value)
        let draft: Omit<FindingDraft, 'ruleId' | 'source' | 'pageNumber' | 'rect' | 'snippet' | 'field' | 'key'> | null = null
        if (tokens.length || (realAuthor && /\p{L}{2,}/u.test(value))) {
          draft = {
            category: 'annotation',
            severity: tokens.length || field === 'author' ? 'high' : 'medium',
            confidence: tokens.length ? 'high' : 'medium',
            reasons: [
              L(
                `${a.subtype} 批注的${label.zh}：${tokens.length ? join(tokens, LIST_SEP).zh : '记录了作者名或账户名'}。`,
                `The ${label.en} of a ${a.subtype} annotation ${tokens.length ? join(tokens, LIST_SEP).en : 'records an author or account name'}.`,
              ),
              L('批注在多数阅读器中可见，审稿人打开批注面板即可看到。', 'Annotations are visible in most readers; reviewers see them in the comments panel.'),
            ],
            suggestion: L(
              '在 PDF 阅读器中删除全部批注，或重新从源文件导出不带批注的 PDF。',
              'Delete all annotations in your PDF reader, or export again from the source without annotations.',
            ),
          }
        } else if (residue || field === 'contents' || field === 'fieldValue') {
          draft = {
            category: residue ? 'editResidue' : 'annotation',
            severity: residue ? 'info' : 'info',
            confidence: residue ? 'medium' : 'low',
            reasons: [
              residue
                ? L(`${label.zh}中有编辑残留（TODO / 待修改等）。`, `The ${label.en} contains editing residue (TODO etc.).`)
                : L(`PDF 中保留了 ${a.subtype} 批注。`, `The PDF still contains a ${a.subtype} annotation.`),
            ],
            suggestion: L('提交前删除所有批注与修订记录。', 'Remove all annotations and tracked changes before submitting.'),
          }
        }
        if (!draft) continue
        out.push({
          ruleId: 'R13',
          source: 'annotation',
          ...draft,
          pageNumber: page.pageNumber,
          rect: a.rect,
          snippet: value,
          snippetText: L(`${label.zh}: ${value}`, `${label.en}: ${value}`),
          field: `${a.subtype}.${field}`,
          key: `${a.id}|${field}`,
        })
      }
    }
  }
  return out
}

/** 正文中的编辑残留（TODO / FIXME / 待修改），仅提示 */
export function ruleTextResidue(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  void ctx
  const out: FindingDraft[] = []
  const re = new RegExp(EDIT_RESIDUE.source, 'gu')
  for (const page of doc.pages) {
    for (const m of page.text.matchAll(re)) {
      out.push({
        ruleId: 'R13',
        category: 'editResidue',
        source: 'text',
        severity: 'info',
        confidence: 'low',
        text: { page, start: m.index, end: m.index + m[0].length },
        reasons: [L('正文中有编辑残留标记；残留的修改意见有时包含合作者姓名。', 'Editing residue in the text; leftover comments sometimes contain co-author names.')],
        suggestion: L('确认是否为遗留的 TODO / 批注文字，提交前删除。', 'Check whether it is a leftover TODO / comment and remove it before submitting.'),
      })
    }
  }
  return out
}

export function ruleAttachments(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  return doc.attachments.map((att, i) => {
    const tokens = [...identityTokens(filenameWords(att.filename), ctx), ...identityTokens(att.description, ctx)]
    for (const n of ctx.derivedNames) {
      const surname = n.tokens[n.tokens.length - 1] ?? ''
      if (!isAmbiguousTerm(surname) && termRegex(surname).test(filenameWords(att.filename)))
        tokens.push(L(`含作者姓「${surname}」`, `contains the author surname “${surname}”`))
    }
    if (freshRegex(EMAIL).test(att.filename)) tokens.push(L('文件名含邮箱', 'the file name contains an email'))
    const seen = new Set<string>()
    const uniq = tokens.filter((t) => !seen.has(t.zh) && seen.add(t.zh))
    return {
      ruleId: 'R17',
      category: 'attachment' as const,
      source: 'attachment' as const,
      severity: uniq.length ? ('high' as const) : ('medium' as const),
      confidence: uniq.length ? ('high' as const) : ('medium' as const),
      snippet: att.description ? `${att.filename} — ${att.description}` : att.filename,
      field: 'attachment',
      reasons: [
        L(
          `PDF 内嵌附件 “${att.filename}”${att.byteSize != null ? `（${att.byteSize} 字节）` : ''}。本工具不解析附件内容。`,
          `Embedded attachment “${att.filename}”${att.byteSize != null ? ` (${att.byteSize} bytes)` : ''}. Its content is not parsed.`,
        ),
        ...(uniq.length
          ? [L(`附件名或描述${join(uniq, LIST_SEP).zh}。`, `The attachment name or description ${join(uniq, LIST_SEP).en}.`)]
          : [L('附件可能包含未匿名的数据、源码或日志，需要人工检查。', 'Attachments may contain non-anonymous data, code or logs; check them manually.')]),
      ],
      suggestion: L(
        '除非会场明确允许，删除嵌入附件，改为单独上传匿名补充材料。',
        'Unless the venue explicitly allows it, remove embedded attachments and upload anonymous supplementary material separately.',
      ),
      key: `att-${i}-${att.rawFilename}`,
    }
  })
}
