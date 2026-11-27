// 生成 PWA 图标（PNG）：墨蓝圆角底 + 白色文稿 + 两行墨线 + 朱红印记。
// 纯 Node 实现（zlib + 手写 PNG 编码），不依赖图像库；输出到 public/icons/，生成后提交到仓库。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(out, { recursive: true })

const INK = [31, 58, 95]
const PAPER = [255, 253, 248]
const SEAL = [176, 56, 44]

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function inPolygon(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 单位坐标（0..1）中的图形；maskable 版本缩进到安全区内并铺满底色 */
function shade(u, v, maskable) {
  const s = maskable ? 0.78 : 1
  const o = (1 - s) / 2
  const X = (u - o) / s
  const Y = (v - o) / s
  const bg = maskable ? true : inRoundRect(u, v, 0.04, 0.04, 0.96, 0.96, 0.22)
  if (!bg) return null
  // 文稿：右上角折角
  const page = [
    [0.3, 0.2],
    [0.6, 0.2],
    [0.72, 0.32],
    [0.72, 0.8],
    [0.3, 0.8],
  ]
  const fold = [
    [0.6, 0.2],
    [0.72, 0.32],
    [0.6, 0.32],
  ]
  if (inPolygon(X, Y, fold)) return [205, 214, 226]
  if (inPolygon(X, Y, page)) {
    if (inRoundRect(X, Y, 0.37, 0.45, 0.65, 0.5, 0.025)) return INK
    if (inRoundRect(X, Y, 0.37, 0.56, 0.58, 0.61, 0.025)) return INK
    if (inRoundRect(X, Y, 0.37, 0.27, 0.5, 0.37, 0.02)) return SEAL
    return PAPER
  }
  return INK
}

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4)
  const SS = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, maskable)
          if (!c) continue
          r += c[0]
          g += c[1]
          b += c[2]
          a++
        }
      }
      const i = (y * size + x) * 4
      if (a) {
        buf[i] = Math.round(r / a)
        buf[i + 1] = Math.round(g / a)
        buf[i + 2] = Math.round(b / a)
        buf[i + 3] = Math.round((a / (SS * SS)) * 255)
      }
    }
  }
  return png(size, buf)
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(join(out, name), render(size, maskable))
  console.log(`[make-icons] ${name}`)
}
