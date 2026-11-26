<script setup lang="ts">
import { ref } from 'vue'
import {
  NButton,
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  dateZhCN,
  zhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import { useSession } from '@/app/session'
import ImportPanel from '@/components/ImportPanel.vue'
import ResultsView from '@/components/ResultsView.vue'
import HelpDrawer from '@/components/HelpDrawer.vue'
import ClearAllButton from '@/components/ClearAllButton.vue'

const s = useSession()
const showHelp = ref(false)

const theme: GlobalThemeOverrides = {
  common: {
    primaryColor: '#1f3a5f',
    primaryColorHover: '#2c4f7c',
    primaryColorPressed: '#162a45',
    primaryColorSuppl: '#2c4f7c',
    borderRadius: '6px',
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
}
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="theme">
    <n-message-provider>
      <n-dialog-provider>
        <header class="top">
          <div class="brand">
            <span class="logo" aria-hidden="true">BP</span>
            <span class="name">BlindPreflight</span>
            <span class="tag">双盲投稿匿名性预检</span>
          </div>
          <div class="privacy" data-testid="privacy-note">
            <span class="dot" aria-hidden="true" />本地处理 · 不上传 · 不调用云端 AI
          </div>
          <div class="acts">
            <n-button size="small" quaternary data-testid="open-help" @click="showHelp = true">帮助</n-button>
            <ClearAllButton />
          </div>
        </header>
        <main>
          <ResultsView v-if="s.state.view === 'results' && s.result.value" :result="s.result.value" />
          <ImportPanel v-else />
        </main>
        <HelpDrawer v-model:show="showHelp" />
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
  padding: 10px 20px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--bp-line);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--bp-accent);
  color: #fff;
  font-weight: 800;
  font-size: 12px;
  display: grid;
  place-items: center;
  letter-spacing: 0.02em;
}
.name {
  font-weight: 700;
  font-size: 16px;
}
.tag {
  font-size: 12px;
  color: var(--bp-muted);
}
.privacy {
  margin-left: auto;
  font-size: 12px;
  color: #24593a;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2f9e5b;
}
.acts {
  display: flex;
  gap: 4px;
}
@media (max-width: 720px) {
  .tag,
  .privacy {
    display: none;
  }
  .acts {
    margin-left: auto;
  }
}
</style>
