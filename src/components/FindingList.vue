<script setup lang="ts">
import { computed, reactive } from 'vue'
import { NButton, NEmpty, NSelect } from 'naive-ui'
import type { Finding, FindingCategory, Severity } from '@/domain/types'
import { CATEGORY_LABEL, SEVERITY_LABEL, isDismissed } from '@/domain/labels'
import { useSession } from '@/app/session'
import FindingCard from './FindingCard.vue'

const props = defineProps<{ findings: Finding[]; docLabels: Record<string, string> }>()
const emit = defineEmits<{ select: [id: string] }>()
const s = useSession()

type ReviewFilter = 'all' | 'todo' | 'resolved' | 'dismissed'
const filter = reactive({
  doc: 'all' as string,
  severity: 'all' as Severity | 'all',
  category: 'all' as FindingCategory | 'all',
  review: 'todo' as ReviewFilter,
})

const docOptions = computed(() => [
  { value: 'all', label: '全部文件' },
  ...Object.entries(props.docLabels).map(([value, label]) => ({ value, label })),
])
const sevOptions = [{ value: 'all', label: '全部级别' }, ...(['high', 'medium', 'info'] as Severity[]).map((v) => ({ value: v, label: SEVERITY_LABEL[v] }))]
const catOptions = computed(() => {
  const present = new Set(props.findings.map((f) => f.category))
  return [
    { value: 'all', label: '全部类别' },
    ...(Object.keys(CATEGORY_LABEL) as FindingCategory[]).filter((c) => present.has(c)).map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
  ]
})
const reviewOptions = [
  { value: 'todo', label: '待处理' },
  { value: 'resolved', label: '已修改' },
  { value: 'dismissed', label: '已忽略' },
  { value: 'all', label: '全部状态' },
]

const visible = computed(() =>
  props.findings.filter((f) => {
    if (filter.doc !== 'all' && f.documentId !== filter.doc) return false
    if (filter.severity !== 'all' && f.severity !== filter.severity) return false
    if (filter.category !== 'all' && f.category !== filter.category) return false
    const st = s.statusOf(f.id)
    if (filter.review === 'todo' && (st === 'resolved' || isDismissed(st))) return false
    if (filter.review === 'resolved' && st !== 'resolved') return false
    if (filter.review === 'dismissed' && !isDismissed(st)) return false
    return true
  }),
)

const filtered = computed(() => filter.doc !== 'all' || filter.severity !== 'all' || filter.category !== 'all' || filter.review !== 'todo')

function reset() {
  filter.doc = 'all'
  filter.severity = 'all'
  filter.category = 'all'
  filter.review = 'all'
}

defineExpose({
  showSeverity(sev: Severity) {
    filter.severity = sev
    filter.review = 'all'
  },
})
</script>

<template>
  <section class="list" aria-label="发现列表">
    <div class="filters">
      <n-select v-model:value="filter.doc" size="small" :options="docOptions" aria-label="按文件筛选" />
      <n-select v-model:value="filter.severity" size="small" :options="sevOptions" aria-label="按级别筛选" data-testid="filter-severity" />
      <n-select v-model:value="filter.category" size="small" :options="catOptions" aria-label="按类别筛选" />
      <n-select v-model:value="filter.review" size="small" :options="reviewOptions" aria-label="按复核状态筛选" data-testid="filter-review" />
    </div>
    <div class="count">
      显示 {{ visible.length }} / {{ findings.length }} 条
      <n-button v-if="filtered" text size="tiny" type="primary" @click="reset">显示全部</n-button>
    </div>
    <div v-if="visible.length" class="cards" data-testid="finding-list">
      <FindingCard
        v-for="f in visible"
        :key="f.id"
        :finding="f"
        :doc-label="docLabels[f.documentId] ?? f.documentId"
        :selected="s.state.selectedFindingId === f.id"
        @select="emit('select', f.id)"
      />
    </div>
    <n-empty v-else :description="findings.length ? '当前筛选条件下没有发现' : '没有发现需要处理的问题'" class="empty">
      <template v-if="findings.length && filtered" #extra>
        <n-button size="small" @click="reset">清除筛选</n-button>
      </template>
    </n-empty>
  </section>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.count {
  font-size: 12px;
  color: var(--bp-muted);
  display: flex;
  gap: 8px;
  align-items: center;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.empty {
  padding: 40px 0;
}
@media (max-width: 640px) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
