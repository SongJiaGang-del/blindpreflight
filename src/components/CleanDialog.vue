<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { NAlert, NButton, NCheckbox, NModal, NRadioButton, NRadioGroup, NSpin } from 'naive-ui'
import type { Finding, FindingCategory, ScanResult } from '@/domain/types'
import { CATEGORY_LABEL } from '@/domain/labels'
import { DEFAULT_SANITIZE_OPTIONS, type SanitizeReport, cleanedFilename, sanitizePdf } from '@/clean/sanitize'
import { compareScans } from '@/app/compare'
import { downloadBytes } from '@/report/download'
import { SLOT_LABEL, type SlotId, useSession } from '@/app/session'
import { useI18n } from '@/i18n'

const props = defineProps<{ result: ScanResult }>()
const show = defineModel<boolean>('show', { required: true })
const s = useSession()
const { t, tx, locale } = useI18n()

const slot = ref<SlotId>('main')
const opts = reactive({ ...DEFAULT_SANITIZE_OPTIONS })
const phase = ref<'idle' | 'working' | 'done' | 'error'>('idle')
const error = ref('')
const out = shallowRef<{ bytes: Uint8Array; report: SanitizeReport; fixed: Finding[]; remaining: Finding[] } | null>(null)

const docs = computed(() => props.result.documents.map((d) => ({ id: d.id as SlotId, label: SLOT_LABEL[d.id as SlotId] ? tx(SLOT_LABEL[d.id as SlotId]) : d.id })))
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
  return [...m.entries()].map(([c, n]) => ({ label: tx(CATEGORY_LABEL[c]), n })).sort((a, b) => b.n - a.n)
}
const fixedGroups = computed(() => groupByCategory(out.value?.fixed ?? []))
const remainingGroups = computed(() => groupByCategory(out.value?.remaining ?? []))

async function run() {
  const file = s.state.files[slot.value]
  if (!file) {
    phase.value = 'error'
    error.value = 'clean.noFile'
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
    error.value = err instanceof Error && /encrypt/i.test(err.message) ? 'clean.encrypted' : 'clean.failed'
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

const sep = computed(() => (locale.value === 'zh' ? '、' : ', '))

function kb(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" :title="t('clean.title')" style="width: min(620px, 94vw)" :bordered="false" data-testid="clean-dialog">
    <div class="body">
      <p class="lede">
        {{ t('clean.lede') }}<b>{{ t('clean.ledeStrong') }}</b>{{ t('clean.ledeTail') }}
      </p>

      <n-radio-group v-if="docs.length > 1" v-model:value="slot" size="small" :disabled="phase === 'working'">
        <n-radio-button v-for="d in docs" :key="d.id" :value="d.id">{{ d.label }}</n-radio-button>
      </n-radio-group>

      <template v-if="phase !== 'done'">
        <div class="opts">
          <n-checkbox v-model:checked="opts.metadata" :disabled="phase === 'working'">
            {{ t('clean.meta') }} <span class="hit">{{ counts.meta ? t('clean.hits', { n: counts.meta }) : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.removeTitle" class="sub" :disabled="!opts.metadata || phase === 'working'">
            {{ t('clean.title2') }} <span v-if="titleFlagged" class="hit">{{ t('clean.titleFlagged') }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.annotations" :disabled="phase === 'working'">
            {{ t('clean.annots') }} <span class="hit">{{ counts.annot ? t('clean.hits', { n: counts.annot }) : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.attachments" :disabled="phase === 'working'">
            {{ t('clean.attach') }} <span class="hit">{{ counts.attach ? t('clean.hits', { n: counts.attach }) : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.imageMetadata" :disabled="phase === 'working'">
            {{ t('clean.images') }} <span class="hit">{{ counts.image ? t('clean.hits', { n: counts.image }) : '' }}</span>
          </n-checkbox>
          <n-checkbox v-model:checked="opts.externalLinks" :disabled="phase === 'working'">
            {{ t('clean.links') }} <span class="hit">{{ counts.link ? t('clean.linkHits', { n: counts.link }) : '' }}</span>
          </n-checkbox>
        </div>
        <div class="muted small">
          {{ t('clean.note', { rev: counts.revision ? t('clean.noteRev', { n: counts.revision }) : '' }) }}
        </div>
        <n-alert v-if="phase === 'error'" type="error" :bordered="false">{{ t(error) }}</n-alert>
      </template>

      <template v-else-if="out">
        <div class="done" data-testid="clean-result">
          <div class="stat ok">
            <b>{{ out.fixed.length }}</b>
            <span>{{ t('clean.fixed') }}</span>
          </div>
          <div class="stat" :class="out.remaining.length ? 'left' : 'ok'">
            <b>{{ out.remaining.length }}</b>
            <span>{{ t('clean.left') }}</span>
          </div>
          <div class="stat plain">
            <b>{{ kb(out.report.bytesAfter) }}</b>
            <span>{{ t('clean.before', { size: kb(out.report.bytesBefore) }) }}</span>
          </div>
        </div>
        <ul class="removed">
          <li v-if="out.report.infoKeys.length">{{ t('clean.rInfo', { keys: out.report.infoKeys.join(sep) }) }}</li>
          <li v-if="out.report.xmpRemoved">{{ t('clean.rXmp', { n: out.report.xmpRemoved }) }}</li>
          <li v-if="out.report.annotationsRemoved">
            {{ t('clean.rAnnots', { n: out.report.annotationsRemoved, types: Object.entries(out.report.annotationTypes).map(([k, v]) => `${k} ${v}`).join(sep) }) }}
          </li>
          <li v-if="out.report.linksRemoved">{{ t('clean.rLinks', { n: out.report.linksRemoved }) }}</li>
          <li v-if="out.report.attachmentsRemoved">{{ t('clean.rAttach', { n: out.report.attachmentsRemoved }) }}</li>
          <li v-if="out.report.imagesCleaned">{{ t('clean.rImages', { n: out.report.imagesCleaned }) }}</li>
          <li v-if="out.report.orphansRemoved">{{ t('clean.rOrphans', { n: out.report.orphansRemoved }) }}</li>
        </ul>
        <div class="groups">
          <div v-if="fixedGroups.length">
            <h4>{{ t('clean.gone') }}</h4>
            <span v-for="g in fixedGroups" :key="g.label" class="chip ok">{{ g.label }} {{ g.n }}</span>
          </div>
          <div v-if="remainingGroups.length">
            <h4>{{ t('clean.stillFix') }}</h4>
            <span v-for="g in remainingGroups" :key="g.label" class="chip left">{{ g.label }} {{ g.n }}</span>
          </div>
        </div>
        <div class="muted small">
          {{ t('clean.fileNote', { name: cleanedFilename(slot), slot: locale === 'zh' ? tx(SLOT_LABEL[slot]) : tx(SLOT_LABEL[slot]).toLowerCase() }) }}
        </div>
      </template>

      <div v-if="phase === 'working'" class="working"><n-spin size="small" /> {{ t('clean.working') }}</div>
    </div>
    <template #footer>
      <div class="foot">
        <template v-if="phase === 'done'">
          <n-button @click="reset">{{ t('clean.reset') }}</n-button>
          <n-button data-testid="clean-download" @click="download">{{ t('clean.download') }}</n-button>
          <n-button type="primary" data-testid="clean-use" @click="useCleaned">{{ t('clean.use') }}</n-button>
        </template>
        <template v-else>
          <n-button @click="show = false">{{ t('common.cancel') }}</n-button>
          <n-button
            type="primary"
            data-testid="clean-run"
            :loading="phase === 'working'"
            :disabled="!opts.metadata && !opts.annotations && !opts.attachments && !opts.externalLinks && !opts.imageMetadata"
            @click="run"
          >
            {{ t('clean.run') }}
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
