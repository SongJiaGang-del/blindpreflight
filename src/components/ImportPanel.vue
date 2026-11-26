<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NProgress } from 'naive-ui'
import { SLOT_IDS, SLOT_LABEL, useSession } from '@/app/session'
import { parseUserTerms } from '@/rules/terms'
import FileSlot from './FileSlot.vue'
import PresetCard from './PresetCard.vue'

const s = useSession()
const st = s.state

const termCount = computed(() => parseUserTerms(st.termsText).length)
const ambiguousCount = computed(() => parseUserTerms(st.termsText).filter((t) => t.ambiguous).length)

const progressText = computed(() => {
  const p = st.progress
  const doc = SLOT_LABEL[p.slot]
  if (st.phase === 'reading') return `正在读取${doc}…`
  if (st.phase === 'parsing') return p.total ? `正在解析${doc}：第 ${p.done} / ${p.total} 页` : `正在打开${doc}…`
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
  main: '点击选择或拖入投稿 PDF',
  'supp-1': '可选：附录 / 补充材料 PDF',
  'supp-2': '可选：第二份补充 PDF',
}
</script>

<template>
  <section class="import" aria-labelledby="import-title">
    <div class="intro">
      <h1 id="import-title">投稿前，先查一遍匿名性</h1>
      <p>
        检查 PDF 的元数据、作者区、邮箱、机构、致谢与资助、代码 / 主页链接、第一人称自引、页眉页脚、文件名、批注和嵌入附件，
        每条发现都会定位到原页。<strong>文件只在这个浏览器标签页里处理，不会上传。</strong>
      </p>
    </div>

    <div class="grid">
      <div class="panel">
        <div class="files">
          <FileSlot
            v-for="id in SLOT_IDS"
            :key="id"
            :label="SLOT_LABEL[id]"
            :hint="HINTS[id] ?? ''"
            :file="st.files[id]"
            :disabled="s.busy.value"
            :test-id="`slot-${id}`"
            :class="{ main: id === 'main' }"
            @change="(f) => s.setFile(id, f)"
          />
        </div>
        <div class="samples">
          没有现成的文件？试试合成示例：
          <n-button text type="primary" size="small" :disabled="s.busy.value" data-testid="sample-leaky" @click="s.loadSamples('leaky')">含泄露的稿件</n-button>
          ·
          <n-button text type="primary" size="small" :disabled="s.busy.value" data-testid="sample-fixed" @click="s.loadSamples('fixed')">修复后的稿件 + 补充材料</n-button>
        </div>

        <details class="terms" :open="st.termsText.length > 0">
          <summary>
            自定义身份词 <span class="muted">（可选 · 仅本次会话 · 不写入报告）</span>
            <span v-if="termCount" class="count">{{ termCount }} 个</span>
          </summary>
          <p class="muted small">
            每行一个：作者姓名（含中英文 / 拼音）、机构简称、实验室名、项目或系统名、个人主页域名、GitHub 用户名等。工具会在全文中查找它们。
          </p>
          <n-input
            v-model:value="st.termsText"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            placeholder="例如：&#10;Zhang San&#10;张三&#10;Example Lab&#10;example-user"
            :disabled="s.busy.value"
            data-testid="terms-input"
            :input-props="{ spellcheck: false, autocomplete: 'off' }"
          />
          <div class="terms-foot">
            <n-checkbox v-model:checked="st.strictShortTerms" size="small" :disabled="s.busy.value">短词（如两字母缩写、单个汉字）也按高优先级处理</n-checkbox>
            <span v-if="ambiguousCount && !st.strictShortTerms" class="muted small">{{ ambiguousCount }} 个短词默认只作为“需核实”。</span>
          </div>
        </details>

        <n-alert v-if="st.selectionError" type="warning" :bordered="false" data-testid="selection-error">{{ st.selectionError }}</n-alert>
        <n-alert v-if="st.phase === 'error' && st.error" type="error" :bordered="false" title="未能完成检查" data-testid="scan-error">
          {{ st.error }}
        </n-alert>
        <n-alert v-if="st.phase === 'cancelled'" type="default" :bordered="false">已取消，没有保留任何中间结果。</n-alert>

        <div v-if="s.busy.value" class="progress" role="status" aria-live="polite" data-testid="scan-progress">
          <n-progress type="line" :percentage="percent" :show-indicator="false" :height="6" />
          <div class="progress-row">
            <span>{{ progressText }}</span>
            <n-button size="small" data-testid="cancel" @click="s.cancel()">取消</n-button>
          </div>
        </div>
        <div v-else class="actions">
          <n-button
            type="primary"
            size="large"
            :disabled="!st.files.main || !!st.selectionError"
            data-testid="start-scan"
            @click="s.start()"
          >
            {{ s.result.value ? '重新检查' : '开始检查' }}
          </n-button>
          <n-button v-if="s.result.value" size="large" @click="st.view = 'results'">返回结果</n-button>
          <span class="muted small">单份 ≤ 25 MB / 100 页，合计 ≤ 50 MB / 200 页</span>
        </div>
      </div>

      <aside class="panel side">
        <PresetCard :preset-id="st.presetId" :disabled="s.busy.value" @change="s.setPreset" />
      </aside>
    </div>
  </section>
</template>

<style scoped>
.import {
  max-width: 1080px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.intro h1 {
  font-family: 'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', Georgia, serif;
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px;
  letter-spacing: 0.01em;
}
.intro p {
  margin: 0 0 24px;
  color: #3d4756;
  max-width: 760px;
  line-height: 1.7;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.panel {
  background: var(--bp-panel);
  border: 1px solid var(--bp-line);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.files {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.files :deep(.main) {
  grid-column: 1 / -1;
  min-height: 116px;
}
.samples {
  font-size: 13px;
  color: var(--bp-muted);
}
.terms summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
}
.terms .count {
  margin-left: 6px;
  background: #e8eef6;
  color: var(--bp-accent);
  border-radius: 10px;
  padding: 0 8px;
  font-size: 12px;
}
.terms p {
  margin: 6px 0 8px;
}
.terms-foot {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 8px;
}
.muted {
  color: var(--bp-muted);
  font-weight: 400;
}
.small {
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.progress-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
@media (max-width: 860px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .side {
    order: -1;
  }
}
@media (max-width: 520px) {
  .files {
    grid-template-columns: 1fr;
  }
}
</style>
