/**
 * 链接类规则：R07 正文网址（仓库 / 主页 / 云盘），R10 内嵌超链接（真实目标 vs 可见文字）。
 * 只做字符串解析，从不访问任何网址。
 */
import type { Confidence, DocumentFacts, Severity, Zone } from '@/domain/types'
import { type FindingDraft, type RuleContext, ZONE_LABEL, around, scanDoc, zoneOf } from './core'
import { BARE_HOST_RE, SELF_CODE_CONTEXT, SELF_CODE_STRONG, SELF_CODE_WEAK, URL_RE } from './patterns'

export type LinkKind =
  | 'anonymous'
  | 'scholarly'
  | 'repository'
  | 'modelHub'
  | 'personalPage'
  | 'cloudDrive'
  | 'videoSocial'
  | 'other'

export interface ParsedLink {
  url: string
  host: string
  kind: LinkKind
  /** 仓库 / 模型站点的 owner（用户名或组织名） */
  owner: string | null
  repo: string | null
  label: string
}

const TRAILING = /[.,;:!?'"”’»。，；：！？、]+$/u

/** 去掉句末标点；括号只在不配对时去掉 */
export function trimUrl(raw: string): string {
  let u = raw
  for (;;) {
    const before = u
    u = u.replace(TRAILING, '')
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      if (u.endsWith(close)) {
        const opens = u.split(open).length - 1
        const closes = u.split(close).length - 1
        if (closes > opens) u = u.slice(0, -1)
      }
    }
    if (u === before) return u
  }
}

const SCHOLARLY = /(?:^|\.)(?:doi\.org|arxiv\.org|aclanthology\.org|aclweb\.org|openreview\.net|proceedings\.neurips\.cc|papers\.nips\.cc|proceedings\.mlr\.press|ieeexplore\.ieee\.org|dl\.acm\.org|link\.springer\.com|sciencedirect\.com|jmlr\.org|semanticscholar\.org|dblp\.org|usenix\.org|ndss-symposium\.org|thecvf\.com|ojs\.aaai\.org|ijcai\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|w3\.org|ietf\.org|rfc-editor\.org|creativecommons\.org)$/i
const ANON = /(?:^|\.)(?:anonymous\.4open\.science|anonymous\.github\.io|anonymized\.science)$/i
const CLOUD = /(?:^|\.)(?:drive\.google\.com|docs\.google\.com|dropbox\.com|onedrive\.live\.com|1drv\.ms|sharepoint\.com|box\.com|pan\.baidu\.com|aliyundrive\.com|mega\.nz|figshare\.com|zenodo\.org|osf\.io|wetransfer\.com)$/i
const VIDEO_SOCIAL = /(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com|bilibili\.com|twitter\.com|x\.com|linkedin\.com|facebook\.com|weibo\.com|zhihu\.com|medium\.com|scholar\.google\.com|orcid\.org|researchgate\.net)$/i
const REPO_HOSTS = /^(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org|gitee\.com|codeberg\.org|sourceforge\.net)$/i
const PERSONAL_PATH = /(?:^\/~|\/(?:people|person|staff|faculty|members?|homes?|users?|~)[/~])/i
const GITHUB_NON_OWNER = new Set(['orgs', 'features', 'topics', 'about', 'marketplace', 'sponsors', 'settings', 'search', 'login'])

export function parseLink(input: string): ParsedLink | null {
  const url = trimUrl(input)
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const segs = u.pathname.split('/').filter(Boolean)
  const base = { url, host, owner: null, repo: null }
  if (ANON.test(host) || (host.endsWith('osf.io') && /view_only=/.test(u.search)))
    return { ...base, kind: 'anonymous', label: '匿名托管链接' }
  if (SCHOLARLY.test(host)) return { ...base, kind: 'scholarly', label: '学术索引 / DOI 链接' }
  if (REPO_HOSTS.test(host)) {
    const owner = segs[0] && !GITHUB_NON_OWNER.has(segs[0].toLowerCase()) ? segs[0] : null
    return { ...base, kind: 'repository', owner, repo: segs[1]?.replace(/\.git$/, '') ?? null, label: `${host.replace(/^www\./, '')} 仓库` }
  }
  if (host === 'huggingface.co' || host === 'hf.co') {
    const s = segs[0] === 'datasets' || segs[0] === 'spaces' ? segs.slice(1) : segs
    return { ...base, kind: 'modelHub', owner: s[0] ?? null, repo: s[1] ?? null, label: 'Hugging Face 页面' }
  }
  if (/\.github\.io$|\.gitlab\.io$|\.netlify\.app$|\.vercel\.app$|\.pages\.dev$|^sites\.google\.com$/.test(host)) {
    const owner = host.endsWith('.github.io') || host.endsWith('.gitlab.io') ? host.split('.')[0] ?? null : null
    return { ...base, kind: 'personalPage', owner, label: '个人 / 项目主页' }
  }
  if (CLOUD.test(host)) return { ...base, kind: 'cloudDrive', label: '云盘 / 共享存储' }
  if (VIDEO_SOCIAL.test(host)) return { ...base, kind: 'videoSocial', label: '视频 / 社交 / 个人档案站点' }
  if (PERSONAL_PATH.test(u.pathname) || /^~/.test(segs[0] ?? '')) return { ...base, kind: 'personalPage', label: '个人主页' }
  return { ...base, kind: 'other', label: '外部网址' }
}

function ownerMatches(owner: string | null, ctx: RuleContext): string | null {
  if (!owner) return null
  const o = owner.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (o.length < 3) return null
  for (const t of ctx.userTerms) {
    const v = t.normalized.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (v.length >= 3 && (o.includes(v) || v.includes(o))) return t.raw
  }
  for (const n of ctx.derivedNames) {
    const surname = (n.tokens[n.tokens.length - 1] ?? '').replace(/[^a-z]/g, '')
    if (surname.length >= 4 && o.includes(surname)) return n.raw
  }
  return null
}

/**
 * 常见公共组织 / 框架仓库：引用它们几乎总是“使用第三方库”。
 * 这些 owner 只有在同一句里出现强自述（“our code is available at”）时才升级。
 */
const PUBLIC_OWNERS = new Set([
  'pytorch', 'tensorflow', 'keras-team', 'jax-ml', 'google', 'google-research', 'google-deepmind', 'deepmind',
  'facebookresearch', 'meta-llama', 'microsoft', 'openai', 'anthropics', 'huggingface', 'nvidia', 'apache',
  'scikit-learn', 'numpy', 'scipy', 'pandas-dev', 'matplotlib', 'opencv', 'open-mmlab', 'allenai', 'stanfordnlp',
  'explosion', 'ultralytics', 'lightning-ai', 'pytorchlightning', 'ray-project', 'vllm-project', 'langchain-ai',
  'eleutherai', 'bigscience-workshop', 'mlfoundations', 'rust-lang', 'python', 'golang', 'llvm', 'torvalds',
  'bert-base-uncased', 'gpt2', 'mistralai', 'qwen', 'stabilityai', 'runwayml',
])

/** 只取命中所在句子（向前到最近的句末标点） */
export function sameSentence(pre: string): string {
  const m = /[.!?。！？](?:\s|$)[^.!?。！？]*$/u.exec(pre)
  return m ? pre.slice(m.index + 1) : pre
}

export function selfContextOf(text: string, link: ParsedLink): boolean {
  if (SELF_CODE_STRONG.test(text)) return true
  const owner = link.owner?.toLowerCase() ?? ''
  if (PUBLIC_OWNERS.has(owner)) return false
  return SELF_CODE_WEAK.test(text)
}

interface LinkVerdict {
  severity: Severity
  confidence: Confidence
  reasons: string[]
  suggestion: string
}

function judge(link: ParsedLink, zone: Zone, selfContext: boolean, ctx: RuleContext): LinkVerdict | null {
  const owned = ownerMatches(link.owner, ctx)
  const reasons: string[] = []
  const anonSuggestion =
    '换成匿名托管（如 anonymous.4open.science）或在补充材料中提供代码；本工具不能确认外站内容已匿名，请自行检查仓库提交记录、README 与 LICENSE。'
  if (owned) reasons.push(`链接中的用户名/组织 “${link.owner}” 与「${owned}」相符。`)
  if (selfContext) reasons.push('上下文表明这是作者自己的代码、数据或项目页。')
  const prominent = zone === 'authorBlock' || zone === 'header' || zone === 'footer'
  switch (link.kind) {
    case 'scholarly':
      return null
    case 'anonymous':
      return {
        severity: 'info',
        confidence: 'medium',
        reasons: ['匿名托管链接。'],
        suggestion: '提交前打开链接自查一次：匿名托管只替换显示名，不会清理代码注释、提交信息、文档里的姓名或机构。',
      }
    case 'repository':
    case 'modelHub':
    case 'personalPage':
    case 'cloudDrive': {
      const kindReason: Record<string, string> = {
        repository: `${link.label}，owner 为 “${link.owner ?? '?'}”，可直接定位作者或实验室。`,
        modelHub: `Hugging Face 页面，owner 为 “${link.owner ?? '?'}”。`,
        personalPage: '个人或项目主页的域名/路径常含姓名。',
        cloudDrive: '云盘分享链接可能显示上传者姓名或账号邮箱。',
      }
      reasons.unshift(kindReason[link.kind] ?? link.label)
      if (owned || selfContext || prominent)
        return { severity: 'high', confidence: owned ? 'high' : 'medium', reasons, suggestion: anonSuggestion }
      if (link.kind === 'repository' || link.kind === 'modelHub') {
        reasons.push('没有看到 “our code” 之类的自述；如果这是第三方公开库，一般没问题。')
        return { severity: 'info', confidence: 'low', reasons, suggestion: '若是作者自己的仓库，请' + anonSuggestion }
      }
      return { severity: 'medium', confidence: 'medium', reasons, suggestion: anonSuggestion }
    }
    case 'videoSocial':
      reasons.unshift(`${link.label}可能关联到个人账号。`)
      return { severity: selfContext || owned ? 'high' : 'medium', confidence: 'medium', reasons, suggestion: '视频或演示改为匿名上传（不显示频道名），或放入补充材料。' }
    default:
      if (!prominent && !selfContext && !owned) return null
      reasons.unshift(prominent ? `网址位于${ZONE_LABEL[zone]}。` : '外部网址。')
      return { severity: 'medium', confidence: 'low', reasons, suggestion: '确认该网址不指向作者主页或机构内部页面。' }
  }
}

// ---------------------------------------------------------------------------
// R07 正文网址
// ---------------------------------------------------------------------------

export function ruleUrls(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  const hits = [...scanDoc(doc, URL_RE), ...scanDoc(doc, BARE_HOST_RE)]
  const seen: Array<{ page: number; start: number; end: number }> = []
  for (const hit of hits.sort((a, b) => b.end - b.start - (a.end - a.start))) {
    if (seen.some((s) => s.page === hit.page.pageNumber && s.start < hit.end && hit.start < s.end)) continue
    seen.push({ page: hit.page.pageNumber, start: hit.start, end: hit.end })
    const raw = hit.match[0]
    const link = parseLink(raw)
    if (!link) continue
    const zone = zoneOf(hit)
    if (zone === 'references' && link.kind !== 'anonymous') continue
    const { pre } = around(hit, 160, 0)
    const verdict = judge(link, zone, selfContextOf(sameSentence(pre), link), ctx)
    if (!verdict) continue
    // 命中范围收缩到去标点后的网址
    const trimmedBy = raw.length - link.url.length
    const end = trimmedBy > 0 ? Math.max(hit.start + 1, hit.end - trimmedBy) : hit.end
    out.push({
      ruleId: 'R07',
      category: link.kind === 'anonymous' || link.kind === 'other' ? 'link' : 'repository',
      source: 'text',
      ...verdict,
      text: { page: hit.page, start: hit.start, end },
      linkTarget: link.url,
      key: link.url,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// R10 内嵌超链接
// ---------------------------------------------------------------------------

function sameUrl(a: string, b: string): boolean {
  const n = (s: string) => trimUrl(s).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase()
  return n(a) === n(b)
}

export function ruleEmbeddedLinks(doc: DocumentFacts, ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = []
  const flagAll = ctx.preset.flagAllEmbeddedLinks
  for (const page of doc.pages) {
    for (const a of page.annotations) {
      if (a.subtype !== 'Link' || !a.url || /^mailto:/i.test(a.url)) continue
      const link = parseLink(a.url)
      const visible = a.visibleText.trim()
      const visibleDiffers = visible.length > 0 && !sameUrl(visible, a.url) && !visible.includes(trimUrl(a.url).replace(/^https?:\/\//, ''))
      const zone: Zone = a.rect ? zoneForRect(page, a.rect) : 'body'
      const selfCtx = link ? selfContextOf(visible, link) : SELF_CODE_CONTEXT.test(visible)
      let verdict = link ? judge(link, zone, selfCtx, ctx) : null
      if (verdict && visibleDiffers && verdict.severity !== 'high' && link?.kind !== 'anonymous') {
        verdict = {
          ...verdict,
          severity: verdict.severity === 'info' ? 'medium' : verdict.severity,
          reasons: [...verdict.reasons, '可见文字与真实目标不同，读者看不到链接实际指向哪里。'],
        }
      }
      if (!verdict && flagAll && link) {
        verdict = {
          severity: 'medium',
          confidence: 'high',
          reasons: [`${link.label}。`],
          suggestion: '该会场格式条款要求投稿 PDF 不含可点击外链；请去掉超链接（保留纯文本引用即可）。',
        }
      } else if (verdict && flagAll) {
        verdict = {
          ...verdict,
          severity: verdict.severity === 'info' ? 'medium' : verdict.severity,
          reasons: [...verdict.reasons, `当前预设（${ctx.preset.venue}）要求检查所有内嵌超链接。`],
        }
      }
      if (!verdict) continue
      out.push({
        ruleId: 'R10',
        category: link?.kind === 'repository' || link?.kind === 'modelHub' ? 'repository' : 'link',
        source: 'link',
        ...verdict,
        reasons: [visible ? `可见文字 “${visible}” → 真实目标 ${a.url}` : `不可见链接 → ${a.url}`, ...verdict.reasons],
        pageNumber: page.pageNumber,
        rect: a.rect,
        zone,
        snippet: visible || a.url,
        linkTarget: a.url,
        visibleText: visible || null,
        key: a.id,
      })
    }
  }
  return out
}

function zoneForRect(page: DocumentFacts['pages'][number], rect: NonNullable<DocumentFacts['pages'][number]['annotations'][number]['rect']>): Zone {
  // 找到中心点落在该矩形内的第一行文字
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  for (const item of page.items) {
    const b = item.bbox
    if (cx >= b.x - 2 && cx <= b.x + b.width + 2 && cy >= b.y - 2 && cy <= b.y + b.height + 2) {
      const idx = page.charItem.indexOf(item.index)
      if (idx >= 0) return zoneOf({ page, start: idx })
    }
  }
  return 'body'
}

export { sameUrl }

/** 在引擎里把同一页、同一目标的 R10 并入 R07 文本命中 */
export function linkTargetsMatch(a: string | null, b: string | null): boolean {
  return !!a && !!b && sameUrl(a, b)
}

