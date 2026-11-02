<template>
  <div class="campus-backdrop" aria-hidden="true">
    <svg viewBox="0 0 1400 1100" preserveAspectRatio="xMidYMin slice">
      <g fill="none" stroke="currentColor" stroke-width="1">
        <path d="M-160 560C180 130 530 840 1000 440S1470 50 1650 270" />
        <path d="M-160 588C180 158 530 868 1000 468S1470 78 1650 298" />
        <path d="M-160 616C180 186 530 896 1000 496S1470 106 1650 326" />
        <path d="M-160 644C180 214 530 924 1000 524S1470 134 1650 354" />
        <path d="M-160 672C180 242 530 952 1000 552S1470 162 1650 382" />
        <circle cx="1270" cy="90" r="210" />
        <circle cx="1270" cy="90" r="235" />
        <circle cx="1270" cy="90" r="260" />
        <circle cx="1270" cy="90" r="285" />
        <path
          d="M40 940h280v-90h70v150H40zM90 940v-200h160v200m-110-150h60m-60 35h60m-60 35h60"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.campus-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: -1;
  background:
    radial-gradient(ellipse at 85% 3%, #d8eae4 0, transparent 43%),
    radial-gradient(ellipse at 20% 86%, #f4e7c8 0, transparent 40%),
    radial-gradient(#719c8b26 0.7px, transparent 0.7px), var(--canvas);
  background-size:
    auto,
    auto,
    22px 22px,
    auto;
}
svg {
  width: 100%;
  height: 100%;
  color: #78a794;
  opacity: 0.23;
}
@media (max-width: 600px) {
  svg {
    opacity: 0.15;
  }
}
@media print {
  .campus-backdrop {
    display: none;
  }
}
</style>
