<script setup lang="ts">
/**
 * 提问区：输入框、固定示例问法、发送与「刷新数据」。
 *
 * 普通问答只有「刷新数据」推进共享时钟；已授权的演示准备另由编排层执行。
 * 它把时钟推到当前时刻再重问上一句，因此长时间停留后按一下就能拿到新的时间口径。
 */
import { computed, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import UiGlyph from '@/components/visual/UiGlyph.vue'
import { submitsQuestion } from './presentation/composerKeys'

const props = withDefaults(
  defineProps<{
    busy?: boolean
    /** 固定问法示例（来自助手模块的 ASK_EXAMPLES） */
    examples?: string[]
    scopeNote?: string
    showSuggestions?: boolean
    askedQuestions?: string[]
  }>(),
  { busy: false, examples: () => [], scopeNote: '', showSuggestions: true, askedQuestions: () => [] },
)

const emit = defineEmits<{ ask: [question: string]; refresh: [] }>()

const text = ref('')
/** 已用过的示例不再重复显示；点过的示例就是当前这一问 */
const used = ref<string[]>([])

const usable = computed(() => props.examples.filter((row) => row === '查看操作记录' || (!used.value.includes(row) && !props.askedQuestions.includes(row))))
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

function onKeydown(event: KeyboardEvent): void {
  if (!submitsQuestion(event)) return
  event.preventDefault()
  send()
}
</script>

<template>
  <div class="composer">
    <div v-if="showSuggestions && suggestions.length" class="suggestion-head"><span>接下来，可以这样问</span>
      <button v-if="moreSuggestions.length" class="more-toggle" type="button" :aria-expanded="moreOpen" aria-controls="assistant-more-questions" @click="moreOpen = !moreOpen">{{ moreOpen ? '收起问题' : '更多问题' }}</button>
    </div>
    <div v-if="showSuggestions && suggestions.length" class="examples" role="group" aria-label="推荐问题">
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
    <div v-if="showSuggestions && moreOpen && moreSuggestions.length" id="assistant-more-questions" class="more-examples" role="group" aria-label="更多预设问题">
      <button v-for="question in moreSuggestions" :key="question" type="button" class="example" :disabled="busy" @click="pick(question)">{{ question }}</button>
    </div>

    <form class="entry" aria-label="向小瞳提问" @submit.prevent="send">
      <textarea
        v-model="text"
        class="input"
        rows="2"
        name="assistant-question"
        aria-label="问小瞳"
        autocomplete="off"
        placeholder="把你想了解的情况，告诉小瞳…"
        :disabled="busy"
        @keydown="onKeydown"
      />
      <div class="entry-actions">
        <span class="key-hint">Enter 发送 · Shift + Enter 换行</span>
        <button class="refresh" type="button" :disabled="busy" title="按当前时刻重新读取数据" @click="emit('refresh')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          刷新数据
        </button>
        <AppButton class="send" type="submit" variant="primary" :disabled="!canSend" :loading="busy">{{ busy ? '处理中' : '发送' }}<UiGlyph v-if="!busy" class="send-arrow" name="arrow" :size="17" /></AppButton>
      </div>
    </form>
    <details class="explanation">
      <summary>提问对象与数据说明</summary>
      <p v-if="scopeNote" class="hint">{{ scopeNote }}</p>
      <p class="hint">查询只读；分析任务可在设置页唯一入口授权后补齐临时素材。小瞳使用本地规则与预设数据，不调用在线模型。刷新数据可重新核对“现在”。</p>
    </details>
  </div>
</template>

<style scoped src="./presentation/styles/composer.css"></style>
