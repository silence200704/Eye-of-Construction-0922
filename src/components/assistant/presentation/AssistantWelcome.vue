<script setup lang="ts">
import { computed } from 'vue'
import XiaotongAvatar from '../XiaotongAvatar.vue'
import UiGlyph from '@/components/visual/UiGlyph.vue'
import { vEdgeLight } from '@/directives/edgeLight'

const props = defineProps<{ questions: string[]; scopeNote: string; busy: boolean; paused: boolean }>()
const emit = defineEmits<{ ask: [question: string] }>()
const suggestions = computed(() => props.questions.slice(0, 3))
const capabilities = [
  { icon: 'trend', text: '监测读数' }, { icon: 'issue', text: '预警依据' },
  { icon: 'task', text: '问题工单' }, { icon: 'book', text: '本地知识' },
]
function iconOf(question: string): string {
  if (/异常|预警/.test(question)) return 'issue'
  if (/趋势|读数/.test(question)) return 'trend'
  if (/什么|功能/.test(question)) return 'book'
  return 'campus'
}
</script>

<template>
  <section class="assistant-welcome" aria-label="小瞳欢迎与快捷提问">
    <div class="welcome-mascot" aria-hidden="true"><XiaotongAvatar state="idle" quiet :paused="paused" :size="76" /></div>
    <span class="eyebrow">你身边的校园守护助手</span>
    <h2>你好，我是小瞳<span>。</span></h2>
    <p class="welcome-copy">从一个问题开始，一起看清变化，<br />找到当前数据与可核对的依据。</p>
    <div class="capabilities" aria-label="可以协助查看的内容">
      <span v-for="item in capabilities" :key="item.text"><UiGlyph :name="item.icon" :size="14" />{{ item.text }}</span>
    </div>
    <div class="suggestion-label"><b>从这里开始聊聊</b><span>点一张卡片，直接提问</span></div>
    <div class="starter-cards" role="group" aria-label="开始提问">
      <button v-for="(question, index) in suggestions" :key="question" v-edge-light type="button"
        class="starter-card" :class="`starter-card--${index}`" :disabled="busy" @click="emit('ask', question)">
        <span class="starter-icon"><UiGlyph :name="iconOf(question)" :size="21" /></span>
        <span class="starter-question">{{ question }}</span><UiGlyph name="arrow" :size="17" class="starter-arrow" />
      </button>
    </div>
    <div class="scope-tip"><UiGlyph name="points" :size="17" /><p>{{ scopeNote }}<span>业务事实与知识引用会分别展示，方便你回到原始依据核对。</span></p></div>
  </section>
</template>

<style scoped>
.assistant-welcome { display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 620px; margin: auto; padding: 12px 6px; }
.welcome-mascot { position: relative; display: grid; place-items: center; width: 108px; height: 100px; margin-bottom: 6px; }
.welcome-mascot::before { content: ''; position: absolute; inset: 3px 7px; border-radius: 50%; background: #e7efdf; box-shadow: 0 0 0 10px #eaf1e349, 0 0 0 22px #eaf1e325; }
.eyebrow { margin-top: 10px; color: #60765f; font-size: 11px; letter-spacing: .08em; }
h2 { font-size: clamp(25px, 2.4vw, 31px); font-weight: 650; color: #244b40; letter-spacing: -.035em; line-height: 1.4; margin: 7px 0 10px; }h2 span { color: #90a77d; }
.welcome-copy { color: var(--text-2); font-size: 13px; line-height: 1.9; text-align: center; }
.capabilities { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 14px; margin: 19px 0 28px; }
.capabilities span { display: inline-flex; align-items: center; gap: 5px; color: #566f63; font-size: 11px; }
.capabilities svg { color: #749281; }
.suggestion-label { align-self: stretch; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.suggestion-label b { font-size: 12px; font-weight: 600; color: #466051; }.suggestion-label span { color: var(--text-3); font-size: 10px; }
.starter-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%; }
.starter-card { display: flex; align-items: center; gap: 10px; min-height: 82px; min-width: 0; padding: 17px 15px; border: 1px solid #d9e6d7; border-radius: 18px; background: #f6faef; color: #355849; font: inherit; text-align: left; cursor: pointer; box-shadow: 0 3px 10px #254c3605; transition: transform 150ms var(--ease-out), box-shadow 150ms; }
.starter-card--1 { background: #fffbf1; border-color: #e9dfc8; }.starter-card--2 { grid-column: 1 / -1; background: #f1f7f8; border-color: #d9e6e8; min-height: 70px; }
.starter-icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 11px; background: #e5efde; color: #5d8058; }
.starter-card--1 .starter-icon { background: #f7edda; color: #97743b; }.starter-card--2 .starter-icon { background: #e2edf0; color: #567d85; }
.starter-question { font-size: 12px; line-height: 1.7; font-weight: 600; overflow-wrap: anywhere; }
.starter-arrow { flex: none; margin-left: auto; color: #7b9485; }
.starter-card:disabled { opacity: .55; cursor: wait; }.starter-card:active:not(:disabled) { transform: scale(.985); }
.scope-tip { display: flex; align-items: flex-start; gap: 9px; align-self: stretch; margin-top: 20px; padding: 13px 15px; background: #f7f9f4; border: 1px dashed #d8e2d2; border-radius: 14px; color: #4f674f; }
.scope-tip > svg { flex: none; margin-top: 2px; }.scope-tip p { font-size: 11px; line-height: 1.8; }.scope-tip span { display: block; color: var(--text-3); margin-top: 3px; }
@media (hover: hover) { .starter-card:hover:not(:disabled) { transform: translateY(-2px); box-shadow: var(--shadow-lift); } }
@media (max-width: 480px) { .assistant-welcome { padding-top: 0; }.welcome-mascot { height: 86px; }.capabilities { gap: 8px 12px; margin-block: 15px 23px; }.starter-cards { grid-template-columns: minmax(0, 1fr); }.starter-card { grid-column: auto; min-height: 62px; padding: 12px 14px; }.suggestion-label span { display: none; }.scope-tip { margin-top: 14px; } }
@media (prefers-reduced-motion: reduce) { .starter-card { transition: none; transform: none !important; } }
</style>
