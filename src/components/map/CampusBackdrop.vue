<script setup lang="ts">
/**
 * 校园平面图底图（工程图纸风格）：围墙、道路、绿地、中心广场、运动场、指北针。
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
      <linearGradient id="cm-paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f8f7f2" />
        <stop offset="0.55" stop-color="#f4f4ee" />
        <stop offset="1" stop-color="#eef1ec" />
      </linearGradient>
      <pattern id="cm-grid-minor" width="25" height="25" patternUnits="userSpaceOnUse">
        <path d="M25 0H0V25" fill="none" stroke="#e6eceb" stroke-width="1" />
      </pattern>
      <pattern id="cm-grid-major" width="125" height="125" patternUnits="userSpaceOnUse">
        <rect width="125" height="125" fill="url(#cm-grid-minor)" />
        <path d="M125 0H0V125" fill="none" stroke="#d5e0df" stroke-width="1.2" />
      </pattern>
      <pattern id="cm-lawn" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="12" height="12" fill="#eaf2e8" />
        <line x1="0" y1="0" x2="0" y2="12" stroke="#dce9da" stroke-width="2" />
      </pattern>
      <pattern id="cm-paving" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="#f5f2e9" />
        <path d="M16 0H0V16" fill="none" stroke="#e3ded2" stroke-width="0.8" />
      </pattern>
    </defs>

    <rect :width="W" :height="H" fill="url(#cm-paper)" />
    <rect :width="W" :height="H" fill="url(#cm-grid-major)" opacity="0.62" />

    <g class="walls">
      <rect x="30" y="30" :width="W - 60" :height="H - 60" rx="7" fill="none" stroke="#82979c" stroke-width="2.2" />
      <rect x="42" y="42" :width="W - 84" :height="H - 84" rx="5" fill="none" stroke="#b7c6ca" stroke-width="1" />
    </g>

    <g class="greens">
      <rect
        v-for="(green, index) in CAMPUS_GREENS"
        :key="`g${index}`"
        :x="green.x * W"
        :y="green.y * H"
        :width="green.w * W"
        :height="green.h * H"
        rx="12"
        fill="url(#cm-lawn)"
        stroke="#cbded0"
        stroke-width="1"
      />
    </g>

    <!-- 图书馆前场与南门中轴：只表达校园空间关系，不参与点击 -->
    <g class="library-plaza" pointer-events="none">
      <rect :x="W * 0.445" :y="H * 0.535" :width="W * 0.41" :height="H * 0.235" rx="18" fill="url(#cm-paving)" stroke="#ddd7c9" stroke-width="1.2" />
      <path :d="`M ${W * 0.52} ${H * 0.77} L ${W * 0.57} ${H * 0.95}`" fill="none" stroke="#e8e2d5" stroke-width="22" stroke-linecap="round" />
      <path :d="`M ${W * 0.52} ${H * 0.77} L ${W * 0.57} ${H * 0.95}`" fill="none" stroke="#f7f3e9" stroke-width="12" stroke-linecap="round" stroke-dasharray="2 8" />
      <circle :cx="W * 0.575" :cy="H * 0.905" r="9" fill="none" stroke="#cfd8d4" stroke-width="2" />
    </g>

    <g class="roads">
      <template v-for="(road, index) in CAMPUS_ROADS" :key="`r${index}`">
        <rect
          :x="road.x * W"
          :y="road.y * H"
          :width="road.w * W"
          :height="road.h * H"
          fill="#dfe7e7"
          stroke="#c8d4d6"
          stroke-width="1"
          rx="4"
        />
        <rect
          :x="road.x * W + 3"
          :y="road.y * H + 3"
          :width="Math.max(1, road.w * W - 6)"
          :height="Math.max(1, road.h * H - 6)"
          fill="#eef2f2"
          rx="2"
        />
        <line
          v-if="road.w > road.h"
          :x1="road.x * W + 14"
          :y1="(road.y + road.h / 2) * H"
          :x2="(road.x + road.w) * W - 14"
          :y2="(road.y + road.h / 2) * H"
          stroke="#c9d6d8"
          stroke-width="2"
          stroke-dasharray="14 12"
        />
        <line
          v-else
          :x1="(road.x + road.w / 2) * W"
          :y1="road.y * H + 14"
          :x2="(road.x + road.w / 2) * W"
          :y2="(road.y + road.h) * H - 14"
          stroke="#c9d6d8"
          stroke-width="2"
          stroke-dasharray="14 12"
        />
      </template>
    </g>

    <g class="track" transform="translate(105 578)">
      <rect width="188" height="96" rx="20" fill="#e5e8e4" stroke="#cdd8d4" stroke-width="1.2" />
      <rect x="9" y="9" width="170" height="78" rx="15" fill="#e9f1e6" stroke="#cbdec9" stroke-width="1" />
      <g fill="none" stroke="#d6e4d3" stroke-width="1">
        <ellipse cx="94" cy="48" rx="67" ry="29" />
        <ellipse cx="94" cy="48" rx="50" ry="18" />
        <line x1="94" y1="9" x2="94" y2="87" />
      </g>
      <text x="94" y="52" text-anchor="middle" font-size="11" fill="#8fa39a">运动场</text>
    </g>

    <g class="gate">
      <rect x="452" y="676" width="96" height="15" rx="4" fill="url(#cm-paving)" stroke="#c9d6d5" stroke-width="1" />
      <line x1="464" y1="684" x2="536" y2="684" stroke="#0f6e7c" stroke-width="2" stroke-linecap="round" />
      <text x="500" y="667" text-anchor="middle" font-size="11" fill="#0f6e7c">主入口</text>
    </g>

    <g class="compass" transform="translate(66 96)">
      <circle r="18" fill="#f8f7f2" stroke="#9fb3bb" stroke-width="1" />
      <path d="M0 -13 L4.5 4 L0 1 L-4.5 4 Z" fill="#5a6b73" />
      <text y="-22" text-anchor="middle" font-size="10" fill="#5a6b73">N</text>
    </g>

    <g class="scale" transform="translate(52 640)">
      <line x1="0" y1="0" x2="120" y2="0" stroke="#8fa3ac" stroke-width="1.4" />
      <line x1="0" y1="-4" x2="0" y2="4" stroke="#8fa3ac" stroke-width="1.4" />
      <line x1="60" y1="-3" x2="60" y2="3" stroke="#8fa3ac" stroke-width="1.2" />
      <line x1="120" y1="-4" x2="120" y2="4" stroke="#8fa3ac" stroke-width="1.4" />
      <text x="0" y="15" font-size="9.5" fill="#8fa3ac">比例示意</text>
    </g>

    <text x="52" y="672" font-size="10.5" fill="#9fb3bb">校园平面示意图 · 非实测坐标</text>
  </g>
</template>
