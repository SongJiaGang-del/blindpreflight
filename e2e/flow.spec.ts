import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Request } from '@playwright/test'

const SAMPLES = fileURLToPath(new URL('../public/samples/', import.meta.url))
const IDENTITY = [/Alex\b/i, /Blair/i, /example\.edu/i, /Institute of Technology/i, /aexample/i, /example-lab/i]

/**
 * 断网金丝雀：除本机预览服务器外的任何请求都会被拦截并记录；
 * 同时记录所有非 GET 请求（稿件数据不应以任何方式发出）。
 */
async function guardNetwork(page: Page) {
  const external: string[] = []
  const nonGet: string[] = []
  await page.context().route('**/*', (route) => {
    const url = route.request().url()
    if (/^https?:\/\/127\.0\.0\.1:4173\//.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    external.push(url)
    return route.abort('blockedbyclient')
  })
  page.on('request', (r: Request) => {
    if (r.method() !== 'GET') nonGet.push(`${r.method()} ${r.url()}`)
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return { external, nonGet, errors }
}

/** 自定义词输入框始终可见（第 3 步卡片）；滚动到可见即可 */
async function openTerms(page: Page) {
  await page.getByTestId('terms-input').scrollIntoViewIfNeeded()
}

async function scanLeakyUpload(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('privacy-note')).toBeVisible()
  await page.getByTestId('slot-main-input').setInputFiles(`${SAMPLES}sample-leaky.pdf`)
  await openTerms(page)
  await page.getByTestId('terms-input').locator('textarea').fill('Widget Alignment')
  await page.getByTestId('start-scan').click()
  await expect(page.getByTestId('finding-list')).toBeVisible({ timeout: 30_000 })
}

test('上传 → 扫描 → 定位高亮 → 导出脱敏报告，全程无外部请求', async ({ page }) => {
  const net = await guardNetwork(page)
  await scanLeakyUpload(page)

  const high = Number((await page.getByTestId('count-high').locator('b').textContent())?.trim())
  expect(high).toBeGreaterThanOrEqual(10)
  await expect(page.getByTestId('finding-R01').first()).toBeVisible()
  await expect(page.getByTestId('finding-R02').first()).toBeVisible()

  // 点击正文类发现 → 右侧原页出现高亮框
  await page.getByTestId('finding-R02').first().click()
  await expect(page.getByTestId('pdf-canvas')).toBeVisible()
  await expect(page.getByTestId('pdf-highlight').first()).toBeVisible({ timeout: 15_000 })

  // 默认导出：脱敏 + 隐藏文件名
  await page.getByTestId('open-export').click()
  const dialog = page.getByTestId('export-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('opt-redact')).toHaveClass(/checked/)
  await expect(page.getByTestId('opt-hide-names')).toHaveClass(/checked/)

  const [htmlDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()])
  expect(htmlDl.suggestedFilename()).toMatch(/^blindpreflight-report-\d{8}-\d{6}\.html$/)
  const html = await readFile((await htmlDl.path())!, 'utf8')
  expect(html).toContain('BlindPreflight')
  expect(html).not.toMatch(/<script/i)
  expect(html).not.toContain('sample-leaky')
  for (const re of IDENTITY) expect(html, String(re)).not.toMatch(re)

  if (!(await page.getByTestId('export-json').isVisible())) await page.getByTestId('open-export').click()
  const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()])
  const json = await readFile((await jsonDl.path())!, 'utf8')
  const report = JSON.parse(json) as { findings: unknown[]; options: { redactEvidence: boolean } }
  expect(report.options.redactEvidence).toBe(true)
  expect(report.findings.length).toBeGreaterThan(10)
  expect(json).not.toContain('Widget Alignment')
  for (const re of IDENTITY) expect(json, String(re)).not.toMatch(re)

  expect(net.external).toEqual([])
  expect(net.nonGet).toEqual([])
  expect(net.errors).toEqual([])
})

test('修复示例 + 补充材料：主稿基本干净，补充材料的泄露被单独报告', async ({ page }) => {
  const net = await guardNetwork(page)
  await page.goto('/')
  await page.getByTestId('sample-fixed').click()
  await page.getByTestId('start-scan').click()
  await expect(page.getByTestId('finding-list')).toBeVisible({ timeout: 30_000 })
  const list = await page.getByTestId('finding-list').textContent()
  expect(list).toContain('补充材料 1')
  expect(net.external).toEqual([])
  expect(net.nonGet).toEqual([])
})

test('非 PDF 文件被拒绝，且不会开始扫描', async ({ page }) => {
  await guardNetwork(page)
  await page.goto('/')
  await page.getByTestId('slot-main-input').setInputFiles({
    name: 'paper.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html><script>alert(1)</script></html>'),
  })
  await page.getByTestId('start-scan').click()
  await expect(page.getByTestId('scan-error')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('finding-list')).toHaveCount(0)
})

test('清除全部：回到导入页，结果与自定义词被清空', async ({ page }) => {
  await guardNetwork(page)
  await scanLeakyUpload(page)
  await page.getByTestId('clear-all').click()
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await expect(page.getByTestId('start-scan')).toBeVisible()
  await expect(page.getByTestId('finding-list')).toHaveCount(0)
  await openTerms(page)
  await expect(page.getByTestId('terms-input').locator('textarea')).toHaveValue('')
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  expect(stored).not.toMatch(/Widget|Alex|sample-leaky/i)
})

test('清理 PDF → 复检 → 替换并重新检查 → 与上一版对比，全程无外部请求', async ({ page }) => {
  const net = await guardNetwork(page)
  await scanLeakyUpload(page)

  await page.getByTestId('open-clean').click()
  await expect(page.getByTestId('clean-dialog')).toBeVisible()
  await page.getByTestId('clean-run').click()
  const result = page.getByTestId('clean-result')
  await expect(result).toBeVisible({ timeout: 30_000 })
  const fixedInPreview = Number((await result.locator('.stat.ok b').first().textContent())?.trim())
  expect(fixedInPreview).toBeGreaterThan(0)

  // 下载的清理版：中性文件名，且不含元数据里的作者名与附件
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('clean-download').click()])
  expect(dl.suggestedFilename()).toBe('paper.pdf')
  const bytes = await readFile((await dl.path())!)
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')

  await page.getByTestId('clean-use').click()
  const panel = page.getByTestId('compare-panel')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  expect(Number((await page.getByTestId('cmp-fixed').locator('b').textContent())?.trim())).toBe(fixedInPreview)
  expect(Number((await page.getByTestId('cmp-added').locator('b').textContent())?.trim())).toBe(0)

  // 人工核对清单：勾选后计数变化
  await page.getByTestId('checklist').locator('summary').click()
  await page.getByTestId('check-repo').click()
  await expect(page.getByTestId('checklist').locator('summary')).toContainText('1 / 8')

  expect(net.external).toEqual([])
  expect(net.nonGet).toEqual([])
  expect(net.errors).toEqual([])
})
