<script setup lang="ts">
/** 只控制讲解节奏和场景选择；不写任何业务表。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SpatialTourStep } from '@/assistant/guide/spatialTour'

const props = defineProps<{ steps: SpatialTourStep[]; pointCode: string; eventId: string | null }>()
const emit = defineEmits<{ step: [step: SpatialTourStep]; close: []; openEvent: [eventId: string] }>()
const index = ref(0)
const playing = ref(true)
const secondsLeft = ref(15)
const current = computed(() => props.steps[index.value])
let timer: ReturnType<typeof setInterval> | null = null

function clearTimer(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}

function tick(): void {
  if (!playing.value || document.hidden) return
  secondsLeft.value -= 1
  if (secondsLeft.value > 0) return
  if (index.value === props.steps.length - 1) {
    playing.value = false
    clearTimer()
    return
  }
  go(index.value + 1)
}

function go(next: number): void {
  index.value = Math.max(0, Math.min(next, props.steps.length - 1))
  secondsLeft.value = 15
  const step = props.steps[index.value]
  if (step !== undefined) emit('step', step)
}

function toggle(): void {
  playing.value = !playing.value
  if (playing.value && timer === null) timer = setInterval(tick, 1000)
}

onMounted(() => {
  go(0)
  timer = setInterval(tick, 1000)
})
onBeforeUnmount(clearTimer)
</script>

<template>
  <section class="tour" aria-label="小瞳 3D 空间讲解" aria-live="polite">
    <div class="tour-head">
      <div class="tour-heading">
        <span class="eyebrow"><span class="pulse" aria-hidden="true" /> 小瞳空间讲解 <span class="point-code">{{ pointCode }}</span></span>
        <h3>{{ current?.title }}</h3>
      </div>
      <button type="button" class="close" aria-label="结束空间讲解" @click="emit('close')">×</button>
    </div>
    <p class="tour-detail">{{ current?.detail }}</p>
    <div class="tour-meta"><strong>第 {{ index + 1 }} / {{ steps.length }} 步</strong><span>{{ playing ? `${secondsLeft} 秒后继续` : '讲解已暂停' }}</span></div>
    <div class="progress" :aria-label="`讲解第 ${index + 1} 步，共 ${steps.length} 步`">
      <span v-for="(step, i) in steps" :key="step.stage" :class="{ active: i <= index }" />
    </div>
    <div class="tour-actions">
      <button type="button" :disabled="index === 0" @click="go(index - 1)">上一步</button>
      <button type="button" class="primary" @click="toggle">{{ playing ? '暂停讲解' : '继续讲解' }}</button>
      <button type="button" :disabled="index === steps.length - 1" @click="go(index + 1)">下一步</button>
    </div>
    <p class="foot">演示视角 · 不修改业务数据</p>
    <button v-if="index === steps.length - 1 && eventId !== null" type="button" class="event" @click="emit('openEvent', eventId)">打开原预警事件核对证据 →</button>
  </section>
</template>

<style scoped>
.tour { position: absolute; left: 14px; bottom: 14px; z-index: 3; box-sizing: border-box; width: min(410px, calc(100% - 28px)); display: grid; gap: 10px; padding: 16px; border: 1px solid rgb(140 212 218 / 75%); border-radius: 16px; background: rgb(250 254 253 / 97%); box-shadow: 0 18px 44px rgb(12 48 56 / 23%); color: #193e47; backdrop-filter: blur(14px); }
.tour::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; border-radius: 16px 0 0 16px; background: #0d8b98; }
.tour-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.tour-heading { min-width: 0; }
.eyebrow { display: flex; align-items: center; gap: 6px; color: #087b87; font-size: 11px; font-weight: 800; letter-spacing: .02em; }
.point-code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #67848a; font-family: var(--font-mono); font-size: 10px; font-weight: 500; }
.pulse { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #10a8a9; box-shadow: 0 0 0 3px #d9f4ef; }
.tour-head h3 { margin: 6px 0 0; font-size: 19px; line-height: 1.25; letter-spacing: -.02em; }
.tour .tour-detail { min-height: 44px; margin: 0; color: #31565e; font-size: 12.5px; line-height: 1.65; }
.tour-meta { display: flex; justify-content: space-between; gap: 8px; color: #6b878c; font-size: 11px; }
.tour-meta strong { color: #087b87; }
.close { flex: none; display: grid; place-items: center; width: 27px; height: 27px; padding: 0; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #5d7b80; font-size: 20px; cursor: pointer; }
.close:hover { background: #e7f4f2; }
.progress { display: flex; gap: 5px; }
.progress span { height: 5px; flex: 1; border-radius: 5px; background: #d5e7e5; }
.progress span.active { background: #0b8997; }
.tour-actions { position: static; inset: auto; display: grid; grid-template-columns: 1fr 1.35fr 1fr; gap: 7px; min-width: 0; }
.tour-actions button, .event { min-width: 0; min-height: 32px; padding: 5px 8px; border: 1px solid #bedbdc; border-radius: 7px; background: white; color: #11616d; font: inherit; font-size: 11.5px; white-space: nowrap; cursor: pointer; }
.tour-actions button.primary { border-color: #0c8491; background: #0c8491; color: white; font-weight: 700; }
.tour-actions button:disabled { opacity: .45; cursor: default; }
.event { justify-self: start; font-weight: 700; }
.tour .foot { margin: -3px 0 0; color: #82989b; font-size: 10px; }
.tour button:focus-visible { outline: 2px solid #087b87; outline-offset: 2px; }
@media (max-width: 700px) { .tour { left: 8px; bottom: 8px; width: min(410px, calc(100% - 16px)); padding: 12px; } }
@media (prefers-reduced-motion: reduce) { .tour { backdrop-filter: none; } }
</style>
