<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { NAlert, NButton, NCheckbox, NModal, NRadioButton, NRadioGroup, NSpin } from 'naive-ui'
import type { Finding, FindingCategory, ScanResult } from '@/domain/types'
import { CATEGORY_LABEL } from '@/domain/labels'
import { DEFAULT_SANITIZE_OPTIONS, type SanitizeReport, cleanedFilename, sanitizePdf } from '@/clean/sanitize'
import { compareScans } from '@/app/compare'
import { downloadBytes } from '@/report/download'
import { SLOT_LABEL, type SlotId, useSession } from '@/app/session'

const props = defineProps<{ result: ScanResult }>()
const show = defineModel<boolean>('show', { required: true })
const s = useSession()

const slot = ref<SlotId>('main')
const opts = reactive({ ...DEFAULT_SANITIZE_OPTIONS })
const phase = ref<'idle' | 'working' | 'done' | 'error'>('idle')
const error = ref('')
const out = shallowRef<{ bytes: Uint8Array; report: SanitizeReport; fixed: Finding[]; remaining: Finding[] } | null>(null)

const docs = computed(() => props.result.documents.map((d) => ({ id: d.id as SlotId, label: SLOT_LABEL[d.id as SlotId] ?? d.id })))
const docFindings = computed(() => props.result.findings.filter((f) => f.documentId === slot.value))
const titleFlagged = computed(() => docFindings.value.some((f) => f.ruleIds.includes('R01') && f.field === 'Info.Title'))
const counts = computed(() => {
  const fs = docFindings.value
  return {
    meta: fs.filter((f) => f.source === 'metadata').length,
    annot: fs.filter((f) => f.source === 'annotation').length,
    attach: fs.filter((f) => f.source === 'attachment').length,
    link: fs.filter((f) => f.source === 'link').length,
    image: fs.filter((f) => f.source === 'image').length,
    revision: fs.filter((f) => f.source === 'revision').length,
  }
})

function reset() {
  phase.value = 'idle'
  out.value = null
  error.value = ''
  Object.assign(opts, DEFAULT_SANITIZE_OPTIONS, { removeTitle: titleFlagged.value })
}
watch(show, (v) => {
  if (v) {
    slot.value = 'main'
    reset()
  }
})
watch(slot, reset)

function groupByCategory(fs: Finding[]) {
  const m = new Map<FindingCategory, number>()
  for (const f of fs) m.set(f.category, (m.get(f.category) ?? 0) + 1)
  return [...m.entries()].map(([c, n]) => ({ label: CATEGORY_LABEL[c], n })).sort((a, b) => b.n - a.n)
}
const fixedGroups = computed(() => groupByCategory(out.value?.fixed ?? []))
const remainingGroups = computed(() => groupByCategory(out.value?.remaining ?? []))

async function run() {
  const file = s.state.files[slot.value]
  if (!file) {
    phase.value = 'error'
    error.value = '找不到这份文件，请回到“文件与设置”重新选择。'
    return
  }
  phase.value = 'working'
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const cleaned = await sanitizePdf(bytes, { ...opts })
    // 复检：用相同设置检查清理版，与当前结果对比
    const preview = await s.previewScan(slot.value, cleaned.bytes.slice())
    const cmp = compareScans(props.result, preview)
    out.value = { bytes: cleaned.bytes, report: cleaned.report, fixed: cmp.fixed, remaining: [...cmp.remaining.map((r) => r.next), ...cmp.added] }
    phase.value = 'done'
  } catch (err) {
    phase.value = 'error'
    error.value = err instanceof Error && /encrypt/i.test(err.message) ? '这份 PDF 已加密，无法清理。' : '清理失败：这份 PDF 的结构 pdf-lib 无法处理。可以改用源文件重新导出。'
  }
}

function download() {
  if (out.value) downloadBytes(cleanedFilename(slot.value), out.value.bytes, 'application/pdf')
}

async function useCleaned() {
  if (!out.value) return
  const file = new File([out.value.bytes as BlobPart], cleanedFilename(slot.value), { type: 'application/pdf', lastModified: Date.now() })
  show.value = false
  await s.rescanWith(slot.value, file)
}

function kb(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="生成清理版 PDF" style="width: min(620px, 94vw)" :bordered="false" data-testid="clean-dialog">
    <div class="body">
      <p class="lede">
        自动删除元数据、审阅批注和嵌入附件，再用相同设置复检一遍。<b>正文内容不会改动</b>：作者区、邮箱、致谢、自引这类问题仍要回到 LaTeX / Word 源文件里修改。
      </p>

      <n-radio-group v-if="docs.length > 1" v-model:value="slot" size="small" :disabled="phase === 'working'">
        <n-radio-button v-for="d in docs" :key="d.id" :value="d.id">{{ d.label }}</n-radio-button>
      </n-radio-group>

      <template v-if="phase !== 'done'">
        <div class="opts">
          <n-checkbox v-model:checked="opts.metadata" :disabled="phase === 'working'">
            元数据：作者、创建工具、关键词、XMP 等 <span class="hit">{{ counts.meta ? `${counts.meta} 条发现` : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.removeTitle" class="sub" :disabled="!opts.metadata || phase === 'working'">
            同时删除文档标题 <span v-if="titleFlagged" class="hit">标题本身被标记</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.annotations" :disabled="phase === 'working'">
            审阅批注：便签、高亮、手写、印章等（保留文内链接与表单域） <span class="hit">{{ counts.annot ? `${counts.annot} 条发现` : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.attachments" :disabled="phase === 'working'">
            嵌入附件 <span class="hit">{{ counts.attach ? `${counts.attach} 条发现` : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.imageMetadata" :disabled="phase === 'working'">
            图片元数据：EXIF / IPTC / XMP、GPS 位置、设备序列号 <span class="hit">{{ counts.image ? `${counts.image} 条发现` : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.externalLinks" :disabled="phase === 'working'">
            外部链接的可点击目标（文字保留，只是不能再点击） <span class="hit">{{ counts.link ? `${counts.link} 条链接发现` : '' }}</span>
          </n-checkbox>
        </div>
        <div class="muted small">
          另外会把增量保存的多个版本合并成一个<template v-if="counts.revision">（本文件有 {{ counts.revision }} 条旧版本相关发现）</template>，并删除没被引用的残留对象，保证被删掉的信息不会留在新文件的字节里。字体名无法自动改写。全部在本机完成，不经过网络。
        </div>
        <n-alert v-if="phase === 'error'" type="error" :bordered="false">{{ error }}</n-alert>
      </template>

      <template v-else-if="out">
        <div class="done" data-testid="clean-result">
          <div class="stat ok">
            <b>{{ out.fixed.length }}</b>
            <span>条发现已消除</span>
          </div>
          <div class="stat" :class="out.remaining.length ? 'left' : 'ok'">
            <b>{{ out.remaining.length }}</b>
            <span>条仍需改源文件</span>
          </div>
          <div class="stat plain">
            <b>{{ kb(out.report.bytesAfter) }}</b>
            <span>原 {{ kb(out.report.bytesBefore) }}</span>
          </div>
        </div>
        <ul class="removed">
          <li v-if="out.report.infoKeys.length">删除元数据字段：{{ out.report.infoKeys.join('、') }}</li>
          <li v-if="out.report.xmpRemoved">删除 XMP 元数据 {{ out.report.xmpRemoved }} 处</li>
          <li v-if="out.report.annotationsRemoved">删除批注 {{ out.report.annotationsRemoved }} 个（{{ Object.entries(out.report.annotationTypes).map(([k, v]) => `${k} ${v}`).join('、') }}）</li>
          <li v-if="out.report.linksRemoved">删除外部链接目标 {{ out.report.linksRemoved }} 个</li>
          <li v-if="out.report.attachmentsRemoved">删除嵌入附件 {{ out.report.attachmentsRemoved }} 个</li>
          <li v-if="out.report.imagesCleaned">去掉 {{ out.report.imagesCleaned }} 张图片的元数据</li>
          <li v-if="out.report.orphansRemoved">回收残留对象 {{ out.report.orphansRemoved }} 个</li>
        </ul>
        <div class="groups">
          <div v-if="fixedGroups.length">
            <h4>已消除</h4>
            <span v-for="g in fixedGroups" :key="g.label" class="chip ok">{{ g.label }} {{ g.n }}</span>
          </div>
          <div v-if="remainingGroups.length">
            <h4>仍需在源文件中修改</h4>
            <span v-for="g in remainingGroups" :key="g.label" class="chip left">{{ g.label }} {{ g.n }}</span>
          </div>
        </div>
        <div class="muted small">
          下载的文件名为 <code>{{ cleanedFilename(slot) }}</code>。选择“替换并重新检查”会用清理版换掉当前{{ SLOT_LABEL[slot] }}，并自动显示与上一版的对比。
        </div>
      </template>

      <div v-if="phase === 'working'" class="working"><n-spin size="small" /> 正在清理并复检…</div>
    </div>
    <template #footer>
      <div class="foot">
        <template v-if="phase === 'done'">
          <n-button @click="reset">重新设置</n-button>
          <n-button data-testid="clean-download" @click="download">下载清理版</n-button>
          <n-button type="primary" data-testid="clean-use" @click="useCleaned">替换并重新检查</n-button>
        </template>
        <template v-else>
          <n-button @click="show = false">取消</n-button>
          <n-button
            type="primary"
            data-testid="clean-run"
            :loading="phase === 'working'"
            :disabled="!opts.metadata && !opts.annotations && !opts.attachments && !opts.externalLinks && !opts.imageMetadata"
            @click="run"
          >
            生成并复检
          </n-button>
        </template>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lede {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--bp-ink-2);
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--bp-line);
  border-radius: 10px;
  background: var(--bp-panel-2);
}
.sub {
  margin-left: 24px;
}
.hit {
  font-size: 11px;
  color: var(--bp-high);
  margin-left: 4px;
}
.muted {
  color: var(--bp-muted);
}
.small {
  font-size: 12px;
  line-height: 1.6;
}
.working {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--bp-muted);
}
.done {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.stat {
  border: 1px solid var(--bp-line);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  background: var(--bp-panel-2);
}
.stat b {
  font-family: var(--bp-serif);
  font-size: 24px;
  line-height: 1.15;
}
.stat span {
  font-size: 12px;
  color: var(--bp-muted);
}
.stat.ok b {
  color: var(--bp-ok);
}
.stat.left b {
  color: var(--bp-high);
}
.stat.plain b {
  font-size: 18px;
}
.removed {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--bp-ink-2);
}
.groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.groups h4 {
  margin: 0 0 4px;
  font-family: var(--bp-serif);
  font-size: 13px;
}
.chip {
  display: inline-block;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  margin: 0 6px 4px 0;
}
.chip.ok {
  color: var(--bp-ok);
  background: var(--bp-ok-soft);
}
.chip.left {
  color: var(--bp-high);
  background: var(--bp-high-soft);
}
code {
  font-family: var(--bp-mono);
  background: var(--bp-code);
  padding: 0 4px;
  border-radius: 3px;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
