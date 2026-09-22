<script setup lang="ts">
/** 平面图缩放控件：校园图与楼层图共用。 */
const emit = defineEmits<{ zoom: [factor: number]; reset: [] }>()
</script>

<template>
  <div class="controls">
    <button type="button" title="放大" @click="emit('zoom', 1.25)">＋</button>
    <button type="button" title="缩小" @click="emit('zoom', 0.8)">－</button>
    <button type="button" class="ctl-reset" title="重置视图" @click="emit('reset')">重置</button>
  </div>
</template>
