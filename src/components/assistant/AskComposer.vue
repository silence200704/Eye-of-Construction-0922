<script setup lang="ts">
/**
 * 提问区：输入框、固定示例问法、发送与「刷新数据」。
 *
 * 普通问答只有「刷新数据」推进共享时钟；已授权的演示准备另由编排层执行。
 * 它把时钟推到当前时刻再重问上一句，因此长时间停留后按一下就能拿到新的时间口径。
 */
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    busy?: boolean
    /** 固定问法示例（来自助手模块的 ASK_EXAMPLES） */
    examples?: string[]
    scopeNote?: string
  }>(),
  { busy: false, examples: () => [], scopeNote: '' },
)

const emit = defineEmits<{ ask: [question: string]; refresh: [] }>()

const text = ref('')
/** 已用过的示例不再重复显示；点过的示例就是当前这一问 */
const used = ref<string[]>([])

const usable = computed(() => props.examples.filter((row) => row === '查看操作记录' || !used.value.includes(row)))
const moreOpen = ref(false)
const suggestions = computed(() => usable.value.slice(0, 3))
const moreSuggestions = computed(() => usable.value.slice(3))
const canSend = computed(() => !props.busy && text.value.trim() !== '')

function send(): void {
  if (!canSend.value) return
  emit('ask', text.value.trim())
  text.value = ''
}

function pick(question: string): void {
  if (props.busy) return
  used.value = [...used.value, question]
  moreOpen.value = false
  emit('ask', question)
}
</script>

<template>
  <div class="composer">
    <div class="suggestion-head"><span>可以这样问</span>
      <button v-if="moreSuggestions.length" class="more-toggle" type="button" :aria-expanded="moreOpen" aria-controls="assistant-more-questions" @click="moreOpen = !moreOpen">{{ moreOpen ? '收起问题' : '更多问题' }}</button>
    </div>
    <div class="examples" aria-label="推荐问题">
      <button
        v-for="question in suggestions"
        :key="question"
        type="button"
        class="example"
        :disabled="busy"
        @click="pick(question)"
      >
        {{ question }}
      </button>
    </div>
    <div v-if="moreOpen && moreSuggestions.length" id="assistant-more-questions" class="more-examples" aria-label="更多预设问题">
      <button v-for="question in moreSuggestions" :key="question" type="button" class="example" :disabled="busy" @click="pick(question)">{{ question }}</button>
    </div>

    <form class="entry" @submit.prevent="send">
      <input
        v-model="text"
        class="input"
        type="text"
        name="assistant-question"
        aria-label="问小瞳"
        autocomplete="off"
        placeholder="问小瞳：分析裂缝照片、定位传感器或查看处置进度"
        :disabled="busy"
        @keydown.enter.prevent="send"
      />
      <button class="send" type="submit" :disabled="!canSend">{{ busy ? '检索中…' : '发送' }}</button>
      <button class="refresh" type="button" :disabled="busy" title="按当前时刻重新读取本地数据" @click="emit('refresh')">
        刷新数据
      </button>
    </form>
    <details class="explanation">
      <summary>提问对象与数据说明</summary>
      <p v-if="scopeNote" class="hint">{{ scopeNote }}</p>
      <p class="hint">查询只读；分析任务可在设置页唯一入口授权后补齐临时素材。小瞳使用本地规则与预设数据，不调用在线模型。刷新数据可重新核对“现在”。</p>
    </details>
  </div>
</template>

<style scoped>
.composer { display: grid; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line); background: var(--paper); max-height: 44dvh; overflow-y: auto; }
.suggestion-head { display: flex; align-items: center; justify-content: space-between; color: var(--text-2); font-size: 11px; }
.more-toggle { border: 0; background: none; color: var(--brand-700); padding: 4px 0 4px 12px; font: inherit; cursor: pointer; }
.more-toggle:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
.more-examples { display: grid; gap: 6px; max-height: 150px; overflow-y: auto; padding: 4px 2px; }
.more-examples .example { text-align: left; }
.explanation { color: var(--text-3); font-size: 11px; }
.explanation summary { cursor: pointer; padding: 2px 0; }
.explanation .hint { margin-top: 6px; }

.examples { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0 4px; }
.example {
  padding: 8px 12px; min-height: 34px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}
.example:hover:not(:disabled), .example:focus-visible { border-color: var(--brand-500); color: var(--brand-700); background: var(--brand-050); }

.entry { display: flex; gap: 6px; }
.input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.input:focus-visible { border-color: var(--brand-500); outline: none; box-shadow: var(--focus-ring); }

.send, .refresh {
  height: 42px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}
.send { border: 1px solid var(--brand-600); background: var(--brand-600); color: #fff; }
.send:disabled { opacity: 0.55; cursor: default; }
.refresh { border: 1px solid var(--line-strong); background: var(--paper); color: var(--text); }
.refresh:hover:not(:disabled) { border-color: var(--brand-500); color: var(--brand-700); }

.hint { margin: 0; color: var(--text-3); font-size: 11.5px; line-height: 1.6; }
.composer > .hint:first-child { padding: 8px 10px; border-radius: var(--r-sm); background: var(--brand-050); color: var(--brand-700); }
@media (max-width: 600px) { .composer { padding: 10px 12px; }.input { font-size: 16px; }.example, .send, .refresh { min-height: 44px; }.more-examples .example { white-space: normal; }.more-toggle { min-height: 32px; } }
</style>
