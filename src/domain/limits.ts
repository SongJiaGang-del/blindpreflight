/** 初始产品限额（设计参数，按实测调整）。 */
export const LIMITS = {
  maxSupplements: 2,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxPagesPerDoc: 100,
  maxPagesTotal: 200,
  /** 每页可见字符少于该值视为「文本不足 / 可能为扫描页」 */
  sparsePageChars: 20,
  snippetMax: 240,
  contextRadius: 90,
} as const

export const APP_VERSION = '0.1.0'
export const RULESET_VERSION = '2026.11.26'
export const REPORT_SCHEMA_VERSION = '1.0.0'
