<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { DEMO_EVIDENCE_NOTE, DEMO_EVIDENCE_PAIR } from '@/config/media/demoPhotos'
import { evidencePreparedFor } from '@/stores/demo/evidence'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { useAssistantStore } from '@/assistant/session'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ pointId: string; pointLabel: string }>()
const demo = useDemoScenarioStore()
const assistant = useAssistantStore()
const prepared = computed(() => evidencePreparedFor(props.pointId))
onMounted(() => { void demo.hydrate() })

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.slice(1)}`
}

async function askEvidence(): Promise<void> {
  await assistant.openWith('point', props.pointId, props.pointLabel, `${props.pointLabel} 的影像有什么变化？给我看数据和照片。`)
}
</script>

<template>
  <section class="prepared" aria-label="视觉演示素材预览">
    <div class="heading">
      <div>
        <b>{{ prepared ? '当前测点的视觉素材已准备' : '从照片到证据，三步完成' }}</b>
        <p>{{ prepared ? pointLabel : '先在系统设置的唯一全链入口准备临时数据，再选择登记测点。' }}</p>
      </div>
      <span class="tag">{{ prepared ? '仅预览 · 尚未加入会话' : '操作指引' }}</span>
    </div>
    <div v-if="prepared" class="pair">
      <figure v-for="photo in DEMO_EVIDENCE_PAIR" :key="photo.key">
        <img :src="assetUrl(photo.path)" :alt="`准备素材：${photo.label}`" loading="lazy" />
        <figcaption><b>{{ photo.key === 'before' ? '原图' : '模拟变化图' }}</b>{{ photo.label }}</figcaption>
      </figure>
    </div>
    <ol class="steps">
      <li><b>01 看照片</b><span>原图与同底图派生图，位置可直接对照</span></li>
      <li><b>02 比区域</b><span>裂缝区与完好墙面分别计算，不预填比例</span></li>
      <li><b>03 问小瞳</b><span>同屏查看读数、趋势、影像与 3D 位置</span></li>
    </ol>
    <p v-if="prepared" class="note">{{ DEMO_EVIDENCE_NOTE }} 这里是素材预览；会话影像仍需通过现有问答按需读取，刷新后清空。</p>
    <AppButton v-if="prepared" size="sm" variant="primary" :disabled="assistant.busy" @click="askEvidence">问小瞳查看这组视觉证据</AppButton>
  </section>
</template>

<style scoped>
.prepared { display: grid; gap: 14px; padding: 18px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper); }
.heading { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
.heading b { color: var(--brand-700); font-size: 15px; }
.heading p, .note { margin: 6px 0 0; color: var(--text-3); font-size: 12px; line-height: 1.7; }
.tag { flex-shrink: 0; padding: 4px 8px; color: var(--brand-700); background: var(--canvas); border-radius: var(--r-sm); font-size: 11px; }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
figure { margin: 0; min-width: 0; }
figure img { display: block; width: 100%; max-height: 220px; aspect-ratio: 4 / 3; object-fit: contain; background: var(--canvas); border-radius: var(--r-sm); }
figcaption { display: grid; gap: 3px; margin-top: 7px; color: var(--text-2); font-size: 12px; line-height: 1.5; }
figcaption b { color: var(--text); }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.steps li { display: grid; gap: 5px; padding-top: 10px; border-top: 2px solid var(--line); font-size: 12px; }
.steps span { color: var(--text-3); line-height: 1.6; }
@media (max-width: 700px) { .heading { flex-direction: column; } .pair, .steps { grid-template-columns: 1fr; } }
</style>
