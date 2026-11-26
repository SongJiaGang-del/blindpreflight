/**
 * 亮 / 暗主题。偏好（auto / light / dark）是纯界面设置，单独存一个 localStorage 键，
 * 不含任何稿件信息。
 */
import { computed, ref } from 'vue'

export type ThemeMode = 'auto' | 'light' | 'dark'

const KEY = 'blindpreflight.theme.v1'
const MODES: ThemeMode[] = ['auto', 'light', 'dark']

function load(): ThemeMode {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    return MODES.includes(v as ThemeMode) ? (v as ThemeMode) : 'auto'
  } catch {
    return 'auto'
  }
}

const mode = ref<ThemeMode>(load())
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
const systemDark = ref(mq?.matches ?? false)
mq?.addEventListener('change', (e) => {
  systemDark.value = e.matches
  apply()
})

const isDark = computed(() => mode.value === 'dark' || (mode.value === 'auto' && systemDark.value))

function apply(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light'
}

function setMode(m: ThemeMode): void {
  mode.value = m
  try {
    globalThis.localStorage?.setItem(KEY, m)
  } catch {
    /* 忽略 */
  }
  apply()
}

/** 循环切换：跟随系统 → 亮 → 暗 */
function cycle(): void {
  setMode(MODES[(MODES.indexOf(mode.value) + 1) % MODES.length]!)
}

apply()

export function useTheme() {
  return { mode, isDark, setMode, cycle }
}
