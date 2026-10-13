<script setup lang="ts">
import { computed } from 'vue'
import { receipts } from '@/core/operations/receipts'
import { formatDateTime } from '@/core/time'
defineProps<{ objectId?: string }>()
const latest = computed(() => receipts.value[receipts.value.length - 1])
</script>
<template>
  <aside v-if="latest && (!objectId || latest.id === objectId)" class="receipt" aria-label="实际提交回执">
    <b>{{ latest.result }} · {{ latest.number }}</b><span>{{ latest.before }} → {{ latest.after }}</span>
    <small>{{ latest.actor }} · {{ formatDateTime(latest.at) }} · 实际附件 {{ latest.attachmentCount }} 份</small>
    <p>{{ latest.action }}</p><RouterLink :to="{ path: latest.path, query: latest.query }">下一办理入口／查看结果</RouterLink>
  </aside>
</template>
<style scoped>
.receipt { padding:10px 14px; border:1px solid var(--brand-200); background:var(--brand-050); border-radius:var(--r-sm); display:flex; gap:10px; flex-wrap:wrap; font-size:12px; }.receipt small { color:var(--text-2); }.receipt p { width:100%; margin:0; }.receipt a { color:var(--brand-700); }
</style>
