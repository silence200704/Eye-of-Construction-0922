<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 22 });
const paths: Record<string, string> = {
  campus:
    "M3 21h18M5 21V9l7-5 7 5v12M9 21v-5h6v5M8 11h1m6 0h1M8 14h1m6 0h1M12 4V2",
  points: "M4 5h16v14H4zM8 9h2m4 0h2M8 13h2m4 0h2M8 17h2m4 0h2M9 2v3m6-3v3",
  device: "M7 3h10v18H7zM10 6h4M10 18h4M3 8v8m18-8v8",
  trend: "M3 4v16h18M6 15l4-5 4 3 6-7M16 6h4v4",
  task: "M9 4H5v17h14V4h-4M9 2h6v4H9zM8 12l2 2 5-5M8 18h7",
  issue: "M12 3l10 18H2L12 3zM12 9v5m0 3v1",
  book: "M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2zm0 0v15",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  search: "M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  menu: "M4 5h16v14H4zM9 5v14m4-10h4m-4 4h4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm14 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
};
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      :d="paths[name] ?? paths.campus"
      stroke="currentColor"
      stroke-width="1.55"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
