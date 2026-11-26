<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { NButton, NEmpty, NSelect } from 'naive-ui'
import type { Finding, FindingCategory, Severity } from '@/domain/types'
import { CATEGORY_LABEL, SEVERITY_LABEL, isDismissed } from '@/domain/labels'
import { useSession } from '@/app/session'
import FindingCard from './FindingCard.vue'

const props = defineProps<{ findings: Finding[]; docLabels: Record<string, string> }>()
const emit = defineEmits<{ select: [id: string] }>()
const s = useSession()

type ReviewFilter = 'all' | 'todo' | 'resolved' | 'dismissed'
type CompareFilter = 'all' | 'remaining' | 'added' | 'reopened'
const filter = reactive({
  compare: 'all' as CompareFilter,
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
const compareOptions = [
  { value: 'all', label: '对比：全部' },
  { value: 'remaining', label: '仍存在' },
  { value: 'added', label: '新增' },
  { value: 'reopened', label: '标记已改但仍存在' },
]
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
    if (filter.compare !== 'all') {
      if (filter.compare === 'reopened') {
        if (!s.comparison.value?.reopened.includes(f.id)) return false
      } else if (s.compareTag.value.get(f.id) !== filter.compare) return false
    }
    const st = s.statusOf(f.id)
    if (filter.review === 'todo' && (st === 'resolved' || isDismissed(st))) return false
    if (filter.review === 'resolved' && st !== 'resolved') return false
    if (filter.review === 'dismissed' && !isDismissed(st)) return false
    return true
  }),
)

// 对比关闭后，对比筛选自动失效
watch(
  () => s.comparison.value,
  (c) => {
    if (!c) filter.compare = 'all'
  },
)

const filtered = computed(() => filter.compare !== 'all' || filter.doc !== 'all' || filter.severity !== 'all' || filter.category !== 'all' || filter.review !== 'todo')

function reset() {
  filter.compare = 'all'
  filter.doc = 'all'
  filter.severity = 'all'
  filter.category = 'all'
  filter.review = 'all'
}

const cardsEl = ref<HTMLElement | null>(null)

/** 选中项变化时（键盘、原页点击）把卡片滚到可见区域 */
watch(
  () => s.state.selectedFindingId,
  async (id) => {
    if (!id) return
    await nextTick()
    const el = cardsEl.value?.querySelector<HTMLElement>(`[data-finding-id="${CSS.escape(id)}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top < 70 || r.bottom > window.innerHeight - 10) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  },
)

defineExpose({
  showSeverity(sev: Severity) {
    filter.severity = sev
    filter.category = 'all'
    filter.review = 'all'
  },
  showCompare(tag: CompareFilter) {
    reset()
    filter.compare = tag
  },
  showCategory(cat: FindingCategory) {
    filter.category = cat
    filter.severity = 'all'
    filter.review = 'todo'
  },
  /** 让被选中的发现在当前筛选下可见（例如在原页点了一个已忽略的框） */
  reveal(id: string) {
    if (visible.value.some((f) => f.id === id)) return
    reset()
  },
  visibleIds: () => visible.value.map((f) => f.id),
})
</script>

<template>
  <section class="list" aria-label="发现列表">
    <div class="filters" :class="{ five: !!s.comparison.value }">
      <n-select v-if="s.comparison.value" v-model:value="filter.compare" size="small" :options="compareOptions" aria-label="按对比结果筛选" data-testid="filter-compare" />
      <n-select v-model:value="filter.doc" size="small" :options="docOptions" aria-label="按文件筛选" />
      <n-select v-model:value="filter.severity" size="small" :options="sevOptions" aria-label="按级别筛选" data-testid="filter-severity" />
      <n-select v-model:value="filter.category" size="small" :options="catOptions" aria-label="按类别筛选" />
      <n-select v-model:value="filter.review" size="small" :options="reviewOptions" aria-label="按复核状态筛选" data-testid="filter-review" />
    </div>
    <div class="count">
      <span>显示 {{ visible.length }} / {{ findings.length }} 条</span>
      <n-button v-if="filtered" text size="tiny" type="primary" @click="reset">显示全部</n-button>
      <span class="kbd-hint"><kbd>J</kbd> <kbd>K</kbd> 切换 · <kbd>R</kbd> 已修改 · <kbd>?</kbd> 快捷键</span>
    </div>
    <div v-if="visible.length" ref="cardsEl" class="cards" data-testid="finding-list">
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
.filters.five {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.count {
  font-size: 12px;
  color: var(--bp-muted);
  display: flex;
  gap: 8px;
  align-items: center;
}
.kbd-hint {
  margin-left: auto;
  white-space: nowrap;
}
.kbd-hint kbd {
  font-size: 10px;
  padding: 0 4px;
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
  .kbd-hint {
    display: none;
  }
  .filters {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
