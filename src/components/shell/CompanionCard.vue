<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import UiGlyph from '@/components/visual/UiGlyph.vue'

const emit = defineEmits<{ ask: [] }>()
// A browser display preference, independent of business data and assistant sessions.
const preferenceKey = 'zhutong-ui-companion-dismissed'
const visible = ref(true)
const restoreButton = ref<HTMLButtonElement | null>(null)
const askButton = ref<HTMLButtonElement | null>(null)

onMounted(() => {
  try {
    visible.value = localStorage.getItem(preferenceKey) !== '1'
  } catch {
    // Storage restrictions must not prevent closing the card in this page.
  }
})

async function setVisible(value: boolean): Promise<void> {
  visible.value = value
  try {
    if (value) localStorage.removeItem(preferenceKey)
    else localStorage.setItem(preferenceKey, '1')
  } catch {
    // The in-memory preference still applies when browser storage is unavailable.
  }
  await nextTick()
  const nextButton = value ? askButton.value : restoreButton.value
  nextButton?.focus()
}
</script>

<template>
  <section v-if="visible" class="side-companion" aria-label="小瞳引导卡">
    <div class="companion-head">
      <span>校园陪伴</span>
      <button type="button" class="companion-close" aria-label="关闭小瞳引导卡"
        title="关闭引导卡片" @click="setVisible(false)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <b>一起，把校园照顾好。</b>
    <p>从留意一处变化，<br />到接续每一步处置。</p>
    <button ref="askButton" type="button" class="companion-button" @click="emit('ask')">
      找小瞳聊聊 <UiGlyph name="arrow" :size="15" />
    </button>
  </section>
  <button v-else ref="restoreButton" type="button" class="companion-restore" @click="setVisible(true)">
    <UiGlyph name="eye" :size="15" />显示小瞳引导卡
  </button>
</template>

<style scoped>
.side-companion {
  position: relative;
  padding: 10px 16px 17px;
  border: 1px solid #dce7d7;
  border-radius: 19px;
  background: radial-gradient(circle at 100% 0, #e8dcb9 0, transparent 55%), #edf3e6;
  overflow: hidden;
}
.side-companion::after {
  content: '';
  position: absolute;
  right: -22px;
  bottom: -32px;
  width: 92px;
  height: 92px;
  border: 1px solid #8faa7b40;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 0 0 12px #97ad7f12, 0 0 0 24px #97ad7f0a;
}
.companion-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.companion-head > span { color: #536c50; font-size: 10px; }
.companion-close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-right: -7px;
  border: 0;
  border-radius: 50%;
  background: #ffffff80;
  color: #49624b;
  cursor: pointer;
  transition: background 120ms;
}
.companion-close:hover { background: #fff; }
.side-companion b { display: block; font-size: 13px; color: #3c583f; }
.side-companion p { margin-top: 6px; font-size: 11px; line-height: 1.8; color: #536947; }
.companion-button {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  min-height: 36px;
  justify-content: flex-end;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  padding: 6px 0;
  background: none;
  border: none;
  color: var(--brand-700);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.companion-restore {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 40px;
  margin-bottom: 8px;
  border: 1px dashed #cbd9c4;
  border-radius: 12px;
  background: #f4f7ef;
  color: #526a4f;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.companion-restore:hover { background: #eaf0e3; }
button:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .companion-close { transition: none; } }
</style>
