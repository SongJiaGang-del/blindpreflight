<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NSelect, useMessage } from 'naive-ui'
import type { FindingCategory, ReviewStatus, ScanResult, Severity } from '@/domain/types'
import { REVIEW_LABEL, isDismissed } from '@/domain/labels'
import { PRESETS } from '@/presets'
import { SLOT_LABEL, type SlotId, useSession } from '@/app/session'
import ResultsSummary from './ResultsSummary.vue'
import FindingList from './FindingList.vue'
import PdfViewer from './PdfViewer.vue'
import ExportDialog from './ExportDialog.vue'
import CleanDialog from './CleanDialog.vue'
import ComparePanel from './ComparePanel.vue'
import ChecklistPanel from './ChecklistPanel.vue'
import type { CompareTag } from '@/app/compare'

const props = defineProps<{ result: ScanResult }>()
const emit = defineEmits<{ help: [tab: string] }>()
const s = useSession()
const message = useMessage()
const list = ref<InstanceType<typeof FindingList> | null>(null)
const viewer = ref<InstanceType<typeof PdfViewer> | null>(null)
const showExport = ref(false)
const showClean = ref(false)
const newVersion = ref<HTMLInputElement | null>(null)

function pickNewVersion() {
  newVersion.value?.click()
}
async function onNewVersion(e: Event) {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  el.value = ''
  if (!f) return
  await s.rescanWith('main', f)
  if (s.state.selectionError) message.warning(s.state.selectionError)
  else if (s.state.phase === 'error' && s.state.error) message.error(s.state.error)
}
function onCompareFilter(tag: CompareTag | 'reopened') {
  list.value?.showCompare(tag)
  mobileTab.value = 'findings'
}
const mobileTab = ref<'findings' | 'page'>('findings')

/** 界面上的文件标签不用文件名，避免截图或录屏时泄露 */
const docLabels = computed(() => Object.fromEntries(props.result.documents.map((d) => [d.id, SLOT_LABEL[d.id as SlotId] ?? d.id])))

const presetOptions = PRESETS.map((p) => ({ value: p.id, label: `${p.venue}${p.year ? ` ${p.year}` : ''}` }))

function changePreset(id: string) {
  s.setPreset(id)
  void s.start()
}
function select(id: string) {
  s.state.selectedFindingId = id
  mobileTab.value = 'page'
}
function onSeverity(sev: Severity) {
  list.value?.showSeverity(sev)
  mobileTab.value = 'findings'
}
function onCategory(cat: FindingCategory) {
  list.value?.showCategory(cat)
  mobileTab.value = 'findings'
}
/** 页码热力条：跳到该页；如果该页有待处理发现，选中最严重的那条 */
function onPage(docId: string, page: number) {
  const rank: Record<Severity, number> = { high: 3, medium: 2, info: 1 }
  const hit = props.result.findings
    .filter((f) => {
      const st = s.statusOf(f.id)
      return f.documentId === docId && st !== 'resolved' && !isDismissed(st) && f.occurrences.some((o) => o.page === page)
    })
    .sort((a, b) => rank[b.severity] - rank[a.severity])[0]
  if (hit && hit.id !== s.state.selectedFindingId) {
    list.value?.reveal(hit.id)
    viewer.value?.willSelectAt(docId, page)
    s.state.selectedFindingId = hit.id
  } else viewer.value?.show(docId, page)
  mobileTab.value = 'page'
}
/** 原页上点击了某个淡色框 */
function onPick(id: string) {
  list.value?.reveal(id)
  s.state.selectedFindingId = id
}

/* ---------- 快捷键 ---------- */
function step(delta: number) {
  const ids = list.value?.visibleIds() ?? []
  if (!ids.length) return
  const cur = s.state.selectedFindingId ? ids.indexOf(s.state.selectedFindingId) : -1
  const next = cur < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, cur + delta))
  s.state.selectedFindingId = ids[next]!
}
function mark(status: ReviewStatus) {
  const id = s.state.selectedFindingId
  if (!id) return
  // 先记住下一条：标记后当前项可能从“待处理”筛选中消失
  const ids = list.value?.visibleIds() ?? []
  const i = ids.indexOf(id)
  const after = ids[i + 1] ?? ids[i - 1] ?? null
  s.setDecision(id, status)
  message.info(`已标记：${status === 'open' ? '待处理' : REVIEW_LABEL[status]}`, { duration: 1400 })
  const still = list.value?.visibleIds() ?? []
  if (!still.includes(id) && after) s.state.selectedFindingId = after
}
function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (!t) return false
  if (t.closest('input, textarea, select, [contenteditable="true"], .n-base-selection, .n-modal, .n-drawer, .n-dialog')) return true
  return !!document.querySelector('.n-modal-container .n-modal, .n-drawer-container .n-drawer')
}
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || typing(e)) return
  const v = viewer.value
  const handled = (() => {
    switch (e.key) {
      case 'j':
      case 'J':
      case 'ArrowDown':
        step(1)
        return true
      case 'k':
      case 'K':
      case 'ArrowUp':
        step(-1)
        return true
      case 'Home': {
        const first = list.value?.visibleIds()[0]
        if (first) s.state.selectedFindingId = first
        return true
      }
      case 'r':
      case 'R':
        mark('resolved')
        return true
      case 'i':
      case 'I':
        mark('dismissed-irrelevant')
        return true
      case 'u':
      case 'U':
        mark('open')
        return true
      case '[':
        v?.prevOcc()
        return true
      case ']':
        v?.nextOcc()
        return true
      case 'ArrowLeft':
        v?.prevPage()
        return true
      case 'ArrowRight':
        v?.nextPage()
        return true
      case '+':
      case '=':
        v?.zoomIn()
        return true
      case '-':
      case '_':
        v?.zoomOut()
        return true
      case '0':
        v?.zoomReset()
        return true
      case '?':
        emit('help', 'keys')
        return true
      default:
        return false
    }
  })()
  if (handled) e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="results">
    <div class="bar">
      <div class="bar-left">
        <n-button size="small" data-testid="back-to-import" @click="s.state.view = 'import'">← 文件与设置</n-button>
        <n-select
          size="small"
          class="preset"
          :value="s.state.presetId"
          :options="presetOptions"
          :disabled="s.busy.value"
          aria-label="切换会场预设并重新检查"
          @update:value="changePreset"
        />
        <span v-if="s.busy.value" class="muted">正在重新检查…</span>
      </div>
      <div class="bar-right">
        <input ref="newVersion" type="file" accept="application/pdf,.pdf" hidden data-testid="new-version-input" @change="onNewVersion" />
        <n-button size="small" :disabled="s.busy.value" title="选择修改后的主稿，重新检查并与当前结果对比" data-testid="new-version" @click="pickNewVersion">上传新版本</n-button>
        <n-button size="small" :disabled="s.busy.value" data-testid="open-clean" @click="showClean = true">清理 PDF</n-button>
        <n-button size="small" :disabled="s.busy.value" @click="s.start()">重新检查</n-button>
        <n-button size="small" type="primary" data-testid="open-export" @click="showExport = true">导出报告</n-button>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button role="tab" :aria-selected="mobileTab === 'findings'" :class="{ on: mobileTab === 'findings' }" @click="mobileTab = 'findings'">发现</button>
      <button role="tab" :aria-selected="mobileTab === 'page'" :class="{ on: mobileTab === 'page' }" @click="mobileTab = 'page'">原页</button>
    </div>
    <div class="cols" :class="`show-${mobileTab}`">
      <div class="left">
        <ResultsSummary :result="result" :doc-labels="docLabels" @severity="onSeverity" @category="onCategory" @page="onPage" />
        <ComparePanel
          v-if="s.comparison.value"
          :cmp="s.comparison.value"
          :doc-labels="docLabels"
          @filter="onCompareFilter"
          @dismiss="s.dismissComparison()"
        />
        <ChecklistPanel :result="result" />
        <FindingList ref="list" :findings="result.findings" :doc-labels="docLabels" @select="select" />
      </div>
      <div class="right">
        <PdfViewer
          :key="result.runId"
          ref="viewer"
          :finding="s.selectedFinding.value"
          :findings="result.findings"
          :doc-labels="docLabels"
          @select="onPick"
        />
      </div>
    </div>
    <ExportDialog v-model:show="showExport" :result="result" />
    <CleanDialog v-model:show="showClean" :result="result" />
  </div>
</template>

<style scoped>
.results {
  max-width: 1480px;
  margin: 0 auto;
  padding: 14px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bar {
  position: sticky;
  top: 53px;
  z-index: 6;
  margin: 0 -20px;
  padding: 8px 20px;
  background: color-mix(in srgb, var(--bp-bg) 90%, transparent);
  backdrop-filter: blur(6px);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.bar-left,
.bar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
.preset {
  width: 200px;
}
.muted {
  font-size: 12px;
  color: var(--bp-muted);
}
.cols {
  display: grid;
  grid-template-columns: minmax(380px, 1fr) minmax(0, 1.05fr);
  gap: 18px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.right {
  position: sticky;
  top: 104px;
  height: calc(100vh - 118px);
  min-width: 0;
}
.tabs {
  display: none;
}
@media (max-width: 960px) {
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--bp-line);
  }
  .tabs button {
    flex: 1;
    background: none;
    border: none;
    padding: 8px;
    font: inherit;
    color: var(--bp-muted);
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tabs button.on {
    color: var(--bp-accent);
    border-bottom-color: var(--bp-accent);
    font-weight: 600;
  }
  .cols {
    grid-template-columns: 1fr;
  }
  .show-findings .right {
    display: none;
  }
  .show-page .left {
    display: none;
  }
  .right {
    position: static;
    height: calc(100vh - 170px);
  }
  .preset {
    width: 150px;
  }
}
</style>
