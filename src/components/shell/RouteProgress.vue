<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { createNavigationActivity } from "@/core/ui/navigationActivity";
const { pending, dispose } = createNavigationActivity(useRouter());
onBeforeUnmount(dispose);
</script>

<template>
  <div
    v-if="pending"
    class="route-progress"
    role="progressbar"
    aria-label="正在打开页面"
  >
    <span />
  </div>
</template>

<style scoped>
.route-progress {
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  overflow: hidden;
  background: var(--brand-050);
}
span {
  display: block;
  height: 100%;
  width: 35%;
  background: var(--brand-500);
  animation: route-progress 900ms ease-in-out infinite;
}
@keyframes route-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(385%);
  }
}
@media (prefers-reduced-motion: reduce) {
  span {
    width: 100%;
    animation: none;
  }
}
</style>
