<script setup lang="ts">
import { NButton, useDialog } from 'naive-ui'
import { useSession } from '@/app/session'
import { useI18n } from '@/i18n'

const s = useSession()
const dialog = useDialog()
const { t } = useI18n()

function confirm() {
  dialog.warning({
    title: t('clear.title'),
    content: t('clear.content'),
    positiveText: t('clear.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => s.clearAll(),
  })
}
</script>

<template>
  <n-button size="small" quaternary data-testid="clear-all" @click="confirm">{{ t('clear.button') }}</n-button>
</template>
