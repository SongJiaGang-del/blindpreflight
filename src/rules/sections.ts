/**
 * 章节与措辞类规则：R05 致谢、R06 资助、R08 第一人称自引、R09 隐式第一人称身份。
 */
import type { DocumentFacts, PageFacts, Severity } from '@/domain/types'
import { type FindingDraft, type RuleContext, type TextHit, ZONE_LABEL, around, scanDoc, scanText, zoneOf } from './core'
import {
  ACK_REDACTED,
  AGENCY,
  AI_DISCLOSURE,
  CITATION_MARK,
  GRANT,
  IMPLICIT_IDENTITY,
  INSTITUTION,
  SELF_CITE_EN,
  SELF_CITE_ZH,
  SUPPORT_PHRASE,
  THANKS,
  freshRegex,
} from './patterns'
import { termRegex } from './terms'
import { L, LIST_SEP, type Text, join } from '@/domain/text'

// ---------------------------------------------------------------------------
// R05 致谢
// ---------------------------------------------------------------------------

interface Section {
  parts: Array<{ page: PageFacts; start: number; end: number }>
  text: string
}

function ackSections(doc: DocumentFacts): Section[] {
  const sections: Section[] = []
  let cur: Section | null = null
  let lastWasAck = false
  for (const page of doc.pages) {
    for (const line of page.lines) {
      if (line.zone === 'header' || line.zone === 'footer') continue
      if (line.zone === 'acknowledgments') {
        if (!cur || !lastWasAck) {
          cur = { parts: [], text: '' }
          sections.push(cur)
        }
        const part = cur.parts[cur.parts.length - 1]
        if (part && part.page === page) part.end = line.end
        else cur.parts.push({ page, start: line.start, end: line.end })
        cur.text += (cur.text ? ' ' : '') + line.text
        lastWasAck = true
      } else lastWasAck = false
    }
  }
  return sections
}

const PERSON_NAME = /\b\p{Lu}\p{Ll}+(?:\s+\p{Lu}\.)?\s+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?\b/gu
const NOT_NAME = /^(?:We|The|This|Our|In|For|And|Acknowledg\w*|National|Science|Foundation|Grant|University|Institute|Department|Research|Program|Council)\b/u

function looksLikeNames(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(freshRegex(PERSON_NAME))) {
    const n = m[0]
    if (NOT_NAME.test(n) || n.split(/\s+/).some((w) => NOT_NAME.test(w))) continue
    out.push(n)
  }
  return out
}

export function ruleAcknowledgments(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  const policy = ctx.preset.ackPolicy
  for (const sec of ackSections(doc)) {
    const first = sec.parts[0]
    if (!first) continue
    const body = sec.text.replace(/^\s*(?:\d+(?:\.\d+)*[.)]?\s*)?(?:acknowledg(?:e)?ments?|致\s*谢)\s*[.:：]?\s*/iu, '')
    const signals: Text[] = []
    const names = looksLikeNames(body)
    if (names.length)
      signals.push(L(`疑似人名 ${names.length} 处（如 ${names.slice(0, 2).join('、')}）`, `${names.length} likely person name(s) (e.g. ${names.slice(0, 2).join(', ')})`))
    const funding = freshRegex(AGENCY).test(body) || freshRegex(SUPPORT_PHRASE).test(body) || /\d{5,}/.test(body)
    const institution = freshRegex(INSTITUTION).test(body)
    if (funding) signals.push(L('资助/项目信息', 'funding / grant information'))
    if (institution) signals.push(L('机构名称', 'institution names'))
    if (THANKS.test(body)) signals.push(L('致谢措辞（thank / grateful）', 'thanking wording (thank / grateful)'))
    for (const n of ctx.derivedNames) if (termRegex(n.raw).test(body)) signals.push(L(`作者名「${n.raw}」`, `author name “${n.raw}”`))
    const redacted = ACK_REDACTED.test(body)
    const aiOnly = AI_DISCLOSURE.test(body) && !names.length && !funding && !institution
    const empty = body.trim().length < 3

    let severity: Severity
    const reasons: Text[] = []
    let suggestion: Text
    if (redacted || empty) {
      severity = 'info'
      reasons.push(
        redacted
          ? L('致谢已写明为匿名审稿而隐去。', 'The acknowledgments say they were removed for anonymous review.')
          : L('只有致谢标题，没有内容。', 'Only an acknowledgments heading, no content.'),
      )
      suggestion =
        policy === 'forbidden'
          ? L('该会场投稿版不应包含致谢章节，建议连标题一起删除。', 'This venue’s submission should not contain an acknowledgments section; remove the heading too.')
          : L('确认最终版再补回致谢。', 'Add the acknowledgments back in the final version.')
      if (policy === 'forbidden') severity = 'medium'
    } else if (policy === 'forbidden') {
      severity = 'high'
      reasons.push(
        L(`当前预设（${ctx.preset.venue.zh}）要求投稿版不包含致谢。`, `The current preset (${ctx.preset.venue.en}) requires no acknowledgments in the submission.`),
      )
      suggestion = L('删除整个致谢章节（含资助信息），录用后的最终版再加入。', 'Remove the whole acknowledgments section (including funding); add it back after acceptance.')
    } else if (policy === 'aiDisclosureOnly' && aiOnly) {
      severity = 'info'
      reasons.push(
        L(
          '致谢只包含 AI 工具使用披露；当前预设允许在投稿版保留这类内容。',
          'The acknowledgments only disclose AI tool use, which the current preset allows in the submission.',
        ),
      )
      suggestion = L('确认其中没有人名、机构或资助信息。', 'Make sure it contains no names, institutions or funding.')
    } else {
      severity = signals.length ? 'high' : 'medium'
      reasons.push(
        signals.length
          ? L('致谢中包含可识别作者的信息。', 'The acknowledgments contain information that can identify the authors.')
          : L('投稿版出现致谢章节。', 'The submission contains an acknowledgments section.'),
      )
      suggestion =
        policy === 'aiDisclosureOnly'
          ? L(
              '投稿版只保留 AI 使用披露，删除人名、机构与资助信息；最终版再补回。',
              'Keep only the AI-use disclosure in the submission; remove names, institutions and funding and add them back later.',
            )
          : L(
              '删除或改为 “Acknowledgments omitted for anonymous review.”，最终版再补回。',
              'Remove it or replace it with “Acknowledgments omitted for anonymous review.”, and restore it in the final version.',
            )
    }
    if (signals.length) reasons.push(join([L('检测到：', 'Detected: '), join(signals, L('；', '; '))]))
    const extra = sec.parts.slice(1)
    out.push({
      ruleId: 'R05',
      category: 'acknowledgments',
      source: 'text',
      severity,
      confidence: redacted || empty ? 'medium' : 'high',
      text: { page: first.page, start: first.start, end: Math.min(first.end, first.start + 600) },
      extra,
      zone: 'acknowledgments',
      reasons,
      suggestion,
      key: 'section',
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// R06 资助 / 项目编号
// ---------------------------------------------------------------------------

export function ruleFunding(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  void ctx
  const out: FindingDraft[] = []
  for (const page of doc.pages) {
    const numbers = scanText(page, GRANT, (h) => /\d/.test(h.match[1] ?? ''))
    const agencies = scanText(page, AGENCY)
    const phrases = scanText(page, SUPPORT_PHRASE)
    type Tagged = TextHit & { kind: 'number' | 'agency' | 'phrase' }
    const all: Tagged[] = [
      ...numbers.map((h) => ({ ...h, kind: 'number' as const })),
      ...agencies.map((h) => ({ ...h, kind: 'agency' as const })),
      ...phrases.map((h) => ({ ...h, kind: 'phrase' as const })),
    ].sort((a, b) => a.start - b.start)
    // 100 字内的线索合并为一处
    const clusters: Tagged[][] = []
    for (const h of all) {
      const last = clusters[clusters.length - 1]
      const lastEnd = last ? Math.max(...last.map((x) => x.end)) : -Infinity
      if (last && h.start - lastEnd <= 100) last.push(h)
      else clusters.push([h])
    }
    for (const c of clusters) {
      const kinds = new Set(c.map((h) => h.kind))
      const start = Math.min(...c.map((h) => h.start))
      const end = Math.max(...c.map((h) => h.end))
      const zone = zoneOf({ page, start })
      if (zone === 'references') continue
      // 只有“受…支持”或只有机构名、而不在致谢里 → 多半是正文普通措辞
      if (!kinds.has('number') && zone !== 'acknowledgments' && !(kinds.has('agency') && kinds.has('phrase'))) continue
      if (kinds.size === 1 && kinds.has('agency') && zone !== 'acknowledgments') continue
      const strong = kinds.has('number') && (kinds.has('agency') || kinds.has('phrase'))
      const parts: Text[] = []
      if (kinds.has('number')) parts.push(L('项目/资助编号', 'grant numbers'))
      if (kinds.has('agency')) parts.push(L('资助机构', 'funding agencies'))
      if (kinds.has('phrase')) parts.push(L('“受…资助”措辞', '“supported by …” wording'))
      out.push({
        ruleId: 'R06',
        category: 'funding',
        source: 'text',
        severity: 'medium',
        confidence: strong ? 'high' : 'medium',
        text: { page, start, end },
        reasons: [
          L(`检测到${join(parts, LIST_SEP).zh}，位于${ZONE_LABEL[zone].zh}。`, `Detected ${join(parts, LIST_SEP).en} in the ${ZONE_LABEL[zone].en}.`),
          L('资助编号可在公开数据库中反查到负责人与单位。', 'Grant numbers can be looked up in public databases to find the PI and institution.'),
        ],
        suggestion: L(
          '投稿版匿名化而不是直接删除事实，例如写 “Funding information removed for review.”；最终版恢复。',
          'Anonymize rather than hide the fact, e.g. “Funding information removed for review.”; restore it in the final version.',
        ),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// R08 第一人称自引
// ---------------------------------------------------------------------------

export function ruleSelfCitation(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  void ctx
  const out: FindingDraft[] = []
  const raw = [...scanDoc(doc, SELF_CITE_EN), ...scanDoc(doc, SELF_CITE_ZH)].sort(
    (a, b) => a.page.pageNumber - b.page.pageNumber || a.start - b.start,
  )
  // “As we showed in our earlier paper” 会命中两段相邻的模式，合并为一处
  const hits: TextHit[] = []
  for (const h of raw) {
    const last = hits[hits.length - 1]
    if (last && last.page === h.page && h.start - last.end <= 2) {
      hits[hits.length - 1] = { ...last, end: Math.max(last.end, h.end), viewEnd: Math.max(last.viewEnd, h.viewEnd) }
    } else hits.push(h)
  }
  for (const hit of hits) {
    const zone = zoneOf(hit)
    if (zone === 'references') continue
    const { pre, post } = around(hit, 40, 100)
    const cited = freshRegex(CITATION_MARK).test(post) || freshRegex(CITATION_MARK).test(pre)
    out.push({
      ruleId: 'R08',
      category: 'selfCitation',
      source: 'text',
      severity: 'medium',
      confidence: cited ? 'high' : 'medium',
      text: hit,
      reasons: [
        L('第一人称描述自己以前的工作，会把被引文献与作者直接关联。', 'Describing your earlier work in the first person links the cited paper directly to the authors.'),
        cited
          ? L('附近有引用标记，审稿人可以据此查到作者。', 'A citation marker is nearby, so reviewers can look up the authors.')
          : L('附近没有找到引用标记，请确认是否指向具体文献。', 'No citation marker nearby; check whether it refers to a specific paper.'),
      ],
      suggestion: L(
        '改为第三人称，例如 “Example et al. [3] showed …”，不要写 “our previous work [3]”。',
        'Use the third person, e.g. “Example et al. [3] showed …”, instead of “our previous work [3]”.',
      ),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// R09 隐式第一人称身份
// ---------------------------------------------------------------------------

export function ruleImplicitIdentity(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  void ctx
  return scanDoc(doc, IMPLICIT_IDENTITY)
    .filter((h) => zoneOf(h) !== 'references')
    .map((hit) => {
      const { post } = around(hit, 0, 80)
      const specific = freshRegex(INSTITUTION).test(post)
      return {
        ruleId: 'R09',
        category: 'implicitIdentity' as const,
        source: 'text' as const,
        severity: specific ? ('medium' as const) : ('info' as const),
        confidence: specific ? ('medium' as const) : ('low' as const),
        text: hit,
        reasons: [
          L('“our lab / 本校” 之类措辞会暗示作者所在单位。', 'Wording like “our lab / our university” hints at the authors’ institution.'),
          specific
            ? L('后文紧接机构名称，组合后可识别。', 'An institution name follows, which together can identify the authors.')
            : L('单独出现时通常无法识别具体单位；研究设置可能确实需要保留。', 'On its own it usually does not identify the institution; the study setup may require it.'),
        ],
        suggestion: L('改为中性表述，如 “a university hospital”、“the participating institution”。', 'Use neutral wording such as “a university hospital” or “the participating institution”.'),
      }
    })
}
