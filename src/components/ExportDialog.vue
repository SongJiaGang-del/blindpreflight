<script setup lang="ts">
import { reactive, ref } from 'vue'
import { NAlert, NButton, NCheckbox, NModal, useDialog } from 'naive-ui'
import type { ScanResult } from '@/domain/types'
import { DEFAULT_REPORT_OPTIONS, buildReport, reportFilename, reportJson } from '@/report/build'
import { renderReportHtml } from '@/report/html'
import { downloadText } from '@/report/download'
import { useSession } from '@/app/session'

const props = defineProps<{ result: ScanResult }>()
const show = defineModel<boolean>('show', { required: true })
const s = useSession()
const dialog = useDialog()

const opts = reactive({ ...DEFAULT_REPORT_OPTIONS })
const busy = ref(false)

function doExport(kind: 'json' | 'html') {
  const report = buildReport(props.result, s.state.decisions, { ...opts })
  if (kind === 'json') downloadText(reportFilename(report, 'json'), reportJson(report), 'application/json')
  else downloadText(reportFilename(report, 'html'), renderReportHtml(report), 'text/html')
  show.value = false
}

function exportAs(kind: 'json' | 'html') {
  if (busy.value) return
  if (!opts.redactEvidence || !opts.hideFilenames) {
    dialog.warning({
      title: '导出包含身份信息的报告？',
      content: `你关闭了${!opts.redactEvidence ? '“证据脱敏”' : ''}${!opts.redactEvidence && !opts.hideFilenames ? '和' : ''}${!opts.hideFilenames ? '“隐藏文件名”' : ''}。报告将包含姓名、邮箱、机构、链接或文件名原文。不要把它放进投稿系统、补充材料或公开仓库。`,
      positiveText: '我了解，导出',
      negativeText: '返回',
      onPositiveClick: () => doExport(kind),
    })
    return
  }
  doExport(kind)
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="导出报告" style="width: min(560px, 94vw)" :bordered="false" data-testid="export-dialog">
    <div class="body">
      <n-alert type="warning" :bordered="false">
        报告用于你自己或合作者核对，<strong>可能包含作者身份信息</strong>。请勿把它上传到投稿系统或随补充材料提交。报告在本机生成并直接下载，不经过任何服务器。
      </n-alert>
      <n-checkbox v-model:checked="opts.redactEvidence" data-testid="opt-redact">证据脱敏（命中文字打码，只保留首字母与前后少量上下文）</n-checkbox>
      <n-checkbox v-model:checked="opts.hideFilenames" data-testid="opt-hide-names">隐藏文件名（显示为“主稿 / 补充材料 n”）</n-checkbox>
      <n-checkbox v-model:checked="opts.includeDismissed">包含已忽略的发现（总数始终保留）</n-checkbox>
      <div class="muted">报告不包含 PDF 内容、全文或你输入的自定义词，只包含发现摘要、覆盖范围与复核状态。</div>
    </div>
    <template #footer>
      <div class="foot">
        <n-button @click="show = false">取消</n-button>
        <n-button data-testid="export-json" @click="exportAs('json')">下载 JSON</n-button>
        <n-button type="primary" data-testid="export-html" @click="exportAs('html')">下载可打印 HTML</n-button>
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
