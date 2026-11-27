/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/**
 * 构建时生成 dist/sw.js：预缓存应用外壳、打包产物与 pdf.js 资源（不含体积较大的 OCR 组件，
 * 它们在第一次使用时缓存）。版本号取自所有预缓存文件内容的哈希。
 */
function serviceWorker(): Plugin {
  let publicDir = ''
  return {
    name: 'blindpreflight-service-worker',
    apply: 'build',
    configResolved(c) {
      publicDir = c.publicDir
    },
    generateBundle(_, bundle) {
      const hash = createHash('sha256')
      const built = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .sort()
      for (const f of built) {
        const item = bundle[f]!
        hash.update(f)
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source))
      }
      const pub = publicDir
        ? walk(publicDir)
            .map((p) => relative(publicDir, p).split('\\').join('/'))
            .filter((p) => !p.startsWith('ocr/'))
            .sort()
        : []
      for (const p of pub) {
        hash.update(p)
        hash.update(readFileSync(join(publicDir, p)))
      }
      const precache = ['./', ...[...built, ...pub].map((p) => `./${p}`)]
      const template = readFileSync(fileURLToPath(new URL('./scripts/sw-template.js', import.meta.url)), 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12))).replace('__PRECACHE__', JSON.stringify(precache)),
      })
    },
  }
}

// base: './' 让产物可以部署到任意子路径（静态托管无需 SPA rewrite）。
export default defineConfig({
  base: './',
  plugins: [vue(), serviceWorker()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // 显式绑定 IPv4：Windows 上 localhost 默认解析到 ::1，部分环境下 IPv6 回环被拦截导致无法访问。
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1' },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
})
