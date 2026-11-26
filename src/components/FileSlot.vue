<script setup lang="ts">
import { ref } from 'vue'
import { NButton } from 'naive-ui'
import { visibleText } from '@/utils/safe-text'

const props = defineProps<{ label: string; hint: string; file: File | null; disabled?: boolean; testId: string; large?: boolean }>()
const emit = defineEmits<{ change: [file: File | null] }>()

const input = ref<HTMLInputElement | null>(null)
const over = ref(false)

function pick() {
  if (!props.disabled) input.value?.click()
}
function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0] ?? null
  if (f) emit('change', f)
  el.value = ''
}
function onDrop(e: DragEvent) {
  over.value = false
  if (props.disabled) return
  const f = e.dataTransfer?.files?.[0]
  if (f) emit('change', f)
}
function size(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
</script>

<template>
  <div
    class="slot"
    :class="{ over, filled: !!file, disabled, large }"
    :data-testid="testId"
    role="button"
    tabindex="0"
    :aria-label="`${label}：${file ? '已选择，点击更换' : '点击选择 PDF 或拖入文件'}`"
    @click="pick"
    @keydown.enter.prevent="pick"
    @keydown.space.prevent="pick"
    @dragover.prevent="over = true"
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    <input ref="input" type="file" accept="application/pdf,.pdf" hidden :data-testid="`${testId}-input`" @change="onInput" />
    <div class="icon" aria-hidden="true">
      <svg v-if="file" viewBox="0 0 40 48" class="doc filled-doc">
        <path d="M4 3h22l10 10v32H4z" class="sheet" />
        <path d="M26 3v10h10" class="fold" />
        <path d="M12 30l5 5 11-12" class="check" />
      </svg>
      <svg v-else viewBox="0 0 40 48" class="doc">
        <path d="M4 3h22l10 10v32H4z" class="sheet" />
        <path d="M26 3v10h10" class="fold" />
        <path d="M20 37V22M14 28l6-6 6 6" class="arrow" />
      </svg>
    </div>
    <div class="body">
      <div class="slot-label">{{ label }}</div>
      <template v-if="file">
        <div class="slot-name" :title="visibleText(file.name)">{{ visibleText(file.name) }}</div>
        <div class="slot-meta">
          {{ size(file.size) }}
          <span class="sep">·</span>
          <span>点击更换</span>
          <n-button text size="tiny" type="error" :disabled="disabled" @click.stop="emit('change', null)">移除</n-button>
        </div>
      </template>
      <template v-else>
        <div class="slot-empty">{{ hint }}</div>
        <div v-if="large" class="slot-sub">PDF · 单份 ≤ 25 MB / 100 页</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.slot {
  border: 1.5px dashed var(--bp-line-strong);
  border-radius: var(--bp-radius);
  padding: 14px 16px;
  min-height: 84px;
  background: var(--bp-panel-2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s, box-shadow 0.15s;
  outline: none;
  display: flex;
  align-items: center;
  gap: 14px;
}
.slot.large {
  min-height: 150px;
  padding: 22px 26px;
  gap: 22px;
}
.slot:hover,
.slot:focus-visible,
.slot.over {
  border-color: var(--bp-accent);
  background: var(--bp-accent-soft);
}
.slot.over {
  transform: scale(1.01);
  box-shadow: var(--bp-shadow);
}
.slot.filled {
  border-style: solid;
  border-color: var(--bp-line-strong);
  background: var(--bp-panel);
}
.slot.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.icon {
  flex: none;
  width: 30px;
  color: var(--bp-muted);
}
.large .icon {
  width: 48px;
}
.slot:hover .icon,
.slot.over .icon {
  color: var(--bp-accent);
}
.doc {
  display: block;
  width: 100%;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.doc .sheet {
  fill: var(--bp-panel);
}
.filled-doc {
  color: var(--bp-ok);
}
.over .arrow {
  animation: nudge 0.8s ease-in-out infinite;
}
@keyframes nudge {
  50% {
    transform: translateY(-3px);
  }
}
.body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.slot-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--bp-muted);
}
.large .slot-label {
  font-family: var(--bp-serif);
  font-size: 15px;
  letter-spacing: 0.02em;
  color: var(--bp-ink-2);
}
.slot-name {
  font-weight: 600;
  word-break: break-all;
  font-size: 14px;
}
.large .slot-name {
  font-size: 16px;
}
.slot-meta {
  font-size: 12px;
  color: var(--bp-muted);
  display: flex;
  gap: 8px;
  align-items: center;
}
.sep {
  opacity: 0.6;
}
.slot-empty {
  color: var(--bp-muted);
  font-size: 13px;
}
.large .slot-empty {
  font-size: 16px;
  color: var(--bp-ink-2);
}
.slot-sub {
  font-size: 12px;
  color: var(--bp-muted);
}
</style>
