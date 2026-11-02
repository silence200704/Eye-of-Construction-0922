<script setup lang="ts">
import UiGlyph from "./UiGlyph.vue";
import { vEdgeLight } from "@/directives/edgeLight";
const actions = [
  {
    to: "/monitor",
    icon: "trend",
    title: "看一看监测",
    sub: "记录、趋势与变化",
    tone: "mint",
  },
  {
    to: "/inspection",
    icon: "task",
    title: "开始现场任务",
    sub: "点检与巡检，一步到位",
    tone: "sky",
  },
  {
    to: "/issues",
    icon: "issue",
    title: "跟进问题工单",
    sub: "从上报到复查，接续办理",
    tone: "sand",
  },
  {
    to: "/knowledge",
    icon: "book",
    title: "翻一翻知识库",
    sub: "查依据，看原文",
    tone: "lavender",
  },
];
</script>

<template>
  <nav class="quick-actions" aria-label="常用业务快捷入口">
    <RouterLink
      v-for="action in actions"
      :key="action.to"
      v-edge-light
      :to="action.to"
      class="action-card"
      :class="`action-card--${action.tone}`"
    >
      <span class="action-icon"><UiGlyph :name="action.icon" /></span>
      <span class="action-copy"
        ><b>{{ action.title }}</b
        ><small>{{ action.sub }}</small></span
      >
      <UiGlyph class="action-arrow" name="arrow" :size="17" />
    </RouterLink>
  </nav>
</template>

<style scoped>
.quick-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.action-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 18px 16px;
  background: #fdfefa;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
  transition:
    transform var(--motion-ui) var(--ease-out),
    box-shadow var(--motion-ui),
    border-color var(--motion-ui);
}
.action-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 43px;
  height: 43px;
  border-radius: 14px;
  background: #e3efe6;
  color: #4e7c5c;
}
.action-card--sky .action-icon {
  background: #e6eff7;
  color: #527b99;
}
.action-card--sand .action-icon {
  background: #f9eed6;
  color: #9b793a;
}
.action-card--lavender .action-icon {
  background: #edeaf3;
  color: #7a6c93;
}
.action-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.action-copy b {
  font-size: 13px;
  font-weight: 600;
}
.action-copy small {
  font-size: 11px;
  color: var(--text-3);
  text-wrap: pretty;
}
.action-arrow {
  flex: none;
  margin-left: auto;
  color: #80968a;
  transition: transform var(--motion-ui);
}
@media (hover: hover) {
  .action-card:hover {
    transform: translateY(-3px);
    border-color: #adcbbb;
    box-shadow: var(--shadow-lift);
  }
  .action-card:hover .action-arrow {
    transform: translateX(3px);
  }
}
.action-card:active {
  transform: translateY(1px) scale(0.99);
}
@media (max-width: 1250px) {
  .quick-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .action-card {
    padding: 15px 12px;
    gap: 9px;
  }
  .action-icon {
    width: 35px;
    height: 35px;
  }
  .action-arrow {
    display: none;
  }
  .quick-actions {
    gap: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .action-card,
  .action-arrow {
    transition: none;
    transform: none !important;
  }
}
</style>
