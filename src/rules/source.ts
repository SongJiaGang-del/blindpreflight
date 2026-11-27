/**
 * 源文件包规则：R22 源码作者信息、R23 源码注释与隐藏内容、R24 版本库与构建残留、R25 包内文件元数据。
 * 只用于随稿件提交或公开的源码（arXiv 源文件、补充材料代码包）；PDF 中可见的正文由其他规则负责。
 */
import type { Severity, SourceFacts } from '@/domain/types'
import { normalizeText } from '@/normalize/unicode'
import { inRanges, texCommands, texHiddenRanges } from '@/normalize/tex'
import type { FindingDraft, RuleContext } from './core'
import { identityTokens } from './identity'
import { EMAIL, EXAMPLE_DOMAIN, INSTITUTION, LOCAL_PATH, URL_RE, freshRegex } from './patterns'
import { parseLink } from './links'
import { isAnonymousPlaceholder, termRegex } from './terms'

/** 每个文件每条规则最多报告的条数，其余合并说明 */
const PER_FILE = 12

/** 行号查找：预先记录换行位置，二分 */
function lineFinder(text: string) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return (pos: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= pos) lo = mid
      else hi = mid - 1
    }
    const start = starts[lo]!
    const next = starts[lo + 1]
    const end = next === undefined ? text.length : next - 1
    return { line: lo + 1, start, text: text.slice(start, end) }
  }
}

/** 截取命中所在行的一段作为证据，返回片段与命中位置 */
function evidence(lineText: string, from: number, to: number): { snippet: string; match: [number, number] } {
  const radius = 70
  const a = Math.max(0, from - radius)
  const b = Math.min(lineText.length, to + radius)
  const pre = (a > 0 ? '…' : '') + lineText.slice(a, from)
  const hit = lineText.slice(from, to)
  const post = lineText.slice(to, b) + (b < lineText.length ? '…' : '')
  return { snippet: pre + hit + post, match: [pre.length, pre.length + hit.length] }
}

interface Hit {
  start: number
  end: number
  severity: Severity
  reason: string
  userTerm?: boolean
}

/** 在一段文字中找身份线索（带位置） */
function findHits(text: string, from: number, to: number, ctx: RuleContext): Hit[] {
  const seg = text.slice(from, to)
  const hits: Hit[] = []
  const add = (re: RegExp, fn: (m: RegExpMatchArray) => Omit<Hit, 'start' | 'end'> | null) => {
    for (const m of seg.matchAll(re)) {
      const h = fn(m)
      if (h) hits.push({ ...h, start: from + m.index!, end: from + m.index! + m[0].length })
    }
  }
  for (const t of ctx.userTerms) {
    if (t.ambiguous && !ctx.strictShortTerms) continue
    add(new RegExp(termRegex(t.normalized).source, 'giu'), () => ({ severity: 'high', reason: `含自定义词「${t.raw}」`, userTerm: true }))
  }
  for (const n of ctx.derivedNames) add(new RegExp(termRegex(n.raw).source, 'giu'), () => ({ severity: 'high', reason: `含作者名「${n.raw}」（来源：${n.source}）` }))
  add(freshRegex(EMAIL), (m) =>
    EXAMPLE_DOMAIN.test(m[0]) ? null : { severity: 'high', reason: '含邮箱地址' },
  )
  add(freshRegex(LOCAL_PATH), () => ({ severity: 'high', reason: '含本机用户目录路径（通常包含用户名）' }))
  add(freshRegex(URL_RE), (m) => {
    const link = parseLink(m[0])
    if (!link || link.kind === 'anonymous' || link.kind === 'scholarly' || link.kind === 'other') return null
    if (link.kind === 'personalPage') return { severity: 'high', reason: `个人主页网址（${link.label}）` }
    if ((link.kind === 'repository' || link.kind === 'modelHub') && link.owner) return { severity: 'medium', reason: `${link.label}，账号名“${link.owner}”可能识别作者` }
    return null
  })
  add(freshRegex(INSTITUTION), () => ({ severity: 'medium', reason: '含机构名称' }))
  // 同一位置只保留最严重的一条
  hits.sort((a, b) => a.start - b.start || (a.severity === 'high' ? -1 : 1))
  const out: Hit[] = []
  for (const h of hits) if (!out.some((o) => h.start < o.end && o.start < h.end)) out.push(h)
  return out
}

function draft(
  ruleId: string,
  category: FindingDraft['category'],
  path: string,
  line: number,
  ev: { snippet: string; match: [number, number] } | { snippet: string; match?: undefined },
  severity: Severity,
  reasons: string[],
  suggestion: string,
  key: string,
  matchedUserTerm = false,
): FindingDraft {
  return {
    ruleId,
    category,
    source: 'source',
    severity,
    confidence: severity === 'high' ? 'high' : 'medium',
    pageNumber: null,
    zone: null,
    field: line > 0 ? `${path}:${line}` : path,
    snippet: ev.snippet,
    snippetMatch: ev.match ?? null,
    reasons,
    suggestion,
    key,
    matchedUserTerm,
  }
}

// ---------------------------------------------------------------------------
// R22 源码作者信息
// ---------------------------------------------------------------------------

const AUTHOR_CMDS = ['author', 'thanks', 'affiliation', 'institution', 'affil', 'email', 'orcid', 'address']
const FINAL_SWITCHES: Array<[RegExp, string]> = [
  [/\\usepackage\s*\[[^\]]*\b(?:final|accepted|camera-?ready|preprint)\b[^\]]*\]\s*\{\s*(?:neurips|nips|icml|iclr|cvpr|iccv|eccv|wacv|acl|emnlp|naacl|coling|aaai|ijcai|colm|corl|aistats|uai)[\w_-]*\s*\}/gi, '会场样式包使用了终稿 / 预印本选项'],
  [/\\(?:iclrfinalcopy|cvprfinalcopy|iccvfinalcopy|aclfinalcopy|wacvfinalcopy)\b/g, '启用了终稿（final copy）开关'],
]

export function ruleSourceAuthor(src: SourceFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const f of src.texts) {
    if (f.kind !== 'tex') continue
    const text = f.text
    const at = lineFinder(text)
    const hidden = texHiddenRanges(text).map(([a, b]) => [a, b] as [number, number])
    let n = 0
    for (const cmd of AUTHOR_CMDS) {
      for (const a of texCommands(text, cmd, hidden)) {
        const content = normalizeText(a.content.replace(/(^|[^\\])%[^\n]*/g, '$1').replace(/\\[a-zA-Z]+\*?|[{}$~\\]/g, ' ')).trim()
        if (!content || isAnonymousPlaceholder(content)) continue
        if (n++ >= PER_FILE) continue
        const l = at(a.contentStart)
        const from = a.contentStart - l.start
        const ev = evidence(l.text, from, Math.min(l.text.length, from + Math.max(1, a.content.split('\n')[0]!.length)))
        const tokens = identityTokens(a.content, ctx)
        out.push(
          draft(
            'R22',
            'sourceAuthor',
            f.path,
            l.line,
            ev,
            'high',
            [
              `LaTeX 源码中的 \\${cmd}{…} 写有内容。即使 PDF 用匿名模式隐去了作者，公开源码（arXiv、补充材料）时这些信息仍然可见。`,
              ...tokens,
            ],
            `提交源码前把 \\${cmd}{…} 改为匿名内容，或只在终稿分支里保留。`,
            `r22-${f.path}-${a.start}`,
            tokens.some((t) => t.startsWith('含自定义词')),
          ),
        )
      }
    }
    for (const h of texCommands(text, 'hypersetup', hidden)) {
      const m = /pdfauthor\s*=\s*\{([^}]*)\}|pdfauthor\s*=\s*([^,}\n]+)/.exec(h.content)
      const v = (m?.[1] ?? m?.[2] ?? '').trim()
      if (!v || isAnonymousPlaceholder(v)) continue
      const pos = h.contentStart + (m?.index ?? 0)
      const l = at(pos)
      out.push(
        draft('R22', 'sourceAuthor', f.path, l.line, evidence(l.text, pos - l.start, pos - l.start + (m?.[0].length ?? 1)), 'high', ['hyperref 的 pdfauthor 会写进 PDF 元数据。'], '改为 \\hypersetup{pdfauthor={}}。', `r22-pdfauthor-${f.path}-${pos}`),
      )
    }
    for (const [re, why] of FINAL_SWITCHES) {
      for (const m of text.matchAll(re)) {
        if (inRanges(m.index, hidden)) continue
        const l = at(m.index)
        out.push(
          draft('R22', 'sourceAuthor', f.path, l.line, evidence(l.text, m.index - l.start, m.index - l.start + m[0].length), 'medium', [`${why}：编译出的 PDF 可能显示作者信息或终稿页眉。`], '投稿版使用会场模板的审稿 / 匿名模式。', `r22-final-${f.path}-${m.index}`),
        )
      }
    }
    for (const m of text.matchAll(/\\documentclass\s*\[([^\]]*)\]\s*\{acmart\}/g)) {
      if (inRanges(m.index, hidden) || /\banonymous\b/.test(m[1]!)) continue
      const l = at(m.index)
      out.push(
        draft('R22', 'sourceAuthor', f.path, l.line, evidence(l.text, m.index - l.start, m.index - l.start + m[0].length), 'medium', ['acmart 没有使用 anonymous 选项，编译出的 PDF 会显示作者信息。'], '改为 \\documentclass[sigconf,review,anonymous]{acmart}。', `r22-acmart-${f.path}-${m.index}`),
      )
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// R23 源码注释与隐藏内容、代码与说明文件中的身份信息
// ---------------------------------------------------------------------------

const HIDDEN_LABEL = { comment: '注释', iffalse: '\\iffalse … \\fi 块', commentEnv: 'comment 环境' } as const
const COPYRIGHT = /(?:copyright|©|\(c\))\s*(?:©|\(c\))?\s*(?:\d{4}(?:\s*[-–,]\s*\d{4})*)?\s*(?:by\s+)?([\p{L}][\p{L}.'’ -]{2,60})/giu
const AUTHOR_FIELD = /\b(?:author|authors|maintainer|__author__)\s*[=:]\s*["'[]?\s*([^"'\]\n]{3,80})/gi
const GENERIC_HOLDER = /^(?:the\s+)?(?:authors?|contributors|anonymous|[a-z]+\s+authors|copyright holders?|owner|holder|original authors?|respective owners?)\b/i

export function ruleSourceHidden(src: SourceFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const f of src.texts) {
    if (f.kind === 'bib' || f.kind === 'build' || f.kind === 'vcs') continue
    const text = f.text
    const at = lineFinder(text)
    const ranges: Array<[number, number, string]> =
      f.kind === 'tex' ? texHiddenRanges(text).map(([a, b, k]) => [a, b, HIDDEN_LABEL[k]]) : [[0, text.length, '']]
    const seen = new Set<number>()
    let n = 0
    let extra = 0
    for (const [a, b, label] of ranges) {
      for (const h of findHits(text, a, b, ctx)) {
        const l = at(h.start)
        if (seen.has(l.line)) continue
        seen.add(l.line)
        if (n >= PER_FILE) {
          extra++
          continue
        }
        n++
        out.push(
          draft(
            'R23',
            'sourceComment',
            f.path,
            l.line,
            evidence(l.text, h.start - l.start, Math.min(l.text.length, h.end - l.start)),
            h.severity,
            [
              f.kind === 'tex' ? `LaTeX ${label}里${h.reason}。这些内容不会出现在 PDF 中，但会随源码一起公开。` : `${h.reason}。`,
            ],
            f.kind === 'tex' ? '提交源码前删除注释和被关掉的代码块（可用 arxiv_latex_cleaner 等工具）。' : '删除或匿名化后再随补充材料提交。',
            `r23-${f.path}-${h.start}`,
            !!h.userTerm,
          ),
        )
      }
    }
    // 版权与作者字段（非 tex 文件）
    if (f.kind !== 'tex') {
      for (const re of [COPYRIGHT, AUTHOR_FIELD]) {
        for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
          const holder = (m[1] ?? '').trim()
          if (!holder || GENERIC_HOLDER.test(holder) || isAnonymousPlaceholder(holder)) continue
          const l = at(m.index)
          if (seen.has(l.line)) continue
          seen.add(l.line)
          if (n >= PER_FILE) {
            extra++
            continue
          }
          n++
          const start = m.index + m[0].length - m[1]!.length
          out.push(
            draft(
              'R23',
              'sourceComment',
              f.path,
              l.line,
              evidence(l.text, start - l.start, Math.min(l.text.length, start - l.start + holder.length)),
              'medium',
              [re === COPYRIGHT ? '版权声明里写了具体的权利人。' : '作者 / 维护者字段写了具体的名字。'],
              '投稿期间改为 “Anonymous Authors” 等中性写法，录用后再恢复。',
              `r23-holder-${f.path}-${m.index}`,
            ),
          )
        }
      }
    }
    if (extra && out.length) out[out.length - 1]!.reasons.push(`同一文件中另有 ${extra} 处类似内容未单独列出。`)
  }
  return out
}

// ---------------------------------------------------------------------------
// R24 版本库与构建残留
// ---------------------------------------------------------------------------

export function ruleSourceArtifacts(src: SourceFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const dir of src.vcsDirs) {
    const files = src.files.filter((f) => f.path.startsWith(`${dir}/`)).length
    out.push(
      draft(
        'R24',
        'sourceArtifact',
        dir,
        0,
        { snippet: `${dir}/（${files} 个文件）` },
        'high',
        ['压缩包里带着版本库目录：完整的提交历史里有每次提交的作者姓名和邮箱，远程地址可能指向个人账号。'],
        '打包时排除版本库目录（如 git archive，或 zip 时加 -x ".git/*"）。',
        `r24-vcs-${dir}`,
      ),
    )
  }
  for (const f of src.texts) {
    if (f.kind !== 'build' && f.kind !== 'vcs') continue
    const at = lineFinder(f.text)
    const hits = findHits(f.text, 0, f.text.length, ctx).filter((h) => h.severity === 'high')
    if (!hits.length) continue
    const h = hits[0]!
    const l = at(h.start)
    out.push(
      draft(
        'R24',
        'sourceArtifact',
        f.path,
        l.line,
        evidence(l.text, h.start - l.start, Math.min(l.text.length, h.end - l.start)),
        'high',
        [
          f.kind === 'build'
            ? `编译产物（日志、synctex 等）${h.reason}；这类文件记录了编译时的完整路径。共 ${hits.length} 处。`
            : `版本库文件${h.reason}。共 ${hits.length} 处。`,
        ],
        '只提交 .tex / .bib / 图片等源文件，删除 .log、.aux、.synctex.gz 等编译产物。',
        `r24-${f.path}`,
        !!h.userTerm,
      ),
    )
  }
  const junk = src.files.filter((f) => f.kind === 'junk')
  const build = src.files.filter((f) => f.kind === 'build')
  if (junk.length || build.length) {
    out.push(
      draft(
        'R24',
        'sourceArtifact',
        '（多个文件）',
        0,
        { snippet: [...junk, ...build].slice(0, 6).map((f) => f.path).join('、') + (junk.length + build.length > 6 ? '…' : '') },
        'info',
        [`包内有 ${junk.length} 个系统 / 编辑器临时文件和 ${build.length} 个编译产物。它们通常无害，但可能带有用户名、路径或机器信息。`],
        '打包前清理（arxiv_latex_cleaner 或 latexmk -c）。',
        'r24-junk',
      ),
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// R25 包内文件元数据与文件名
// ---------------------------------------------------------------------------

const META_ID = /(artist|author|creator(?!tool)|copyright|owner|by-?line|lastmodifiedby|company|manager|contact)/i

export function ruleSourceMetadata(src: SourceFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const m of src.meta) {
    const shown: string[] = []
    const reasons: string[] = []
    let severity: Severity | null = null
    for (const [k, v] of Object.entries(m.fields)) {
      const tokens = identityTokens(v, ctx)
      if (tokens.length || (META_ID.test(k) && !isAnonymousPlaceholder(v))) {
        severity = 'high'
        shown.push(`${k}: ${v}`)
        reasons.push(tokens.length ? `${k}：${tokens.join('、')}` : `${k} 字段非空`)
      }
    }
    if (m.gps) {
      severity = 'high'
      shown.unshift('GPS: 有')
      reasons.unshift('图片带有 GPS 拍摄位置。')
    }
    if (!severity) continue
    out.push(
      draft(
        'R25',
        'sourceMetadata',
        m.path,
        0,
        { snippet: shown.join('；') },
        severity,
        [m.kind === 'office' ? 'Office 文档属性里记录了作者 / 最后修改人 / 单位。' : '图片元数据可能识别作者。', ...reasons],
        m.kind === 'office' ? 'Word / PowerPoint：文件 → 信息 → 检查文档 → 删除文档属性和个人信息。' : '用 exiftool -all= 等工具去除图片元数据后再打包。',
        `r25-${m.path}`,
      ),
    )
  }
  // 文件名
  for (const f of src.files) {
    if (f.kind === 'vcs' || f.kind === 'junk') continue
    const words = normalizeText(f.path.replace(/[/_.-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'))
    const tokens = [
      ...ctx.userTerms.filter((t) => !t.ambiguous && termRegex(t.normalized).test(words)).map((t) => `自定义词「${t.raw}」`),
      ...ctx.derivedNames.filter((n) => termRegex(n.raw).test(words)).map((n) => `作者名「${n.raw}」`),
    ]
    if (!tokens.length) continue
    out.push(
      draft('R25', 'sourceMetadata', f.path, 0, { snippet: f.path }, 'medium', [`文件路径中含${tokens.join('、')}。`], '把文件 / 目录改为中性名称。', `r25-name-${f.path}`, tokens.some((t) => t.startsWith('自定义词'))),
    )
  }
  return out
}

export const SOURCE_RULE_FNS: Record<string, (src: SourceFacts, ctx: RuleContext) => FindingDraft[]> = {
  R22: ruleSourceAuthor,
  R23: ruleSourceHidden,
  R24: ruleSourceArtifacts,
  R25: ruleSourceMetadata,
}
