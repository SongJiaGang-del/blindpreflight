<script setup lang="ts">
import { computed } from 'vue'
import type { Finding, FindingCategory, ScanResult, Severity } from '@/domain/types'
import { CAPABILITY_LABEL, CATEGORY_LABEL, COVERAGE_LABEL, SEVERITY_LABEL, isDismissed } from '@/domain/labels'
import { useSession } from '@/app/session'

const props = defineProps<{ result: ScanResult; docLabels: Record<string, string> }>()
const emit = defineEmits<{ severity: [sev: Severity]; category: [cat: FindingCategory]; page: [docId: string, page: number] }>()
const s = useSession()

const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, info: 1 }
const SEVS: Severity[] = ['high', 'medium', 'info']

function isOpen(f: Finding) {
  const st = s.statusOf(f.id)
  return st !== 'resolved' && !isDismissed(st)
}

const open = computed(() => props.result.findings.filter(isOpen))

const counts = computed(() => {
  const c = { high: 0, medium: 0, info: 0, done: 0 }
  for (const f of props.result.findings) {
    if (isOpen(f)) c[f.severity]++
    else c.done++
  }
  return c
})
const total = computed(() => props.result.findings.length)
const donePct = computed(() => (total.value ? Math.round((counts.value.done / total.value) * 100) : 100))

/** 结论印章：只看待处理项，不打分（分数会给人“合规程度”的错觉） */
const verdict = computed(() => {
  const c = counts.value
  if (c.high) return { tone: 'high', stamp: '需修改', text: `还有 ${c.high} 处几乎可以确定会暴露身份的问题，请在源文件中修改后重新导出。` }
  if (c.medium) return { tone: 'medium', stamp: '待核实', text: `没有高优先级问题，但还有 ${c.medium} 处需要你结合上下文判断。` }
  return { tone: 'ok', stamp: '未见明显泄露', text: '没有待处理的高优先级或需核实项。这不代表稿件一定合规——请看下方未覆盖项，并人工复核图片、扫描页和外部链接。' }
})

const pages = computed(() => props.result.documents.reduce((n, d) => n + d.pageCount, 0))

/** 按类别：每类的待处理数，按严重度分段 */
const byCategory = computed(() => {
  const m = new Map<FindingCategory, Record<Severity, number>>()
  for (const f of open.value) {
    const row = m.get(f.category) ?? { high: 0, medium: 0, info: 0 }
    row[f.severity]++
    m.set(f.category, row)
  }
  const rows = [...m.entries()].map(([cat, r]) => ({ cat, label: CATEGORY_LABEL[cat], ...r, sum: r.high + r.medium + r.info }))
  rows.sort((a, b) => b.high - a.high || b.medium - a.medium || b.sum - a.sum)
  return rows
})
const maxCat = computed(() => Math.max(1, ...byCategory.value.map((r) => r.sum)))

/** 按页码：每页最严重的待处理项 */
const byPage = computed(() =>
  props.result.documents.map((d) => {
    const cells: Array<{ page: number; sev: Severity | null; n: number }> = Array.from({ length: d.pageCount }, (_, i) => ({ page: i + 1, sev: null, n: 0 }))
    let docLevel = 0
    for (const f of open.value) {
      if (f.documentId !== d.id) continue
      const ps = new Set(f.occurrences.map((o) => o.page).filter((p): p is number => p != null))
      if (!ps.size) docLevel++
      for (const p of ps) {
        const c = cells[p - 1]
        if (!c) continue
        c.n++
        if (!c.sev || SEV_RANK[f.severity] > SEV_RANK[c.sev]) c.sev = f.severity
      }
    }
    return { id: d.id, label: props.docLabels[d.id] ?? d.id, cells, docLevel }
  }),
)

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
    <div class="sheet">
      <div class="verdict" :class="`v-${verdict.tone}`">
        <div class="stamp" data-testid="verdict-stamp">{{ verdict.stamp }}</div>
        <div class="v-body">
          <div class="v-title">匿名性自检意见</div>
          <p :data-testid="verdict.tone === 'ok' ? 'all-clear' : undefined">{{ verdict.text }}</p>
          <div class="meta">
            {{ result.preset.venue }}{{ result.preset.year ? ` ${result.preset.year}` : '' }} 预设 · {{ result.documents.length }} 个文件 · {{ pages }} 页 ·
            规则集 {{ result.rulesetVersion }}<template v-if="result.userTermCount"> · {{ result.userTermCount }} 个自定义词</template>
          </div>
        </div>
      </div>

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

      <div class="progress" :aria-label="`复核进度 ${counts.done} / ${total}`">
        <div class="p-head">
          <span>复核进度</span>
          <span class="num">{{ counts.done }} / {{ total }} · {{ donePct }}%</span>
        </div>
        <div class="p-bar" aria-hidden="true">
          <span class="seg done" :style="{ flexGrow: counts.done }" />
          <span v-for="sv in SEVS" :key="sv" class="seg" :class="sv" :style="{ flexGrow: counts[sv] }" />
        </div>
      </div>
    </div>

    <div v-if="byCategory.length" class="dist">
      <div class="dist-col">
        <h3>按类别 <span class="muted">· 待处理</span></h3>
        <ul class="cats">
          <li v-for="r in byCategory" :key="r.cat">
            <button type="button" :title="`只看“${r.label}”`" @click="emit('category', r.cat)">
              <span class="c-label">{{ r.label }}</span>
              <span class="c-bar">
                <span v-for="sv in SEVS" :key="sv" class="c-seg" :class="sv" :style="{ width: `${(r[sv] / maxCat) * 100}%` }" />
              </span>
              <span class="c-n">{{ r.sum }}</span>
            </button>
          </li>
        </ul>
      </div>
      <div class="dist-col">
        <h3>按页码 <span class="muted">· 点击跳到该页</span></h3>
        <div v-for="d in byPage" :key="d.id" class="doc-strip">
          <div class="ds-label">
            {{ d.label }}
            <span v-if="d.docLevel" class="muted">· 另有 {{ d.docLevel }} 条文档级</span>
          </div>
          <div class="cells" role="list">
            <button
              v-for="c in d.cells"
              :key="c.page"
              type="button"
              role="listitem"
              class="cell"
              :class="c.sev ?? 'none'"
              :title="`第 ${c.page} 页${c.n ? `：${c.n} 条待处理（最高：${SEVERITY_LABEL[c.sev!]}）` : '：无待处理'}`"
              :aria-label="`第 ${c.page} 页，${c.n} 条待处理`"
              @click="emit('page', d.id, c.page)"
            >
              <span v-if="d.cells.length <= 40">{{ c.page }}</span>
            </button>
          </div>
        </div>
        <div class="legend">
          <span><i class="cell high" />高优先级</span>
          <span><i class="cell medium" />需核实</span>
          <span><i class="cell info" />提示</span>
          <span><i class="cell none" />无</span>
        </div>
      </div>
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
  gap: 12px;
}
.sheet {
  background: var(--bp-panel);
  border: 1px solid var(--bp-line);
  border-radius: 14px;
  box-shadow: var(--bp-shadow);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.verdict {
  display: flex;
  gap: 16px;
  align-items: center;
}
.stamp {
  --c: var(--bp-high);
  flex: none;
  min-width: 92px;
  padding: 8px 12px;
  text-align: center;
  font-family: var(--bp-serif);
  font-weight: 800;
  font-size: 19px;
  letter-spacing: 0.12em;
  color: var(--c);
  border: 2.5px solid var(--c);
  border-radius: 6px;
  outline: 1px solid var(--c);
  outline-offset: 2px;
  transform: rotate(-4deg);
  opacity: 0.9;
  animation: stamp 0.45s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
.v-medium .stamp {
  --c: var(--bp-medium);
}
.v-ok .stamp {
  --c: var(--bp-ok);
  font-size: 15px;
  letter-spacing: 0.04em;
}
@keyframes stamp {
  from {
    transform: rotate(-4deg) scale(1.6);
    opacity: 0;
  }
}
.v-body {
  min-width: 0;
}
.v-title {
  font-family: var(--bp-serif);
  font-weight: 700;
  font-size: 16px;
}
.v-body p {
  margin: 3px 0 4px;
  font-size: 13px;
  color: var(--bp-ink-2);
  line-height: 1.6;
}
.meta {
  font-size: 12px;
  color: var(--bp-muted);
}
.tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.tile {
  border: 1px solid var(--bp-line);
  background: var(--bp-panel-2);
  border-radius: 8px;
  padding: 8px 12px;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  transition: background 0.15s, transform 0.15s;
}
.tile::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--bp-line-strong);
}
.tile.plain {
  cursor: default;
}
.tile b {
  font-family: var(--bp-serif);
  font-size: 26px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.tile span {
  font-size: 12px;
  color: var(--bp-muted);
}
.tile.high::before {
  background: var(--bp-high);
}
.tile.high b {
  color: var(--bp-high);
}
.tile.medium::before {
  background: var(--bp-medium);
}
.tile.medium b {
  color: var(--bp-medium-ink);
}
.tile.info::before {
  background: var(--bp-info);
}
.tile.info b {
  color: var(--bp-info);
}
.tile.plain::before {
  background: var(--bp-ok);
}
.tile.plain b {
  color: var(--bp-ok);
}
.tile:not(.plain):hover {
  background: var(--bp-accent-soft);
  transform: translateY(-1px);
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.p-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--bp-muted);
}
.num {
  font-variant-numeric: tabular-nums;
}
.p-bar {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bp-line);
  gap: 2px;
}
.seg {
  flex-basis: 0;
  transition: flex-grow 0.35s ease;
}
.seg.done {
  background: var(--bp-ok);
}
.seg.high {
  background: var(--bp-high);
}
.seg.medium {
  background: var(--bp-medium);
}
.seg.info {
  background: var(--bp-info);
  opacity: 0.7;
}

.dist {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  background: var(--bp-panel);
  border: 1px solid var(--bp-line);
  border-radius: 14px;
  padding: 14px 18px;
}
.dist h3 {
  font-family: var(--bp-serif);
  font-size: 14px;
  margin: 0 0 8px;
}
.muted {
  color: var(--bp-muted);
  font-family: var(--bp-sans);
  font-weight: 400;
  font-size: 12px;
}
.cats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cats button {
  width: 100%;
  display: grid;
  grid-template-columns: 96px 1fr 26px;
  gap: 8px;
  align-items: center;
  background: none;
  border: none;
  padding: 3px 4px;
  border-radius: 4px;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.cats button:hover {
  background: var(--bp-accent-soft);
}
.c-label {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.c-bar {
  display: flex;
  height: 8px;
  gap: 1px;
}
.c-seg {
  border-radius: 2px;
  transition: width 0.35s ease;
}
.c-seg.high {
  background: var(--bp-high);
}
.c-seg.medium {
  background: var(--bp-medium);
}
.c-seg.info {
  background: var(--bp-info);
  opacity: 0.7;
}
.c-n {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--bp-muted);
  text-align: right;
}
.doc-strip + .doc-strip {
  margin-top: 8px;
}
.ds-label {
  font-size: 12px;
  margin-bottom: 4px;
}
.cells {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20px, 1fr));
  gap: 3px;
}
.cell {
  height: 20px;
  border-radius: 3px;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  color: var(--bp-muted);
  background: var(--bp-panel-2);
  box-shadow: inset 0 0 0 1px var(--bp-line);
  transition: transform 0.1s;
}
.cell:hover {
  transform: scale(1.15);
}
.cell.high {
  background: var(--bp-high);
  box-shadow: none;
  color: #fff;
}
.cell.medium {
  background: var(--bp-medium);
  box-shadow: none;
  color: #fff;
}
.cell.info {
  background: var(--bp-info-soft);
  box-shadow: inset 0 0 0 1px var(--bp-info);
  color: var(--bp-info);
}
.legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 11px;
  color: var(--bp-muted);
}
.legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend .cell {
  display: inline-block;
  width: 10px;
  height: 10px;
  cursor: default;
}

.warn {
  font-size: 13px;
  background: var(--bp-medium-soft);
  color: var(--bp-medium-ink);
  border-radius: 8px;
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
  color: var(--bp-medium-ink);
}
.tone-failed {
  color: var(--bp-high);
}
.disabled {
  font-size: 12px;
  color: var(--bp-muted);
  margin-top: 6px;
}
@media (max-width: 1180px) {
  .dist {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .verdict {
    flex-direction: column;
    align-items: flex-start;
  }
  .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
