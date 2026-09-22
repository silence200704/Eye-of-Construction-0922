<script setup lang="ts">
/**
 * 声明式表单：由 FieldDef 描述字段，统一渲染与错误展示。
 * 四个建档实体共用本组件，避免四套重复表单；model 由父级传入响应式对象，直接按字段键写入。
 */
import { computed } from 'vue'
import { parseNum } from '@/core/format'
import type { FieldDef } from '@/types/forms'

const model = defineModel<Record<string, unknown>>({ required: true })

const props = withDefaults(
  defineProps<{
    fields: FieldDef[]
    errors?: Record<string, string>
    columns?: 1 | 2
  }>(),
  { errors: () => ({}), columns: 2 },
)

const emit = defineEmits<{ change: [key: string] }>()

const visibleFields = computed(() => props.fields.filter((field) => field.visible === undefined || field.visible(model.value)))

function inputType(field: FieldDef): string {
  if (field.type === 'date') return 'date'
  if (field.type === 'datetime') return 'datetime-local'
  if (field.type === 'number') return 'number'
  return 'text'
}

function text(field: FieldDef): string {
  const raw = model.value[field.key]
  if (raw === null || raw === undefined) return ''
  return String(raw)
}

function errorOf(field: FieldDef): string {
  return props.errors[field.key] ?? ''
}

function optionsOf(field: FieldDef): { value: string; label: string }[] {
  const list = typeof field.options === 'function' ? field.options(model.value) : field.options ?? []
  const current = model.value[field.key]
  const empty = current === undefined || current === null || current === ''
  if (field.required === true && empty && !list.some((option) => option.value === '')) {
    return [{ value: '', label: '请选择…' }, ...list]
  }
  return list
}

function onInput(field: FieldDef, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  const raw = target.value
  if (field.type === 'number') {
    model.value[field.key] = raw.trim() === '' ? '' : (parseNum(raw) ?? raw)
  } else {
    model.value[field.key] = raw
  }
  emit('change', field.key)
}

function onBlur(field: FieldDef): void {
  emit('change', field.key)
}
</script>

<template>
  <div class="form-grid" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
    <div v-for="field in visibleFields" :key="field.key" class="field" :class="{ 'field--wide': field.span === 2 }">
      <label class="field-label" :for="`field-${field.key}`">
        {{ field.label }}
        <span v-if="field.required" class="field-req">*</span>
        <span v-if="field.unit" class="field-unit">{{ field.unit }}</span>
      </label>

      <select
        v-if="field.type === 'select'"
        :id="`field-${field.key}`"
        class="ctl"
        :class="{ 'ctl--invalid': errorOf(field) !== '' }"
        :value="text(field)"
        @change="onInput(field, $event)"
        @blur="onBlur(field)"
      >
        <option v-for="option in optionsOf(field)" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>

      <textarea
        v-else-if="field.type === 'textarea'"
        :id="`field-${field.key}`"
        class="ctl"
        :class="{ 'ctl--invalid': errorOf(field) !== '' }"
        :rows="field.rows ?? 3"
        :placeholder="field.placeholder"
        :value="text(field)"
        @input="onInput(field, $event)"
      />

      <div v-else-if="field.type === 'readonly'" class="ctl ctl--ro">{{ text(field) === '' ? '自动生成' : text(field) }}</div>

      <input
        v-else
        :id="`field-${field.key}`"
        class="ctl"
        :class="{ 'ctl--invalid': errorOf(field) !== '' }"
        :type="inputType(field)"
        :step="field.step"
        :min="field.min"
        :max="field.max"
        :placeholder="field.placeholder"
        :value="text(field)"
        @input="onInput(field, $event)"
        @blur="onBlur(field)"
      />

      <p v-if="errorOf(field) !== ''" class="field-error">{{ errorOf(field) }}</p>
      <p v-else-if="field.hint" class="field-hint">{{ field.hint }}</p>
    </div>
  </div>
</template>

<style scoped>
.ctl--ro {
  display: flex;
  align-items: center;
  background: var(--canvas-deep);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 12.5px;
}
</style>
