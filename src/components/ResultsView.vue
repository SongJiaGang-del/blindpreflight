<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NSelect } from 'naive-ui'
import type { ScanResult, Severity } from '@/domain/types'
import { PRESETS } from '@/presets'
import { SLOT_LABEL, type SlotId, useSession } from '@/app/session'
import ResultsSummary from './ResultsSummary.vue'
import FindingList from './FindingList.vue'
import PdfViewer from './PdfViewer.vue'
import ExportDialog from './ExportDialog.vue'

const props = defineProps<{ result: ScanResult }>()
const s = useSession()
const list = ref<InstanceType<typeof FindingList> | null>(null)
const showExport = ref(false)
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
        <ResultsSummary :result="result" :doc-labels="docLabels" @severity="onSeverity" />
        <FindingList ref="list" :findings="result.findings" :doc-labels="docLabels" @select="select" />
      </div>
      <div class="right">
        <PdfViewer :key="result.runId" :finding="s.selectedFinding.value" :doc-labels="docLabels" />
      </div>
    </div>
    <ExportDialog v-model:show="showExport" :result="result" />
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
  top: 70px;
  height: calc(100vh - 90px);
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
