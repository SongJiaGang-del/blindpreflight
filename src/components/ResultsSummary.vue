<script setup lang="ts">
import { computed } from 'vue'
import type { Finding, FindingCategory, ScanResult, Severity } from '@/domain/types'
import { CAPABILITY_LABEL, CATEGORY_LABEL, COVERAGE_LABEL, SEVERITY_LABEL, isDismissed } from '@/domain/labels'
import { useSession } from '@/app/session'
import { useI18n } from '@/i18n'
import { presetName } from '@/presets'

const props = defineProps<{ result: ScanResult; docLabels: Record<string, string> }>()
const emit = defineEmits<{ severity: [sev: Severity]; category: [cat: FindingCategory]; page: [docId: string, page: number]; ocr: [] }>()
const s = useSession()
const { t, tx, locale } = useI18n()

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
  if (c.high) return { tone: 'high', stamp: t('sum.stampHigh'), text: t('sum.textHigh', { n: c.high }) }
  if (c.medium) return { tone: 'medium', stamp: t('sum.stampMedium'), text: t('sum.textMedium', { n: c.medium }) }
  return { tone: 'ok', stamp: t('sum.stampOk'), text: t('sum.textOk') }
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
  const rows = [...m.entries()].map(([cat, r]) => ({ cat, label: tx(CATEGORY_LABEL[cat]), ...r, sum: r.high + r.medium + r.info }))
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
      doc: c.documentId ? (props.docLabels[c.documentId] ?? c.documentId) : t('sum.all'),
      cap: tx(CAPABILITY_LABEL[c.capability]),
      status: tx(COVERAGE_LABEL[c.status]),
      tone: c.status,
      reason: tx(c.reason),
      pages: c.pageNumbers,
    })),
)
/** 有文字缺失 / 乱码的页、但这次没有做 OCR */
const ocrSuggest = computed(() => {
  const weak = props.result.documents.reduce((n, d) => n + d.pages.filter((p) => p.textQuality !== 'ok' && !p.ocr).length, 0)
  const done = props.result.documents.some((d) => d.pages.some((p) => p.ocr))
  return weak && !done ? weak : 0
})
const disabledRules = computed(() => props.result.rules.filter((r) => r.status === 'disabled'))
const warnings = computed(() =>
  props.result.documents.flatMap((d) => d.warnings.map((w, i) => ({ key: `${d.id}-${i}`, doc: props.docLabels[d.id] ?? d.id, text: w }))),
)
</script>

<template>
  <section class="summary" :aria-label="t('sum.aria')">
    <div class="sheet">
      <div class="verdict" :class="`v-${verdict.tone}`">
        <div class="stamp" data-testid="verdict-stamp">{{ verdict.stamp }}</div>
        <div class="v-body">
          <div class="v-title">{{ t('sum.title') }}</div>
          <p :data-testid="verdict.tone === 'ok' ? 'all-clear' : undefined">{{ verdict.text }}</p>
          <div class="meta">
            {{ t('sum.meta', { preset: presetName(result.preset, locale), pdfs: result.documents.length, pages }) }}<template v-if="result.source">{{ t('sum.metaSrc', { n: result.source.fileCount }) }}</template>{{ t('sum.metaRules', { v: result.rulesetVersion }) }}<template v-if="result.userTermCount">{{ t('sum.metaTerms', { n: result.userTermCount }) }}</template>
          </div>
        </div>
      </div>

      <div class="tiles">
        <button class="tile high" type="button" data-testid="count-high" @click="emit('severity', 'high')">
          <b>{{ counts.high }}</b><span>{{ t('sev.high') }}</span>
        </button>
        <button class="tile medium" type="button" data-testid="count-medium" @click="emit('severity', 'medium')">
          <b>{{ counts.medium }}</b><span>{{ t('sev.medium') }}</span>
        </button>
        <button class="tile info" type="button" data-testid="count-info" @click="emit('severity', 'info')">
          <b>{{ counts.info }}</b><span>{{ t('sev.info') }}</span>
        </button>
        <div class="tile plain">
          <b>{{ counts.done }}</b><span>{{ t('sum.done') }}</span>
        </div>
      </div>

      <div class="progress" :aria-label="`${t('sum.progress')} ${counts.done} / ${total}`">
        <div class="p-head">
          <span>{{ t('sum.progress') }}</span>
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
        <h3>{{ t('sum.byCat') }} <span class="muted">{{ t('sum.open') }}</span></h3>
        <ul class="cats">
          <li v-for="r in byCategory" :key="r.cat">
            <button type="button" :title="t('sum.onlyCat', { label: r.label })" @click="emit('category', r.cat)">
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
        <h3>{{ t('sum.byPage') }} <span class="muted">{{ t('sum.clickPage') }}</span></h3>
        <div v-for="d in byPage" :key="d.id" class="doc-strip">
          <div class="ds-label">
            {{ d.label }}
            <span v-if="d.docLevel" class="muted">{{ t('sum.docLevel', { n: d.docLevel }) }}</span>
          </div>
          <div class="cells" role="list">
            <button
              v-for="c in d.cells"
              :key="c.page"
              type="button"
              role="listitem"
              class="cell"
              :class="c.sev ?? 'none'"
              :title="c.n ? t('sum.cellTitle', { page: c.page, n: c.n, sev: tx(SEVERITY_LABEL[c.sev!]) }) : t('sum.cellNone', { page: c.page })"
              :aria-label="t('sum.cellAria', { page: c.page, n: c.n })"
              @click="emit('page', d.id, c.page)"
            >
              <span v-if="d.cells.length <= 40">{{ c.page }}</span>
            </button>
          </div>
        </div>
        <div class="legend">
          <span><i class="cell high" />{{ t('sev.high') }}</span>
          <span><i class="cell medium" />{{ t('sev.medium') }}</span>
          <span><i class="cell info" />{{ t('sev.info') }}</span>
          <span><i class="cell none" />{{ t('sum.none') }}</span>
        </div>
      </div>
    </div>

    <div v-for="w in warnings" :key="w.key" class="warn">{{ w.doc }}: {{ tx(w.text) }}</div>

    <div v-if="ocrSuggest" class="ocr-tip" data-testid="ocr-suggest">
      {{ t('sum.ocrTip', { n: ocrSuggest }) }}
      <button type="button" class="link" :disabled="s.busy.value" @click="emit('ocr')">{{ t('sum.ocrButton') }}</button>
    </div>

    <details class="coverage" data-testid="coverage">
      <summary>{{ t('sum.coverage', { s: gaps.length ? t('sum.gaps', { n: gaps.length }) : t('sum.allCovered') }) }}</summary>
      <table>
        <tbody>
          <tr v-for="g in gaps" :key="g.key">
            <td class="nowrap">{{ g.doc }}</td>
            <td class="nowrap">{{ g.cap }}</td>
            <td class="nowrap" :class="`tone-${g.tone}`">{{ g.status }}</td>
            <td>{{ g.reason }}<template v-if="g.pages?.length">{{ t('sum.pagesNote', { pages: g.pages.slice(0, 12).join(locale === 'zh' ? '、' : ', ') + (g.pages.length > 12 ? '…' : '') }) }}</template></td>
          </tr>
        </tbody>
      </table>
      <div v-if="disabledRules.length" class="disabled">
        {{ t('sum.disabled', { list: disabledRules.map((r) => `${r.ruleId} ${tx(r.title)}`).join(locale === 'zh' ? '、' : ', ') }) }}
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
.ocr-tip {
  font-size: 13px;
  background: var(--bp-info-soft);
  color: var(--bp-ink-2);
  border-radius: 8px;
  padding: 8px 12px;
}
.link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--bp-accent);
  text-decoration: underline;
  cursor: pointer;
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
