/**
 * 扫描会话：单例状态机。
 * - 文件、正文、扫描结果只存在内存；localStorage 只存会场预设等非稿件偏好。
 * - PDFDocumentProxy 不进入响应式系统（模块级 Map + markRaw）。
 * - runId 防止旧任务覆盖新结果；AbortController 支持取消。
 * - 文档 ID 固定为 main / supp-1 / supp-2，避免文件名经 ID 泄露。
 */
import { computed, markRaw, reactive, shallowRef } from 'vue'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentFacts, ReviewDecision, ReviewStatus, ScanResult } from '@/domain/types'
import { LIMITS } from '@/domain/limits'
import { PreflightError, isCancelled } from '@/domain/errors'
import { extractDocument } from '@/parsers/pdf/extract'
import { browserAssets, loadPdfjs } from '@/parsers/pdf/pdfjs-browser'
import { validateSelection } from '@/parsers/pdf/validate'
import { runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import { PRESETS } from '@/presets'

export type Phase = 'idle' | 'reading' | 'parsing' | 'scanning' | 'done' | 'error' | 'cancelled'
export type SlotId = 'main' | 'supp-1' | 'supp-2'
export const SLOT_IDS: SlotId[] = ['main', 'supp-1', 'supp-2']

const PREF_KEY = 'blindpreflight.prefs.v1'

interface Prefs {
  presetId: string
}

function loadPrefs(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(PREF_KEY)
    const p = raw ? (JSON.parse(raw) as Partial<Prefs>) : {}
    const presetId = typeof p.presetId === 'string' && PRESETS.some((x) => x.id === p.presetId) ? p.presetId : 'generic'
    return { presetId }
  } catch {
    return { presetId: 'generic' }
  }
}

function savePrefs(p: Prefs): void {
  try {
    globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify({ presetId: p.presetId }))
  } catch {
    /* 隐私模式等：忽略 */
  }
}

function fingerprint(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`
}

export const SLOT_LABEL: Record<SlotId, string> = { main: '主稿', 'supp-1': '补充材料 1', 'supp-2': '补充材料 2' }

const state = reactive({
  presetId: loadPrefs().presetId,
  termsText: '',
  strictShortTerms: false,
  files: { main: null, 'supp-1': null, 'supp-2': null } as Record<SlotId, File | null>,
  phase: 'idle' as Phase,
  progress: { slot: 'main' as SlotId, done: 0, total: 0, docIndex: 0, docCount: 0 },
  error: null as string | null,
  /** 选择文件时的即时校验错误 */
  selectionError: null as string | null,
  decisions: new Map<string, ReviewDecision>(),
  selectedFindingId: null as string | null,
  /** 结果视图 / 导入视图 */
  view: 'import' as 'import' | 'results',
})

const result = shallowRef<ScanResult | null>(null)
const pdfs = new Map<string, PDFDocumentProxy>()
let currentRun = 0
let controller: AbortController | null = null
let lastFingerprints = ''

function destroyPdfs(): void {
  for (const pdf of pdfs.values()) void pdf.loadingTask.destroy().catch(() => {})
  pdfs.clear()
}

function selectedFingerprints(): string {
  return SLOT_IDS.map((id) => (state.files[id] ? fingerprint(state.files[id]!) : '-')).join('#')
}

function checkSelection(): void {
  state.selectionError = null
  try {
    validateSelection({
      main: state.files.main?.size ?? null,
      supplements: [state.files['supp-1'], state.files['supp-2']].filter((f): f is File => !!f).map((f) => f.size),
    })
  } catch (err) {
    state.selectionError = err instanceof PreflightError ? err.message : '文件选择无效。'
  }
}

function setFile(slot: SlotId, file: File | null): void {
  state.files[slot] = file
  checkSelection()
}

/** 整页拖入多个文件：先填主稿，再依次填空着的补充材料槽；都满了则替换主稿 */
function addFiles(files: File[]): void {
  const queue = [...files]
  for (const id of SLOT_IDS) {
    if (!queue.length) break
    if (!state.files[id]) state.files[id] = queue.shift()!
  }
  if (queue.length && files.length === 1) state.files.main = queue.shift()!
  checkSelection()
}

function setPreset(id: string): void {
  if (!PRESETS.some((p) => p.id === id)) return
  state.presetId = id
  savePrefs({ presetId: id })
}

async function start(): Promise<void> {
  const main = state.files.main
  if (!main) {
    state.selectionError = '请先选择主稿 PDF。'
    return
  }
  checkSelection()
  if (state.selectionError) return

  controller?.abort()
  const runId = ++currentRun
  const ctl = new AbortController()
  controller = ctl
  const stale = () => runId !== currentRun
  destroyPdfs()
  state.error = null
  state.phase = 'reading'

  const inputs = SLOT_IDS.flatMap((id) => {
    const f = state.files[id]
    return f ? [{ id, file: f }] : []
  })
  state.progress = { slot: 'main', done: 0, total: 0, docIndex: 0, docCount: inputs.length }
  const opened: PDFDocumentProxy[] = []
  try {
    const lib = await loadPdfjs()
    const assets = browserAssets()
    let budget = LIMITS.maxPagesTotal
    const facts: DocumentFacts[] = []
    for (const [i, input] of inputs.entries()) {
      if (ctl.signal.aborted) throw new PreflightError('CANCELLED')
      state.phase = 'reading'
      state.progress = { slot: input.id, done: 0, total: 0, docIndex: i, docCount: inputs.length }
      const bytes = new Uint8Array(await input.file.arrayBuffer())
      if (stale()) return
      state.phase = 'parsing'
      const r = await extractDocument(
        { id: input.id, role: input.id === 'main' ? 'main' : 'supplement', displayName: input.file.name, bytes },
        {
          lib,
          assets,
          signal: ctl.signal,
          pageBudget: budget,
          onProgress: (done, total) => {
            if (!stale()) state.progress = { slot: input.id, done, total, docIndex: i, docCount: inputs.length }
          },
        },
      )
      opened.push(r.pdf)
      if (stale()) {
        for (const p of opened) void p.loadingTask.destroy().catch(() => {})
        return
      }
      budget -= r.facts.pageCount
      facts.push(r.facts)
    }
    state.phase = 'scanning'
    await new Promise((r) => setTimeout(r, 0))
    if (stale()) {
      for (const p of opened) void p.loadingTask.destroy().catch(() => {})
      return
    }
    const scan = runScan(facts, {
      presetId: state.presetId,
      userTerms: parseUserTerms(state.termsText),
      strictShortTerms: state.strictShortTerms,
    }, { runId })
    // 同一组文件重扫保留复核决定；换了文件则清空
    const fp = selectedFingerprints()
    if (fp !== lastFingerprints) state.decisions.clear()
    else {
      const ids = new Set(scan.findings.map((f) => f.id))
      for (const id of [...state.decisions.keys()]) if (!ids.has(id)) state.decisions.delete(id)
    }
    lastFingerprints = fp
    for (const [i, input] of inputs.entries()) pdfs.set(input.id, markRaw(opened[i]!))
    result.value = markRaw(scan)
    state.selectedFindingId = null
    state.phase = 'done'
    state.view = 'results'
  } catch (err) {
    for (const p of opened) void p.loadingTask.destroy().catch(() => {})
    if (stale()) return
    if (isCancelled(err)) {
      state.phase = 'cancelled'
      return
    }
    state.phase = 'error'
    state.error = err instanceof PreflightError ? err.message : '处理过程中出现未知错误。请刷新页面后重试。'
    if (!(err instanceof PreflightError)) console.error('[BlindPreflight] unexpected error', err instanceof Error ? err.name : typeof err)
  } finally {
    if (controller === ctl) controller = null
  }
}

function cancel(): void {
  controller?.abort()
  currentRun++
  controller = null
  state.phase = 'cancelled'
}

function clearAll(): void {
  controller?.abort()
  controller = null
  currentRun++
  destroyPdfs()
  result.value = null
  state.files = { main: null, 'supp-1': null, 'supp-2': null }
  state.termsText = ''
  state.strictShortTerms = false
  state.decisions.clear()
  state.selectedFindingId = null
  state.phase = 'idle'
  state.error = null
  state.selectionError = null
  state.view = 'import'
  lastFingerprints = ''
}

function setDecision(findingId: string, status: ReviewStatus, reason = ''): void {
  if (status === 'open' && !reason) {
    state.decisions.delete(findingId)
    return
  }
  state.decisions.set(findingId, { findingId, status, reason, createdAt: new Date().toISOString() })
}

function statusOf(findingId: string): ReviewStatus {
  return state.decisions.get(findingId)?.status ?? 'open'
}

/** 同源示例 PDF（仓库内合成样例，不含真实论文） */
const SAMPLE_TERM = 'Widget Alignment'

async function loadSamples(kind: 'leaky' | 'fixed'): Promise<void> {
  const get = async (name: string) => {
    // 唯一允许的网络读取：同源、只读、仓库自带的合成示例 PDF；从不上传任何内容
    // eslint-disable-next-line no-restricted-globals
    const res = await fetch(new URL(`samples/${name}`, document.baseURI), { credentials: 'omit', cache: 'no-store' })
    if (!res.ok) throw new Error('sample')
    return new File([await res.arrayBuffer()], name, { type: 'application/pdf', lastModified: 0 })
  }
  try {
    const main = await get(kind === 'leaky' ? 'sample-leaky.pdf' : 'sample-fixed.pdf')
    const supp = kind === 'fixed' ? await get('sample-supplement.pdf') : null
    state.files = { main, 'supp-1': supp, 'supp-2': null }
    // 示例自定义词只用于演示“系统名泄露”；切到修复示例时撤掉，避免修复稿的标题被它命中
    if (kind === 'leaky' && !state.termsText) state.termsText = SAMPLE_TERM
    if (kind === 'fixed' && state.termsText === SAMPLE_TERM) state.termsText = ''
    checkSelection()
  } catch {
    state.selectionError = '示例文件加载失败。'
  }
}

export function getPdf(docId: string): PDFDocumentProxy | null {
  return pdfs.get(docId) ?? null
}

const busy = computed(() => state.phase === 'reading' || state.phase === 'parsing' || state.phase === 'scanning')
const selectedFinding = computed(() => result.value?.findings.find((f) => f.id === state.selectedFindingId) ?? null)
const filesChangedSinceScan = computed(() => result.value != null && selectedFingerprints() !== lastFingerprints)

export function useSession() {
  return {
    state,
    result,
    busy,
    selectedFinding,
    filesChangedSinceScan,
    setFile,
    addFiles,
    setPreset,
    start,
    cancel,
    clearAll,
    setDecision,
    statusOf,
    loadSamples,
    getPdf,
  }
}
