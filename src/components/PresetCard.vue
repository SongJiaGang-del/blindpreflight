<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NSelect, NTag, useMessage } from 'naive-ui'
import { getPreset } from '@/presets'
import { exportSpecsJson, parseSpecsJson } from '@/presets/custom'
import { downloadText } from '@/report/download'
import { useSession } from '@/app/session'
import PresetEditor from './PresetEditor.vue'

const props = defineProps<{ presetId: string; disabled?: boolean }>()
const emit = defineEmits<{ change: [id: string] }>()

const IMPL: Record<string, { label: string; type: 'success' | 'warning' | 'default' }> = {
  implemented: { label: '已按条款调整', type: 'success' },
  partial: { label: '部分实现', type: 'warning' },
  reference: { label: '仅条款摘要', type: 'default' },
}
const VERIFY: Record<string, string> = { verified: '资料已核验', partial: '资料部分核验', unverified: '通用规则' }

const s = useSession()
const message = useMessage()

const options = computed(() => {
  const all = s.presetList.value
  const label = (p: (typeof all)[number]) =>
    `${p.venue}${p.year ? ` ${p.year}` : ''}${p.implementationStatus === 'reference' ? '（参考）' : p.implementationStatus === 'partial' ? '（部分）' : ''}`
  const builtin = all.filter((p) => !p.custom).map((p) => ({ value: p.id, label: label(p) }))
  const custom = all.filter((p) => p.custom).map((p) => ({ value: p.id, label: p.venue }))
  return custom.length
    ? [
        { type: 'group', label: '内置预设', key: 'builtin', children: builtin },
        { type: 'group', label: '自定义预设', key: 'custom', children: custom },
      ]
    : builtin
})
const preset = computed(() => {
  void s.presetList.value
  return getPreset(props.presetId)
})

const showEditor = ref(false)
const editing = computed(() => (preset.value.custom ? (s.customSpecs.value.find((x) => x.id === preset.value.id) ?? null) : null))
const editTarget = ref<typeof editing.value>(null)
function openNew() {
  editTarget.value = null
  showEditor.value = true
}
function openEdit() {
  editTarget.value = editing.value
  showEditor.value = true
}
function onSaved(id: string) {
  emit('change', id)
  message.success('已保存自定义预设')
}

const importer = ref<HTMLInputElement | null>(null)
async function onImport(e: Event) {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  el.value = ''
  if (!f) return
  try {
    if (f.size > 256 * 1024) throw new Error('size')
    const list = parseSpecsJson(await f.text(), s.ruleIds, s.baseIds)
    if (!list.length) throw new Error('empty')
    s.importCustomPresets(list)
    message.success(`已导入 ${list.length} 个自定义预设`)
  } catch {
    message.error('无法导入：不是 BlindPreflight 导出的预设文件。')
  }
}
function exportAll() {
  downloadText('blindpreflight-presets.json', exportSpecsJson(s.customSpecs.value), 'application/json')
}
</script>

<template>
  <div class="preset">
    <n-select
      id="preset-select"
      aria-label="会场预设"
      data-testid="preset-select"
      :value="presetId"
      :options="options"
      :disabled="disabled"
      @update:value="(v: string) => emit('change', v)"
    />
    <div class="pacts">
      <n-button size="tiny" secondary :disabled="disabled" data-testid="preset-new" @click="openNew">新建自定义</n-button>
      <n-button v-if="editing" size="tiny" secondary :disabled="disabled" data-testid="preset-edit" @click="openEdit">编辑</n-button>
      <n-button size="tiny" quaternary :disabled="disabled" @click="importer?.click()">导入</n-button>
      <n-button v-if="s.customSpecs.value.length" size="tiny" quaternary @click="exportAll">导出（{{ s.customSpecs.value.length }}）</n-button>
      <input ref="importer" type="file" accept="application/json,.json" hidden @change="onImport" />
    </div>
    <div class="tags">
      <n-tag v-if="preset.custom" size="small" :bordered="false" type="info">自定义</n-tag>
      <n-tag size="small" :bordered="false" :type="IMPL[preset.implementationStatus]?.type ?? 'default'">
        {{ IMPL[preset.implementationStatus]?.label }}
      </n-tag>
      <n-tag size="small" :bordered="false">{{ VERIFY[preset.verificationStatus] }}{{ preset.verifiedAt ? ` · ${preset.verifiedAt}` : '' }}</n-tag>
      <n-tag v-if="preset.phase" size="small" :bordered="false">{{ preset.phase }}</n-tag>
    </div>
    <ul class="summary">
      <li v-for="(line, i) in preset.summary" :key="i">{{ line }}</li>
    </ul>
    <div v-if="preset.linkNote" class="note">{{ preset.linkNote }}</div>
    <details v-if="preset.sources.length" class="sources">
      <summary>政策来源（{{ preset.sources.length }}）</summary>
      <div class="muted small">以下地址仅以文本展示，本工具不会访问它们。请自行在浏览器中核对最新版本。</div>
      <ul>
        <li v-for="(src, i) in preset.sources" :key="i">
          {{ src.label }}<span v-if="src.section"> · {{ src.section }}</span>
          <div class="url">{{ src.url }}</div>
        </li>
      </ul>
    </details>
    <PresetEditor v-model:show="showEditor" :spec="editTarget" @saved="onSaved" />
  </div>
</template>

<style scoped>
.preset {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pacts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.summary {
  margin: 2px 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--bp-ink-2);
  line-height: 1.6;
}
.note {
  font-size: 12px;
  color: var(--bp-medium-ink);
  background: var(--bp-medium-soft);
  padding: 6px 10px;
  border-radius: 6px;
}
.sources {
  font-size: 12px;
}
.sources summary {
  cursor: pointer;
  color: var(--bp-accent);
}
.sources ul {
  padding-left: 18px;
  margin: 6px 0 0;
}
.url {
  font-family: var(--bp-mono);
  word-break: break-all;
  color: var(--bp-muted);
  user-select: all;
}
</style>
