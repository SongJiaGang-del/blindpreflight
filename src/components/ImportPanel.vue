<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NProgress, NRadioButton, NRadioGroup } from 'naive-ui'
import { SLOT_IDS, SLOT_LABEL, useSession } from '@/app/session'
import { parseUserTerms } from '@/rules/terms'
import { RULES } from '@/rules/engine'
import { PRESETS, getPreset } from '@/presets'
import FileSlot from './FileSlot.vue'
import { useI18n } from '@/i18n'
import { presetName as nameOf } from '@/presets'
import PresetCard from './PresetCard.vue'

const s = useSession()
const st = s.state
const { t, tx, locale } = useI18n()

const termCount = computed(() => parseUserTerms(st.termsText).length)
const ambiguousCount = computed(() => parseUserTerms(st.termsText).filter((t) => t.ambiguous).length)
const presetName = computed(() => {
  void s.presetList.value
  return nameOf(getPreset(st.presetId), locale.value)
})
const suppCount = computed(() => (st.files['supp-1'] ? 1 : 0) + (st.files['supp-2'] ? 1 : 0))

const steps = computed(() => [
  {
    n: 1,
    title: t('import.step.files'),
    done: !!st.files.main,
    note: st.files.main
      ? t('import.step.filesNote', {
          supp: suppCount.value ? t('import.step.supp', { n: suppCount.value }) : '',
          src: st.sourceFile ? t('import.step.src') : '',
        })
      : t('import.step.pending'),
    target: 'step-files',
  },
  { n: 2, title: t('import.step.venue'), done: true, note: presetName.value, target: 'step-venue' },
  {
    n: 3,
    title: t('import.step.terms'),
    done: termCount.value > 0,
    note: termCount.value ? t('import.step.termCount', { n: termCount.value }) : t('import.step.recommended'),
    target: 'step-terms',
  },
])

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const progressText = computed(() => {
  const p = st.progress
  const doc = locale.value === 'zh' ? tx(SLOT_LABEL[p.slot]) : tx(SLOT_LABEL[p.slot]).toLowerCase()
  if (st.phase === 'reading') return t('progress.reading', { doc })
  if (st.phase === 'parsing') return p.total ? t('progress.parsing', { doc, done: p.done, total: p.total }) : t('progress.opening', { doc })
  if (st.phase === 'source') return t('progress.source')
  if (st.phase === 'ocr') return p.total ? t('progress.ocr', { doc, done: p.done, total: p.total }) : t('progress.ocrLoad')
  if (st.phase === 'scanning') return t('progress.scanning')
  return ''
})
const percent = computed(() => {
  const p = st.progress
  if (st.phase === 'scanning') return 99
  if (!p.docCount) return 0
  const per = p.total ? p.done / p.total : 0
  return Math.min(98, Math.round(((p.docIndex + per) / p.docCount) * 100))
})
const HINTS: Record<string, string> = { main: 'import.hint.main', 'supp-1': 'import.hint.supp1', 'supp-2': 'import.hint.supp2' }

/* 整页拖放：拖着文件进入窗口时显示遮罩，松开后依次填入空槽 */
const dragging = ref(false)
let depth = 0
function hasFiles(e: DragEvent) {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}
function onEnter(e: DragEvent) {
  if (!hasFiles(e) || s.busy.value) return
  depth++
  dragging.value = true
}
function onLeave(e: DragEvent) {
  if (!hasFiles(e)) return
  depth = Math.max(0, depth - 1)
  if (!depth) dragging.value = false
}
function onOver(e: DragEvent) {
  if (hasFiles(e)) e.preventDefault()
}
function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  depth = 0
  dragging.value = false
  // 已经落在某个文件槽上：由槽自己处理
  if (e.defaultPrevented) return
  e.preventDefault()
  if (s.busy.value) return
  const files = Array.from(e.dataTransfer?.files ?? []).slice(0, 3)
  if (files.length) s.addFiles(files)
}
onMounted(() => {
  window.addEventListener('dragenter', onEnter)
  window.addEventListener('dragleave', onLeave)
  window.addEventListener('dragover', onOver)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onEnter)
  window.removeEventListener('dragleave', onLeave)
  window.removeEventListener('dragover', onOver)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <section class="import" aria-labelledby="import-title">
    <div class="hero">
      <div class="hero-text">
        <div class="eyebrow">{{ t('import.eyebrow') }}</div>
        <h1 id="import-title">{{ t('import.title') }}</h1>
        <p>
          {{ t('import.lede') }}
          <strong>{{ t('import.ledeStrong') }}</strong>
        </p>
      </div>
      <dl class="stats" :aria-label="t('import.stats')">
        <div><dt>{{ RULES.length }}</dt><dd>{{ t('import.statRules') }}</dd></div>
        <div><dt>{{ PRESETS.length }}</dt><dd>{{ t('import.statPresets') }}</dd></div>
        <div><dt>0</dt><dd>{{ t('import.statUploads') }}</dd></div>
      </dl>
    </div>

    <ol class="steps" :aria-label="t('import.steps')">
      <li v-for="step in steps" :key="step.n" :class="{ done: step.done }">
        <button type="button" @click="jump(step.target)">
          <span class="num" aria-hidden="true">
            <svg v-if="step.done" viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <template v-else>{{ step.n }}</template>
          </span>
          <span class="st">
            <span class="st-title">{{ step.title }}</span>
            <span class="st-note">{{ step.note }}</span>
          </span>
        </button>
      </li>
    </ol>

    <div id="step-files" class="card">
      <header class="card-head">
        <h2><span class="badge">1</span>{{ t('import.step.files') }}</h2>
        <div class="samples">
          {{ t('import.noFile') }}
          <n-button size="tiny" secondary :disabled="s.busy.value" data-testid="sample-leaky" @click="s.loadSamples('leaky')">{{ t('import.sampleLeaky') }}</n-button>
          <n-button size="tiny" secondary :disabled="s.busy.value" data-testid="sample-fixed" @click="s.loadSamples('fixed')">{{ t('import.sampleFixed') }}</n-button>
        </div>
      </header>
      <div class="files">
        <FileSlot
          v-for="id in SLOT_IDS"
          :key="id"
          :label="tx(SLOT_LABEL[id])"
          :hint="t(HINTS[id] ?? '')"
          :file="st.files[id]"
          :disabled="s.busy.value"
          :test-id="`slot-${id}`"
          :large="id === 'main'"
          :class="{ main: id === 'main' }"
          @change="(f) => s.setFile(id, f)"
        />
        <FileSlot
          :label="t('import.srcLabel')"
          :hint="t('import.srcHint')"
          :sub="t('import.srcSub')"
          accept=".zip,.tex,.bib,application/zip"
          :file="st.sourceFile"
          :disabled="s.busy.value"
          test-id="slot-src"
          class="src"
          @change="(f) => s.setSourceFile(f)"
        />
      </div>
      <div class="ocr">
        <n-checkbox :checked="st.ocr" :disabled="s.busy.value" data-testid="ocr-toggle" @update:checked="(v: boolean) => s.setOcr(v)">
          {{ t('import.ocr') }}
        </n-checkbox>
        <n-radio-group v-if="st.ocr" size="small" :value="st.ocrLang" :disabled="s.busy.value" @update:value="(v: 'eng' | 'eng+chi_sim') => s.setOcr(true, v)">
          <n-radio-button value="eng">{{ t('import.ocrEng') }}</n-radio-button>
          <n-radio-button value="eng+chi_sim">{{ t('import.ocrChi') }}</n-radio-button>
        </n-radio-group>
        <span class="muted small">{{ t('import.ocrNote', { mb: st.ocrLang === 'eng' ? 6 : 8 }) }}</span>
      </div>
    </div>

    <div class="two">
      <div id="step-venue" class="card">
        <header class="card-head">
          <h2><span class="badge">2</span>{{ t('import.step.venue') }}</h2>
        </header>
        <PresetCard :preset-id="st.presetId" :disabled="s.busy.value" @change="s.setPreset" />
      </div>

      <div id="step-terms" class="card terms">
        <header class="card-head">
          <h2><span class="badge">3</span>{{ t('import.step.terms') }} <span class="opt">{{ t('import.recommended') }}</span></h2>
          <span v-if="termCount" class="count">{{ t('import.step.termCount', { n: termCount }) }}</span>
        </header>
        <p class="muted small">
          {{ t('import.termsHelp') }}
          <b>{{ t('import.termsPrivate') }}</b>
        </p>
        <n-input
          v-model:value="st.termsText"
          type="textarea"
          :autosize="{ minRows: 4, maxRows: 9 }"
          :placeholder="t('import.termsPlaceholder')"
          :disabled="s.busy.value"
          data-testid="terms-input"
          :input-props="{ spellcheck: false, autocomplete: 'off' }"
        />
        <div class="terms-foot">
          <n-checkbox v-model:checked="st.strictShortTerms" size="small" :disabled="s.busy.value">{{ t('import.strict') }}</n-checkbox>
          <span v-if="ambiguousCount && !st.strictShortTerms" class="muted small">{{ t('import.ambiguous', { n: ambiguousCount }) }}</span>
        </div>
      </div>
    </div>

    <div class="alerts">
      <n-alert v-if="st.selectionError" type="warning" :bordered="false" data-testid="selection-error">{{ tx(st.selectionError) }}</n-alert>
      <n-alert v-if="st.phase === 'error' && st.error" type="error" :bordered="false" :title="t('import.failed')" data-testid="scan-error">
        {{ tx(st.error) }}
      </n-alert>
      <n-alert v-if="st.phase === 'cancelled'" type="default" :bordered="false">{{ t('import.cancelled') }}</n-alert>
    </div>

    <div class="go" :class="{ ready: !!st.files.main }">
      <div v-if="s.busy.value" class="progress" role="status" aria-live="polite" data-testid="scan-progress">
        <div class="progress-row">
          <span>{{ progressText }}</span>
          <span class="pct">{{ percent }}%</span>
        </div>
        <n-progress type="line" :percentage="percent" :show-indicator="false" :height="6" />
        <n-button size="small" data-testid="cancel" @click="s.cancel()">{{ t('common.cancel') }}</n-button>
      </div>
      <template v-else>
        <div class="go-text">
          <b>{{ st.files.main ? t('import.ready') : t('import.needMain') }}</b>
          <span class="muted small">{{ t('import.goMeta', { preset: presetName, terms: termCount }) }}</span>
        </div>
        <div class="go-acts">
          <n-button v-if="s.result.value" size="large" @click="st.view = 'results'">{{ t('import.back') }}</n-button>
          <n-button
            type="primary"
            size="large"
            class="start"
            :disabled="!st.files.main || !!st.selectionError"
            data-testid="start-scan"
            @click="s.start()"
          >
            {{ s.result.value ? t('import.rescan') : t('import.start') }}
          </n-button>
        </div>
      </template>
    </div>

    <ul class="promises" :aria-label="t('import.promises')">
      <li>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
        <div><b>{{ t('import.p1t') }}</b><span>{{ t('import.p1') }}</span></div>
      </li>
      <li>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" /><path d="M5 5l14 14" /></svg>
        <div><b>{{ t('import.p2t') }}</b><span>{{ t('import.p2') }}</span></div>
      </li>
      <li>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h4" /></svg>
        <div><b>{{ t('import.p3t') }}</b><span>{{ t('import.p3') }}</span></div>
      </li>
    </ul>

    <Transition name="fade">
      <div v-if="dragging" class="drop-mask" aria-hidden="true">
        <div class="drop-box">
          <svg viewBox="0 0 40 48" width="54"><path d="M4 3h22l10 10v32H4z" /><path d="M26 3v10h10" /><path d="M20 37V22M14 28l6-6 6 6" /></svg>
          <b>{{ t('import.drop') }}</b>
          <span>{{ t('import.dropNote') }}</span>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.import {
  max-width: 1080px;
  margin: 0 auto;
  padding: 36px 24px 56px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.hero {
  display: flex;
  gap: 32px;
  align-items: flex-end;
  justify-content: space-between;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--bp-line);
}
.eyebrow {
  font-family: var(--bp-serif);
  font-style: italic;
  font-size: 14px;
  color: var(--bp-high);
  margin-bottom: 6px;
}
.hero h1 {
  font-family: var(--bp-serif);
  font-size: 34px;
  font-weight: 700;
  margin: 0 0 10px;
  letter-spacing: 0.02em;
  line-height: 1.25;
}
.hero p {
  margin: 0;
  color: var(--bp-ink-2);
  max-width: 660px;
  line-height: 1.8;
  font-size: 14.5px;
}
.stats {
  display: flex;
  gap: 4px;
  margin: 0;
  flex: none;
}
.stats div {
  padding: 4px 16px;
  text-align: center;
}
.stats div + div {
  border-left: 1px solid var(--bp-line);
}
.stats dt {
  font-family: var(--bp-serif);
  font-size: 34px;
  font-weight: 700;
  color: var(--bp-accent);
  line-height: 1.1;
  font-variant-numeric: oldstyle-nums;
}
.stats dd {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--bp-muted);
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  counter-reset: none;
}
.steps li {
  position: relative;
}
.steps li + li::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  width: 10px;
  border-top: 1px dashed var(--bp-line-strong);
}
.steps button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--bp-line);
  border-radius: var(--bp-radius);
  background: var(--bp-panel);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.steps button:hover {
  border-color: var(--bp-line-strong);
}
.num {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-family: var(--bp-serif);
  font-weight: 700;
  font-size: 14px;
  border: 1.5px solid var(--bp-line-strong);
  color: var(--bp-muted);
  transition: all 0.2s;
}
.done .num {
  background: var(--bp-accent);
  border-color: var(--bp-accent);
  color: var(--bp-on-accent);
}
.st {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.st-title {
  font-weight: 600;
  font-size: 14px;
}
.st-note {
  font-size: 12px;
  color: var(--bp-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card {
  background: var(--bp-panel);
  border: 1px solid var(--bp-line);
  border-radius: 14px;
  padding: 18px 20px 20px;
  box-shadow: var(--bp-shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-margin-top: 72px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.card-head h2 {
  margin: 0;
  font-family: var(--bp-serif);
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}
.badge {
  font-family: var(--bp-serif);
  font-size: 13px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: var(--bp-high);
  border: 1.5px solid var(--bp-high);
}
.opt {
  font-family: var(--bp-sans);
  font-size: 11px;
  font-weight: 600;
  color: var(--bp-ok);
  background: var(--bp-ok-soft);
  border-radius: 999px;
  padding: 1px 8px;
}
.samples {
  font-size: 12px;
  color: var(--bp-muted);
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.files {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.files :deep(.main),
.files :deep(.src) {
  grid-column: 1 / -1;
}
.files :deep(.src) {
  min-height: 64px;
}
.ocr {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px dashed var(--bp-line);
}
.two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
}
.terms .count {
  background: var(--bp-accent-soft);
  color: var(--bp-accent);
  border-radius: 10px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}
.terms p {
  margin: 0;
  line-height: 1.65;
}
.terms-foot {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.muted {
  color: var(--bp-muted);
  font-weight: 400;
}
.small {
  font-size: 12px;
}
.alerts:empty {
  display: none;
}
.alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.go {
  position: sticky;
  bottom: 14px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-radius: 14px;
  border: 1px solid var(--bp-line);
  background: color-mix(in srgb, var(--bp-panel) 92%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: var(--bp-shadow-lg);
  transition: border-color 0.2s;
}
.go.ready {
  border-color: color-mix(in srgb, var(--bp-accent) 45%, var(--bp-line));
}
.go-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.go-text b {
  font-family: var(--bp-serif);
  font-size: 16px;
}
.go-acts {
  display: flex;
  gap: 10px;
  flex: none;
}
.start {
  min-width: 140px;
  font-weight: 600;
}
.progress {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 6px 14px;
  align-items: center;
}
.progress :deep(.n-progress) {
  grid-column: 1;
}
.progress > .n-button {
  grid-row: 1 / span 2;
  grid-column: 2;
}
.progress-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.pct {
  font-variant-numeric: tabular-nums;
  color: var(--bp-muted);
}

.promises {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.promises li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.promises svg {
  flex: none;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: var(--bp-ok);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.promises div {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--bp-muted);
  line-height: 1.55;
}
.promises b {
  font-size: 13px;
  color: var(--bp-ink);
}

.drop-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bp-bg) 70%, transparent);
  backdrop-filter: blur(3px);
  pointer-events: none;
}
.drop-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 56px;
  border: 2px dashed var(--bp-accent);
  border-radius: 18px;
  background: var(--bp-panel);
  box-shadow: var(--bp-shadow-lg);
  color: var(--bp-accent);
}
.drop-box svg {
  fill: var(--bp-panel);
  stroke: currentColor;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.drop-box b {
  font-family: var(--bp-serif);
  font-size: 20px;
}
.drop-box span {
  font-size: 13px;
  color: var(--bp-muted);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 860px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
  }
  .two {
    grid-template-columns: 1fr;
  }
  .promises {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 620px) {
  .hero h1 {
    font-size: 26px;
  }
  .steps {
    grid-template-columns: 1fr;
  }
  .steps li + li::before {
    display: none;
  }
  .files {
    grid-template-columns: 1fr;
  }
  .go {
    flex-direction: column;
    align-items: stretch;
  }
  .go-acts .n-button {
    flex: 1;
  }
}
</style>
