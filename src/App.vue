<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NButton,
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NTooltip,
  darkTheme,
  dateEnUS,
  dateZhCN,
  enUS,
  zhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import { useSession } from '@/app/session'
import { useTheme } from '@/app/theme'
import { usePwa } from '@/app/pwa'
import { useI18n } from '@/i18n'
import ImportPanel from '@/components/ImportPanel.vue'
import ResultsView from '@/components/ResultsView.vue'
import HelpDrawer from '@/components/HelpDrawer.vue'
import ClearAllButton from '@/components/ClearAllButton.vue'

const s = useSession()
const th = useTheme()
const pwa = usePwa()
const { t, locale, setLocale } = useI18n()
const showHelp = ref(false)
const helpTab = ref('rules')

const SANS = "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"

const LIGHT: GlobalThemeOverrides = {
  common: {
    primaryColor: '#1f3a5f',
    primaryColorHover: '#2c4f7c',
    primaryColorPressed: '#162a45',
    primaryColorSuppl: '#2c4f7c',
    errorColor: '#b0382c',
    errorColorHover: '#c24a3d',
    warningColor: '#a66d14',
    infoColor: '#36679b',
    successColor: '#2d7449',
    borderRadius: '6px',
    fontFamily: SANS,
    bodyColor: '#f3efe6',
    cardColor: '#fffdf8',
    modalColor: '#fffdf8',
    popoverColor: '#fffdf8',
    inputColor: '#fffdf8',
    tableColor: '#fffdf8',
    borderColor: '#e3dccd',
    dividerColor: '#e3dccd',
    textColor1: '#1f2330',
    textColor2: '#3d4250',
    textColor3: '#6e685b',
  },
}
const DARK: GlobalThemeOverrides = {
  common: {
    primaryColor: '#8fb3de',
    primaryColorHover: '#a9c5e8',
    primaryColorPressed: '#7399c6',
    primaryColorSuppl: '#a9c5e8',
    errorColor: '#e57d70',
    warningColor: '#dba84f',
    infoColor: '#7fabda',
    successColor: '#74c08f',
    borderRadius: '6px',
    fontFamily: SANS,
    bodyColor: '#15171b',
    cardColor: '#1d2026',
    modalColor: '#1d2026',
    popoverColor: '#22262d',
    inputColor: '#22262d',
    tableColor: '#1d2026',
    borderColor: '#2f333b',
    dividerColor: '#2f333b',
  },
}

const naiveTheme = computed(() => (th.isDark.value ? darkTheme : null))
const overrides = computed(() => (th.isDark.value ? DARK : LIGHT))
const themeLabel = computed(() => ({ auto: t('app.themeAuto'), light: t('app.themeLight'), dark: t('app.themeDark') })[th.mode.value])
const naiveLocale = computed(() => (locale.value === 'zh' ? zhCN : enUS))
const naiveDateLocale = computed(() => (locale.value === 'zh' ? dateZhCN : dateEnUS))

function openHelp(tab = 'rules') {
  helpTab.value = tab
  showHelp.value = true
}
</script>

<template>
  <n-config-provider :locale="naiveLocale" :date-locale="naiveDateLocale" :theme="naiveTheme" :theme-overrides="overrides">
    <n-message-provider>
      <n-dialog-provider>
        <header class="top">
          <button class="brand" type="button" :aria-label="t('app.home')" @click="s.state.view = 'import'">
            <span class="logo" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="30" height="30">
                <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="currentColor" />
                <path d="M10 8.5h8.5l4 4V23.5H10z" fill="none" stroke="var(--bp-on-accent)" stroke-width="1.8" stroke-linejoin="round" />
                <path d="M13 15.5h6.5M13 19h4" stroke="var(--bp-on-accent)" stroke-width="1.8" stroke-linecap="round" />
                <rect x="12.4" y="11" width="5" height="2.4" rx="0.6" fill="var(--bp-on-accent)" />
              </svg>
            </span>
            <span class="name">BlindPreflight</span>
            <span class="tag">{{ t('app.tag') }}</span>
          </button>
          <div class="privacy" data-testid="privacy-note">
            <span class="dot" aria-hidden="true" />{{ t('app.privacy') }}
          </div>
          <span v-if="pwa.offlineReady.value" class="offline" data-testid="offline-ready" :title="t('app.offlineTip')">{{ t('app.offline') }}</span>
          <n-button v-if="pwa.canInstall.value" size="small" secondary data-testid="install-app" @click="pwa.promptInstall()">{{ t('app.install') }}</n-button>
          <div class="acts">
            <n-tooltip>
              <template #trigger>
                <n-button size="small" quaternary :aria-label="themeLabel" data-testid="theme-toggle" @click="th.cycle()">
                  <svg v-if="th.mode.value === 'auto'" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" />
                    <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
                  </svg>
                  <svg v-else-if="th.mode.value === 'light'" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                    <path d="M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                  <svg v-else viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  </svg>
                </n-button>
              </template>
              {{ t('app.themeTip', { label: themeLabel }) }}
            </n-tooltip>
            <n-button
              size="small"
              quaternary
              class="lang"
              :title="t('app.lang')"
              :aria-label="t('app.lang')"
              data-testid="lang-toggle"
              @click="setLocale(locale === 'zh' ? 'en' : 'zh')"
            >
              {{ t('app.langShort') }}
            </n-button>
            <n-button size="small" quaternary data-testid="open-help" @click="openHelp()">{{ t('app.help') }}</n-button>
            <ClearAllButton />
          </div>
        </header>
        <main>
          <Transition name="page" mode="out-in">
            <ResultsView v-if="s.state.view === 'results' && s.result.value" :result="s.result.value" @help="openHelp" />
            <ImportPanel v-else />
          </Transition>
        </main>
        <HelpDrawer v-model:show="showHelp" v-model:tab="helpTab" />
        <Transition name="page">
          <div v-if="pwa.updateReady.value" class="update" role="status">
            <span>{{ t('app.update') }}</span>
            <n-button size="tiny" type="primary" @click="pwa.applyUpdate()">{{ t('app.reloadNow') }}</n-button>
            <n-button size="tiny" quaternary @click="pwa.updateReady.value = false">{{ t('app.later') }}</n-button>
          </div>
        </Transition>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.top {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 24px;
  background: color-mix(in srgb, var(--bp-bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--bp-line);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.logo {
  color: var(--bp-accent);
  display: grid;
  place-items: center;
}
.name {
  font-family: var(--bp-serif);
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.01em;
}
.tag {
  font-size: 12px;
  color: var(--bp-muted);
  padding-left: 10px;
  border-left: 1px solid var(--bp-line-strong);
}
.privacy {
  margin-left: auto;
  font-size: 12px;
  color: var(--bp-ok);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--bp-ok-soft);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--bp-ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bp-ok) 25%, transparent);
}
.lang {
  font-weight: 700;
  min-width: 34px;
}
.offline {
  font-size: 11px;
  color: var(--bp-muted);
  border: 1px solid var(--bp-line-strong);
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.update {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--bp-panel);
  border: 1px solid var(--bp-line);
  box-shadow: var(--bp-shadow-lg);
  font-size: 13px;
}
.acts {
  display: flex;
  gap: 4px;
  align-items: center;
}
.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.page-leave-to {
  opacity: 0;
}
@media (max-width: 720px) {
  .tag,
  .offline,
  .privacy {
    display: none;
  }
  .acts {
    margin-left: auto;
  }
  .top {
    padding: 10px 14px;
  }
}
</style>
