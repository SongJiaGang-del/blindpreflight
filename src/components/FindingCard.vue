<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import type { Finding, ReviewStatus } from '@/domain/types'
import { CATEGORY_LABEL, CONFIDENCE_LABEL, REVIEW_LABEL, REVIEW_ORDER, SEVERITY_LABEL, SOURCE_LABEL, isDismissed } from '@/domain/labels'
import { ZONE_LABEL } from '@/rules/core'
import { ruleTitle } from '@/rules/engine'
import { openExternal, safeExternalUrl, visibleText } from '@/utils/safe-text'
import { useSession } from '@/app/session'

const props = defineProps<{ finding: Finding; docLabel: string; selected: boolean }>()
const emit = defineEmits<{ select: [] }>()

const s = useSession()
const dialog = useDialog()
const message = useMessage()

const status = computed(() => s.statusOf(props.finding.id))
const cmpTag = computed(() => s.compareTag.value.get(props.finding.id) ?? null)
const reopened = computed(() => s.comparison.value?.reopened.includes(props.finding.id) ?? false)
const dismissed = computed(() => isDismissed(status.value))

const parts = computed(() => {
  const f = props.finding
  const m = f.matchInSnippet
  if (!m) return { before: visibleText(f.snippet), hit: '', after: '' }
  return {
    before: visibleText(f.snippet.slice(0, m[0])),
    hit: visibleText(f.snippet.slice(m[0], m[1])),
    after: visibleText(f.snippet.slice(m[1])),
  }
})

const pages = computed(() => [...new Set(props.finding.occurrences.map((o) => o.page).filter((p): p is number => p != null))])
const where = computed(() => {
  const f = props.finding
  const bits = [props.docLabel]
  if (f.page == null) bits.push('文档级')
  else bits.push(pages.value.length > 1 ? `第 ${pages.value.slice(0, 6).join('、')}${pages.value.length > 6 ? '…' : ''} 页` : `第 ${f.page} 页`)
  if (f.zone) bits.push(ZONE_LABEL[f.zone])
  if (f.field) bits.push(f.field)
  return bits.join(' · ')
})

const reviewOptions = REVIEW_ORDER.map((v) => ({ value: v, label: REVIEW_LABEL[v] }))
const linkUrl = computed(() => safeExternalUrl(props.finding.linkTarget))

function onStatus(v: ReviewStatus) {
  s.setDecision(props.finding.id, v)
}

function confirmOpen() {
  const url = linkUrl.value
  if (!url) return
  dialog.warning({
    title: '打开外部链接？',
    content: `将在新标签页中打开：\n${visibleText(url)}\n\n访问该网站会向对方暴露你的 IP 地址等信息；如果这是你自己的主页或仓库，访问记录可能被关联到审稿时间。BlindPreflight 本身不会访问任何链接。`,
    positiveText: '仍然打开',
    negativeText: '取消',
    style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
    onPositiveClick: () => {
      openExternal(url)
    },
  })
}

async function copyEvidence() {
  const f = props.finding
  const lines = [
    `[${f.ruleIds.join('+')}] ${SEVERITY_LABEL[f.severity]} · ${where.value}`,
    f.snippet,
    ...(f.linkTarget ? [`链接目标：${f.linkTarget}`] : []),
  ]
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    message.success('已复制到剪贴板')
  } catch {
    message.warning('无法访问剪贴板，请手动选择文本复制')
  }
}
</script>

<template>
  <article
    class="card"
    :class="[`sev-${finding.severity}`, { selected, dismissed }]"
    :data-testid="`finding-${finding.ruleId}`"
    :data-finding-id="finding.id"
    tabindex="0"
    :aria-label="`${SEVERITY_LABEL[finding.severity]}：${ruleTitle(finding.ruleId)}，${where}`"
    @click="emit('select')"
    @keydown.enter.self="emit('select')"
  >
    <header class="head">
      <span class="sev">{{ SEVERITY_LABEL[finding.severity] }}</span>
      <span class="title">{{ finding.ruleIds.map(ruleTitle).join(' · ') }}</span>
      <n-tag size="tiny" :bordered="false">{{ CATEGORY_LABEL[finding.category] }}</n-tag>
      <n-tag v-if="finding.matchedUserTerm" size="tiny" :bordered="false" type="info">命中自定义词</n-tag>
      <span v-if="cmpTag === 'added'" class="cmp added" data-testid="tag-added">新增</span>
      <span v-else-if="reopened" class="cmp reopened">标记已改，但仍存在</span>
      <span v-else-if="cmpTag === 'remaining'" class="cmp remaining">仍存在</span>
      <span class="ids">{{ finding.ruleIds.join('+') }}</span>
    </header>
    <div class="where">{{ where }} · {{ SOURCE_LABEL[finding.source] }} · 置信度{{ CONFIDENCE_LABEL[finding.confidence] }}</div>

    <blockquote class="snippet" data-testid="finding-snippet">{{ parts.before }}<mark v-if="parts.hit">{{ parts.hit }}</mark>{{ parts.after }}</blockquote>

    <div v-if="finding.linkTarget" class="link">
      <span class="muted">真实链接：</span>
      <code>{{ visibleText(finding.linkTarget) }}</code>
      <template v-if="finding.visibleText">
        <span class="muted">；页面上显示为：</span><code>{{ visibleText(finding.visibleText) }}</code>
      </template>
    </div>

    <ul class="reasons">
      <li v-for="(r, i) in finding.reasons" :key="i">{{ visibleText(r) }}</li>
    </ul>
    <div class="suggest"><strong>怎么改：</strong>{{ finding.suggestion }}</div>
    <div v-if="finding.policyRefs.length" class="refs">
      依据：<span v-for="(p, i) in finding.policyRefs" :key="i">{{ p.label }}<template v-if="p.note">（{{ p.note }}）</template><template v-if="i < finding.policyRefs.length - 1">；</template></span>
    </div>

    <footer class="foot" @click.stop>
      <n-select
        size="small"
        class="review"
        :value="status"
        :options="reviewOptions"
        :consistent-menu-width="false"
        aria-label="复核状态"
        data-testid="review-select"
        @update:value="onStatus"
      />
      <n-button size="small" quaternary @click="copyEvidence">复制证据</n-button>
      <n-button v-if="linkUrl" size="small" quaternary @click="confirmOpen">打开链接…</n-button>
    </footer>
  </article>
</template>

<style scoped>
.card {
  --sev: var(--bp-info);
  position: relative;
  background: var(--bp-panel);
  border: 1px solid var(--bp-line);
  border-radius: 10px;
  padding: 12px 14px 12px 18px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  outline: none;
  transition: box-shadow 0.15s, border-color 0.15s, transform 0.15s;
  scroll-margin: 80px 0 20px;
}
.card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--sev);
}
.card.sev-high {
  --sev: var(--bp-high);
}
.card.sev-medium {
  --sev: var(--bp-medium);
}
.card:hover {
  box-shadow: var(--bp-shadow);
}
.card:focus-visible,
.card.selected {
  border-color: var(--bp-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bp-accent) 22%, transparent), var(--bp-shadow);
}
.card.selected {
  background: color-mix(in srgb, var(--bp-accent-soft) 45%, var(--bp-panel));
}
.card.dismissed {
  opacity: 0.62;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sev {
  font-size: 12px;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 4px;
  color: var(--sev);
  background: color-mix(in srgb, var(--sev) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--sev) 35%, transparent);
}
.cmp {
  font-size: 11px;
  font-weight: 600;
  padding: 0 7px;
  border-radius: 999px;
}
.cmp.added {
  color: var(--bp-on-accent);
  background: var(--bp-high);
}
.cmp.reopened {
  color: var(--bp-high);
  background: var(--bp-high-soft);
}
.cmp.remaining {
  color: var(--bp-medium-ink);
  background: var(--bp-medium-soft);
}
.title {
  font-family: var(--bp-serif);
  font-weight: 700;
  font-size: 15px;
}
.ids {
  margin-left: auto;
  font-family: var(--bp-mono);
  font-size: 11px;
  color: var(--bp-muted);
}
.where {
  font-size: 12px;
  color: var(--bp-muted);
}
.snippet {
  margin: 2px 0;
  padding: 8px 10px;
  background: var(--bp-code);
  border-left: 2px solid var(--bp-line-strong);
  border-radius: 4px;
  font-family: var(--bp-mono);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.snippet mark {
  background: var(--bp-mark);
  color: inherit;
  padding: 0 1px;
  border-radius: 2px;
}
.link {
  font-size: 12.5px;
  word-break: break-all;
}
.link code {
  background: var(--bp-code);
  padding: 0 4px;
  border-radius: 3px;
}
.reasons {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--bp-ink-2);
}
.suggest {
  font-size: 13px;
}
.refs {
  font-size: 12px;
  color: var(--bp-muted);
}
.muted {
  color: var(--bp-muted);
}
.foot {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 4px;
  cursor: default;
}
.review {
  width: 200px;
}
</style>
