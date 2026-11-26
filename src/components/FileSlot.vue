<script setup lang="ts">
import { ref } from 'vue'
import { NButton } from 'naive-ui'
import { visibleText } from '@/utils/safe-text'

const props = defineProps<{ label: string; hint: string; file: File | null; disabled?: boolean; testId: string }>()
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
    :class="{ over, filled: !!file, disabled }"
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
    <div class="slot-label">{{ label }}</div>
    <template v-if="file">
      <div class="slot-name" :title="visibleText(file.name)">{{ visibleText(file.name) }}</div>
      <div class="slot-meta">
        {{ size(file.size) }}
        <n-button text size="tiny" type="error" :disabled="disabled" @click.stop="emit('change', null)">移除</n-button>
      </div>
    </template>
    <template v-else>
      <div class="slot-empty">{{ hint }}</div>
    </template>
  </div>
</template>

<style scoped>
.slot {
  border: 1.5px dashed #c5ccd8;
  border-radius: 10px;
  padding: 14px 16px;
  min-height: 96px;
  background: #fbfcfd;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  outline: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.slot:hover,
.slot:focus-visible,
.slot.over {
  border-color: var(--bp-accent);
  background: #f2f6fb;
}
.slot.filled {
  border-style: solid;
  border-color: #b9c6d8;
  background: #fff;
}
.slot.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.slot-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--bp-muted);
}
.slot-name {
  font-weight: 600;
  word-break: break-all;
  font-size: 14px;
}
.slot-meta {
  font-size: 12px;
  color: var(--bp-muted);
  display: flex;
  gap: 10px;
  align-items: center;
}
.slot-empty {
  color: var(--bp-muted);
  font-size: 13px;
  margin-top: 6px;
}
</style>
