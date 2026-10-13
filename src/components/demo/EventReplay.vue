<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReplayNode } from '@/assistant/types'
import { useAssistantStore } from '@/assistant/session'
import { useEventsStore } from '@/stores/events'
import { formatDateTime } from '@/core/time'
const props = defineProps<{ eventId: string; nodes: ReplayNode[] }>()
const selected = ref('')
const node = computed(() => props.nodes.find(row => row.id === selected.value) ?? props.nodes[0])
watch(() => props.eventId, () => { selected.value = '' })
function select(id: string): void {
  selected.value = id
  const event = useEventsStore().byId(props.eventId)
  if (event) useAssistantStore().context = { eventId: event.id, pointId: event.pointId, replayNode: id }
}
</script>
<template>
  <section class="replay" aria-label="真实事件历史回放">
    <b>事件历史回放 · {{ nodes.length }} 个真实节点</b>
    <p>选择节点查看原始记录；回放不改变当前业务状态。</p>
    <div class="nodes"><button v-for="item in nodes" :key="item.id" type="button" :aria-pressed="node?.id === item.id" @click="select(item.id)">{{ item.title }}<small>{{ formatDateTime(item.at) }}</small></button></div>
    <dl v-if="node"><dt>节点</dt><dd>{{ node.title }} · {{ formatDateTime(node.at) }}</dd><dt>原记录</dt><dd>{{ node.recordNo || '办理记录' }}</dd><dt>依据</dt><dd>{{ node.detail }}</dd><dt v-if="node.ruleVersion">规则版本</dt><dd v-if="node.ruleVersion">{{ node.ruleVersion }} · {{ node.thresholds }}</dd><dt>操作者</dt><dd>{{ node.by }}</dd></dl>
    <p v-else>没有可回放记录。</p>
  </section>
</template>
<style scoped>
.replay { padding:12px; border:1px solid var(--line); border-radius:var(--r-sm); font-size:12px; }.replay p { color:var(--text-2); }.nodes { display:flex; overflow:auto; gap:8px; margin:12px 0; }.nodes button { flex-shrink:0; padding:9px; border:1px solid var(--line); background:var(--paper); color:var(--text); border-radius:4px; text-align:left; cursor:pointer; }.nodes button[aria-pressed=true] { border-color:var(--brand-500); background:var(--brand-050); }.nodes small { display:block; margin-top:4px; }.replay dl { display:grid; grid-template-columns:90px 1fr; gap:9px; }.replay dd { margin:0; line-height:1.6; }
</style>
