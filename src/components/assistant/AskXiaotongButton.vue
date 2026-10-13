<script setup lang="ts">
/**
 * 「问小瞳」入口按钮（挂在测点卡、事件详情等对象详情里）。
 *
 * 只做一件事：带着当前对象唤起半屏面板，并立刻问一句与对象匹配的默认问法。
 * 抽成组件是为了让调用方只加一行 —— 详情页本来就长，不该为入口再堆一段状态逻辑。
 */
import { nextTick } from 'vue'
import { useAssistantStore } from '@/assistant/session'
import AppButton from '@/components/ui/AppButton.vue'

const props = withDefaults(
  defineProps<{
    kind: 'point' | 'event'
    /** 当前对象 ID，作为提问上下文；对象消失后由助手提示重新选择 */
    objectId: string
    /** 上下文说明（编号 + 名称），显示在面板头部的"当前上下文"里 */
    label: string
    text?: string
    size?: 'sm' | 'md'
  }>(),
  { text: '问小瞳', size: 'sm' },
)

const assistant = useAssistantStore()
const emit = defineEmits<{ opened: [] }>()

async function open(): Promise<void> {
  // 对象详情若是模态框，先交给父页关闭并完成焦点回位，再展开小瞳。
  const { kind, objectId, label } = props
  emit('opened')
  await nextTick()
  await assistant.openWith(kind, objectId, label)
}
</script>

<template>
  <AppButton :size="size" @click="open">{{ text }}</AppButton>
</template>
