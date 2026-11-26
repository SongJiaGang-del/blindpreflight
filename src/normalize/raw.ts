import type { AnnotationFact } from '@/domain/types'

/** 抽取层交给规范化层的原始页面：只含 pdf.js 公开 API 的数据，不含 proxy 对象。 */
export interface RawTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

export interface RawPage {
  documentId: string
  pageNumber: number
  /** [x0, y0, x1, y1]，PDF 用户空间 */
  view: number[]
  rotation: number
  /** viewport(scale=1).transform：用户空间 → 显示坐标 */
  viewTransform: number[]
  viewWidth: number
  viewHeight: number
  items: RawTextItem[]
  annotations: AnnotationFact[]
  extractionStatus: 'completed' | 'failed'
  extractionError?: string
}
