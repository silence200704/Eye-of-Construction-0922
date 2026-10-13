<script setup lang="ts">
/**
 * 校园平面图底图（工程图纸风格）：围墙、道路、绿地、运动场、指北针。
 * 明确标注为示意图，不代表真实坐标；接真实校园图时直接替换底图与档案。
 */
import { VIEW_H, VIEW_W } from '@/core/map/viewport'
import { CAMPUS_GREENS, CAMPUS_ROADS } from '@/core/map/campusDecor'

const W = VIEW_W
const H = VIEW_H
</script>

<template>
  <g class="backdrop">
    <defs>
      <pattern id="cm-grid-minor" width="25" height="25" patternUnits="userSpaceOnUse">
        <path d="M25 0H0V25" fill="none" stroke="#e8eef0" stroke-width="1" />
      </pattern>
      <pattern id="cm-grid-major" width="125" height="125" patternUnits="userSpaceOnUse">
        <rect width="125" height="125" fill="url(#cm-grid-minor)" />
        <path d="M125 0H0V125" fill="none" stroke="#d8e1e5" stroke-width="1.3" />
      </pattern>
      <pattern id="cm-hatch-demo" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="9" height="9" fill="#eef2f4" />
        <line x1="0" y1="0" x2="0" y2="9" stroke="#c3d0d6" stroke-width="3" />
      </pattern>
    </defs>

    <rect :width="W" :height="H" fill="#fbfcfc" />
    <rect :width="W" :height="H" fill="url(#cm-grid-major)" />

    <g class="walls">
      <rect x="30" y="30" :width="W - 60" :height="H - 60" rx="6" fill="none" stroke="#8fa3ac" stroke-width="2" />
      <rect x="42" y="42" :width="W - 84" :height="H - 84" rx="4" fill="none" stroke="#b6c5cc" stroke-width="1" />
    </g>

    <g class="greens">
      <rect
        v-for="(green, index) in CAMPUS_GREENS"
        :key="`g${index}`"
        :x="green.x * W"
        :y="green.y * H"
        :width="green.w * W"
        :height="green.h * H"
        rx="10"
        fill="#eef5ef"
        stroke="#cfe0d4"
        stroke-width="1"
      />
    </g>

    <g class="roads">
      <template v-for="(road, index) in CAMPUS_ROADS" :key="`r${index}`">
        <rect
          :x="road.x * W"
          :y="road.y * H"
          :width="road.w * W"
          :height="road.h * H"
          fill="#eef2f4"
          stroke="#dae2e6"
          stroke-width="1"
        />
        <line
          v-if="road.w > road.h"
          :x1="road.x * W + 12"
          :y1="(road.y + road.h / 2) * H"
          :x2="(road.x + road.w) * W - 12"
          :y2="(road.y + road.h / 2) * H"
          stroke="#cfd9de"
          stroke-width="2"
          stroke-dasharray="14 12"
        />
      </template>
    </g>

    <g class="track" transform="translate(105 578)">
      <rect width="188" height="96" rx="18" fill="#eef2f4" stroke="#d5dee2" stroke-width="1" />
      <rect x="10" y="10" width="168" height="76" rx="12" fill="#eef5ef" stroke="#cfe0d4" stroke-width="1" />
      <line x1="94" y1="10" x2="94" y2="86" stroke="#cfe0d4" stroke-width="1" />
      <text x="94" y="52" text-anchor="middle" font-size="11" fill="#93a4ab">运动场</text>
    </g>

    <g class="entrance">
      <rect x="470" y="662" width="60" height="14" fill="#fbfcfc" />
      <line x1="470" y1="672" x2="530" y2="672" stroke="#0f6e7c" stroke-width="2" />
      <text x="500" y="657" text-anchor="middle" font-size="11" fill="#0f6e7c">主入口</text>
    </g>

    <g class="compass" transform="translate(66 96)">
      <circle r="18" fill="#fbfcfc" stroke="#9fb3bb" stroke-width="1" />
      <path d="M0 -13 L4.5 4 L0 1 L-4.5 4 Z" fill="#5a6b73" />
      <text y="-20" text-anchor="middle" font-size="10" fill="#5a6b73">N</text>
    </g>

    <text x="52" y="672" font-size="11" fill="#9fb3bb">校园平面示意图 · 非实测坐标</text>
  </g>
</template>
