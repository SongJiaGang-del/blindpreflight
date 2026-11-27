import { defineConfig, devices } from '@playwright/test'

/**
 * 默认使用 Playwright 自带的 Chromium（需先 `npx playwright install chromium`）。
 * 已有本地 Chromium / headless shell 时，可设 PW_CHROMIUM_PATH 指向其可执行文件，免去下载。
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    trace: 'retain-on-failure',
    // 界面语言按浏览器语言选择；用例断言的是中文文案，英文界面另有专门用例
    locale: 'zh-CN',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
