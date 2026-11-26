import type { BBox, DisplayBox, ItemGeometry } from '@/domain/types'

/** PDF 仿射矩阵 [a, b, c, d, e, f]：x' = a·x + c·y + e，y' = b·x + d·y + f */
export type Matrix = [number, number, number, number, number, number]

export function applyMatrix(m: readonly number[], x: number, y: number): [number, number] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = m
  return [a * x + c * y + e, b * x + d * y + f]
}

export function boxFromPoints(points: Array<[number, number]>): DisplayBox {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const [x, y] of points) {
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
  return { left, top, right, bottom }
}

export function bboxFromPoints(points: Array<[number, number]>): BBox {
  const b = boxFromPoints(points)
  return { x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }
}

/** 由 TextItem.transform 与宽度/高度推出基线几何。 */
export function itemGeometry(transform: readonly number[], width: number, height: number): ItemGeometry {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform
  const ul = Math.hypot(a, b) || 1
  const vl = Math.hypot(c, d)
  const h = vl > 0 ? vl : height > 0 ? height : ul
  // 无竖直分量时假定「上」= 基线逆时针 90°
  const vx = vl > 0 ? c / vl : -b / ul
  const vy = vl > 0 ? d / vl : a / ul
  return { ox: e, oy: f, ux: a / ul, uy: b / ul, vx, vy, w: Math.max(0, width), h }
}

/** 基线方向上 [s0, s1]（单位：用户空间长度）范围的四个角点。下沿取 -0.22h，上沿取 0.9h。 */
export function sliceCorners(g: ItemGeometry, s0: number, s1: number): Array<[number, number]> {
  const lo = -0.22 * g.h
  const hi = 0.9 * g.h
  const pt = (s: number, t: number): [number, number] => [
    g.ox + g.ux * s + g.vx * t,
    g.oy + g.uy * s + g.vy * t,
  ]
  return [pt(s0, lo), pt(s1, lo), pt(s1, hi), pt(s0, hi)]
}

export function sliceBBox(g: ItemGeometry, fraction0: number, fraction1: number): BBox {
  const f0 = Math.max(0, Math.min(1, fraction0))
  const f1 = Math.max(f0, Math.min(1, fraction1))
  return bboxFromPoints(sliceCorners(g, g.w * f0, g.w * f1))
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width)
    y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** [x1, y1, x2, y2] → BBox（自动排序角点） */
export function rectToBBox(rect: readonly number[] | null | undefined): BBox | null {
  if (!rect || rect.length < 4) return null
  const [a, b, c, d] = rect as [number, number, number, number]
  if (![a, b, c, d].every(Number.isFinite)) return null
  const x = Math.min(a, c)
  const y = Math.min(b, d)
  return { x, y, width: Math.abs(c - a), height: Math.abs(d - b) }
}

export function bboxContains(b: BBox, x: number, y: number, tolerance = 0): boolean {
  return (
    x >= b.x - tolerance &&
    x <= b.x + b.width + tolerance &&
    y >= b.y - tolerance &&
    y <= b.y + b.height + tolerance
  )
}

/** 用户空间 BBox → 显示坐标框（viewport.transform 已含缩放与旋转） */
export function bboxToDisplay(b: BBox, viewTransform: readonly number[]): DisplayBox {
  return boxFromPoints([
    applyMatrix(viewTransform, b.x, b.y),
    applyMatrix(viewTransform, b.x + b.width, b.y),
    applyMatrix(viewTransform, b.x + b.width, b.y + b.height),
    applyMatrix(viewTransform, b.x, b.y + b.height),
  ])
}
