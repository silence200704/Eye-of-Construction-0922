<script setup lang="ts">
/**
 * 影像对比（工作线 C 的展示页，与问筑瞳联动）。
 *
 * 一条边界写在页面最上方，不藏在角落：
 * **影像只看演示素材与本机文件、只做预设分析** —— 不接摄像头或校园监控、不调在线服务、不给毫米数、不自动生成正式预警。
 *
 * 深链 `?point=<测点ID>`：助手回答里"打开影像对比"就落到这个测点的会话影像上。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { hasNumericReadings } from '@/types/catalog'
import { backendActive } from '@/api/backend/runtime'
import { useArchiveStore } from '@/stores/archive'
import { useMediaStore } from '@/stores/media'
import { resolvePointTarget } from '@/assistant/deepLink'
import MediaSourcePanel from '@/components/media/MediaSourcePanel.vue'
import VideoPanel from '@/components/media/video/VideoPanel.vue'
import MediaComparePanel from '@/components/media/MediaComparePanel.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const archive = useArchiveStore()
const media = useMediaStore()
const route = useRoute()
const router = useRouter()

const pointId = ref('')
const persistCopy = computed(() => backendActive()
  ? {
      sub: '关键帧与比对结果保存到服务端数据库；照片留存仍走问题附件入口',
      first: '影像与关键帧保存在服务端数据库中，受身份与楼栋授权保护；刷新后从受保护内容接口重建预览。',
    }
  : {
      sub: '会话影像不写库；正式留存的照片走现有附件入口',
      first: '会话影像只存在当前页面里，刷新或关闭页面即消失；本轮不新增影像表，也不做数据库迁移。',
    })

/** 可选测点：有数值记录的测点优先排在前面（影像对比多用于结构测点） */
const points = computed(() =>
  archive.activePoints
    .map((row) => ({ id: row.id, label: `${row.code} ${row.name}`, numeric: hasNumericReadings(row.metric) }))
    .sort((a, b) => Number(b.numeric) - Number(a.numeric) || a.label.localeCompare(b.label)),
)

const requestedPointId = computed(() => (typeof route.query.point === 'string' ? route.query.point : ''))
const deepLink = computed(() =>
  resolvePointTarget(requestedPointId.value, (id) => {
    const row = archive.pointById(id)
    return row === undefined ? undefined : { code: row.code, archived: row.status !== 'active' }
  }),
)

/** 深链优先；页面里换测点后同步回 URL，链接与页面始终说同一个测点 */
function pickPoint(): void {
  if (requestedPointId.value !== '') {
    pointId.value = deepLink.value.id
    return
  }
  if (pointId.value !== '' && archive.pointById(pointId.value) !== undefined) return
  pointId.value = points.value[0]?.id ?? ''
}

onMounted(pickPoint)
watch(requestedPointId, pickPoint)
watch(pointId, (id) => {
  if (id === requestedPointId.value) return
  void router.replace({ query: { ...route.query, point: id === '' ? undefined : id } })
})

</script>

<template>
  <div class="stack media-workspace">
    <details class="scope-info">
      <summary><b>素材与分析说明</b><span>演示素材 · 不是裂缝识别或安全鉴定</span></summary>
      <p>影像来源：生成演示照片、公开实拍参考图、人工上传、本地视频关键帧。公开参考图非本校，不参与比对。分析只做像素差异统计，不调用摄像头或在线 AI，不给毫米数，不自动生成结构预警。{{ backendActive() ? '关键帧与比对结果保存在服务端，受身份与楼栋授权保护；照片正式留存走问题与工单的附件入口。' : '会话影像刷新即失，正式留存走问题与工单的附件入口。' }}</p>
    </details>

    <!-- 会话级提示：抽帧、比对、载入视频的结果都走这里，失败必须看得见 -->
    <p v-if="media.message !== ''" class="notice" :class="media.tone === 'ok' ? 'notice--brand' : 'notice--warn'">
      {{ media.message }}
    </p>

    <SectionCard v-if="requestedPointId !== '' && deepLink.reason !== ''" title="测点定位">
      <EmptyState
        v-if="requestedPointId !== '' && deepLink.reason !== ''"
        title="深链里的测点打不开"
        :sub="deepLink.reason"
      />
    </SectionCard>

    <MediaSourcePanel v-model:point-id="pointId" :points="points" />
    <VideoPanel :point-id="pointId" />
    <MediaComparePanel :point-id="pointId" />

    <SectionCard title="留存与边界" :sub="persistCopy.sub">
      <ul class="rules">
        <li>{{ persistCopy.first }}</li>
        <li>需要正式留存的照片，请到「问题与工单」按现有附件入口入库（每问题最多 3 张、单图约 200 KB）。</li>
        <li>本页产生的任何结论都不进入预警判定链路：判定只看监测记录与规则引擎。</li>
      </ul>
      <div class="row wrap">
        <AppButton size="sm" @click="router.push('/issues')">去问题与工单留存照片</AppButton>
        <AppButton size="sm" variant="ghost" @click="router.push('/trend')">去看该测点的监测趋势</AppButton>
      </div>
    </SectionCard>
  </div>
</template>

<style scoped>
.stack { display: grid; gap: 14px; }
.media-workspace { gap: 20px; }
.scope-info { padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper); font-size: 13px; color: var(--text-2); }
.scope-info summary { cursor: pointer; min-height: 24px; }.scope-info summary b { color: var(--text); margin-right: 14px; }.scope-info p { margin-top: 12px; line-height: 1.8; }
@media (max-width: 700px) { .scope-info summary span { display: block; margin: 4px 0 0 18px; } }
.rules { margin: 0; padding-left: 18px; color: var(--text-2); font-size: 12.5px; line-height: 1.75; }
</style>
