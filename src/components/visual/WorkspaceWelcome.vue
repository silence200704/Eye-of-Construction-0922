<script setup lang="ts">
import CampusScene from "./CampusScene.vue";
withDefaults(
  defineProps<{
    title: string;
    description: string;
    eyebrow?: string;
    compact?: boolean;
  }>(),
  { eyebrow: "校园守护 · 每一步，都有迹可循", compact: false },
);
</script>

<template>
  <section
    class="welcome"
    :class="{ 'welcome--compact': compact }"
    aria-label="校园守护工作台"
  >
    <div class="welcome-copy">
      <span class="welcome-eyebrow"
        ><span class="welcome-spark" aria-hidden="true">✦</span
        >{{ eyebrow }}</span
      >
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <div v-if="$slots.default" class="welcome-actions"><slot /></div>
    </div>
    <div class="welcome-art">
      <CampusScene /><span class="art-caption">校园主题插画</span>
    </div>
  </section>
</template>

<style scoped>
.welcome {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.62fr);
  min-height: 230px;
  overflow: hidden;
  border: 1px solid #d5e5d8;
  border-radius: var(--r-lg);
  background:
    radial-gradient(ellipse at 75% 80%, #d6e9d4 0, transparent 56%),
    linear-gradient(115deg, #f7f9ec, #edf5eb 65%, #e4efdf);
  box-shadow: var(--shadow-card);
}
.welcome::before {
  content: "";
  position: absolute;
  width: 260px;
  height: 260px;
  border: 1px solid #b8cdb54d;
  border-radius: 50%;
  right: 22%;
  top: -175px;
  box-shadow:
    0 0 0 24px #c3d6bf26,
    0 0 0 50px #c3d6bf17;
  pointer-events: none;
}
.welcome-copy {
  position: relative;
  z-index: 1;
  align-self: center;
  padding: 30px 34px;
}
.welcome-eyebrow {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #567869;
  font-weight: 600;
}
.welcome-spark {
  font-size: 18px;
  color: #658c5a;
}
h2 {
  margin: 12px 0 10px;
  font-size: clamp(23px, 2.2vw, 34px);
  line-height: 1.35;
  letter-spacing: -0.04em;
  color: #203f36;
  text-wrap: balance;
}
p {
  max-width: 52ch;
  font-size: 13px;
  color: #5b7265;
  line-height: 1.85;
  text-wrap: pretty;
}
.welcome-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}
.welcome-art {
  position: relative;
  align-self: center;
  margin: -10px 16px -4px -18px;
}
.art-caption {
  position: absolute;
  bottom: 8px;
  right: 16px;
  color: #607d68;
  font-size: 10px;
  letter-spacing: 0.08em;
}
.welcome--compact {
  min-height: 130px;
  grid-template-columns: minmax(0, 1fr) 200px;
}
.welcome--compact .welcome-copy {
  padding: 22px 28px;
}
.welcome--compact h2 {
  font-size: 24px;
  margin: 6px 0;
}
.welcome--compact .welcome-art {
  max-height: 150px;
}
.welcome--compact .art-caption {
  display: none;
}
@media (max-width: 760px) {
  .welcome {
    grid-template-columns: minmax(0, 1fr) 170px;
    min-height: 220px;
  }
  .welcome-copy {
    padding: 24px;
  }
  .welcome-art {
    margin-right: -20px;
    margin-left: -50px;
  }
  .welcome--compact {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }
  .welcome--compact .welcome-art {
    display: none;
  }
}
@media (max-width: 480px) {
  .welcome {
    display: block;
    min-height: 0;
  }
  .welcome-copy {
    padding: 24px 22px;
  }
  .welcome-art {
    position: absolute;
    right: -45px;
    bottom: -18px;
    width: 170px;
    opacity: 0.22;
  }
  .welcome-copy p {
    max-width: 32ch;
  }
  .welcome-actions {
    padding-right: 32px;
  }
  .welcome-art .art-caption {
    display: none;
  }
}
</style>
