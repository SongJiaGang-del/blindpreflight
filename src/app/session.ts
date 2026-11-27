/**
 * 扫描会话：单例状态机。
 * - 文件、正文、扫描结果只存在内存；localStorage 只存会场预设等非稿件偏好。
 * - PDFDocumentProxy 不进入响应式系统（模块级 Map + markRaw）。
 * - runId 防止旧任务覆盖新结果；AbortController 支持取消。
 * - 文档 ID 固定为 main / supp-1 / supp-2，避免文件名经 ID 泄露。
 */
import { computed, markRaw, reactive, shallowRef } from 'vue'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentFacts, ReviewDecision, ReviewStatus, ScanOptions, ScanResult } from '@/domain/types'
import { LIMITS } from '@/domain/limits'
import { PreflightError, isCancelled } from '@/domain/errors'
import { SCANNED_WARNING, extractDocument } from '@/parsers/pdf/extract'
import { parseSourceArchive } from '@/parsers/source/archive'
import { OCR_MAX_PAGES, type OcrLang, createOcrSession } from '@/ocr/ocr'
import { assignZones } from '@/normalize/zones'
import { browserAssets, loadPdfjs } from '@/parsers/pdf/pdfjs-browser'
import { validateSelection } from '@/parsers/pdf/validate'
import { runScan } from '@/rules/engine'
import { deriveNames, parseUserTerms } from '@/rules/terms'
import { PRESETS, allPresets, getBuiltinPreset, setCustomPresets } from '@/presets'
import { type CustomPresetSpec, loadCustomSpecs, saveCustomSpecs, toPreset } from '@/presets/custom'
import { RULES } from '@/rules/engine'
import { type Comparison, compareScans, compareTags, migrateDecisions } from './compare'

export type Phase = 'idle' | 'reading' | 'parsing' | 'source' | 'ocr' | 'scanning' | 'done' | 'error' | 'cancelled'
export type SlotId = 'main' | 'supp-1' | 'supp-2'
export const SLOT_IDS: SlotId[] = ['main', 'supp-1', 'supp-2']

const PREF_KEY = 'blindpreflight.prefs.v1'

/** 只存界面偏好：会场预设、是否做本地 OCR 与识别语言 */
interface Prefs {
  presetId: string
  ocr: boolean
  ocrLang: OcrLang
}

function loadPrefs(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(PREF_KEY)
    const p = raw ? (JSON.parse(raw) as Partial<Prefs>) : {}
    const presetId = typeof p.presetId === 'string' && allPresets().some((x) => x.id === p.presetId) ? p.presetId : 'generic'
    return { presetId, ocr: p.ocr === true, ocrLang: p.ocrLang === 'eng+chi_sim' ? 'eng+chi_sim' : 'eng' }
  } catch {
    return { presetId: 'generic', ocr: false, ocrLang: 'eng' }
  }
}

function savePrefs(): void {
  try {
    globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify({ presetId: state.presetId, ocr: state.ocr, ocrLang: state.ocrLang }))
  } catch {
    /* 隐私模式等：忽略 */
  }
}

function fingerprint(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`
}

/* ---------- 自定义预设（必须在读取偏好之前登记） ---------- */
const RULE_IDS = RULES.map((r) => r.id)
const BASE_IDS = PRESETS.map((p) => p.id)
const customSpecs = shallowRef<CustomPresetSpec[]>(loadCustomSpecs(RULE_IDS, BASE_IDS))
function applyCustom(): void {
  setCustomPresets(customSpecs.value.map((sp) => toPreset(sp, getBuiltinPreset(sp.baseId))))
}
applyCustom()

export const SLOT_LABEL: Record<SlotId, string> = { main: '主稿', 'supp-1': '补充材料 1', 'supp-2': '补充材料 2' }

const initialPrefs = loadPrefs()
const state = reactive({
  presetId: initialPrefs.presetId,
  /** 对扫描页 / 图片页做本地 OCR */
  ocr: initialPrefs.ocr,
  ocrLang: initialPrefs.ocrLang as OcrLang,
  termsText: '',
  strictShortTerms: false,
  files: { main: null, 'supp-1': null, 'supp-2': null } as Record<SlotId, File | null>,
  /** 可选的源文件包（LaTeX / zip） */
  sourceFile: null as File | null,
  phase: 'idle' as Phase,
  progress: { slot: 'main' as SlotId, done: 0, total: 0, docIndex: 0, docCount: 0 },
  error: null as string | null,
  /** 选择文件时的即时校验错误 */
  selectionError: null as string | null,
  decisions: new Map<string, ReviewDecision>(),
  selectedFindingId: null as string | null,
  /** 人工核对清单中已勾选的条目 */
  checked: new Set<string>(),
  /** 结果视图 / 导入视图 */
  view: 'import' as 'import' | 'results',
})

const result = shallowRef<ScanResult | null>(null)
/** 与上一版的对比（换了文件重新检查时生成） */
const comparison = shallowRef<Comparison | null>(null)
const pdfs = new Map<string, PDFDocumentProxy>()
let currentRun = 0
let controller: AbortController | null = null
let lastFingerprints = ''
/** 本次会话中从元数据得到过的作者名（只在内存中），见 ScanOptions.knownNames */
let knownNames: NonNullable<ScanOptions['knownNames']> = []

function rememberNames(facts: DocumentFacts[]): void {
  const seen = new Set(knownNames.map((n) => n.raw.toLowerCase()))
  for (const n of deriveNames(facts)) {
    if (seen.has(n.raw.toLowerCase())) continue
    seen.add(n.raw.toLowerCase())
    knownNames.push({ raw: n.raw, tokens: [...n.tokens], source: n.source })
  }
}

function scanOptions(): ScanOptions {
  return {
    presetId: state.presetId,
    userTerms: parseUserTerms(state.termsText),
    strictShortTerms: state.strictShortTerms,
    knownNames,
  }
}

function destroyPdfs(): void {
  for (const pdf of pdfs.values()) void pdf.loadingTask.destroy().catch(() => {})
  pdfs.clear()
}

function selectedFingerprints(): string {
  return [...SLOT_IDS.map((id) => (state.files[id] ? fingerprint(state.files[id]!) : '-')), state.sourceFile ? fingerprint(state.sourceFile) : '-'].join('#')
}

/** 源文件（LaTeX / zip）按扩展名识别 */
export function isSourceFile(f: File): boolean {
  return /\.(?:zip|tex|bib)$/i.test(f.name)
}

function setSourceFile(file: File | null): void {
  state.sourceFile = file
  state.selectionError = null
  if (file && !isSourceFile(file)) state.selectionError = '源文件只支持 .zip 压缩包，或单个 .tex / .bib 文件。'
  else if (file && file.size > 50 * 1024 * 1024) state.selectionError = '源文件包超过 50 MB。请去掉数据集、模型权重等大文件后重试。'
  else checkSelection()
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
  const src = files.find(isSourceFile)
  if (src) setSourceFile(src)
  const queue = files.filter((f) => !isSourceFile(f))
  for (const id of SLOT_IDS) {
    if (!queue.length) break
    if (!state.files[id]) state.files[id] = queue.shift()!
  }
  if (queue.length && queue.length === files.length && files.length === 1) state.files.main = queue.shift()!
  checkSelection()
}

function setPreset(id: string): void {
  if (!allPresets().some((p) => p.id === id)) return
  state.presetId = id
  savePrefs()
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

    // 本地 OCR：只识别文字为空、过少或乱码的页
    const weak = facts.flatMap((d, i) => d.pages.filter((p) => p.textQuality !== 'ok').map((p) => ({ di: i, page: p })))
    if (state.ocr && weak.length) {
      const todo = weak.slice(0, OCR_MAX_PAGES)
      state.phase = 'ocr'
      state.progress = { slot: facts[todo[0]!.di]!.id as SlotId, done: 0, total: todo.length, docIndex: 0, docCount: inputs.length }
      let session: Awaited<ReturnType<typeof createOcrSession>> | null = null
      try {
        session = await createOcrSession(state.ocrLang)
        let done = 0
        for (const { di, page } of todo) {
          if (ctl.signal.aborted) throw new PreflightError('CANCELLED')
          const doc = facts[di]!
          const idx = doc.pages.indexOf(page)
          doc.pages[idx] = await session.recognizePage(opened[di]!, page, ctl.signal)
          done++
          if (!stale()) state.progress = { slot: doc.id as SlotId, done, total: todo.length, docIndex: di, docCount: inputs.length }
        }
        for (const [di, doc] of facts.entries()) {
          const n = doc.pages.filter((p) => p.ocr).length
          if (!n) continue
          assignZones(doc.pages)
          doc.warnings = doc.warnings.filter((w) => w !== SCANNED_WARNING)
          const img = doc.coverage.find((c) => c.capability === 'images')
          if (img) img.reason = img.reason.replace('图片中的文字没有检查（无 OCR）', `已对 ${n} 页扫描 / 图片页做本地 OCR，文字正常的页面里的插图没有识别`)
          const cov = doc.coverage.find((c) => c.capability === 'text')
          if (cov) cov.reason += ` 其中 ${n} 页已用本地 OCR 识别${n < weak.filter((w) => w.di === di).length ? '（超过单次上限的页没有识别）' : ''}，识别结果可能有错字。`
        }
      } catch (err) {
        if (isCancelled(err)) throw err
        facts[0]?.warnings.push(err instanceof PreflightError ? err.message : '本地 OCR 未能完成。')
      } finally {
        await session?.terminate()
      }
      if (stale()) {
        for (const p of opened) void p.loadingTask.destroy().catch(() => {})
        return
      }
    }
    state.phase = 'scanning'
    await new Promise((r) => setTimeout(r, 0))
    if (stale()) {
      for (const p of opened) void p.loadingTask.destroy().catch(() => {})
      return
    }
    let source = null
    if (state.sourceFile) {
      state.phase = 'source'
      const bytes = new Uint8Array(await state.sourceFile.arrayBuffer())
      if (stale()) {
        for (const p of opened) void p.loadingTask.destroy().catch(() => {})
        return
      }
      source = await parseSourceArchive(state.sourceFile.name, bytes)
      if (stale()) {
        for (const p of opened) void p.loadingTask.destroy().catch(() => {})
        return
      }
    }
    state.phase = 'scanning'
    const scan = runScan(facts, { ...scanOptions(), source }, { runId })
    rememberNames(facts)
    // 同一组文件重扫保留复核决定；换了文件则与上一版对比，并把仍然存在的发现的忽略决定带过来
    const fp = selectedFingerprints()
    const prevResult = result.value
    if (fp !== lastFingerprints) {
      const prevDecisions = new Map(state.decisions)
      state.decisions.clear()
      if (prevResult && lastFingerprints) {
        const cmp = compareScans(prevResult, scan)
        const mig = migrateDecisions(cmp, prevDecisions)
        for (const [k, v] of mig.decisions) state.decisions.set(k, v)
        comparison.value = markRaw({ ...cmp, reopened: mig.reopened })
      } else comparison.value = null
    } else {
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
  comparison.value = null
  state.checked.clear()
  state.files = { main: null, 'supp-1': null, 'supp-2': null }
  state.sourceFile = null
  state.termsText = ''
  state.strictShortTerms = false
  state.decisions.clear()
  state.selectedFindingId = null
  state.phase = 'idle'
  state.error = null
  state.selectionError = null
  state.view = 'import'
  lastFingerprints = ''
  knownNames = []
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

/** 结果页直接换上新版本并重新检查（会自动与上一版对比） */
async function rescanWith(slot: SlotId, file: File): Promise<void> {
  setFile(slot, file)
  if (state.selectionError) return
  await start()
}

/**
 * 只读复检：对一份（清理后的）PDF 做与当前设置相同的检查，不改动会话状态。
 * 用于在下载清理版之前告诉用户“哪些问题已经消除，哪些仍需改源文件”。
 */
async function previewScan(slot: SlotId, bytes: Uint8Array): Promise<ScanResult> {
  const lib = await loadPdfjs()
  const r = await extractDocument(
    { id: slot, role: slot === 'main' ? 'main' : 'supplement', displayName: state.files[slot]?.name ?? slot, bytes },
    { lib, assets: browserAssets(), pageBudget: LIMITS.maxPagesTotal },
  )
  try {
    return runScan([r.facts], scanOptions())
  } finally {
    void r.pdf.loadingTask.destroy().catch(() => {})
  }
}

function commitCustom(list: CustomPresetSpec[]): void {
  customSpecs.value = list
  saveCustomSpecs(list)
  applyCustom()
  if (!allPresets().some((p) => p.id === state.presetId)) setPreset('generic')
}

function upsertCustomPreset(spec: CustomPresetSpec): void {
  const list = customSpecs.value.filter((x) => x.id !== spec.id)
  commitCustom([...list, spec])
}

function removeCustomPreset(id: string): void {
  commitCustom(customSpecs.value.filter((x) => x.id !== id))
}

/** 导入：同 id 覆盖，其余追加 */
function importCustomPresets(list: CustomPresetSpec[]): number {
  const ids = new Set(list.map((x) => x.id))
  commitCustom([...customSpecs.value.filter((x) => !ids.has(x.id)), ...list])
  return list.length
}

function setOcr(on: boolean, lang?: OcrLang): void {
  state.ocr = on
  if (lang) state.ocrLang = lang
  savePrefs()
}

function dismissComparison(): void {
  comparison.value = null
}

function toggleChecked(id: string, on: boolean): void {
  if (on) state.checked.add(id)
  else state.checked.delete(id)
}

export function getPdf(docId: string): PDFDocumentProxy | null {
  return pdfs.get(docId) ?? null
}

const busy = computed(() => state.phase === 'reading' || state.phase === 'parsing' || state.phase === 'scanning')
const selectedFinding = computed(() => result.value?.findings.find((f) => f.id === state.selectedFindingId) ?? null)
const compareTag = computed(() => compareTags(comparison.value))
const presetList = computed(() => {
  void customSpecs.value
  return allPresets()
})
const filesChangedSinceScan = computed(() => result.value != null && selectedFingerprints() !== lastFingerprints)

export function useSession() {
  return {
    state,
    result,
    busy,
    selectedFinding,
    filesChangedSinceScan,
    comparison,
    compareTag,
    presetList,
    customSpecs,
    upsertCustomPreset,
    removeCustomPreset,
    importCustomPresets,
    ruleIds: RULE_IDS,
    baseIds: BASE_IDS,
    dismissComparison,
    toggleChecked,
    rescanWith,
    previewScan,
    setFile,
    setSourceFile,
    setOcr,
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
