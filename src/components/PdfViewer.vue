<script setup lang="ts">
/**
 * 原页预览：canvas 渲染 + 高亮框叠加。只渲染当前页；切换时取消上一次渲染。
 * BBox 为 PDF 用户空间（左下原点），经 viewport.convertToViewportRectangle 转为屏幕坐标。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { NButton, NButtonGroup, NInputNumber, NSelect } from 'naive-ui'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { BBox, Finding } from '@/domain/types'
import { useSession } from '@/app/session'

const props = defineProps<{ finding: Finding | null; docLabels: Record<string, string> }>()
const s = useSession()

const docId = ref('main')
const pageNo = ref(1)
const zoom = ref(1) // 相对“适应宽度”
const rotation = ref(0)
const occIndex = ref(0)
const pageCount = ref(0)
const rendering = ref(false)
const renderError = ref<string | null>(null)

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const boxes = shallowRef<Array<{ left: number; top: number; width: number; height: number }>>([])
const size = ref({ w: 0, h: 0 })
let task: RenderTask | null = null
let seq = 0
let resizeObs: ResizeObserver | null = null

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
  if (f.page == null) return '这是文档级发现（元数据 / 文件名 / 附件），没有页面位置。'
  if (currentOcc.value && !currentOcc.value.bboxes?.length && currentOcc.value.page === pageNo.value) return '该发现没有精确坐标，请在整页中查找。'
  if (f.bboxApproximate && highlight.value.length) return '高亮框按字符宽度估算，可能略有偏移。'
  return null
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
  const avail = Math.max(240, host.value.clientWidth - 24)
  const scale = (avail / base.width) * zoom.value
  const viewport = page.getViewport({ scale, rotation: rot })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const c = canvas.value
  c.width = Math.floor(viewport.width * dpr)
  c.height = Math.floor(viewport.height * dpr)
  c.style.width = `${Math.floor(viewport.width)}px`
  c.style.height = `${Math.floor(viewport.height)}px`
  size.value = { w: Math.floor(viewport.width), h: Math.floor(viewport.height) }
  boxes.value = highlight.value.map((b) => {
    const [x1, y1] = viewport.convertToViewportPoint(b.x, b.y) as [number, number]
    const [x2, y2] = viewport.convertToViewportPoint(b.x + b.width, b.y + b.height) as [number, number]
    const pad = 2
    return {
      left: Math.min(x1, x2) - pad,
      top: Math.min(y1, y2) - pad,
      width: Math.abs(x2 - x1) + pad * 2,
      height: Math.abs(y2 - y1) + pad * 2,
    }
  })
  try {
    task = page.render({ canvas: c, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
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
  if (my === seq && boxes.value.length) {
    await nextTick()
    host.value?.querySelector('.hl')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

function goto(p: number) {
  if (!pageCount.value) return
  pageNo.value = Math.min(Math.max(1, Math.round(p)), pageCount.value)
}

watch(
  () => props.finding?.id,
  () => {
    const f = props.finding
    if (!f) return
    occIndex.value = 0
    docId.value = f.documentId
    const first = occurrences.value[0]
    pageNo.value = first?.page ?? f.page ?? 1
    void render()
  },
)
watch(occIndex, () => {
  const o = currentOcc.value
  if (o?.page) pageNo.value = o.page
  void render()
})
watch([docId, pageNo, zoom, rotation], () => void render())

onMounted(() => {
  void render()
  let last = host.value?.clientWidth ?? 0
  resizeObs = new ResizeObserver(() => {
    const w = host.value?.clientWidth ?? 0
    if (Math.abs(w - last) > 8) {
      last = w
      void render()
    }
  })
  if (host.value) resizeObs.observe(host.value)
})
onBeforeUnmount(() => {
  seq++
  task?.cancel()
  resizeObs?.disconnect()
})
</script>

<template>
  <section class="viewer" aria-label="原页预览">
    <div class="toolbar">
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
    <div ref="host" class="stage" :class="{ busy: rendering }">
      <div class="page-wrap" :style="{ width: `${size.w}px`, height: `${size.h}px` }">
        <canvas ref="canvas" data-testid="pdf-canvas" />
        <div
          v-for="(b, i) in boxes"
          :key="i"
          class="hl"
          :style="{ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` }"
          data-testid="pdf-highlight"
        />
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
  color: #6a5313;
  background: #fdf6e8;
  border-radius: 6px;
  padding: 5px 10px;
}
.note.err {
  color: var(--bp-high);
  background: #fcefed;
}
.stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #e9ecf1;
  border-radius: 8px;
  padding: 12px;
}
.stage.busy canvas {
  opacity: 0.85;
}
.page-wrap {
  position: relative;
  margin: 0 auto;
  box-shadow: 0 1px 4px rgba(20, 30, 50, 0.18);
  background: #fff;
}
canvas {
  display: block;
}
.hl {
  position: absolute;
  border: 2px solid #e0a100;
  background: rgba(255, 213, 0, 0.28);
  border-radius: 3px;
  pointer-events: none;
  animation: pulse 1.2s ease-out 1;
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(224, 161, 0, 0.7);
  }
  100% {
    box-shadow: 0 0 0 10px rgba(224, 161, 0, 0);
  }
}
</style>
