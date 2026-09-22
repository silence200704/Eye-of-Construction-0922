<script setup lang="ts">
/**
 * 只负责表头、空状态与表体插槽；行内容由各页面显式书写，
 * 避免为一个通用表格引入过度抽象，也保证每张表的列完全可控。
 */
defineProps<{
  columns: { key: string; label: string; align?: 'left' | 'right' | 'center'; width?: string }[]
  rowCount: number
  empty?: string
}>()
</script>

<template>
  <div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :style="{ width: column.width, textAlign: column.align ?? 'left' }"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rowCount === 0">
          <td class="tbl-empty" :colspan="columns.length">{{ empty ?? '暂无记录' }}</td>
        </tr>
        <slot v-else />
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tbl-wrap {
  overflow-x: auto;
}
</style>
