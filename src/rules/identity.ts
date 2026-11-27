/**
 * 身份类规则：R01 元数据、R02 邮箱、R03 自定义词/派生姓名、R04 机构、R15 ORCID/本地路径。
 */
import type { Confidence, DocumentFacts, Severity, Zone } from '@/domain/types'
import { normalizeText } from '@/normalize/unicode'
import { type FindingDraft, type RuleContext, type TextHit, ZONE_LABEL, around, demote, scanDoc, zoneOf } from './core'
import {
  EMAIL,
  EXAMPLE_DOMAIN,
  GROUPED_EMAIL,
  INSTITUTION,
  LOCAL_PATH,
  ORCID,
  freshRegex,
} from './patterns'
import { isAnonymousPlaceholder, localPartMatchesName, termRegex } from './terms'
import { L, LIST_SEP, type Text, join } from '@/domain/text'

// ---------------------------------------------------------------------------
// R01 元数据
// ---------------------------------------------------------------------------

const PDFJS_FLAGS = /^(?:PDFFormatVersion|IsLinearized|IsAcroFormPresent|IsXFAPresent|IsCollectionPresent|IsSignaturesPresent|Language|EncryptFilterName|Trapped)$/
const AUTHOR_KEY = /^(?:Author|dc:creator|pdf:author|xmp:author|Custom\.(?:Authors?|Creator))$/i
const SOFTWARE_KEY = /^(?:Creator|Producer|xmp:creatortool|pdf:producer)$/i
const DATE_KEY = /^(?:CreationDate|ModDate|xmp:createdate|xmp:modifydate|xmp:metadatadate)$/i
const DESCRIPTIVE_KEY = /^(?:Title|Subject|Keywords|dc:title|dc:description|dc:subject|pdf:keywords)$/i
const XMP_IGNORED = /^(?:xmpmm:|pdfx:ptex\.fullbanner|xmp:)/i

/** 一个值里的身份线索（双语）；userTerm 标记命中了用户输入的自定义词 */
export type IdentityToken = Text & { userTerm?: boolean }

export function identityTokens(value: string, ctx: RuleContext): IdentityToken[] {
  const out: IdentityToken[] = []
  const v = normalizeText(value)
  if (freshRegex(EMAIL).test(v)) out.push(L('含邮箱', 'contains an email address'))
  if (freshRegex(INSTITUTION).test(v)) out.push(L('含机构词', 'contains an institution word'))
  for (const t of ctx.userTerms)
    if (!t.ambiguous && termRegex(t.normalized).test(v)) out.push({ ...L(`含自定义词「${t.raw}」`, `contains your term “${t.raw}”`), userTerm: true })
  for (const n of ctx.derivedNames) if (termRegex(n.raw).test(v)) out.push(L(`含作者名「${n.raw}」`, `contains the author name “${n.raw}”`))
  if (LOCAL_PATH.test(v)) out.push(L('含本地用户路径', 'contains a local user path'))
  LOCAL_PATH.lastIndex = 0
  return out
}

export const hasUserTerm = (tokens: IdentityToken[]) => tokens.some((t) => t.userTerm)

export function ruleMetadata(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  const software: string[] = []
  const groups: Array<[string, Record<string, string> | null]> = [
    ['Info', doc.info],
    ['XMP', doc.xmp],
  ]
  for (const [group, dict] of groups) {
    if (!dict) continue
    for (const [key, rawValue] of Object.entries(dict)) {
      const value = rawValue.trim()
      if (!value || PDFJS_FLAGS.test(key)) continue
      const field = `${group}.${key}`
      const tokens = identityTokens(value, ctx)
      const base = { ruleId: 'R01', category: 'metadata' as const, source: 'metadata' as const, field, snippet: value, pageNumber: null, zone: null }

      if (AUTHOR_KEY.test(key)) {
        if (isAnonymousPlaceholder(value)) continue
        out.push({
          ...base,
          severity: 'high',
          confidence: 'high',
          reasons: [
            group === 'Info'
              ? L('PDF Info 字典的作者字段非空且不是匿名占位符。', 'The PDF Info author field is set and is not an anonymous placeholder.')
              : L('XMP 元数据的作者字段非空且不是匿名占位符。', 'The XMP author field is set and is not an anonymous placeholder.'),
            ...tokens,
          ],
          suggestion: L(
            '在 LaTeX 中用 \\hypersetup{pdfauthor={}} 或导出设置清空作者；Word 用「检查文档 → 删除文档属性」。清理后重新导出并再检查一次。',
            'In LaTeX clear it with \\hypersetup{pdfauthor={}} or your export settings; in Word use “Inspect Document → Remove document properties”. Export again and re-check.',
          ),
        })
        continue
      }
      if (SOFTWARE_KEY.test(key) || DATE_KEY.test(key)) {
        if (tokens.length > 0) {
          out.push({
            ...base,
            severity: 'medium',
            confidence: 'medium',
            reasons: [join([L('生成软件字段里出现了可能识别身份的内容：', 'The producer / creator field contains something identifying: '), join(tokens, LIST_SEP)])],
            suggestion: L('清空或改写该字段后重新导出。', 'Clear or rewrite the field and export again.'),
          })
        } else software.push(`${field}=${value}`)
        continue
      }
      if (group === 'XMP' && XMP_IGNORED.test(key) && tokens.length === 0) continue
      if (key.startsWith('Custom.')) {
        out.push({
          ...base,
          severity: tokens.length ? 'high' : 'medium',
          confidence: tokens.length ? 'high' : 'medium',
          reasons: [L('PDF 带有自定义元数据字段，常由模板或机构流程写入。', 'The PDF has custom metadata fields, often written by templates or institutional workflows.'), ...tokens],
          suggestion: L(
            '删除自定义文档属性（Acrobat：文件 → 属性 → 自定义；或用 exiftool/qpdf 清理）后重新检查。',
            'Remove the custom document properties (Acrobat: File → Properties → Custom, or clean with exiftool / qpdf) and re-check.',
          ),
        })
        continue
      }
      if (DESCRIPTIVE_KEY.test(key) || group === 'XMP') {
        if (tokens.length === 0) continue
        out.push({
          ...base,
          severity: 'high',
          confidence: 'medium',
          reasons: [join([L(`元数据字段 ${field} 中：`, `Metadata field ${field}: `), join(tokens, LIST_SEP)])],
          suggestion: L('清空或改写该字段后重新导出。', 'Clear or rewrite the field and export again.'),
        })
      }
    }
  }
  if (software.length > 0) {
    out.push({
      ruleId: 'R01',
      category: 'metadata',
      source: 'metadata',
      field: 'software',
      severity: 'info',
      confidence: 'high',
      pageNumber: null,
      zone: null,
      snippet: software.join('；'),
      reasons: [L('生成软件与时间字段通常不识别作者（如 LaTeX、pdfTeX），仅供知悉。', 'Producer and date fields usually do not identify authors (e.g. LaTeX, pdfTeX); listed for your information.')],
      suggestion: L('一般无需处理；若字段中含机构内部工具名或主机名，再考虑清理。', 'Usually nothing to do; clean them if they contain internal tool or host names.'),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// R02 邮箱
// ---------------------------------------------------------------------------

function emailSeverity(zone: Zone, ownName: boolean, exampleDomain: boolean): [Severity, Confidence, Text] {
  if (exampleDomain) return ['info', 'low', L('RFC 2606 示例域名，通常是占位符。', 'An RFC 2606 example domain, usually a placeholder.')]
  if (zone === 'references')
    return [ownName ? 'medium' : 'info', 'low', L('位于参考文献，可能是他人联系方式；请人工确认。', 'In the references; may be someone else’s contact. Please check.')]
  if (zone === 'authorBlock' || zone === 'header' || zone === 'footer' || zone === 'acknowledgments')
    return ['high', 'high', L(`位于${ZONE_LABEL[zone].zh}，几乎必然是作者联系方式。`, `In the ${ZONE_LABEL[zone].en}; almost certainly an author contact.`)]
  if (ownName) return ['high', 'high', L('邮箱用户名与元数据或自定义词条中的姓名一致。', 'The mailbox name matches a name from the metadata or your terms.')]
  return [
    'medium',
    'medium',
    L(
      `位于${ZONE_LABEL[zone].zh}；可能是作者通讯邮箱，也可能是数据集/工具联系人。`,
      `In the ${ZONE_LABEL[zone].en}; could be an author contact or a dataset / tool contact.`,
    ),
  ]
}

export function ruleEmail(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  const names = [
    ...ctx.derivedNames,
    ...ctx.userTerms.filter((t) => !t.ambiguous).map((t) => ({ tokens: t.normalized.toLowerCase().split(/\s+/) })),
  ]
  const suggestion = L(
    '删除或替换为匿名表述（如 “anonymous@submission”），并检查同一邮箱是否也出现在元数据、页脚或补充材料中。',
    'Remove it or replace it with an anonymous form (e.g. “anonymous@submission”), and check whether the same address appears in metadata, footers or supplements.',
  )

  const grouped = scanDoc(doc, GROUPED_EMAIL)
  for (const hit of grouped) {
    const locals = (hit.match[1] ?? '').split(/\s*[,;|]\s*/)
    const domain = hit.match[2] ?? ''
    const own = locals.some((l) => localPartMatchesName(l, names))
    const [severity, confidence, why] = emailSeverity(zoneOf(hit), own, EXAMPLE_DOMAIN.test(domain))
    out.push({
      ruleId: 'R02',
      category: 'email',
      source: 'text',
      severity,
      confidence,
      text: hit,
      reasons: [L(`分组邮箱写法，展开为 ${locals.length} 个地址（@${domain}）。`, `Grouped email notation expanding to ${locals.length} addresses (@${domain}).`), why],
      suggestion,
    })
  }

  const inGroup = (h: TextHit) => grouped.some((g) => g.page === h.page && g.start <= h.start && h.end <= g.end)
  for (const hit of scanDoc(doc, EMAIL, (h) => !inGroup(h))) {
    const addr = hit.match[0]
    const [local = '', domain = ''] = addr.split('@')
    const own = localPartMatchesName(local, names)
    const [severity, confidence, why] = emailSeverity(zoneOf(hit), own, EXAMPLE_DOMAIN.test(domain))
    const reasons: Text[] = [why]
    const view = hit.viewText.slice(hit.viewStart, hit.viewEnd)
    if (!hit.page.text.slice(hit.start, hit.end).includes(view))
      reasons.push(L('该邮箱在版面上被拆成多行或多段，已拼接识别。', 'The address is split across lines or text runs; it was joined to detect it.'))
    out.push({ ruleId: 'R02', category: 'email', source: 'text', severity, confidence, text: hit, reasons, suggestion })
  }

  for (const page of doc.pages) {
    for (const a of page.annotations) {
      if (!a.url || !/^mailto:/i.test(a.url)) continue
      const addr = decodeURIComponentSafe(a.url.replace(/^mailto:/i, '').split('?')[0] ?? '')
      const [local = '', domain = ''] = addr.split('@')
      const own = localPartMatchesName(local, names)
      out.push({
        ruleId: 'R02',
        category: 'email',
        source: 'link',
        severity: EXAMPLE_DOMAIN.test(domain) ? 'info' : own ? 'high' : 'medium',
        confidence: own ? 'high' : 'medium',
        pageNumber: page.pageNumber,
        rect: a.rect,
        snippet: addr,
        linkTarget: a.url,
        visibleText: a.visibleText || null,
        key: a.id,
        reasons: [L('PDF 中有 mailto: 链接；即使页面上看不到邮箱，点击也会暴露地址。', 'The PDF has a mailto: link; clicking it reveals the address even if it is not visible on the page.')],
        suggestion: L('删除该链接（LaTeX 中检查 \\href{mailto:…} 与 hyperref 设置）。', 'Remove the link (in LaTeX check \\href{mailto:…} and the hyperref settings).'),
      })
    }
  }
  return out
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// ---------------------------------------------------------------------------
// R03 自定义词条 / 元数据派生姓名
// ---------------------------------------------------------------------------

function termSeverity(zone: Zone, ambiguous: boolean, strict: boolean): [Severity, Confidence] {
  let s: Severity
  let c: Confidence
  switch (zone) {
    case 'authorBlock':
    case 'header':
    case 'footer':
    case 'acknowledgments':
      s = 'high'
      c = 'high'
      break
    case 'references':
      s = 'info'
      c = 'low'
      break
    default:
      s = 'medium'
      c = 'medium'
  }
  if (ambiguous && !strict) {
    s = s === 'info' ? 'info' : demote(s)
    c = 'low'
  }
  return [s, c]
}

export function ruleUserTerms(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  const terms: Array<{ label: string; normalized: string; ambiguous: boolean; user: boolean; source: Text }> = [
    ...ctx.userTerms.map((t) => ({ label: t.raw, normalized: t.normalized, ambiguous: t.ambiguous, user: true, source: L('你输入的自定义词条', 'your custom terms') })),
    ...ctx.derivedNames
      .filter((n) => !ctx.userTerms.some((t) => t.normalized.toLowerCase() === n.raw.toLowerCase()))
      .map((n) => ({
        label: n.raw,
        normalized: n.raw,
        ambiguous: false,
        user: false,
        source: L(`元数据作者（${n.source.zh}）`, `metadata author (${n.source.en})`),
      })),
  ]
  for (const term of terms) {
    for (const hit of scanDoc(doc, termRegex(term.normalized))) {
      const zone = zoneOf(hit)
      const [severity, confidence] = termSeverity(zone, term.ambiguous, ctx.strictShortTerms)
      const reasons: Text[] = [
        L(`匹配「${term.label}」，来源：${term.source.zh}；位于${ZONE_LABEL[zone].zh}。`, `Matches “${term.label}” (from ${term.source.en}); in the ${ZONE_LABEL[zone].en}.`),
      ]
      if (zone === 'references')
        reasons.push(
          L(
            '参考文献中以第三人称引用自己的工作通常是允许的；请确认引用方式不暴露作者关系。',
            'Citing your own work in the third person in the references is usually allowed; make sure the wording does not reveal authorship.',
          ),
        )
      else if (zone === 'body' || zone === 'appendix') {
        const { post } = around(hit, 0, 12)
        if (/^\s*(?:et\s+al\.|and\s+\p{Lu}|\[\d)/u.test(post))
          reasons.push(L('看起来是第三人称引用（如 “X et al. [n]”），一般可以保留。', 'Looks like a third-person citation (e.g. “X et al. [n]”); usually fine to keep.'))
      }
      if (term.ambiguous && !ctx.strictShortTerms)
        reasons.push(L('词条较短或较常见，已降低优先级；可在设置里开启「严格短词」。', 'The term is short or common, so it was demoted; enable strict short terms to change this.'))
      out.push({
        ruleId: 'R03',
        category: 'userTerm',
        source: 'text',
        severity,
        confidence,
        text: hit,
        reasons,
        matchedUserTerm: term.user,
        suggestion:
          zone === 'references'
            ? L(
                '保留第三人称引用；确认正文没有 “our previous work [n]” 之类把该文献与作者关联的措辞。',
                'Keep third-person citations; make sure the text has no “our previous work [n]” wording linking it to the authors.',
              )
            : L('删除或改为匿名表述；如需引用自己的工作，使用第三人称。', 'Remove or anonymize it; cite your own work in the third person.'),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// R04 机构
// ---------------------------------------------------------------------------

const CONNECTORS = new Set(['of', 'for', 'and', 'the', '&', 'de', 'di', 'der', 'des', 'du', 'la', 'le', 'y', 'in', 'at'])

/** 由关键词向两侧扩展为完整机构短语（大写词与连接词，不跨越标点） */
const LABEL_WORDS = /^(?:Correspond\w*|E-?mails?|Contact|Abstract|Keywords?|Index|Equal|Address|Homepage|Website|Code|Data)$/iu

function expandInstitution(text: string, s: number, e: number, sameZone: (from: number, to: number) => boolean = () => true): [number, number] {
  const first = text[s] ?? ''
  if (/[\p{Script=Han}]/u.test(first)) {
    let a = s
    let steps = 0
    while (a > 0 && /[\p{Script=Han}]/u.test(text[a - 1] ?? '') && steps < 14) {
      a--
      steps++
    }
    return [a, e]
  }
  const tokenRe = /[\p{L}][\p{L}'.&-]*|&/uy
  // 向左：每次跨过恰好一个空格和一个词
  let a = s
  for (let n = 0; n < 6; n++) {
    if (text[a - 1] !== ' ') break
    const k = a - 2
    if (k < 0 || !/[\p{L}&.]/u.test(text[k] ?? '')) break
    let st = k
    while (st > 0 && /[\p{L}'.&-]/u.test(text[st - 1] ?? '')) st--
    const tok = text.slice(st, k + 1)
    if (!/^[\p{L}&]/u.test(tok)) break
    if (!sameZone(s, st)) break
    if (/^\p{Lu}/u.test(tok) || CONNECTORS.has(tok.toLowerCase())) a = st
    else break
  }
  // 向右
  let b = e
  for (let n = 0; n < 7; n++) {
    let k = b
    if (text[k] !== ' ') break
    k++
    tokenRe.lastIndex = k
    const m = tokenRe.exec(text)
    if (!m) break
    const tok = m[0]
    if (!sameZone(s, k)) break
    // “Correspondence:” “Email:” 之类的标签属于下一行，不是机构名的一部分
    if (LABEL_WORDS.test(tok) || text[k + tok.length] === ':' || text[k + tok.length] === '：') break
    if (/^\p{Lu}/u.test(tok) || CONNECTORS.has(tok.toLowerCase())) b = k + tok.length
    else break
  }
  // 去掉两端的连接词
  let phrase = text.slice(a, b)
  const lead = /^(?:(?:of|for|and|the|&|in|at)\s+)+/i.exec(phrase)
  if (lead) a += lead[0].length
  phrase = text.slice(a, b)
  const trail = /(?:\s+(?:of|for|and|the|&|in|at))+$/i.exec(phrase)
  if (trail) b -= trail[0].length
  if (text[b - 1] === '.' && !/\b(?:Inc|Ltd|Co|St|Univ|Dept)\.$/.test(text.slice(a, b))) b--
  return [a, b]
}

export function ruleInstitution(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  void ctx
  const out: FindingDraft[] = []
  for (const page of doc.pages) {
    const flat = page.views.find((v) => v.name === 'flat')
    if (!flat) continue
    const spans: Array<[number, number]> = []
    const re = freshRegex(INSTITUTION)
    let m: RegExpExecArray | null
    // 扁平视图把换行变成空格；扩展时不跨到另一个版面区域（如从作者区扩进标题）
    const zoneAtView = (i: number) => zoneOf({ page, start: flat.toBase[i] ?? 0 })
    const sameZone = (from: number, to: number) => zoneAtView(from) === zoneAtView(to)
    while ((m = re.exec(flat.text)) !== null) {
      const [a, b] = expandInstitution(flat.text, m.index, m.index + m[0].length, sameZone)
      spans.push([a, b])
    }
    // 合并重叠或仅隔 “, ” 的短语
    spans.sort((x, y) => x[0] - y[0])
    const merged: Array<[number, number]> = []
    for (const sp of spans) {
      const last = merged[merged.length - 1]
      if (last && sp[0] <= last[1] + 2 && !/[.;]/.test(flat.text.slice(last[1], sp[0]))) last[1] = Math.max(last[1], sp[1])
      else merged.push([...sp])
    }
    for (const [vs, ve] of merged) {
      const s = flat.toBase[vs] ?? 0
      const e = (flat.toBase[ve - 1] ?? s) + 1
      const zone = zoneOf({ page, start: s })
      if (zone === 'references') continue
      let severity: Severity
      let confidence: Confidence
      let why: Text
      if (zone === 'authorBlock' || zone === 'header' || zone === 'footer') {
        severity = 'high'
        confidence = 'high'
        why = L(`机构名称位于${ZONE_LABEL[zone].zh}，通常是作者单位。`, `An institution name in the ${ZONE_LABEL[zone].en}, usually the authors’ affiliation.`)
      } else if (zone === 'acknowledgments') {
        severity = 'medium'
        confidence = 'medium'
        why = L('机构名称位于致谢，可能暴露作者单位或资助方。', 'An institution name in the acknowledgments may reveal the affiliation or a funder.')
      } else {
        severity = 'info'
        confidence = 'low'
        why = L(
          `机构名称位于${ZONE_LABEL[zone].zh}；可能只是数据集、合作方或第三方，请结合上下文判断。`,
          `An institution name in the ${ZONE_LABEL[zone].en}; may just be a dataset, partner or third party — judge from context.`,
        )
      }
      out.push({
        ruleId: 'R04',
        category: 'institution',
        source: 'text',
        severity,
        confidence,
        text: { page, start: s, end: e },
        reasons: [why],
        suggestion:
          zone === 'body' || zone === 'appendix'
            ? L(
                '若只是第三方或数据来源，可标记为「第三方」忽略；若是作者单位，请改为匿名表述。',
                'If it is only a third party or data source, dismiss it as third-party; if it is the authors’ affiliation, anonymize it.',
              )
            : L('删除或匿名化（如 “Anonymous Institution”）。', 'Remove or anonymize it (e.g. “Anonymous Institution”).'),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// R15 ORCID / 本地用户路径
// ---------------------------------------------------------------------------

function orcidChecksumOk(id: string): boolean {
  const digits = id.replace(/-/g, '')
  let total = 0
  for (let i = 0; i < 15; i++) total = (total + Number(digits[i])) * 2
  const r = (12 - (total % 11)) % 11
  const check = r === 10 ? 'X' : String(r)
  return (digits[15] ?? '').toUpperCase() === check
}

export function ruleOrcidPath(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  void ctx
  const out: FindingDraft[] = []
  for (const hit of scanDoc(doc, ORCID)) {
    const zone = zoneOf(hit)
    const valid = orcidChecksumOk(hit.match[0])
    const authorish = zone === 'authorBlock' || zone === 'header' || zone === 'footer'
    out.push({
      ruleId: 'R15',
      category: 'identifier',
      source: 'text',
      severity: zone === 'references' ? 'info' : authorish ? 'high' : 'medium',
      confidence: valid ? (authorish ? 'high' : 'medium') : 'low',
      text: hit,
      reasons: [
        valid ? L('ORCID 格式且校验位正确。', 'An ORCID iD with a valid checksum.') : L('疑似 ORCID（格式符合，校验位不符）。', 'Looks like an ORCID iD (format matches, checksum does not).'),
        L(`位于${ZONE_LABEL[zone].zh}。`, `In the ${ZONE_LABEL[zone].en}.`),
      ],
      suggestion: L('投稿版删除 ORCID；参考文献中他人的 ORCID 可以保留。', 'Remove ORCID iDs from the submission; other people’s ORCIDs in the references can stay.'),
    })
  }
  for (const hit of scanDoc(doc, LOCAL_PATH)) {
    out.push({
      ruleId: 'R15',
      category: 'identifier',
      source: 'text',
      severity: 'medium',
      confidence: 'medium',
      text: hit,
      reasons: [L('文件中出现本地用户目录路径，路径里的用户名可能识别作者。', 'A local user-directory path appears; the user name in it may identify an author.')],
      suggestion: L('删除或改为相对路径（常见于代码清单、日志截图和编译警告）。', 'Remove it or use a relative path (common in code listings, log screenshots and build warnings).'),
    })
  }
  return out
}
