<script setup lang="ts">
/** 归档 / 恢复确认：归档必须填写原因，恢复需说明依据。 */
import { computed, ref, watch } from 'vue'
import type { FieldDef } from '@/types/forms'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'

const props = defineProps<{
  open: boolean
  targetLabel: string
  archived: boolean
}>()

const emit = defineEmits<{ close: []; confirm: [reason: string] }>()

const model = ref<Record<string, unknown>>({ reason: '' })
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) {
      model.value = { reason: '' }
      error.value = ''
    }
  },
)

/** 字段必须随 archived 变化重建，否则归档时仍显示"恢复说明"。 */
const fields = computed<FieldDef[]>(() => [
  {
    key: 'reason',
    label: props.archived ? '归档原因' : '恢复说明',
    type: 'textarea',
    required: props.archived,
    rows: 2,
    placeholder: '例如 该测点已拆除，设备回收，档案保留历史记录',
  },
])

function confirm(): void {
  const reason = String(model.value.reason ?? '').trim()
  if (props.archived && reason === '') {
    error.value = '归档必须填写原因'
    return
  }
  emit('confirm', reason)
}
</script>

<template>
  <AppModal
    :open="open"
    :title="archived ? '归档确认' : '恢复确认'"
    :sub="targetLabel"
    :width="560"
    @close="emit('close')"
  >
    <p class="notice" :class="archived ? 'notice--warn' : 'notice--brand'">
      {{
        archived
          ? '归档不会删除历史记录，监测数据、基准版本与操作日志全部保留；归档后该对象不再出现在可选清单与地图标记中。'
          : '恢复后该对象重新出现在档案、地图与待选清单中，历史记录保持原样。'
      }}
    </p>
    <FormGrid v-model="model" :fields="fields" :errors="error === '' ? {} : { reason: error }" :columns="1" />
    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton :variant="archived ? 'danger' : 'primary'" @click="confirm">
        {{ archived ? '确认归档' : '确认恢复' }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.notice {
  margin-bottom: 14px;
}
</style>
