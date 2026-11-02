<script setup lang="ts">
import { useId } from "vue";
const id = useId().replace(/:/g, "");
</script>

<template>
  <svg
    viewBox="0 0 480 270"
    fill="none"
    aria-hidden="true"
    class="campus-scene"
  >
    <defs>
      <pattern
        :id="`${id}-windows`"
        width="24"
        height="25"
        patternUnits="userSpaceOnUse"
      >
        <rect
          x="7"
          y="6"
          width="8"
          height="12"
          rx="2"
          fill="#5d9b9a"
          opacity=".62"
        />
      </pattern>
      <linearGradient
        :id="`${id}-ground`"
        x1="50"
        y1="160"
        x2="400"
        y2="260"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#c5e1d4" />
        <stop offset="1" stop-color="#dfece0" />
      </linearGradient>
    </defs>
    <circle cx="379" cy="52" r="32" fill="#f6dda3" />
    <g stroke="#80b7b0" opacity=".25">
      <circle cx="235" cy="143" r="106" stroke-dasharray="3 7" />
      <ellipse cx="240" cy="197" rx="204" ry="62" />
    </g>
    <path d="M33 201 241 109 448 204 242 265Z" :fill="`url(#${id}-ground)`" />
    <path d="m86 204 155-69 153 68-152 62Z" fill="#eaf2df" />
    <path
      d="m148 254 90-39 85 39m-84-39 1-81M86 204l153 11 155-12"
      stroke="#fcfbeb"
      stroke-width="13"
      stroke-linejoin="round"
    />
    <ellipse cx="237" cy="218" rx="28" ry="12" fill="#a3caba" />
    <ellipse cx="237" cy="216" rx="21" ry="8" fill="#d1e8db" />
    <path d="m104 168 64 27 90-39-64-29Z" fill="#b2cec4" opacity=".6" />
    <path d="m92 102 66 28v60l-66-28Z" fill="#e6eee1" />
    <path d="m158 130 84-38v60l-84 38Z" fill="#bfdad2" />
    <path d="m92 102 84-38 66 28-84 38Z" fill="#629d8f" />
    <path d="m101 102 75-33 56 23-74 33Z" fill="#7bb2a1" />
    <path d="m166 136 67-30v39l-67 30Z" :fill="`url(#${id}-windows)`" />
    <path d="m101 116 46 20v38l-46-20Z" :fill="`url(#${id}-windows)`" />
    <path d="m275 103 57 24v70l-57-25Z" fill="#e4edf1" />
    <path d="m332 127 63-29v70l-63 29Z" fill="#bfd5de" />
    <path d="m275 103 63-29 57 24-63 29Z" fill="#84acb8" />
    <path d="m282 103 56-25 49 20-55 24Z" fill="#a0c3cc" />
    <path d="m340 133 46-21v48l-46 21Z" :fill="`url(#${id}-windows)`" />
    <path d="m284 117 39 17v48l-39-17Z" :fill="`url(#${id}-windows)`" />
    <path d="m217 74 24 11 27-13-24-11Z" fill="#f2d5a4" />
    <path d="m217 74 24 11v58l-24-11Z" fill="#f9edcf" />
    <path d="m241 85 27-13v58l-27 13Z" fill="#dfcda6" />
    <path d="M243 61V33" stroke="#63877c" stroke-width="2" />
    <path d="M244 34c10-5 13 5 24 0v15c-11 5-14-5-24 0Z" fill="#edb57a" />
    <g fill="#6d9f83" stroke="#658b74" stroke-width="2" stroke-linecap="round">
      <path d="M65 181v29m350-47v34M302 223v28M155 204v26" />
      <ellipse cx="65" cy="179" rx="15" ry="23" />
      <ellipse cx="415" cy="161" rx="15" ry="23" />
      <ellipse cx="302" cy="220" rx="14" ry="21" />
      <ellipse cx="155" cy="202" rx="11" ry="17" />
    </g>
    <g fill="#eaf3ee">
      <path d="M47 66c-1-12 15-15 19-6 10-8 23 0 18 9H47Z" />
      <path d="M319 40c0-10 13-12 16-5 8-6 19 0 15 7h-31Z" />
    </g>
    <g stroke="#517f72" stroke-width="2" stroke-linecap="round">
      <path d="m384 220 4 2m-10 3 4 2M95 226l4 2m-12 2 4 2" />
    </g>
  </svg>
</template>

<style scoped>
.campus-scene {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
</style>
