<script setup lang="ts">
import type { AskVideoPreview } from '@/types/media/video'
import VideoEvidence from '@/components/media/video/VideoEvidence.vue'
defineProps<{ preview: AskVideoPreview }>()
</script>

<template>
  <VideoEvidence :video="preview.video" :frame-ids="preview.frameIds" :analysis="preview.analysis" :seek-time="preview.seekTime" :autoplay="preview.autoplay" />
</template>
