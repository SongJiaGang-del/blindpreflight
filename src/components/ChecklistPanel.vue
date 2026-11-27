<script setup lang="ts">
import { computed } from 'vue'
import { NCheckbox } from 'naive-ui'
import type { ScanResult } from '@/domain/types'
import { checklistFor } from '@/app/checklist'
import { useSession } from '@/app/session'
import { useI18n } from '@/i18n'

const props = defineProps<{ result: ScanResult }>()
const s = useSession()
const { t, tx } = useI18n()

const items = computed(() => checklistFor(props.result))
const done = computed(() => items.value.filter((i) => s.state.checked.has(i.id)).length)
</script>

<template>
  <details class="check" data-testid="checklist">
    <summary>
      <span class="title">{{ t('check.title') }}</span>
      <span class="muted">{{ t('check.sub') }}</span>
      <span class="count" :class="{ all: done === items.length }">{{ done }} / {{ items.length }}</span>
    </summary>
    <ul>
      <li v-for="it in items" :key="it.id" :class="{ on: s.state.checked.has(it.id) }">
        <n-checkbox
          :checked="s.state.checked.has(it.id)"
          :data-testid="`check-${it.id}`"
          @update:checked="(v: boolean) => s.toggleChecked(it.id, v)"
        >
          <span class="it-title">{{ tx(it.title) }}</span>
        </n-checkbox>
        <div class="detail">{{ tx(it.detail) }}</div>
        <div v-if="it.emphasis" class="emph">{{ tx(it.emphasis) }}</div>
      </li>
    </ul>
    <div class="foot">{{ t('check.foot') }}</div>
  </details>
</template>

<style scoped>
.check {
  background: var(--bp-panel);
  border: 1px solid var(--bp-line);
  border-radius: 14px;
  padding: 12px 18px;
}
summary {
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 6px;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
summary::before {
  content: '▸';
  color: var(--bp-muted);
  font-size: 12px;
  transition: transform 0.15s;
}
.check[open] summary::before {
  transform: rotate(90deg);
}
.title {
  font-family: var(--bp-serif);
  font-weight: 700;
  font-size: 15px;
}
.muted {
  font-size: 12px;
  color: var(--bp-muted);
}
.count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 0 8px;
  border-radius: 999px;
  color: var(--bp-medium-ink);
  background: var(--bp-medium-soft);
}
.count.all {
  color: var(--bp-ok);
  background: var(--bp-ok-soft);
}
ul {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
li {
  padding-left: 2px;
  transition: opacity 0.2s;
}
li.on {
  opacity: 0.62;
}
li.on .it-title {
  text-decoration: line-through;
  text-decoration-color: var(--bp-muted);
}
.it-title {
  font-weight: 600;
  font-size: 13.5px;
}
.detail {
  margin: 2px 0 0 26px;
  font-size: 12.5px;
  color: var(--bp-ink-2);
  line-height: 1.6;
}
.emph {
  margin: 4px 0 0 26px;
  font-size: 12px;
  color: var(--bp-high);
}
.foot {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--bp-muted);
}
</style>
