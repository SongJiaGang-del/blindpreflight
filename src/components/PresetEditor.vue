<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NModal, NRadio, NRadioGroup, NSelect, NSwitch, useDialog } from 'naive-ui'
import type { AckPolicy, Severity } from '@/domain/types'
import { PRESETS, getBuiltinPreset } from '@/presets'
import { ACK_LABEL, type CustomPresetSpec, newCustomId, validPattern } from '@/presets/custom'
import { RULES } from '@/rules/engine'
import { SEVERITY_LABEL } from '@/domain/labels'
import { useSession } from '@/app/session'
import { useI18n } from '@/i18n'
import { presetName } from '@/presets'

/** 要编辑的自定义预设；null = 新建 */
const props = defineProps<{ spec: CustomPresetSpec | null }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ saved: [id: string] }>()
const s = useSession()
const dialog = useDialog()
const { t, tx, locale } = useI18n()

type Level = Severity | 'off' | 'default'
const form = reactive({
  venue: '',
  baseId: 'generic',
  ackPolicy: 'noIdentity' as AckPolicy,
  flagAllEmbeddedLinks: false,
  rules: {} as Record<string, Level>,
  markerPattern: '',
  markerLabel: '',
  note: '',
})
const touched = ref(false)

function fill() {
  const sp = props.spec
  const base = getBuiltinPreset(sp?.baseId ?? s.state.presetId)
  form.venue = sp?.venue ?? ''
  form.baseId = sp?.baseId ?? (base.custom ? 'generic' : base.id)
  form.ackPolicy = sp?.ackPolicy ?? base.ackPolicy
  form.flagAllEmbeddedLinks = sp?.flagAllEmbeddedLinks ?? base.flagAllEmbeddedLinks
  form.rules = Object.fromEntries(RULES.map((r) => [r.id, (sp?.rules[r.id] ?? 'default') as Level]))
  form.markerPattern = sp?.templateMarker?.pattern ?? ''
  form.markerLabel = sp?.templateMarker?.label ?? ''
  form.note = sp?.note ?? ''
  touched.value = false
}
watch(show, (v) => v && fill())

/** 换基础预设时，致谢与外链设置跟着换（仅新建且未手动改过时） */
watch(
  () => form.baseId,
  (id) => {
    if (props.spec || touched.value) return
    const b = getBuiltinPreset(id)
    form.ackPolicy = b.ackPolicy
    form.flagAllEmbeddedLinks = b.flagAllEmbeddedLinks
  },
)

const baseOptions = computed(() => PRESETS.map((p) => ({ value: p.id, label: presetName(p, locale.value) })))
const base = computed(() => getBuiltinPreset(form.baseId))

function levelOptions(ruleId: string) {
  const b = base.value
  const def = b.disabledRuleIds.includes(ruleId)
    ? t('editor.off')
    : b.severityOverrides[ruleId]
      ? tx(SEVERITY_LABEL[b.severityOverrides[ruleId]!])
      : t('editor.byRule')
  return [
    { value: 'default', label: t('editor.default', { def }) },
    { value: 'high', label: t('editor.allHigh') },
    { value: 'medium', label: t('editor.allMedium') },
    { value: 'info', label: t('editor.allInfo') },
    { value: 'off', label: t('editor.off') },
  ]
}
const changedCount = computed(() => Object.values(form.rules).filter((v) => v !== 'default').length)

const patternOk = computed(() => validPattern(form.markerPattern))
const canSave = computed(() => form.venue.trim().length > 0 && patternOk.value)

function save() {
  if (!canSave.value) return
  const rules: CustomPresetSpec['rules'] = {}
  for (const [k, v] of Object.entries(form.rules)) if (v !== 'default') rules[k] = v
  const spec: CustomPresetSpec = {
    id: props.spec?.id ?? newCustomId(),
    venue: form.venue.trim().slice(0, 60),
    baseId: form.baseId,
    ackPolicy: form.ackPolicy,
    flagAllEmbeddedLinks: form.flagAllEmbeddedLinks,
    rules,
    templateMarker: form.markerPattern.trim() ? { pattern: form.markerPattern.trim(), label: form.markerLabel.trim() || form.markerPattern.trim() } : null,
    note: form.note.trim().slice(0, 300),
  }
  s.upsertCustomPreset(spec)
  emit('saved', spec.id)
  show.value = false
}

function remove() {
  const sp = props.spec
  if (!sp) return
  dialog.warning({
    title: t('editor.deleteTitle', { name: sp.venue }),
    content: t('editor.deleteContent'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      s.removeCustomPreset(sp.id)
      show.value = false
    },
  })
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="spec ? t('editor.titleEdit') : t('editor.titleNew')"
    style="width: min(720px, 96vw)"
    :bordered="false"
    data-testid="preset-editor"
  >
    <div class="body">
      <n-alert type="info" :bordered="false">
        {{ t('editor.intro') }}
      </n-alert>

      <div class="row two">
        <label>
          <span class="lbl">{{ t('editor.name') }}</span>
          <n-input v-model:value="form.venue" maxlength="60" :placeholder="t('editor.namePh')" data-testid="preset-name" />
        </label>
        <label>
          <span class="lbl">{{ t('editor.base') }}</span>
          <n-select v-model:value="form.baseId" :options="baseOptions" />
        </label>
      </div>

      <div class="row">
        <span class="lbl">{{ t('editor.ack') }}</span>
        <n-radio-group v-model:value="form.ackPolicy" name="ack" @update:value="touched = true">
          <n-radio v-for="(label, k) in ACK_LABEL" :key="k" :value="k">{{ tx(label) }}</n-radio>
        </n-radio-group>
      </div>

      <div class="row inline">
        <n-switch v-model:value="form.flagAllEmbeddedLinks" @update:value="touched = true" />
        <span>{{ t('editor.flagLinks') }}</span>
      </div>

      <details class="rules" :open="changedCount > 0">
        <summary>{{ t('editor.rules') }} <span class="muted">{{ t('editor.rulesChanged', { n: changedCount }) }}</span></summary>
        <table>
          <tbody>
            <tr v-for="r in RULES" :key="r.id">
              <td class="id">{{ r.id }}</td>
              <td class="t">{{ tx(r.title) }}</td>
              <td class="sel">
                <n-select v-model:value="form.rules[r.id]" size="small" :options="levelOptions(r.id)" :consistent-menu-width="false" />
              </td>
            </tr>
          </tbody>
        </table>
      </details>

      <div class="row">
        <span class="lbl">{{ t('editor.marker') }} <span class="muted">{{ t('editor.markerNote') }}</span></span>
        <div class="two">
          <n-input v-model:value="form.markerPattern" :placeholder="t('editor.markerPh')" :status="patternOk ? undefined : 'error'" />
          <n-input v-model:value="form.markerLabel" :placeholder="t('editor.markerLabelPh')" />
        </div>
        <span v-if="!patternOk" class="err">{{ t('editor.badRegex') }}</span>
        <span v-else-if="!form.markerPattern && base.templateMarker" class="muted">{{ t('editor.inherit', { venue: tx(base.venue), label: base.templateMarker.label }) }}</span>
      </div>

      <label class="row">
        <span class="lbl">{{ t('editor.note') }} <span class="muted">{{ t('editor.noteHelp') }}</span></span>
        <n-input v-model:value="form.note" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="300" />
      </label>
    </div>
    <template #footer>
      <div class="foot">
        <n-button v-if="spec" type="error" quaternary @click="remove">{{ t('common.delete') }}</n-button>
        <span class="grow" />
        <n-button @click="show = false">{{ t('common.cancel') }}</n-button>
        <n-button type="primary" :disabled="!canSave" data-testid="preset-save" @click="save">{{ t('common.save') }}</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row.inline {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.row.two label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 13px;
  font-weight: 600;
}
.muted {
  font-weight: 400;
  font-size: 12px;
  color: var(--bp-muted);
}
.err {
  font-size: 12px;
  color: var(--bp-high);
}
.rules summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.rules table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
}
.rules td {
  border-top: 1px solid var(--bp-line);
  padding: 4px 6px;
  font-size: 13px;
}
.rules .id {
  font-family: var(--bp-mono);
  color: var(--bp-muted);
  width: 44px;
}
.rules .sel {
  width: 200px;
}
.foot {
  display: flex;
  gap: 8px;
  align-items: center;
}
.grow {
  flex: 1;
}
@media (max-width: 560px) {
  .two {
    grid-template-columns: 1fr;
  }
}
</style>
