<script setup lang="ts">
/**
 * 小瞳形象（统一形象，分层动画）。
 *
 * 悬浮入口、面板头部与回答头像都用这一个组件、同一张图（`xiaotong.png`），
 * 但**动效分层**：`float`（持续浮动）永远在跑，状态只叠加自己的那几层，
 * 因此"找到答案点一下头"之后不会把浮动替换掉、更不会让入口长期静止 ——
 * 旧实现把 `found` 直接写在 `.mascot` 的 animation 上，一次性动画播完就彻底停了。
 *
 * 层级（由内到外）：
 *   halo   柔和呼吸光环（常驻，随状态换色）
 *   orbit  外侧细轨道（缓慢旋转，常驻）
 *   float  形象本体（缓慢上下浮动，常驻）
 *   scan   检索中的扫描环（`searching` 期间持续运转）
 *   spark  找到证据的一次性亮光（`found` 时闪一下）
 *   lens   镜头高光（悬停或检索时点亮）
 *
 * `quiet` 给回答里的小头像用：只留静态形象，整页不跟着动。
 * `paused` 只暂停装饰动画（拖动中、红色预警弹窗出现时由父级设置），不改变状态语义。
 * 系统"减少动态效果"时停用位移与旋转，状态改由光环颜色与文字承载。
 */
import { computed } from 'vue'
import xiaotongUrl from './xiaotong.png'

const props = withDefaults(
  defineProps<{
    state: 'idle' | 'searching' | 'found' | 'empty'
    paused?: boolean
    /** 回答里的小头像：只做静态展示，不参与动效 */
    quiet?: boolean
    /** 指针悬停：点亮镜头高光 */
    hover?: boolean
    size?: number
  }>(),
  { paused: false, quiet: false, hover: false, size: 80 },
)

const LABEL: Record<typeof props.state, string> = {
  idle: '小瞳待机',
  searching: '小瞳正在检索本地数据',
  found: '小瞳找到证据',
  empty: '小瞳没有找到可用数据',
}

const label = computed(() => LABEL[props.state])
const pixels = computed(() => Math.min(96, Math.max(24, props.size)))
</script>

<template>
  <span
    class="mascot-zone"
    :class="{ 'mascot-zone--quiet': quiet }"
    :data-state="state"
    :data-paused="paused ? 'true' : 'false'"
    :data-hover="hover ? 'true' : 'false'"
    :style="{ width: `${pixels}px`, height: `${pixels}px` }"
    role="img"
    :aria-label="label"
  >
    <span class="halo" aria-hidden="true" />
    <span class="orbit" aria-hidden="true" />
    <span class="float-layer">
      <img class="mascot" :src="xiaotongUrl" alt="" aria-hidden="true" draggable="false" />
      <span class="lens" aria-hidden="true" />
    </span>
    <span class="scan" aria-hidden="true" />
    <span class="spark" aria-hidden="true" />
  </span>
</template>

<style scoped>
.mascot-zone {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
}

/* 柔和呼吸光环：常驻，让入口在任何时刻都有起伏 */
.halo {
  position: absolute;
  inset: -12%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(20, 134, 149, 0.28) 0%, rgba(20, 134, 149, 0) 68%);
  animation: mascot-halo 3.6s ease-in-out infinite;
  z-index: 0;
}

/* 外侧细轨道：慢速旋转，提供"活着"的持续感 */
.orbit {
  position: absolute;
  inset: -4%;
  border-radius: 50%;
  border: 1px dashed var(--brand-200);
  opacity: 0.7;
  animation: mascot-orbit 9s linear infinite;
  z-index: 1;
}

.float-layer {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  z-index: 2;
  animation: mascot-float 4.6s ease-in-out infinite;
}

.mascot {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  filter: drop-shadow(0 4px 8px rgba(11, 87, 98, 0.18));
}

/* 镜头高光：悬停或检索时点亮 */
.lens {
  position: absolute;
  left: 30%;
  top: 30%;
  width: 34%;
  height: 34%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0) 70%);
  opacity: 0;
  transition: opacity 0.25s ease;
}

.scan {
  position: absolute;
  inset: -10%;
  border: 2px solid transparent;
  border-top-color: var(--brand-500);
  border-right-color: var(--brand-200);
  border-radius: 50%;
  opacity: 0;
  z-index: 3;
}

.spark {
  position: absolute;
  right: 4%;
  top: 8%;
  width: 20%;
  height: 20%;
  border-radius: 50%;
  background: var(--st-orange);
  box-shadow: 0 0 0 5px var(--st-orange-bg);
  opacity: 0;
  z-index: 4;
}

/* ---- 状态叠加：注意都加在"附加层"上，不替换 .float-layer 的浮动 ---- */

.mascot-zone[data-state='searching'] .scan {
  opacity: 1;
  animation: mascot-orbit 1.1s linear infinite;
}

.mascot-zone[data-state='searching'] .lens { opacity: 0.9; }
.mascot-zone[data-state='searching'] .halo { animation-duration: 1.8s; }

/* 一次性反馈：闪一下 + 点一次头，浮动层不动，因此之后仍在动 */
.mascot-zone[data-state='found'] .spark { animation: mascot-sparkle 0.8s ease-out 1; }
.mascot-zone[data-state='found'] .mascot { animation: mascot-nod 0.6s ease-in-out 1; }

/* 无数据：整体压暗，光环收敛，但浮动仍在（入口不静止） */
.mascot-zone[data-state='empty'] .mascot { opacity: 0.62; }
.mascot-zone[data-state='empty'] .halo {
  background: radial-gradient(circle, rgba(110, 125, 133, 0.22) 0%, rgba(110, 125, 133, 0) 68%);
  animation-duration: 5.2s;
}
.mascot-zone[data-state='empty'] .orbit { border-color: var(--line-strong); }

/* 悬停反馈：父级知道指针在哪，这里只负责"点亮镜头" */
.mascot-zone[data-hover='true'] .lens,
.mascot-zone[data-hover='true'] .orbit { opacity: 1; }

/* 回答里的小头像：只做静态展示 */
.mascot-zone--quiet .halo,
.mascot-zone--quiet .orbit,
.mascot-zone--quiet .scan,
.mascot-zone--quiet .spark { display: none; }
.mascot-zone--quiet .float-layer { animation: none; }

/* 拖动中 / 红色预警弹窗出现时：只暂停装饰动画，不改变状态语义 */
.mascot-zone[data-paused='true'] *,
.mascot-zone[data-paused='true'] *::before,
.mascot-zone[data-paused='true'] *::after {
  animation-play-state: paused !important;
}

@keyframes mascot-float {
  0%, 100% { transform: translateY(4px) rotate(-1.2deg); }
  50% { transform: translateY(-4px) rotate(1.2deg); }
}
@keyframes mascot-halo {
  0%, 100% { transform: scale(0.92); opacity: 0.55; }
  50% { transform: scale(1.1); opacity: 1; }
}
@keyframes mascot-orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes mascot-nod {
  0%, 100% { transform: rotate(0); }
  45% { transform: rotate(8deg) translateY(4%); }
}
@keyframes mascot-sparkle {
  0%, 100% { opacity: 0; transform: scale(0.5); }
  35% { opacity: 1; transform: scale(1.15); }
}

/*
 * 减少动态效果：停用位移与旋转，但**保留**光环与轨道静态可见，
 * 状态改由颜色（光环/轨道）与文字（入口上的状态标签）承载。
 */
@media (prefers-reduced-motion: reduce) {
  .mascot-zone *,
  .mascot-zone *::before,
  .mascot-zone *::after { animation: none !important; }
  .mascot-zone[data-state='searching'] .scan { opacity: 1; }
  .mascot-zone[data-state='found'] .spark { opacity: 1; }
  .mascot-zone--quiet .lens { display: none; }
}
</style>
