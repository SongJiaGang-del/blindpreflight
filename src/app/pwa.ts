/**
 * PWA：注册 service worker（只在构建产物中），提供“可离线”“有新版本”“安装到桌面”三种状态。
 * service worker 只缓存本站静态资源，不接触稿件。
 */
import { ref } from 'vue'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const offlineReady = ref(false)
const updateReady = ref(false)
const canInstall = ref(false)
let registration: ServiceWorkerRegistration | null = null
let deferred: InstallPromptEvent | null = null
let started = false

export function initPwa(): void {
  if (started || !import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  started = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    canInstall.value = true
  })
  window.addEventListener('appinstalled', () => {
    canInstall.value = false
    deferred = null
  })
  const track = (w: ServiceWorker) =>
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') {
        if (navigator.serviceWorker.controller) updateReady.value = true
        else offlineReady.value = true
      }
      if (w.state === 'activated') offlineReady.value = true
    })
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((r) => {
      registration = r
      if (r.active) offlineReady.value = true
      if (r.waiting && navigator.serviceWorker.controller) updateReady.value = true
      if (r.installing) track(r.installing)
      r.addEventListener('updatefound', () => r.installing && track(r.installing))
    })
    .catch(() => {
      /* 不支持或被禁用：应用照常在线使用 */
    })
}

/** 让新版本接管并刷新页面（会清空当前检查结果，调用前先确认） */
export function applyUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  waiting.postMessage('skip-waiting')
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return
  await deferred.prompt()
  await deferred.userChoice.catch(() => null)
  deferred = null
  canInstall.value = false
}

export function usePwa() {
  return { offlineReady, updateReady, canInstall, applyUpdate, promptInstall }
}
