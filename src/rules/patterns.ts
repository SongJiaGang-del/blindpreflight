/**
 * 共享正则与词表。所有正则都是「每次调用新建」或在使用前重置 lastIndex，避免 /g 状态泄漏。
 */

export const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu
/** {alice, bob}@cs.example.edu 或 {alice,bob}@example.edu */
export const GROUPED_EMAIL = /\{\s*([A-Z0-9._%+-]+(?:\s*[,;|]\s*[A-Z0-9._%+-]+)+)\s*\}\s*@\s*([A-Z0-9.-]+\.[A-Z]{2,})/giu
/** RFC 2606 保留域名：示例邮箱只作提示 */
export const EXAMPLE_DOMAIN = /(?:^|\.)example\.(?:com|org|net)$/iu

export const INSTITUTION =
  /\b(?:universit(?:y|ies|ät|at|é|e|à|a|eit)|institute|institution|department|dept\.|laboratory|laboratories|college|school\s+of|research\s+cent(?:er|re)|academy\s+of\s+sciences?)\b|(?:大学|学院|研究所|实验室|研究院|附属医院|研究中心)/giu

export const GRANT =
  /\b(?:grants?|awards?|project|contract|fund(?:ing)?)\s*(?:no\.?|nos\.?|number|numbers|#|id)?\s*[:：]?\s*([A-Z0-9][A-Z0-9./-]{3,39})\b/giu
export const AGENCY =
  /\b(?:NSF|NSFC|NIH|ERC|DARPA|DFG|JSPS|KAKENHI|EPSRC|NSERC|DOE|ONR|AFOSR|IARPA|ANR|ARC|NRF|JST|CREST|Horizon\s+2020|Horizon\s+Europe|National\s+(?:Natural\s+)?Science\s+Foundation|National\s+Institutes?\s+of\s+Health|European\s+Research\s+Council)\b|(?:\p{Lu}[\p{L}-]*\s+){1,4}(?:Foundation|Fund|Council)\b|国家自然科学基金|国家重点研发计划|社科基金|资助|基金号|项目编号|基金项目/gu
export const SUPPORT_PHRASE =
  /\b(?:(?:was|is|were|are|been|partially|partly|generously)\s+)?(?:funded|supported|sponsored|financed)\s+(?:in\s+part\s+)?by\b|\bfinancial\s+support\b|受(?:到)?.{0,20}(?:资助|支持)/giu

export const URL_RE = /https?:\/\/[^\s<>"{}|\\^`]+/giu
/** 没有协议头的常见托管域名（github.com/owner/repo 这类） */
export const BARE_HOST_RE =
  /(?<![\p{L}\p{N}@./-])(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org|huggingface\.co|[a-z0-9-]+\.github\.io)\/[^\s<>"{}|\\^`]*/giu

export const SELF_CITE_EN =
  /\b(?:(?:in\s+)?our\s+(?:own\s+)?(?:previous|prior|earlier|recent|past)\s+(?:work|works|paper|papers|study|studies|publication|research)|we\s+(?:have\s+)?(?:previously|earlier|recently)\s+(?:proposed|showed|shown|presented|introduced|demonstrated|developed|published|reported)|as\s+we\s+(?:have\s+)?(?:showed|shown|demonstrated|reported|proposed|argued)\s+(?:in|previously|before|earlier)|(?:extends?|extending|builds?\s+(?:up)?on|building\s+(?:up)?on)\s+our\s+(?:previous|prior|earlier)?\s*(?:work|paper|study|conference\s+paper|workshop\s+paper))\b/giu
export const SELF_CITE_ZH =
  /(?:我们|本团队|本课题组|课题组|笔者|作者)(?:此前|先前|之前|早期|前期|曾经|曾)(?:.{0,16}?)(?:提出|研究|工作|证明|发现|发表)|在我们(?:先前|之前|此前|早期|前期)的(?:工作|研究|论文)中|我们的(?:前期|先前|早期)(?:研究|工作)/gu
export const CITATION_MARK = /\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]|\(\s*\p{Lu}[\p{L}-]+(?:\s+et\s+al\.)?,?\s+\d{4}[a-z]?\s*\)|\p{Lu}[\p{L}-]+\s+et\s+al\./gu

export const IMPLICIT_IDENTITY =
  /\b(?:our\s+(?:lab(?:oratory)?|university|institution|department|group's|research\s+group|hospital|company)|at\s+our\s+(?:department|university|institution|lab|hospital|company))\b|(?:本校|我校|本实验室|我们所在的|我院|本院|我所|本所)/giu

export const ORCID = /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/giu
export const LOCAL_PATH = /(?:[A-Z]:\\Users\\[^\\\r\n\s]+|\/(?:Users|home)\/[^/\s]+)/giu

export const ARXIV_STAMP = /arXiv:\s?\d{4}\.\d{4,5}(?:v\d+)?\s*\[[a-zA-Z.-]+\]/gu

export const AI_DISCLOSURE =
  /\b(?:chatgpt|gpt-?\d|claude|gemini|copilot|llms?|large\s+language\s+models?|ai\s+(?:assistant|tools?|writing)|language\s+model|grammarly)\b|(?:大(?:语言)?模型|人工智能|AI\s*(?:工具|助手))/iu
export const ACK_REDACTED =
  /\b(?:removed|omitted|hidden|withheld|redacted|suppressed|anonymi[sz]ed)\b.{0,40}\b(?:anonymity|review|blind|submission)\b|(?:为匿名|审稿期间|匿名审稿).{0,10}(?:删除|省略|隐去)/iu
export const THANKS = /\b(?:we\s+(?:would\s+like\s+to\s+)?thank|thanks?\s+(?:go(?:es)?\s+)?to|grateful\s+to|gratitude\s+to|indebted\s+to)\b|感谢|致谢/iu

/** 强自述：明确说链接是作者自己的代码 / 项目页 */
export const SELF_CODE_STRONG =
  /\b(?:our\s+(?:code|implementation|source\s+code|repository|repo|project\s+page|website|demo)|(?:code|implementation)\s+(?:is|will\s+be)\s+(?:publicly\s+)?(?:available|released|open[- ]sourced)|(?:we\s+)?(?:release|released|open[- ]source)\s+(?:our|the)\s+(?:code|implementation|models?|data)|project\s+page|code:)|我们的代码|代码(?:已|将)?开源|项目主页/iu
/** 弱自述：“our model / available at” 之类，单独出现时也常用于描述第三方库 */
export const SELF_CODE_WEAK = /\b(?:our\s+(?:models?|data(?:set)?|tool)|available\s+at)\b/iu
export const SELF_CODE_CONTEXT = new RegExp(`${SELF_CODE_STRONG.source}|${SELF_CODE_WEAK.source}`, 'iu')

/** 匿名占位符：不是真实姓名 */
export const ANON_PLACEHOLDER =
  /^(?:anonymous(?:\s+(?:authors?|submission|for\s+review))?(?:\s*\(s\))?|anon\.?|authors?|author\s*names?|unknown|n\/?a|none|-+|匿名(?:作者)?|(?:paper|submission)\s*(?:id|#|no\.?)?\s*[\d-]+)$/iu

export const EDIT_RESIDUE = /\b(?:TODO|FIXME|XXX|TBD|TK)\b|待补充|待修改|作者回复|删除此处|请删除/u

/** 正则用户输入转义 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function freshRegex(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags)
}
