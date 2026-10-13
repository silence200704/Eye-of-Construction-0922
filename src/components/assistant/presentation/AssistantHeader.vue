<script setup lang="ts">
import { useAssistantStore } from '@/assistant/session'
import XiaotongAvatar from '../XiaotongAvatar.vue'
import { useDirectorStore } from '@/assistant/director/state'

defineProps<{ context: string; active: boolean; paused: boolean }>()
const emit = defineEmits<{ close: [] }>()
const assistant = useAssistantStore()
const task = useDirectorStore()
</script>

<template>
  <header class="head">
    <XiaotongAvatar :state="assistant.mascotState" :paused="paused" :size="48" />
    <div class="head-text">
      <div class="title-row"><b>问筑瞳</b><span>智能分析 · {{ active ? '系统联动已授权' : '本地数据' }}</span></div>
      <p :title="context">{{ context }}</p>
    </div>
    <button class="close" type="button" aria-label="关闭问筑瞳" @click="emit('close')">关闭</button>
    <div v-if="active || assistant.turns.length || assistant.contextLabel || assistant.context.pointId || assistant.context.eventId" class="tools">
      <span>会话管理</span>
      <button v-if="active" type="button" @click="task.stop()">停止自动补齐</button>
      <button v-if="assistant.contextLabel || assistant.context.pointId || assistant.context.eventId" type="button" @click="assistant.clearContext()">清除上下文</button>
      <button v-if="assistant.turns.length" type="button" @click="assistant.clearTurns()">清空对话</button>
    </div>
  </header>
</template>

<style scoped>
.head { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; padding: 14px 20px 0; border-bottom: 1px solid var(--line); background: var(--paper); }
.head:not(:has(.tools)) { padding-bottom: 14px; }
.head-text { min-width: 0; }
.title-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
.title-row b { font-size: 19px; letter-spacing: -.03em; }
.title-row span { color: var(--brand-700); font-size: 11px; }
.head-text p { margin: 5px 0 0; color: var(--text-2); font-size: 11.5px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.close { min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--r-sm); }
.tools { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; min-height: 36px; border-top: 1px solid var(--line); }
.tools span { margin-right: auto; color: var(--text-3); font-size: 11px; }
.tools button { min-height: 36px; padding: 0; }
button:hover { color: var(--brand-700); }
button:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 3px; }
@media(max-width:600px) { .head { padding: 10px 12px 0; gap: 8px; }.close, .tools button { min-height: 44px; }.title-row span { font-size: 10px; } }
</style>
