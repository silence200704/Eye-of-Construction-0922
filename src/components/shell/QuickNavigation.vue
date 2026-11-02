<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import AppModal from "@/components/ui/AppModal.vue";
import UiGlyph from "@/components/visual/UiGlyph.vue";
import { NAV_GROUPS, NAV_WORKSPACES } from "./navGroups";

const route = useRoute();
const router = useRouter();
const open = ref(false);
const query = ref("");
const search = ref<HTMLInputElement | null>(null);
const entries = [
  ...new Map(
    [
      ...NAV_GROUPS.flatMap((group) => group.items),
      ...NAV_WORKSPACES.flatMap((group) => group.tabs),
    ].map((row) => [row.to, row]),
  ).values(),
];
const matches = computed(() =>
  entries.filter((row) =>
    `${row.label} ${row.to}`
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
);

function shortcut(event: KeyboardEvent): void {
  if (!open.value && document.querySelector('[aria-modal="true"]')) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "k" &&
    !event.isComposing
  ) {
    event.preventDefault();
    open.value = !open.value;
  }
}

function go(to: string): void {
  open.value = false;
  if (to !== route.path) void router.push(to);
}

watch(open, async (value) => {
  if (!value) return;
  query.value = "";
  await nextTick();
  search.value?.focus();
});
onMounted(() => window.addEventListener("keydown", shortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", shortcut));
</script>

<template>
  <button
    type="button"
    class="quick-search"
    aria-label="搜索页面与功能（Ctrl K）"
    @click="open = true"
  >
    <UiGlyph name="search" :size="17" /><span>搜索页面与功能</span
    ><kbd>Ctrl K</kbd>
  </button>
  <AppModal
    :open="open"
    title="想去哪里看看？"
    sub="搜索页面名称，按 Enter 打开首项"
    initial-focus="[data-quick-search]"
    :width="540"
    @close="open = false"
  >
    <label class="search-field">
      <UiGlyph name="search" :size="20" />
      <input
        ref="search"
        v-model="query"
        data-quick-search
        aria-label="搜索页面名称"
        placeholder="例如：监测、巡检、工单…"
        @keydown.enter.prevent="matches[0] && go(matches[0].to)"
      />
    </label>
    <nav class="search-results" aria-label="页面搜索结果">
      <button
        v-for="item in matches"
        :key="item.to"
        type="button"
        @click="go(item.to)"
      >
        <span>{{ item.label }}</span
        ><span class="result-note"
          >{{ item.to === route.path ? "当前页面" : "前往" }}
          <UiGlyph name="arrow" :size="16"
        /></span>
      </button>
      <p v-if="matches.length === 0" role="status">
        没有找到这个页面，试试“监测”或“巡检”。
      </p>
    </nav>
  </AppModal>
</template>

<style scoped>
.quick-search {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #f7f9f6;
  color: var(--text-3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast);
}
.quick-search:hover {
  background: var(--paper);
  border-color: var(--brand-200);
}
kbd {
  margin-left: 12px;
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--paper);
  font: inherit;
  font-size: 10px;
}
.search-field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 15px;
  background: var(--canvas);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  color: var(--brand-600);
}
.search-field:focus-within {
  box-shadow: var(--focus-ring);
  border-color: var(--brand-500);
}
input {
  border: 0;
  outline: 0;
  box-shadow: none;
  background: transparent;
  min-width: 0;
  width: 100%;
  font: inherit;
  color: var(--text);
}
.search-results {
  display: grid;
  gap: 4px;
  max-height: 45dvh;
  overflow: auto;
  margin-top: 14px;
}
.search-results button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 46px;
  padding: 10px 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.search-results button:hover,
.search-results button:focus-visible {
  background: var(--brand-050);
}
.result-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 11px;
}
.search-results p {
  padding: 20px 8px;
  color: var(--text-3);
  font-size: 13px;
}
@media (max-width: 1200px) {
  .quick-search span,
  kbd {
    display: none;
  }
  .quick-search {
    min-width: 40px;
    justify-content: center;
  }
}
@media (max-width: 600px) {
  .quick-search {
    display: none;
  }
}
</style>
