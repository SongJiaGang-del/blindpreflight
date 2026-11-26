<script setup lang="ts">
import { computed } from 'vue'
import { NSelect, NTag } from 'naive-ui'
import { PRESETS, getPreset } from '@/presets'

const props = defineProps<{ presetId: string; disabled?: boolean }>()
const emit = defineEmits<{ change: [id: string] }>()

const IMPL: Record<string, { label: string; type: 'success' | 'warning' | 'default' }> = {
  implemented: { label: '已按条款调整', type: 'success' },
  partial: { label: '部分实现', type: 'warning' },
  reference: { label: '仅条款摘要', type: 'default' },
}
const VERIFY: Record<string, string> = { verified: '资料已核验', partial: '资料部分核验', unverified: '通用规则' }

const options = computed(() =>
  PRESETS.map((p) => ({
    value: p.id,
    label: `${p.venue}${p.year ? ` ${p.year}` : ''}${p.implementationStatus === 'reference' ? '（参考）' : p.implementationStatus === 'partial' ? '（部分）' : ''}`,
  })),
)
const preset = computed(() => getPreset(props.presetId))
</script>

<template>
  <div class="preset">
    <label class="field-label" for="preset-select">会场预设</label>
    <n-select
      id="preset-select"
      data-testid="preset-select"
      :value="presetId"
      :options="options"
      :disabled="disabled"
      @update:value="(v: string) => emit('change', v)"
    />
    <div class="tags">
      <n-tag size="small" :bordered="false" :type="IMPL[preset.implementationStatus]?.type ?? 'default'">
        {{ IMPL[preset.implementationStatus]?.label }}
      </n-tag>
      <n-tag size="small" :bordered="false">{{ VERIFY[preset.verificationStatus] }}{{ preset.verifiedAt ? ` · ${preset.verifiedAt}` : '' }}</n-tag>
      <n-tag v-if="preset.phase" size="small" :bordered="false">{{ preset.phase }}</n-tag>
    </div>
    <ul class="summary">
      <li v-for="(s, i) in preset.summary" :key="i">{{ s }}</li>
    </ul>
    <div v-if="preset.linkNote" class="note">{{ preset.linkNote }}</div>
    <details v-if="preset.sources.length" class="sources">
      <summary>政策来源（{{ preset.sources.length }}）</summary>
      <div class="muted small">以下地址仅以文本展示，本工具不会访问它们。请自行在浏览器中核对最新版本。</div>
      <ul>
        <li v-for="(s, i) in preset.sources" :key="i">
          {{ s.label }}<span v-if="s.section"> · {{ s.section }}</span>
          <div class="url">{{ s.url }}</div>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.preset {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  color: #36404e;
  line-height: 1.6;
}
.note {
  font-size: 12px;
  color: #8a5a10;
  background: #fdf6e8;
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
  font-family: ui-monospace, Consolas, monospace;
  word-break: break-all;
  color: var(--bp-muted);
  user-select: all;
}
</style>
