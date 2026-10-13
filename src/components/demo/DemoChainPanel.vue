<script setup lang="ts">
import ShowcaseControls from './ShowcaseControls.vue'
import ManualDataPanel from './ManualDataPanel.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
</script>
<template>
  <ManualDataPanel />
  <SectionCard title="完整自动演示" sub="一次启动，实际业务接口逐步执行；独立演示库可以随时复位" marked>
    <ShowcaseControls />
  </SectionCard>
</template>
