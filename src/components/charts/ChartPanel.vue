<script setup lang="ts">
/**
 * 图表外壳：只负责"有数据画图 / 没数据显示空态"这一个分叉。
 *
 * 三张图各自只管自己的 option 与点击含义；空态文案由调用方按数据口径给出
 * （例如"暂无有效读数"），这里不编任何占位数字。
 */
import EmptyState from '@/components/ui/EmptyState.vue'

defineProps<{
  /** 非空即显示空态，内容就是这句文案 */
  empty: string
  /** 空态下的补充说明（口径、为什么不显示 0） */
  hint?: string
}>()
</script>

<template>
  <div class="panel">
    <EmptyState v-if="empty !== ''" :title="empty" :sub="hint ?? ''" />
    <slot v-else />
  </div>
</template>

<style scoped>
.panel { min-height: 120px; }
</style>
