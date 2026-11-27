/* BlindPreflight service worker（由 vite 构建时生成 dist/sw.js）。
 *
 * 只做一件事：缓存本站的静态资源，让应用断网也能打开。
 * - 只处理同源 GET 请求；从不缓存、读取或转发稿件（稿件从不经过网络）。
 * - 应用外壳与 pdf.js 资源在安装时预缓存；OCR 组件体积较大，第一次使用时再缓存。
 * - 版本号随构建内容变化；新版本安装后等待页面确认再接管。
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const SHELL = `bp-shell-${VERSION}`
const RUNTIME = 'bp-runtime-v1'
// 静态服务器常带 Vary: Origin；模块脚本（crossorigin）请求带 Origin 头，按 Vary 匹配会落空
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('bp-shell-') && key !== SHELL) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 页面导航：先网络（拿到最新版本），断网时用缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(req, MATCH)) || (await caches.match(new URL('./', self.registration.scope).href, MATCH)) || Response.error()),
    )
    return
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(req, MATCH)
      if (hit) return hit
      const res = await fetch(req)
      // OCR 组件、pdf.js 资源：第一次用到时缓存，之后断网也能用
      if (res.ok && /\/(?:ocr|pdfjs)\//.test(url.pathname)) {
        const cache = await caches.open(RUNTIME)
        await cache.put(req, res.clone())
      }
      return res
    })(),
  )
})
