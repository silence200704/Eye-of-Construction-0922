<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import WorkspaceWelcome from "./WorkspaceWelcome.vue";
const route = useRoute();
const copy: Record<string, { title: string; description: string }> = {
  "/monitor": {
    title: "留意每一次，细微的变化。",
    description: "把记录留完整，让变化有依据。录入、修订与查询，都从这里开始。",
  },
  "/trend": {
    title: "沿着时间，看见变化。",
    description: "把同一测点的读数连起来，带着时间、单位和依据一起看。",
  },
  "/alarms": {
    title: "每一声提醒，都认真回应。",
    description: "先核实，再处置。按优先级跟进预警，让每一步都有回音。",
  },
  "/issues": {
    title: "从发现，到妥善解决。",
    description: "上报、维修、验收与复查，让现场的问题接续办理。",
  },
  "/inspection": {
    title: "走近现场，把细节看清。",
    description: "带着任务到现场，留下真实记录，及时上报发现的问题。",
  },
  "/maintenance": {
    title: "日常多一分用心。",
    description: "按计划检查、保养与留痕，把设备维护落实到每一次任务。",
  },
  "/knowledge": {
    title: "每一个判断，都能找到依据。",
    description: "从本地知识中查找解释，展开引用，回到原文核对。",
  },
  "/media": {
    title: "把现场，放在一起细看。",
    description:
      "保留影像来源与时间，对照查看变化；演示分析与监测结论分别展示。",
  },
  "/settings": {
    title: "把工作空间，照顾妥当。",
    description: "管理数据、查看配置与备份，让下一次演示也从容开始。",
  },
};
const content = computed(
  () =>
    copy[route.path] ?? {
      title: String(route.meta.title ?? "校园守护工作台"),
      description: String(
        route.meta.sub ?? "围绕同一份业务记录，查看、核实与接续办理。",
      ),
    },
);
</script>

<template>
  <WorkspaceWelcome
    v-if="route.path !== '/' && route.path !== '/dashboard'"
    class="workspace-intro"
    :title="content.title"
    :description="content.description"
    compact
  />
</template>

<style scoped>
.workspace-intro {
  margin-bottom: 22px;
}
@media print {
  .workspace-intro {
    display: none;
  }
}
</style>
