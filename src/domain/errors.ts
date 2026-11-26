/** 错误码：错误信息不回显文件中的敏感片段。 */
export type ErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'TOTAL_TOO_LARGE'
  | 'PAGE_LIMIT'
  | 'TOO_MANY_FILES'
  | 'ENCRYPTED_PDF'
  | 'CORRUPT_PDF'
  | 'PARTIAL_TEXT'
  | 'WORKER_FAILED'
  | 'CANCELLED'

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNSUPPORTED_TYPE: '这不是可识别的 PDF 文件（文件头不是 %PDF-）。请导出为 PDF 后重试。',
  EMPTY_FILE: '文件为空。',
  FILE_TOO_LARGE: '单个文件超过 25 MB 上限。请拆分补充材料，或压缩图片后重新导出。',
  TOTAL_TOO_LARGE: '所有文件合计超过 50 MB 上限。',
  PAGE_LIMIT: '页数超过上限（单份 100 页，整组 200 页）。请拆分后分别检查。',
  TOO_MANY_FILES: '最多 1 份主稿 + 2 份补充 PDF。',
  ENCRYPTED_PDF:
    '该 PDF 受密码保护。本工具不收集密码：请用你信任的本地工具导出一份未加密的审稿副本再检查。',
  CORRUPT_PDF: 'PDF 结构损坏或无法解析。请从源文件重新导出。',
  PARTIAL_TEXT: '部分页面文本无法抽取，结果只覆盖已处理的页面。',
  WORKER_FAILED: 'PDF 解析线程未能启动或中途失败。请刷新页面重试；若仍失败，换用最新版 Chromium / Firefox。',
  CANCELLED: '已取消。',
}

export class PreflightError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${ERROR_MESSAGES[code]}（${detail}）` : ERROR_MESSAGES[code])
    this.code = code
    this.name = 'PreflightError'
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof PreflightError && err.code === 'CANCELLED'
}
