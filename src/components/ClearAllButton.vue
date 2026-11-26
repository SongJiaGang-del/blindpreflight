<script setup lang="ts">
import { NButton, useDialog } from 'naive-ui'
import { useSession } from '@/app/session'

const s = useSession()
const dialog = useDialog()

function confirm() {
  dialog.warning({
    title: '清空全部？',
    content: '将移除已选文件、自定义身份词、检查结果和复核标记。会场预设选择会保留。',
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: () => s.clearAll(),
  })
}
</script>

<template>
  <n-button size="small" quaternary data-testid="clear-all" @click="confirm">清空全部</n-button>
</template>
