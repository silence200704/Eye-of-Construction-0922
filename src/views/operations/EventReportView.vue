<script setup lang="ts">
/**
 * 单事件处置报告页（V1-E）。
 *
 * 一页回答四个问题：为何预警、谁收到谁确认、谁处置如何验收、为何关闭。
 * 报告内容全部由 `buildEventReport` 从库里的原始行组装 —— 页面不加工、不润色，
 * 未确认/未关闭的环节如实写出来，避免空白被读成"没问题"。
 * 支持浏览器打印（Ctrl+P / 打印按钮），打印时隐藏操作栏。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { backendActive } from '@/api/backend/runtime'
import { buildEventReport } from '@/core/metrics/eventReport'
import { formatDateTime } from '@/core/time'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'

const route = useRoute()
const router = useRouter()
const archive = useArchiveStore()
const events = useEventsStore()
const issues = useIssueStore()
const orders = useWorkOrderStore()
const ready = ref(false)

/** 浏览器打印：打印样式里隐藏操作栏，其余按屏幕内容输出。 */
function printReport(): void {
  window.print()
}

const eventId = computed(() => String(route.params.id))
const sourceText = computed(() => (backendActive() ? '后端数据库' : '本机 IndexedDB'))

const report = computed(() => {
  const event = events.events.find((row) => row.id === eventId.value)
  if (event === undefined) return null
  const point = archive.pointById(event.pointId) ?? null
  return buildEventReport({
    event,
    point,
    device: point === null ? null : (archive.devicesOfPoint(point.id)[0] ?? null),
    notifications: events.notifications.filter((row) => row.eventId === event.id),
    issues: issues.issues.filter((row) => row.eventId === event.id),
    orders: orders.orders.filter((row) => row.eventId === event.id),
  })
})

onMounted(async () => {
  if (!events.loaded) await events.reload()
  if (!issues.loaded) await issues.reload()
  if (!orders.loaded) await orders.reload()
  ready.value = true
})
</script>

<template>
  <div class="stack report">
    <div class="ops no-print">
      <AppButton variant="ghost" size="sm" @click="router.back()">返回</AppButton>
      <AppButton size="sm" @click="printReport()">打印 / 另存为 PDF</AppButton>
    </div>

    <EmptyState v-if="ready && report === null" title="事件不存在" sub="该事件可能已被清库或属于另一个数据集" />
    <template v-else-if="report !== null">
      <SectionCard :title="report.title" :sub="`报告生成时间 ${formatDateTime(new Date().toISOString())}；数据来源：${sourceText}`">
        <p v-if="!report.closed" class="warn">
          本事件尚未关闭：下面的"关闭依据"为空是**真实的当前状态**，不代表核查通过。
        </p>
        <div class="meta">
          <span class="code">本报告用于说明「为何预警、谁处置、如何验收、为何关闭」，四个环节各一节。</span>
        </div>
      </SectionCard>

      <SectionCard
        v-for="section in report.sections"
        :key="section.title"
        :title="section.title"
        :sub="`要回答的问题：${section.question}`"
      >
        <dl class="rows">
          <template v-for="row in section.rows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
      </SectionCard>

      <SectionCard title="五、处置时间线" sub="事件、问题、工单三处记录按时间合并，可逐步倒查">
        <ol v-if="report.timeline.length > 0" class="timeline">
          <li v-for="(item, index) in report.timeline" :key="`${item.at}_${index}`">
            <span class="num">{{ formatDateTime(item.at) }}</span>
            <span class="code">{{ item.by }}</span>
            <span class="action">{{ item.action }}</span>
            <span>{{ item.detail }}</span>
          </li>
        </ol>
        <p v-else class="code">暂无处置时间线记录。</p>
      </SectionCard>
    </template>
  </div>
</template>

<style scoped>
.rows {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 6px 14px;
  margin: 0;
  font-size: 13px;
}

.rows dt {
  color: var(--text-3);
}

.rows dd {
  margin: 0;
  color: var(--text-1);
  word-break: break-all;
}

.timeline {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  display: grid;
  gap: 6px;
}

.timeline .action {
  font-weight: 500;
  margin: 0 6px;
}

.warn {
  margin: 0 0 8px;
  color: var(--red-600, #c2410c);
  font-size: 13px;
}

/* 打印：隐藏操作栏，卡片边框收细，一页尽量放得下 */
@media print {
  .no-print {
    display: none;
  }

  .report {
    gap: 8px;
  }
}
</style>
