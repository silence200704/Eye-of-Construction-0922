<script setup lang="ts">
import type { InstallationView } from '@/core/spatial/installation'

defineProps<{ view: InstallationView }>()
</script>

<template>
  <section class="section-card" :class="{ 'section-card--slab': view.slab }" :aria-label="`${view.title}：${view.pointCode}`">
    <header><div><small>测点安装 · 档案与示意</small><strong>{{ view.title }} <span>· {{ view.pointCode }}</span></strong></div><i>示意</i></header>
    <div class="diagram" aria-hidden="true">
      <span class="diagram__surface"><b>{{ view.surfaceLabel }}</b></span>
      <span class="diagram__core">{{ view.coreLabel }}</span>
      <span class="diagram__side">{{ view.roomLabel }} →</span>
    </div>
    <dl>
      <div><dt>设备编号</dt><dd>{{ view.deviceCode }}</dd></div>
      <div><dt>设备 / 型号</dt><dd>{{ view.deviceName }} · {{ view.model }}</dd></div>
      <div><dt>档案位置</dt><dd>{{ view.archivePosition }}</dd></div>
      <div><dt>测量方向</dt><dd>{{ view.direction }}</dd></div>
      <div><dt>档案安装日</dt><dd>{{ view.installDate }}</dd></div>
      <div><dt>模型高度</dt><dd>{{ view.modelHeight }}</dd></div>
    </dl>
    <p>{{ view.note }}</p>
  </section>
</template>

<style scoped>
.section-card { position: absolute; top: 12px; right: 12px; width: min(340px, 54%); padding: 13px; border: 1px solid #a9cdd2; border-radius: 10px; background: rgb(250 254 253 / 96%); color: #214751; box-shadow: 0 9px 26px rgb(24 72 80 / 15%); pointer-events: none; }
header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
header div { display: grid; gap: 2px; } header small { color: #47737b; font-size: 10px; }
header strong { font-size: 14px; } header strong span { font-size: 11px; }
header i { padding: 2px 5px; border-radius: 3px; background: #dbeff0; color: #087f8c; font-size: 10px; font-style: normal; }
.diagram { position: relative; height: 84px; margin: 9px 0; border-radius: 5px; background: linear-gradient(90deg, #e8f0ec, #f9fcfa); overflow: hidden; }
.diagram__surface { position: absolute; left: 22%; top: 7px; bottom: 7px; width: 32%; border: 1px solid #9eb6ba; background: repeating-linear-gradient(145deg, #cad9d9 0 5px, #e8efed 5px 10px); }
.diagram__surface b { position: absolute; left: 4px; top: 5px; font-size: 9px; color: #526d73; }
.diagram__core { position: absolute; left: 32%; top: 29px; padding: 3px 5px; border: 1px solid #087f8c; border-radius: 3px; background: rgb(41 176 179 / 70%); color: #073f49; font-size: 9px; white-space: nowrap; }
.diagram__side { position: absolute; right: 6px; bottom: 8px; font-size: 10px; color: #54747c; }
.section-card--slab .diagram__surface { left: 10%; right: 10%; top: 38px; bottom: 14px; width: auto; }
.section-card--slab .diagram__core { left: 34%; top: 21px; }
dl { display: grid; gap: 5px; margin: 0; } dl div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px; align-items: baseline; }
dt { color: #688189; font-size: 11px; } dd { margin: 0; color: #244a52; font-size: 11.5px; line-height: 1.4; overflow-wrap: anywhere; }
p { margin: 9px 0 0; padding-top: 7px; border-top: 1px solid #dce9e8; color: #667f85; font-size: 10.5px; line-height: 1.5; }
@media (max-width: 720px) { .section-card { width: min(270px, 70%); max-height: 75%; overflow: auto; } }
</style>
