/** 错误码：错误信息不回显文件中的敏感片段。 */
import { L, type Text } from './text'

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
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_UNREADABLE'
  | 'OCR_FAILED'

export const ERROR_MESSAGES: Record<ErrorCode, Text> = {
  UNSUPPORTED_TYPE: L(
    '这不是可识别的 PDF 文件（文件头不是 %PDF-）。请导出为 PDF 后重试。',
    'This is not a recognizable PDF (the file does not start with %PDF-). Export it as PDF and try again.',
  ),
  EMPTY_FILE: L('文件为空。', 'The file is empty.'),
  FILE_TOO_LARGE: L(
    '单个文件超过 25 MB 上限。请拆分补充材料，或压缩图片后重新导出。',
    'A file exceeds the 25 MB limit. Split the supplement or compress images and export again.',
  ),
  TOTAL_TOO_LARGE: L('所有文件合计超过 50 MB 上限。', 'All files together exceed the 50 MB limit.'),
  PAGE_LIMIT: L(
    '页数超过上限（单份 100 页，整组 200 页）。请拆分后分别检查。',
    'Too many pages (100 per file, 200 in total). Split the files and check them separately.',
  ),
  TOO_MANY_FILES: L('最多 1 份主稿 + 2 份补充 PDF。', 'At most 1 main paper and 2 supplementary PDFs.'),
  ENCRYPTED_PDF: L(
    '该 PDF 受密码保护。本工具不收集密码：请用你信任的本地工具导出一份未加密的审稿副本再检查。',
    'This PDF is password-protected. BlindPreflight never asks for passwords: export an unencrypted review copy with a local tool you trust, then check that.',
  ),
  CORRUPT_PDF: L('PDF 结构损坏或无法解析。请从源文件重新导出。', 'The PDF is damaged or cannot be parsed. Export it again from the source.'),
  PARTIAL_TEXT: L('部分页面文本无法抽取，结果只覆盖已处理的页面。', 'Text could not be extracted from some pages; results cover only the processed pages.'),
  WORKER_FAILED: L(
    'PDF 解析线程未能启动或中途失败。请刷新页面重试；若仍失败，换用最新版 Chromium / Firefox。',
    'The PDF worker failed to start or crashed. Reload the page and try again; if it keeps failing, use a recent Chromium or Firefox.',
  ),
  CANCELLED: L('已取消。', 'Cancelled.'),
  SOURCE_TOO_LARGE: L(
    '源文件包过大：压缩包最多 50 MB，解压后最多 300 MB / 5000 个文件。请去掉数据集、模型权重等大文件后重试。',
    'The source archive is too large: at most 50 MB compressed and 300 MB / 5000 files unpacked. Remove datasets, model weights and other large files, then try again.',
  ),
  SOURCE_UNREADABLE: L(
    '源文件无法读取：只支持 .zip 压缩包，或单个 .tex / .bib 文本文件。',
    'The source file cannot be read: only .zip archives or single .tex / .bib text files are supported.',
  ),
  OCR_FAILED: L(
    '本地 OCR 未能完成（识别组件加载失败或浏览器不支持 WebAssembly）。其余检查结果不受影响。',
    'Local OCR could not finish (the recognizer failed to load or WebAssembly is unavailable). The other checks are not affected.',
  ),
}

export class PreflightError extends Error {
  readonly code: ErrorCode
  /** 双语说明（界面按当前语言显示） */
  readonly text: Text
  constructor(code: ErrorCode, detail?: Text) {
    const base = ERROR_MESSAGES[code]
    const text = detail ? L(`${base.zh}（${detail.zh}）`, `${base.en} (${detail.en})`) : base
    super(text.zh)
    this.code = code
    this.text = text
    this.name = 'PreflightError'
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof PreflightError && err.code === 'CANCELLED'
}
