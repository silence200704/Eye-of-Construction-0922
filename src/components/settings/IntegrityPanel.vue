<script setup lang="ts">
/**
 * 设置页的「数据一致性检查」卡片。
 *
 * 抽成子组件的原因：设置页本身已接近单文件行数上限，而检查项还会随版本增加；
 * 这里只负责把各 store 的数据喂给 scanIntegrity() 并把结果表出来，
 * 检查规则本身在 `core/integrity.ts`（纯函数、可单独测试）。
 */
import { computed } from 'vue'
import { scanIntegrity } from '@/core/integrity'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useEventsStore } from '@/stores/events'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const archive = useArchiveStore()
const records = useRecordsStore()
const events = useEventsStore()
const plans = usePlanStore()
const tasks = useTaskStore()
const issues = useIssueStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()

/** 关联编号与位置引用的体检：让"看起来完整"和"真的对得上"分开呈现。 */
const rows = computed(() =>
  scanIntegrity({
    buildings: archive.buildings,
    floors: archive.floors,
    points: archive.points,
    devices: archive.devices,
    baselines: archive.baselines,
    records: records.records,
    events: events.events,
    plans: plans.plans,
    tasks: tasks.tasks,
    issues: issues.issues,
    workOrders: workOrders.orders,
    attachments: attachments.attachments,
  }),
)

const errorCount = computed(() => rows.value.filter((row) => row.level === 'error').length)

const columns = [
  { key: 'level', label: '级别', width: '72px' },
  { key: 'kind', label: '检查项', width: '168px' },
  { key: 'label', label: '对象' },
  { key: 'message', label: '说明' },
]
</script>

<template>
  <SectionCard
    title="数据一致性检查"
    :sub="
      rows.length === 0
        ? '未发现编号关联、位置引用与基准冲突问题'
        : `共 ${rows.length} 项：错误 ${errorCount} 项、提示 ${rows.length - errorCount} 项`
    "
  >
    <DataTable v-if="rows.length > 0" :columns="columns" :row-count="rows.length" empty="未发现问题">
      <tr v-for="(issue, index) in rows" :key="index">
        <td>
          <StatusTag :tone="issue.level === 'error' ? 'red' : 'orange'" :text="issue.level === 'error' ? '错误' : '提示'" />
        </td>
        <td>{{ issue.kind }}</td>
        <td>{{ issue.label }}</td>
        <td class="muted">{{ issue.message }}</td>
      </tr>
    </DataTable>
    <p v-else class="hint">
      检查内容：测点的楼栋、楼层与区域引用是否仍然有效；设备绑定的测点是否存在；监测记录指向的测点是否存在；
      相对基准指标是否已设基准；同一测点是否存在多条"当前生效"基准；设备量程上下限是否合法；
      NFC 标签编号是否重复；巡检计划与任务的引用是否有效；问题、工单与照片的关联是否完整。
    </p>
  </SectionCard>
</template>
