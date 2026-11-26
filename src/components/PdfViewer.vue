<script setup lang="ts">
/**
 * 原页预览：canvas 渲染 + 高亮框叠加 + 缩略图导航。
 * - 只渲染当前页；切换时取消上一次渲染。
 * - BBox 为 PDF 用户空间（左下原点），经 viewport.convertToViewportPoint 转为屏幕坐标。
 * - 当前页上其他发现以淡色框显示，点击可跳到对应发现（原页 → 发现）。
 * - 缩略图按需（进入可视区域时）串行渲染，切换文件即作废。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { NButton, NButtonGroup, NInputNumber, NSelect, NTooltip } from 'naive-ui'
import type { PageViewport, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { BBox, Finding, Severity } from '@/domain/types'
import { isDismissed } from '@/domain/labels'
import { ruleTitle } from '@/rules/engine'
import { useSession } from '@/app/session'

const props = defineProps<{ finding: Finding | null; findings: Finding[]; docLabels: Record<string, string> }>()
const emit = defineEmits<{ select: [id: string] }>()
const s = useSession()

const docId = ref('main')
const pageNo = ref(1)
const zoom = ref(1) // 相对“适应宽度”
const rotation = ref(0)
const occIndex = ref(0)
const pageCount = ref(0)
const rendering = ref(false)
const renderError = ref<string | null>(null)
const showThumbs = ref(typeof window !== 'undefined' ? window.innerWidth > 1100 : true)
/** 每次选中发现自增，用来重放高亮动画 */
const flash = ref(0)

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const viewport = shallowRef<PageViewport | null>(null)
const size = ref({ w: 0, h: 0 })
let task: RenderTask | null = null
let seq = 0
let resizeObs: ResizeObserver | null = null
/** 从原页点击某个框时，记住那一处，选中后停留在这一页而不是跳回第一处 */
let pendingPick: { docId: string; page: number } | null = null

const docOptions = computed(() => Object.entries(props.docLabels).map(([value, label]) => ({ value, label })))

const occurrences = computed(() => (props.finding ? props.finding.occurrences.filter((o) => o.page != null) : []))
const currentOcc = computed(() => occurrences.value[occIndex.value] ?? null)
const highlight = computed<BBox[]>(() => {
  const o = currentOcc.value
  if (!o || !props.finding || props.finding.documentId !== docId.value || o.page !== pageNo.value) return []
  return o.bboxes ?? []
})
const noBoxNote = computed(() => {
  const f = props.finding
  if (!f) return null
  if (f.page == null) return '这是文档级发现（元数据、文件名、附件、旧版本或未被页面引用的图片），没有页面位置。'
  if (currentOcc.value && !currentOcc.value.bboxes?.length && currentOcc.value.page === pageNo.value) return '该发现没有精确坐标，请在整页中查找。'
  if (f.bboxApproximate && highlight.value.length) return '高亮框按字符宽度估算，可能略有偏移。'
  return null
})

function isOpen(f: Finding) {
  const st = s.statusOf(f.id)
  return st !== 'resolved' && !isDismissed(st)
}

type Rect = { left: number; top: number; width: number; height: number }
function toRect(b: BBox, vp: PageViewport, pad = 2): Rect {
  const [x1, y1] = vp.convertToViewportPoint(b.x, b.y) as [number, number]
  const [x2, y2] = vp.convertToViewportPoint(b.x + b.width, b.y + b.height) as [number, number]
  return {
    left: Math.min(x1, x2) - pad,
    top: Math.min(y1, y2) - pad,
    width: Math.abs(x2 - x1) + pad * 2,
    height: Math.abs(y2 - y1) + pad * 2,
  }
}

const boxes = computed<Rect[]>(() => {
  const vp = viewport.value
  return vp ? highlight.value.map((b) => toRect(b, vp)) : []
})

/** 当前页上的其他发现（淡色、可点击） */
const others = computed(() => {
  const vp = viewport.value
  if (!vp) return []
  const out: Array<Rect & { key: string; id: string; sev: Severity; open: boolean; title: string }> = []
  for (const f of props.findings) {
    if (f.documentId !== docId.value) continue
    f.occurrences.forEach((o, oi) => {
      if (o.page !== pageNo.value || !o.bboxes?.length) return
      if (props.finding?.id === f.id && currentOcc.value === o) return
      const open = isOpen(f)
      o.bboxes.forEach((b, bi) =>
        out.push({ ...toRect(b, vp, 1), key: `${f.id}-${oi}-${bi}`, id: f.id, sev: f.severity, open, title: ruleTitle(f.ruleId) }),
      )
    })
  }
  return out
})

/** 聚光遮罩：整页变暗，当前高亮处挖空 */
const maskPath = computed(() => {
  const { w, h } = size.value
  if (!boxes.value.length || !w) return ''
  let d = `M0 0H${w}V${h}H0Z`
  for (const b of boxes.value) d += `M${b.left} ${b.top}v${b.height}h${b.width}v${-b.height}Z`
  return d
})

/** 每页待处理发现的最高严重度（缩略图上的小圆点） */
const pageSeverity = computed(() => {
  const rank: Record<Severity, number> = { high: 3, medium: 2, info: 1 }
  const m = new Map<number, Severity>()
  for (const f of props.findings) {
    if (f.documentId !== docId.value || !isOpen(f)) continue
    for (const o of f.occurrences) {
      if (o.page == null) continue
      const cur = m.get(o.page)
      if (!cur || rank[f.severity] > rank[cur]) m.set(o.page, f.severity)
    }
  }
  return m
})

async function render() {
  const pdf = s.getPdf(docId.value)
  const my = ++seq
  task?.cancel()
  task = null
  renderError.value = null
  if (!pdf || !canvas.value || !host.value) return
  pageCount.value = pdf.numPages
  if (pageNo.value > pdf.numPages) pageNo.value = pdf.numPages
  rendering.value = true
  let page: PDFPageProxy
  try {
    page = await pdf.getPage(pageNo.value)
  } catch {
    if (my === seq) {
      renderError.value = '页面无法渲染。'
      rendering.value = false
    }
    return
  }
  if (my !== seq) return
  const rot = (page.rotate + rotation.value) % 360
  const base = page.getViewport({ scale: 1, rotation: rot })
  const avail = Math.max(240, host.value.clientWidth - 34)
  const scale = (avail / base.width) * zoom.value
  const vp = page.getViewport({ scale, rotation: rot })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const c = canvas.value
  c.width = Math.floor(vp.width * dpr)
  c.height = Math.floor(vp.height * dpr)
  c.style.width = `${Math.floor(vp.width)}px`
  c.style.height = `${Math.floor(vp.height)}px`
  size.value = { w: Math.floor(vp.width), h: Math.floor(vp.height) }
  viewport.value = vp
  try {
    task = page.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
    await task.promise
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
    if (name !== 'RenderingCancelledException' && my === seq) renderError.value = '页面无法渲染。'
  } finally {
    if (my === seq) {
      rendering.value = false
      task = null
    }
  }
  if (my === seq) void scrollToHighlight()
}

async function scrollToHighlight() {
  if (!boxes.value.length) return
  await nextTick()
  host.value?.querySelector('.hl')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
}

function goto(p: number) {
  if (!pageCount.value) return
  pageNo.value = Math.min(Math.max(1, Math.round(p)), pageCount.value)
}

function pickOther(id: string) {
  pendingPick = { docId: docId.value, page: pageNo.value }
  emit('select', id)
}

watch(
  () => props.finding?.id,
  () => {
    const f = props.finding
    if (!f) return
    const pick = pendingPick
    pendingPick = null
    let idx = 0
    if (pick && pick.docId === f.documentId) {
      const i = occurrences.value.findIndex((o) => o.page === pick.page)
      if (i >= 0) idx = i
    }
    const prev = `${docId.value}#${pageNo.value}`
    occIndex.value = idx
    docId.value = f.documentId
    pageNo.value = occurrences.value[idx]?.page ?? f.page ?? pageNo.value
    flash.value++
    // 同一页：不重绘画布，只更新高亮
    if (prev === `${docId.value}#${pageNo.value}`) void scrollToHighlight()
  },
  // 从导入页返回结果页时组件重新挂载，已有的选中项要立即生效
  { immediate: true },
)
watch(occIndex, () => {
  const o = currentOcc.value
  if (o?.page) pageNo.value = o.page
  flash.value++
  void scrollToHighlight()
})
watch([docId, pageNo, zoom, rotation], () => void render())

/* ---------- 缩略图 ---------- */
const thumbsEl = ref<HTMLElement | null>(null)
const thumbPages = computed(() => Array.from({ length: pageCount.value }, (_, i) => i + 1))
let thumbObs: IntersectionObserver | null = null
let thumbSeq = 0
let thumbQueue: Promise<void> = Promise.resolve()
const THUMB_W = 76

function renderThumb(el: HTMLCanvasElement, p: number) {
  const my = thumbSeq
  const doc = docId.value
  thumbQueue = thumbQueue.then(async () => {
    if (my !== thumbSeq || doc !== docId.value || el.dataset.done) return
    const pdf = s.getPdf(doc)
    if (!pdf) return
    try {
      const page = await pdf.getPage(p)
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: (THUMB_W * 2) / base.width })
      el.width = Math.floor(vp.width)
      el.height = Math.floor(vp.height)
      el.style.aspectRatio = `${vp.width} / ${vp.height}`
      await page.render({ canvas: el, viewport: vp }).promise
      el.dataset.done = '1'
    } catch {
      /* 缩略图失败不影响主视图 */
    }
  })
}

function observeThumbs() {
  thumbObs?.disconnect()
  thumbSeq++
  if (!thumbsEl.value || !showThumbs.value) return
  thumbObs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target as HTMLCanvasElement
        thumbObs?.unobserve(el)
        renderThumb(el, Number(el.dataset.page))
      }
    },
    { root: thumbsEl.value, rootMargin: '200px 0px' },
  )
  for (const el of thumbsEl.value.querySelectorAll<HTMLCanvasElement>('canvas[data-page]')) {
    delete el.dataset.done
    thumbObs.observe(el)
  }
}
watch([docId, pageCount, showThumbs], async () => {
  await nextTick()
  observeThumbs()
})
watch(pageNo, async (p) => {
  await nextTick()
  const el = thumbsEl.value?.querySelector<HTMLElement>(`[data-thumb="${p}"]`)
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

/* ---------- 供父组件（快捷键）调用 ---------- */
defineExpose({
  /** 跳到某页；如果当前发现在这一页也出现，切到那一处 */
  show(d: string, p: number) {
    if (props.docLabels[d] == null) return
    docId.value = d
    pageNo.value = p
    if (props.finding?.documentId === d) {
      const i = occurrences.value.findIndex((o) => o.page === p)
      if (i >= 0) occIndex.value = i
    }
  },
  /** 即将选中另一条发现时调用：选中后停在这一页，而不是跳回它的第一处 */
  willSelectAt(d: string, p: number) {
    pendingPick = { docId: d, page: p }
  },
  prevPage: () => goto(pageNo.value - 1),
  nextPage: () => goto(pageNo.value + 1),
  zoomIn: () => (zoom.value = Math.min(3, +(zoom.value + 0.25).toFixed(2))),
  zoomOut: () => (zoom.value = Math.max(0.5, +(zoom.value - 0.25).toFixed(2))),
  zoomReset: () => (zoom.value = 1),
  prevOcc: () => {
    if (occIndex.value > 0) occIndex.value--
  },
  nextOcc: () => {
    if (occIndex.value < occurrences.value.length - 1) occIndex.value++
  },
})

onMounted(() => {
  void render()
  let last = host.value?.clientWidth ?? 0
  let raf = 0
  resizeObs = new ResizeObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const w = host.value?.clientWidth ?? 0
      if (Math.abs(w - last) > 24) {
        last = w
        void render()
      }
    })
  })
  if (host.value) resizeObs.observe(host.value)
})
onBeforeUnmount(() => {
  seq++
  thumbSeq++
  task?.cancel()
  resizeObs?.disconnect()
  thumbObs?.disconnect()
})
</script>

<template>
  <section class="viewer" aria-label="原页预览">
    <div class="toolbar">
      <n-tooltip>
        <template #trigger>
          <n-button size="small" :type="showThumbs ? 'primary' : 'default'" :secondary="showThumbs" aria-label="显示或隐藏缩略图" @click="showThumbs = !showThumbs">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="1.5" width="4.5" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" /><rect x="1.5" y="9" width="4.5" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" /><rect x="8" y="1.5" width="6.5" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
          </n-button>
        </template>
        缩略图
      </n-tooltip>
      <n-select v-if="docOptions.length > 1" v-model:value="docId" size="small" :options="docOptions" class="doc" aria-label="选择文件" />
      <n-button-group size="small">
        <n-button :disabled="pageNo <= 1" aria-label="上一页" @click="goto(pageNo - 1)">‹</n-button>
        <n-button :disabled="pageNo >= pageCount" aria-label="下一页" @click="goto(pageNo + 1)">›</n-button>
      </n-button-group>
      <n-input-number
        size="small"
        class="page"
        :value="pageNo"
        :min="1"
        :max="pageCount || 1"
        :show-button="false"
        aria-label="页码"
        @update:value="(v: number | null) => v && goto(v)"
      >
        <template #suffix>/ {{ pageCount }}</template>
      </n-input-number>
      <n-button-group size="small">
        <n-button aria-label="缩小" :disabled="zoom <= 0.5" @click="zoom = Math.max(0.5, +(zoom - 0.25).toFixed(2))">−</n-button>
        <n-button aria-label="适应宽度" @click="zoom = 1">{{ Math.round(zoom * 100) }}%</n-button>
        <n-button aria-label="放大" :disabled="zoom >= 3" @click="zoom = Math.min(3, +(zoom + 0.25).toFixed(2))">+</n-button>
      </n-button-group>
      <n-button size="small" aria-label="旋转 90 度" @click="rotation = (rotation + 90) % 360">⟳</n-button>
      <n-button-group v-if="occurrences.length > 1" size="small" class="occ">
        <n-button :disabled="occIndex <= 0" @click="occIndex--">上一处</n-button>
        <n-button disabled>{{ occIndex + 1 }} / {{ occurrences.length }}</n-button>
        <n-button :disabled="occIndex >= occurrences.length - 1" @click="occIndex++">下一处</n-button>
      </n-button-group>
    </div>
    <div v-if="noBoxNote" class="note">{{ noBoxNote }}</div>
    <div v-if="renderError" class="note err">{{ renderError }}</div>
    <div class="body" :class="{ 'with-thumbs': showThumbs }">
      <nav v-if="showThumbs" ref="thumbsEl" class="thumbs" aria-label="页面缩略图">
        <button
          v-for="p in thumbPages"
          :key="`${docId}-${p}`"
          type="button"
          class="thumb"
          :class="{ on: p === pageNo }"
          :data-thumb="p"
          :aria-label="`第 ${p} 页`"
          :aria-current="p === pageNo ? 'page' : undefined"
          @click="goto(p)"
        >
          <canvas :data-page="p" />
          <span class="t-no">{{ p }}</span>
          <span v-if="pageSeverity.get(p)" class="t-dot" :class="pageSeverity.get(p)" />
        </button>
      </nav>
      <div ref="host" class="stage" :class="{ busy: rendering }">
        <div class="page-wrap" :style="{ width: `${size.w}px`, height: `${size.h}px` }">
          <canvas ref="canvas" data-testid="pdf-canvas" />
          <button
            v-for="o in others"
            :key="o.key"
            type="button"
            class="other"
            :class="[o.sev, { closed: !o.open }]"
            :style="{ left: `${o.left}px`, top: `${o.top}px`, width: `${o.width}px`, height: `${o.height}px` }"
            :title="`${o.title}（点击查看）`"
            :aria-label="`查看发现：${o.title}`"
            data-testid="pdf-other"
            @click="pickOther(o.id)"
          />
          <svg v-if="maskPath" :key="`m${flash}`" class="spot" :width="size.w" :height="size.h" aria-hidden="true">
            <path :d="maskPath" fill-rule="evenodd" />
          </svg>
          <div
            v-for="(b, i) in boxes"
            :key="`${flash}-${i}`"
            class="hl"
            :style="{ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` }"
            data-testid="pdf-highlight"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.doc {
  width: 140px;
}
.page {
  width: 96px;
}
.note {
  font-size: 12px;
  color: var(--bp-medium-ink);
  background: var(--bp-medium-soft);
  border-radius: 6px;
  padding: 5px 10px;
}
.note.err {
  color: var(--bp-high);
  background: var(--bp-high-soft);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
}
.thumbs {
  flex: none;
  width: 104px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 8px;
  background: var(--bp-panel-2);
  border: 1px solid var(--bp-line);
  border-radius: 10px;
  scrollbar-width: thin;
}
.thumb {
  position: relative;
  flex: none;
  width: 100%;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.thumb canvas {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1.3;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  border-radius: 2px;
}
.thumb:hover {
  transform: translateY(-1px);
}
.thumb.on {
  border-color: var(--bp-accent);
}
.t-no {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  padding: 0 5px;
  border-radius: 6px;
  background: rgba(20, 22, 28, 0.62);
  color: #fff;
}
.t-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #fff;
}
.t-dot.high {
  background: var(--bp-high);
}
.t-dot.medium {
  background: var(--bp-medium);
}
.t-dot.info {
  background: var(--bp-info);
}
.stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  /* 滚动条出现 / 消失不改变可用宽度，避免“重绘 → 滚动条变化 → 再重绘”的循环 */
  scrollbar-gutter: stable;
  background: var(--bp-stage);
  border-radius: 10px;
  padding: 14px;
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.08);
}
.stage.busy canvas {
  opacity: 0.85;
}
.page-wrap {
  position: relative;
  /* 页面外的框（如旋转的侧边戳）不撑出滚动区域 */
  overflow: clip;
  overflow-clip-margin: 14px;
  margin: 0 auto;
  box-shadow: 0 2px 10px rgba(20, 30, 50, 0.22);
  background: #fff;
}
canvas {
  display: block;
}
.other {
  position: absolute;
  padding: 0;
  border: 1px dashed var(--c);
  background: color-mix(in srgb, var(--c) 10%, transparent);
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.15s;
  --c: #3b6ea5;
}
.other.high {
  --c: #c0392b;
}
.other.medium {
  --c: #b7791f;
}
.other.closed {
  --c: #8a8a8a;
  opacity: 0.6;
}
.other:hover,
.other:focus-visible {
  background: color-mix(in srgb, var(--c) 28%, transparent);
  border-style: solid;
  outline: none;
}
.spot {
  position: absolute;
  inset: 0;
  pointer-events: none;
  fill: rgba(15, 20, 30, 0.38);
  animation: spot 2.2s ease-out forwards;
}
@keyframes spot {
  0% {
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  60% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.hl {
  position: absolute;
  border: 2px solid #e0a100;
  background: rgba(255, 213, 0, 0.28);
  border-radius: 3px;
  pointer-events: none;
  animation:
    land 0.42s cubic-bezier(0.2, 1.2, 0.4, 1) both,
    pulse 1.4s ease-out 0.42s 2;
}
@keyframes land {
  from {
    transform: scale(2.2);
    opacity: 0;
  }
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(224, 161, 0, 0.75);
  }
  100% {
    box-shadow: 0 0 0 12px rgba(224, 161, 0, 0);
  }
}
@media (max-width: 960px) {
  .thumbs {
    width: 78px;
  }
}
</style>
