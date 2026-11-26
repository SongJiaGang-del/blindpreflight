<script setup lang="ts">
import { computed } from 'vue'
import type { ScanResult, Severity } from '@/domain/types'
import { CAPABILITY_LABEL, COVERAGE_LABEL, isDismissed } from '@/domain/labels'
import { useSession } from '@/app/session'

const props = defineProps<{ result: ScanResult; docLabels: Record<string, string> }>()
const emit = defineEmits<{ severity: [sev: Severity] }>()
const s = useSession()

const counts = computed(() => {
  const c = { high: 0, medium: 0, info: 0, done: 0 }
  for (const f of props.result.findings) {
    const st = s.statusOf(f.id)
    if (st === 'resolved' || isDismissed(st)) c.done++
    else c[f.severity]++
  }
  return c
})

const pages = computed(() => props.result.documents.reduce((n, d) => n + d.pageCount, 0))

/** 只列出不是“已检查”的项，避免信息过载 */
const gaps = computed(() =>
  props.result.coverage
    .filter((c) => c.status !== 'completed')
    .map((c) => ({
      key: `${c.documentId ?? 'all'}-${c.capability}`,
      doc: c.documentId ? (props.docLabels[c.documentId] ?? c.documentId) : '全部',
      cap: CAPABILITY_LABEL[c.capability],
      status: COVERAGE_LABEL[c.status],
      tone: c.status,
      reason: c.reason,
      pages: c.pageNumbers,
    })),
)
const disabledRules = computed(() => props.result.rules.filter((r) => r.status === 'disabled'))
const warnings = computed(() =>
  props.result.documents.flatMap((d) => d.warnings.map((w, i) => ({ key: `${d.id}-${i}`, doc: props.docLabels[d.id] ?? d.id, text: w }))),
)
</script>

<template>
  <section class="summary" aria-label="检查摘要">
    <div class="tiles">
      <button class="tile high" type="button" data-testid="count-high" @click="emit('severity', 'high')">
        <b>{{ counts.high }}</b><span>高优先级</span>
      </button>
      <button class="tile medium" type="button" data-testid="count-medium" @click="emit('severity', 'medium')">
        <b>{{ counts.medium }}</b><span>需核实</span>
      </button>
      <button class="tile info" type="button" data-testid="count-info" @click="emit('severity', 'info')">
        <b>{{ counts.info }}</b><span>提示</span>
      </button>
      <div class="tile plain">
        <b>{{ counts.done }}</b><span>已处理</span>
      </div>
    </div>
    <div class="meta">
      {{ result.preset.venue }}{{ result.preset.year ? ` ${result.preset.year}` : '' }} 预设 · {{ result.documents.length }} 个文件 · {{ pages }} 页 ·
      规则集 {{ result.rulesetVersion }}<template v-if="result.userTermCount"> · {{ result.userTermCount }} 个自定义词</template>
    </div>
    <div v-if="counts.high === 0 && counts.medium === 0" class="clear" data-testid="all-clear">
      没有待处理的高优先级或需核实项。这不代表稿件一定合规——请看下面的未覆盖项，并对图片、扫描页和外部链接做人工复核。
    </div>

    <div v-for="w in warnings" :key="w.key" class="warn">{{ w.doc }}：{{ w.text }}</div>

    <details class="coverage" data-testid="coverage">
      <summary>覆盖范围：{{ gaps.length ? `${gaps.length} 项未完全检查` : '所有支持的项目均已检查' }}</summary>
      <table>
        <tbody>
          <tr v-for="g in gaps" :key="g.key">
            <td class="nowrap">{{ g.doc }}</td>
            <td class="nowrap">{{ g.cap }}</td>
            <td class="nowrap" :class="`tone-${g.tone}`">{{ g.status }}</td>
            <td>{{ g.reason }}<template v-if="g.pages?.length">（页：{{ g.pages.slice(0, 12).join('、') }}{{ g.pages.length > 12 ? '…' : '' }}）</template></td>
          </tr>
        </tbody>
      </table>
      <div v-if="disabledRules.length" class="disabled">
        当前预设未启用的检查：{{ disabledRules.map((r) => `${r.ruleId} ${r.title}`).join('、') }}（此检查未启用）
      </div>
    </details>
  </section>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.tile {
  border: 1px solid var(--bp-line);
  background: #fff;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  border-top: 3px solid var(--bp-line);
}
.tile.plain {
  cursor: default;
}
.tile b {
  font-size: 24px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.tile span {
  font-size: 12px;
  color: var(--bp-muted);
}
.tile.high {
  border-top-color: var(--bp-high);
}
.tile.high b {
  color: var(--bp-high);
}
.tile.medium {
  border-top-color: var(--bp-medium);
}
.tile.medium b {
  color: #9a6512;
}
.tile.info {
  border-top-color: var(--bp-info);
}
.tile.info b {
  color: var(--bp-info);
}
.tile:not(.plain):hover {
  background: #f7f9fc;
}
.meta {
  font-size: 12px;
  color: var(--bp-muted);
}
.clear {
  font-size: 13px;
  background: #eef7f0;
  color: #24593a;
  border-radius: 6px;
  padding: 8px 12px;
}
.warn {
  font-size: 13px;
  background: #fdf6e8;
  color: #7a4f0e;
  border-radius: 6px;
  padding: 8px 12px;
}
.coverage summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--bp-accent);
}
.coverage table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
  margin-top: 6px;
}
.coverage td {
  border-top: 1px solid var(--bp-line);
  padding: 5px 6px;
  vertical-align: top;
}
.nowrap {
  white-space: nowrap;
}
.tone-unsupported,
.tone-skipped {
  color: var(--bp-muted);
}
.tone-partial {
  color: #9a6512;
}
.tone-failed {
  color: var(--bp-high);
}
.disabled {
  font-size: 12px;
  color: var(--bp-muted);
  margin-top: 6px;
}
</style>
