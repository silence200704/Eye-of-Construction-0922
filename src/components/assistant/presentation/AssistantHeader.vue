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
      <div class="title-row"><b>小瞳助手</b><span>校园的变化，一起关心</span></div>
      <span class="local-badge">本地分析{{ active ? ' · 系统联动已授权' : ' · 依据可追溯' }}</span>
    </div>
    <button class="close" type="button" aria-label="关闭问筑瞳" @click="emit('close')">关闭</button>
    <p class="context"><span>当前关注</span>{{ context }}</p>
    <div v-if="active || assistant.turns.length || assistant.contextLabel || assistant.context.pointId || assistant.context.eventId" class="tools">
      <span>会话管理</span>
      <button v-if="active" type="button" @click="task.stop()">停止自动补齐</button>
      <button v-if="assistant.contextLabel || assistant.context.pointId || assistant.context.eventId" type="button" @click="assistant.clearContext()">清除上下文</button>
      <button v-if="assistant.turns.length" type="button" @click="assistant.clearTurns()">清空对话</button>
    </div>
  </header>
</template>

<style scoped>
.head { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 18px 22px 14px; border-bottom: 1px solid #dfe7dc; background: #fffffff5; }
.head-text { min-width: 0; }
.title-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
.title-row b { font-size: 19px; letter-spacing: -.03em; color: #2c503f; }
.title-row span { color: var(--text-2); font-size: 10px; }
.local-badge { display: inline-flex; margin-top: 6px; color: #4f6d4f; font-size: 10px; }
.local-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #638b57; margin: 5px 6px 0 0; }
.context { grid-column: 1 / -1; margin: 0; padding: 9px 12px; border: 1px solid #e2e8dd; border-radius: 12px; background: #f7f9f3; font-size: 11px; color: var(--text-2); line-height: 1.7; overflow-wrap: anywhere; }
.context > span { display: inline-block; margin-right: 9px; color: #45623f; font-weight: 600; }
button { border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.close { min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--r-sm); }
.tools { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; min-height: 30px; }
.tools span { margin-right: auto; color: var(--text-3); font-size: 11px; }
.tools button { min-height: 36px; padding: 0; }
button:hover { color: var(--brand-700); }
button:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 3px; }
@media(max-width:600px) { .head { padding: 12px 16px; gap: 8px 10px; }.close, .tools button { min-height: 44px; }.title-row span { display: none; }.context { padding: 7px 10px; } }
</style>
