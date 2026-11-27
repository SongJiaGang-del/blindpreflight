<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NProgress, NRadioButton, NRadioGroup } from 'naive-ui'
import { SLOT_IDS, SLOT_LABEL, useSession } from '@/app/session'
import { parseUserTerms } from '@/rules/terms'
import { RULES } from '@/rules/engine'
import { PRESETS, getPreset } from '@/presets'
import FileSlot from './FileSlot.vue'
import PresetCard from './PresetCard.vue'

const s = useSession()
const st = s.state

const termCount = computed(() => parseUserTerms(st.termsText).length)
const ambiguousCount = computed(() => parseUserTerms(st.termsText).filter((t) => t.ambiguous).length)
const presetName = computed(() => {
  const p = getPreset(st.presetId)
  return `${p.venue}${p.year ? ` ${p.year}` : ''}`
})
const suppCount = computed(() => (st.files['supp-1'] ? 1 : 0) + (st.files['supp-2'] ? 1 : 0))

const steps = computed(() => [
  {
    n: 1,
    title: '放入稿件',
    done: !!st.files.main,
    note: st.files.main ? `主稿${suppCount.value ? ` + ${suppCount.value} 份补充` : ''}${st.sourceFile ? ' + 源文件' : ''}` : '待选择',
    target: 'step-files',
  },
  { n: 2, title: '选择会场', done: true, note: presetName.value, target: 'step-venue' },
  {
    n: 3,
    title: '填写身份词',
    done: termCount.value > 0,
    note: termCount.value ? `${termCount.value} 个` : '推荐填写',
    target: 'step-terms',
  },
])

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const progressText = computed(() => {
  const p = st.progress
  const doc = SLOT_LABEL[p.slot]
  if (st.phase === 'reading') return `正在读取${doc}…`
  if (st.phase === 'parsing') return p.total ? `正在解析${doc}：第 ${p.done} / ${p.total} 页` : `正在打开${doc}…`
  if (st.phase === 'source') return '正在读取源文件包…'
  if (st.phase === 'ocr') return p.total ? `正在本地 OCR 识别${doc}：第 ${p.done} / ${p.total} 页` : '正在加载本地 OCR 组件…'
  if (st.phase === 'scanning') return '正在运行检查规则…'
  return ''
})
const percent = computed(() => {
  const p = st.progress
  if (st.phase === 'scanning') return 99
  if (!p.docCount) return 0
  const per = p.total ? p.done / p.total : 0
  return Math.min(98, Math.round(((p.docIndex + per) / p.docCount) * 100))
})
const HINTS: Record<string, string> = {
  main: '点击选择，或把投稿 PDF（以及源文件 zip）拖到页面任意位置',
  'supp-1': '可选：附录 / 补充材料',
  'supp-2': '可选：第二份补充材料',
}

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
        <div class="eyebrow">Pre-submission anonymity check</div>
        <h1 id="import-title">投稿前，先查一遍匿名性</h1>
        <p>
          检查 PDF 的元数据、作者区、邮箱、机构、致谢与资助、代码 / 主页链接、第一人称自引、页眉页脚、文件名、批注和嵌入附件，每条发现都会定位到原页。
          <strong>文件只在这个浏览器标签页里处理，不会上传。</strong>
        </p>
      </div>
      <dl class="stats" aria-label="工具概况">
        <div><dt>{{ RULES.length }}</dt><dd>项检查规则</dd></div>
        <div><dt>{{ PRESETS.length }}</dt><dd>个会场预设</dd></div>
        <div><dt>0</dt><dd>次网络上传</dd></div>
      </dl>
    </div>

    <ol class="steps" aria-label="检查步骤">
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
        <h2><span class="badge">1</span>放入稿件</h2>
        <div class="samples">
          没有现成的文件？
          <n-button size="tiny" secondary :disabled="s.busy.value" data-testid="sample-leaky" @click="s.loadSamples('leaky')">试用：含泄露的稿件</n-button>
          <n-button size="tiny" secondary :disabled="s.busy.value" data-testid="sample-fixed" @click="s.loadSamples('fixed')">试用：修复后 + 补充材料</n-button>
        </div>
      </header>
      <div class="files">
        <FileSlot
          v-for="id in SLOT_IDS"
          :key="id"
          :label="SLOT_LABEL[id]"
          :hint="HINTS[id] ?? ''"
          :file="st.files[id]"
          :disabled="s.busy.value"
          :test-id="`slot-${id}`"
          :large="id === 'main'"
          :class="{ main: id === 'main' }"
          @change="(f) => s.setFile(id, f)"
        />
        <FileSlot
          label="源文件包（可选）"
          hint="LaTeX 工程或代码的 .zip，或单个 .tex"
          sub="检查注释、\author、.git、编译日志、图片元数据 · ≤ 50 MB"
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
          对扫描页 / 图片页做本地 OCR
        </n-checkbox>
        <n-radio-group v-if="st.ocr" size="small" :value="st.ocrLang" :disabled="s.busy.value" @update:value="(v: 'eng' | 'eng+chi_sim') => s.setOcr(true, v)">
          <n-radio-button value="eng">英文</n-radio-button>
          <n-radio-button value="eng+chi_sim">中文 + 英文</n-radio-button>
        </n-radio-group>
        <span class="muted small">只识别文字缺失或乱码的页面，在本机完成；首次使用需加载约 {{ st.ocrLang === 'eng' ? 6 : 8 }} MB 识别组件，每页需要几秒。</span>
      </div>
    </div>

    <div class="two">
      <div id="step-venue" class="card">
        <header class="card-head">
          <h2><span class="badge">2</span>选择会场</h2>
        </header>
        <PresetCard :preset-id="st.presetId" :disabled="s.busy.value" @change="s.setPreset" />
      </div>

      <div id="step-terms" class="card terms">
        <header class="card-head">
          <h2><span class="badge">3</span>填写身份词 <span class="opt">推荐</span></h2>
          <span v-if="termCount" class="count">{{ termCount }} 个</span>
        </header>
        <p class="muted small">
          每行一个：作者姓名（含中英文 / 拼音）、机构简称、实验室名、项目或系统名、个人主页域名、GitHub 用户名等。工具不知道作者是谁，填了才能在全文中查找。
          <b>仅本次会话有效，不写入报告。</b>
        </p>
        <n-input
          v-model:value="st.termsText"
          type="textarea"
          :autosize="{ minRows: 4, maxRows: 9 }"
          placeholder="例如：&#10;Zhang San&#10;张三&#10;Example Lab&#10;example-user"
          :disabled="s.busy.value"
          data-testid="terms-input"
          :input-props="{ spellcheck: false, autocomplete: 'off' }"
        />
        <div class="terms-foot">
          <n-checkbox v-model:checked="st.strictShortTerms" size="small" :disabled="s.busy.value">短词（如两字母缩写、单个汉字）也按高优先级处理</n-checkbox>
          <span v-if="ambiguousCount && !st.strictShortTerms" class="muted small">{{ ambiguousCount }} 个短词默认只作为“需核实”。</span>
        </div>
      </div>
    </div>

    <div class="alerts">
      <n-alert v-if="st.selectionError" type="warning" :bordered="false" data-testid="selection-error">{{ st.selectionError }}</n-alert>
      <n-alert v-if="st.phase === 'error' && st.error" type="error" :bordered="false" title="未能完成检查" data-testid="scan-error">
        {{ st.error }}
      </n-alert>
      <n-alert v-if="st.phase === 'cancelled'" type="default" :bordered="false">已取消，没有保留任何中间结果。</n-alert>
    </div>

    <div class="go" :class="{ ready: !!st.files.main }">
      <div v-if="s.busy.value" class="progress" role="status" aria-live="polite" data-testid="scan-progress">
        <div class="progress-row">
          <span>{{ progressText }}</span>
          <span class="pct">{{ percent }}%</span>
        </div>
        <n-progress type="line" :percentage="percent" :show-indicator="false" :height="6" />
        <n-button size="small" data-testid="cancel" @click="s.cancel()">取消</n-button>
      </div>
      <template v-else>
        <div class="go-text">
          <b>{{ st.files.main ? '准备就绪' : '先放入主稿 PDF' }}</b>
          <span class="muted small">{{ presetName }} 预设 · {{ termCount }} 个身份词 · 单份 ≤ 25 MB / 100 页，合计 ≤ 50 MB / 200 页</span>
        </div>
        <div class="go-acts">
          <n-button v-if="s.result.value" size="large" @click="st.view = 'results'">返回结果</n-button>
          <n-button
            type="primary"
            size="large"
            class="start"
            :disabled="!st.files.main || !!st.selectionError"
            data-testid="start-scan"
            @click="s.start()"
          >
            {{ s.result.value ? '重新检查' : '开始检查' }}
          </n-button>
        </div>
      </template>
    </div>

    <ul class="promises" aria-label="隐私承诺">
      <li>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
        <div><b>不上传</b><span>PDF 只在本标签页内存中解析，关闭即清除。</span></div>
      </li>
      <li>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" /><path d="M5 5l14 14" /></svg>
        <div><b>不联网</b><span>CSP 禁止外部请求，没有云端 AI、统计或第三方字体。</span></div>
      </li>
      <li>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h4" /></svg>
        <div><b>报告默认脱敏</b><span>姓名、邮箱、机构打码，文件名隐藏。</span></div>
      </li>
    </ul>

    <Transition name="fade">
      <div v-if="dragging" class="drop-mask" aria-hidden="true">
        <div class="drop-box">
          <svg viewBox="0 0 40 48" width="54"><path d="M4 3h22l10 10v32H4z" /><path d="M26 3v10h10" /><path d="M20 37V22M14 28l6-6 6 6" /></svg>
          <b>松开以放入</b>
          <span>依次填入主稿和补充材料的空位（最多 3 份）</span>
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
