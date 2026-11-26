<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import type { Comparison, CompareTag } from '@/app/compare'
import { SEVERITY_LABEL } from '@/domain/labels'
import { ruleTitle } from '@/rules/engine'
import { getPreset } from '@/presets'
import { visibleText } from '@/utils/safe-text'

const props = defineProps<{ cmp: Comparison; docLabels: Record<string, string> }>()
const emit = defineEmits<{ filter: [tag: CompareTag | 'reopened']; dismiss: [] }>()

const when = computed(() => {
  const d = new Date(props.cmp.previousAt)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
})
const total = computed(() => props.cmp.fixed.length + props.cmp.remaining.length)
const pct = computed(() => (total.value ? Math.round((props.cmp.fixed.length / total.value) * 100) : 0))
const prevPreset = computed(() => {
  const p = getPreset(props.cmp.previousPreset)
  return `${p.venue}${p.year ? ` ${p.year}` : ''}`
})

function where(f: Comparison['fixed'][number]) {
  const doc = props.docLabels[f.documentId] ?? f.documentId
  return f.page == null ? `${doc} · 文档级` : `${doc} · 第 ${f.page} 页`
}
function hit(f: Comparison['fixed'][number]) {
  const t = f.matchInSnippet ? f.snippet.slice(f.matchInSnippet[0], f.matchInSnippet[1]) : (f.linkTarget ?? f.snippet)
  const v = visibleText(t)
  return v.length > 60 ? `${v.slice(0, 60)}…` : v
}
</script>

<template>
  <section class="cmp" aria-label="与上一版对比" data-testid="compare-panel">
    <header>
      <h3>与上一版对比 <span class="muted">· 上一版检查于 {{ when }}</span></h3>
      <n-button text size="tiny" @click="emit('dismiss')">关闭对比</n-button>
    </header>

    <div class="bar" :aria-label="`修复进度 ${pct}%`">
      <span class="seg fixed" :style="{ flexGrow: cmp.fixed.length }" />
      <span class="seg remaining" :style="{ flexGrow: cmp.remaining.length }" />
    </div>

    <div class="stats">
      <div class="stat fixed" data-testid="cmp-fixed">
        <b>{{ cmp.fixed.length }}</b><span>已修复</span>
      </div>
      <button type="button" class="stat remaining" data-testid="cmp-remaining" @click="emit('filter', 'remaining')">
        <b>{{ cmp.remaining.length }}</b><span>仍存在</span>
      </button>
      <button type="button" class="stat added" data-testid="cmp-added" @click="emit('filter', 'added')">
        <b>{{ cmp.added.length }}</b><span>新增</span>
      </button>
    </div>

    <div v-if="cmp.reopened.length" class="warn">
      你在上一版标记为“已在源文件中修改”的 {{ cmp.reopened.length }} 条，在新版本里仍然存在，已恢复为待处理。
      <n-button text size="tiny" type="primary" @click="emit('filter', 'reopened')">查看</n-button>
    </div>
    <div v-if="cmp.presetChanged" class="note">两次检查使用的会场预设不同（上一版：{{ prevPreset }}），部分差异可能来自预设而不是修改。</div>
    <div v-if="cmp.remaining.length === 0 && cmp.fixed.length === 0 && cmp.added.length > 0" class="note">
      两个版本几乎没有共同的发现——如果这不是同一篇论文的新版本，可以关闭对比。
    </div>

    <details v-if="cmp.fixed.length" class="fixed-list">
      <summary>已修复的 {{ cmp.fixed.length }} 条</summary>
      <ul>
        <li v-for="f in cmp.fixed" :key="f.id">
          <span class="sev" :class="f.severity">{{ SEVERITY_LABEL[f.severity] }}</span>
          <span class="t">{{ ruleTitle(f.ruleId) }}</span>
          <span class="w">{{ where(f) }}</span>
          <s class="h">{{ hit(f) }}</s>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.cmp {
  background: var(--bp-panel);
  border: 1px solid color-mix(in srgb, var(--bp-ok) 40%, var(--bp-line));
  border-radius: 14px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: rise 0.35s ease-out both;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h3 {
  margin: 0;
  font-family: var(--bp-serif);
  font-size: 15px;
}
.muted {
  font-family: var(--bp-sans);
  font-weight: 400;
  font-size: 12px;
  color: var(--bp-muted);
}
.bar {
  display: flex;
  height: 8px;
  gap: 2px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bp-line);
}
.seg {
  flex-basis: 0;
  transition: flex-grow 0.4s ease;
}
.seg.fixed {
  background: var(--bp-ok);
}
.seg.remaining {
  background: var(--bp-medium);
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.stat {
  border: 1px solid var(--bp-line);
  background: var(--bp-panel-2);
  border-radius: 8px;
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  text-align: left;
  font: inherit;
  color: inherit;
}
button.stat {
  cursor: pointer;
}
button.stat:hover {
  background: var(--bp-accent-soft);
}
.stat b {
  font-family: var(--bp-serif);
  font-size: 22px;
  line-height: 1.15;
}
.stat span {
  font-size: 12px;
  color: var(--bp-muted);
}
.stat.fixed b {
  color: var(--bp-ok);
}
.stat.remaining b {
  color: var(--bp-medium-ink);
}
.stat.added b {
  color: var(--bp-high);
}
.warn,
.note {
  font-size: 12.5px;
  border-radius: 8px;
  padding: 7px 12px;
}
.warn {
  color: var(--bp-high);
  background: var(--bp-high-soft);
}
.note {
  color: var(--bp-medium-ink);
  background: var(--bp-medium-soft);
}
.fixed-list summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--bp-accent);
}
.fixed-list ul {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fixed-list li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  flex-wrap: wrap;
}
.sev {
  font-size: 11px;
  font-weight: 700;
}
.sev.high {
  color: var(--bp-high);
}
.sev.medium {
  color: var(--bp-medium-ink);
}
.sev.info {
  color: var(--bp-info);
}
.t {
  font-weight: 600;
}
.w {
  color: var(--bp-muted);
}
.h {
  font-family: var(--bp-mono);
  color: var(--bp-muted);
  word-break: break-all;
}
</style>
