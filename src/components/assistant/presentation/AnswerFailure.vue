<script setup lang="ts">
import { computed } from 'vue'
import { answerFailure } from '@/core/app/loadFailure'

const props = defineProps<{ error: string }>()
const failure = computed(() => answerFailure(props.error))

function reload(): void {
  // 用户显式刷新，不自动重放可能补齐临时数据的演示指令。
  window.location.reload()
}
</script>

<template>
  <div class="notice notice--warn answer-failure" role="alert">
    <p>{{ failure.message }}</p>
    <template v-if="failure.reload">
      <p class="reload-note">刷新保留已保存的业务数据；当前对话、会话影像和自动补齐授权会清除。刷新后请从系统设置的唯一入口重新开启本次演示。</p>
      <button type="button" class="reload-button" @click="reload">刷新加载新版</button>
      <details class="reload-detail">
        <summary>查看技术信息</summary>
        <p>{{ error }}</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.answer-failure { display: block; }
p { margin: 0; }
.reload-note { margin-top: 8px; font-size: 12px; line-height: 1.6; }
.reload-button { margin-top: 12px; padding: 9px 15px; border: 1px solid var(--brand-600); border-radius: 8px; background: var(--brand-600); color: white; cursor: pointer; font: inherit; }
.reload-button:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 3px; }
.reload-detail { margin-top: 10px; font-size: 12px; overflow-wrap: anywhere; }
.reload-detail summary { cursor: pointer; }
</style>
