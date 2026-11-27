<script setup lang="ts">
import { reactive, ref } from 'vue'
import { NAlert, NButton, NCheckbox, NModal, useDialog } from 'naive-ui'
import type { ScanResult } from '@/domain/types'
import { DEFAULT_REPORT_OPTIONS, buildReport, reportFilename, reportJson } from '@/report/build'
import { renderReportHtml } from '@/report/html'
import { downloadText } from '@/report/download'
import { useSession } from '@/app/session'
import { checklistFor } from '@/app/checklist'
import { useI18n } from '@/i18n'

const props = defineProps<{ result: ScanResult }>()
const show = defineModel<boolean>('show', { required: true })
const s = useSession()
const dialog = useDialog()
const { t, locale } = useI18n()

const opts = reactive({ ...DEFAULT_REPORT_OPTIONS, includeChecklist: true })
const busy = ref(false)

function doExport(kind: 'json' | 'html') {
  const { includeChecklist, ...reportOpts } = opts
  const cmp = s.comparison.value
  const report = buildReport(props.result, s.state.decisions, { ...reportOpts, locale: locale.value }, undefined, {
    checklist: includeChecklist ? { items: checklistFor(props.result), checked: s.state.checked } : undefined,
    comparison: cmp
      ? { fixed: cmp.fixed.length, remaining: cmp.remaining.length, added: cmp.added.length, reopened: cmp.reopened.length, presetChanged: cmp.presetChanged }
      : null,
  })
  if (kind === 'json') downloadText(reportFilename(report, 'json'), reportJson(report), 'application/json')
  else downloadText(reportFilename(report, 'html'), renderReportHtml(report), 'text/html')
  show.value = false
}

function exportAs(kind: 'json' | 'html') {
  if (busy.value) return
  if (!opts.redactEvidence || !opts.hideFilenames) {
    dialog.warning({
      title: t('export.warnTitle'),
      content: t('export.warnContent', {
        what: [!opts.redactEvidence ? t('export.warnRedact') : '', !opts.hideFilenames ? t('export.warnNames') : ''].filter(Boolean).join(t('export.warnAnd')),
      }),
      positiveText: t('export.warnOk'),
      negativeText: t('export.back'),
      onPositiveClick: () => doExport(kind),
    })
    return
  }
  doExport(kind)
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" :title="t('export.title')" style="width: min(560px, 94vw)" :bordered="false" data-testid="export-dialog">
    <div class="body">
      <n-alert type="warning" :bordered="false">
        {{ t('export.alert') }}<strong>{{ t('export.alertStrong') }}</strong>{{ t('export.alertTail') }}
      </n-alert>
      <n-checkbox v-model:checked="opts.redactEvidence" data-testid="opt-redact">{{ t('export.redact') }}</n-checkbox>
      <n-checkbox v-model:checked="opts.hideFilenames" data-testid="opt-hide-names">{{ t('export.hideNames') }}</n-checkbox>
      <n-checkbox v-model:checked="opts.includeDismissed">{{ t('export.includeDismissed') }}</n-checkbox>
      <n-checkbox v-model:checked="opts.includeChecklist" data-testid="opt-checklist">{{ t('export.includeChecklist') }}</n-checkbox>
      <div class="muted">{{ t('export.note') }}</div>
      <div class="muted">{{ t('export.lang') }}</div>
    </div>
    <template #footer>
      <div class="foot">
        <n-button @click="show = false">{{ t('common.cancel') }}</n-button>
        <n-button data-testid="export-json" @click="exportAs('json')">{{ t('export.json') }}</n-button>
        <n-button type="primary" data-testid="export-html" @click="exportAs('html')">{{ t('export.html') }}</n-button>
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
.muted {
  font-size: 12px;
  color: var(--bp-muted);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
