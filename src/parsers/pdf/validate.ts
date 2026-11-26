import { LIMITS } from '@/domain/limits'
import { PreflightError } from '@/domain/errors'

/** 文件头 %PDF- 需出现在前 1024 字节内（PDF 规范允许前导垃圾字节）。 */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 5, 1024)
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    )
      return true
  }
  return false
}

/** 单文件校验：只看大小与文件头，不依赖扩展名或 MIME。 */
export function validatePdfBytes(bytes: Uint8Array): void {
  if (bytes.length === 0) throw new PreflightError('EMPTY_FILE')
  if (bytes.length > LIMITS.maxFileBytes) throw new PreflightError('FILE_TOO_LARGE')
  if (!hasPdfMagic(bytes)) throw new PreflightError('UNSUPPORTED_TYPE')
}

/** 选择文件时的整组校验（读取内容之前） */
export function validateSelection(sizes: { main: number | null; supplements: number[] }): void {
  if (sizes.supplements.length > LIMITS.maxSupplements) throw new PreflightError('TOO_MANY_FILES')
  const all = [sizes.main ?? 0, ...sizes.supplements]
  for (const s of all) if (s > LIMITS.maxFileBytes) throw new PreflightError('FILE_TOO_LARGE')
  if (all.reduce((a, b) => a + b, 0) > LIMITS.maxTotalBytes) throw new PreflightError('TOTAL_TOO_LARGE')
}
