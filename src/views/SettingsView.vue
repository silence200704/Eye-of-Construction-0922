<script setup lang="ts">
/** 系统设置：演示身份、数据模式、备份恢复、本地存储与操作日志。 */
import { computed, onMounted, ref } from 'vue'
import { APP_STAGE, DEMO_ROLES, ROLES, SCHEMA_VERSION, APP_VERSION } from '@/types/catalog'
import { db, estimateStorage } from '@/db/database'
import { readDataset } from '@/db/repo'
import { buildBackup, downloadBackup, estimateBackup, parseBackup, readFileText, toDataset } from '@/db/backup'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useEventsStore } from '@/stores/events'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useSessionStore } from '@/stores/session'
import { formatBytes } from '@/core/format'
import { formatDateTime } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import IntegrityPanel from '@/components/settings/IntegrityPanel.vue'
import DemoChainPanel from '@/components/demo/DemoChainPanel.vue'
import { backendEnabled } from '@/api/http/runtime'
import BackendIdentity from '@/components/session/BackendIdentity.vue'
import LegacyMigrationPanel from '@/components/settings/LegacyMigrationPanel.vue'
import ShowcaseControl from '@/components/showcase/ShowcaseControl.vue'

const archive = useArchiveStore()
const plans = usePlanStore()
const tasks = useTaskStore()
const issues = useIssueStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()
const maintenancePlans = useMaintenancePlanStore()
const maintenanceTasks = useMaintenanceTaskStore()
const records = useRecordsStore()
const events = useEventsStore()
const session = useSessionStore()

const mode = computed(() => archive.dataMode)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const usage = ref<{ usage: number; quota: number } | null>(null)

const identityModel = ref<Record<string, unknown>>({ name: session.name, role: session.role })
const identityFields = [
  { key: 'name', label: '操作人姓名', type: 'text' as const, required: true },
  {
    key: 'role',
    label: '演示角色',
    type: 'select' as const,
    required: true,
    /*
     * 验收动作已收口到学校安全管理人员（core 状态机强制），
     * 「验收人员」在当前演示里没有任何可执行动作 —— 留在切换列表里只会让人选到一个空角色。
     * 角色定义本身保留在 ROLES 里（历史数据里的 executorRole 仍要能显示），
     * 后续若把复核流程拆出来，把 DEMO_ROLES 改回 ROLES 即可。
     */
    options: DEMO_ROLES.map((row) => ({ value: row.key, label: row.name })),
  },
]

const clearOpen = ref(false)
const clearModel = ref<Record<string, unknown>>({ reason: '' })
const clearFields = [
  {
    key: 'reason',
    label: '清空原因',
    type: 'textarea' as const,
    required: true,
    rows: 2,
    placeholder: '例如 演示前重置为空白档案，按脚本从零建档',
  },
]

const auditFilter = ref('')
const auditOptions = ['building', 'floor', 'point', 'device', 'baseline', 'record', 'system']

const eventCount = computed(() => events.events.length)

const auditRows = computed(() =>
  archive.audits.filter((row) => auditFilter.value === '' || row.objectType === auditFilter.value).slice(0, 60),
)

function notify(text: string, ok = true): void {
  message.value = text
  tone.value = ok ? 'ok' : 'bad'
}

onMounted(async () => {
  usage.value = await estimateStorage()
})

function applyIdentity(): void {
  const name = String(identityModel.value.name ?? '').trim()
  const role = String(identityModel.value.role ?? '')
  if (name === '' || role === '') {
    notify('请填写操作人姓名并选择演示角色', false)
    return
  }
  session.setIdentity(name, role)
  notify('演示身份已切换，后续操作按新身份留痕')
}

/** 数据集整体替换后，记录与事件两个 store 的内存快照都要重建。 */
async function reloadAllStores(): Promise<void> {
  await records.load()
  await events.load()
  // 换数据集时 V0.3 的巡检与处置数据必须一起重载，否则界面会拿旧数据继续归并
  await plans.reset()
  await tasks.reset()
  await issues.reset()
  await workOrders.reset()
  await attachments.reset()
  // 保养数据同样要一起重载：设置页的一致性检查要覆盖它，否则换数据集后还在检查旧数据
  await maintenancePlans.reset()
  await maintenanceTasks.reset()
  await Promise.all([
    plans.reload(),
    tasks.reload(),
    issues.reload(),
    workOrders.reload(),
    attachments.reload(),
    maintenancePlans.reload(),
    maintenanceTasks.reload(),
  ])
}

async function confirmClear(): Promise<void> {
  const reason = String(clearModel.value.reason ?? '').trim()
  if (reason === '') {
    notify('清空必须填写原因', false)
    return
  }
  await archive.clearAll(reason)
  await reloadAllStores()
  clearOpen.value = false
  clearModel.value = { reason: '' }
  notify('已清空本地数据并转为空白模式，可从零建档')
}

async function exportBackup(): Promise<void> {
  const data = await readDataset()
  const pkg = await buildBackup(data, session.name)
  downloadBackup(pkg)
  const size = estimateBackup(pkg)
  const broken = pkg.brokenPhotos ?? 0
  await archive.log(
    'export',
    'system',
    'backup',
    '本地备份',
    `导出 JSON 备份（含照片 ${size.photoCount} 张）`,
    broken === 0 ? `预计 ${(size.totalBytes / 1024 / 1024).toFixed(1)} MB` : `另有 ${broken} 条照片数据已损坏、未能导出`,
  )
  const base = `已导出备份：${data.buildings.length} 栋楼 / ${data.points.length} 个测点 / ${data.records.length} 条记录｜含照片 ${size.photoCount} 张，约 ${(size.totalBytes / 1024 / 1024).toFixed(1)} MB`
  notify(
    broken === 0 ? base : `${base}；另有 ${broken} 条照片数据已损坏（本地库中已丢失字节）未能导出，请在问题详情里重新上传`,
    broken === 0,
  )
}

async function importBackup(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  const text = await readFileText(file)
  const parsed = parseBackup(text)
  if (!parsed.ok || parsed.data === null) {
    notify(`导入失败：${parsed.errors.join('；')}`, false)
    return
  }
  const safety = await readDataset()
  const safetyPkg = await buildBackup(safety, session.name)
  downloadBackup(safetyPkg)
  const broken = safetyPkg.brokenPhotos ?? 0
  const data = toDataset(parsed.data)
  /*
   * 清空交给 restoreDataset：它内部的 writeDataset 本来就是"清空 + 写入"一个事务。
   * 在外面再清一次会把那句事务撕成两半 —— 清空已提交、写入还没开始时失败，库就空在那里了。
   */
  await archive.restoreDataset(data)
  await reloadAllStores()
  await archive.log('import', 'system', 'backup', '本地备份', '导入 JSON 备份', `来源文件：${file.name}`)
  const done = `导入完成：${data.buildings.length} 栋楼 / ${data.points.length} 个测点 / ${data.records.length} 条记录；导入前的数据已自动另存为备份文件`
  notify(broken === 0 ? done : `${done}（其中 ${broken} 条损坏照片未能写进安全备份）`, broken === 0)
}

const scope = [
  '手动建档：楼栋、楼层、责任人、测点与设备档案，包含图上位置与底图版本',
  '校园图与楼层图点击定位，测点支持拖拽与坐标微调',
  '基准值与单位设置，基准按版本保存并记录原因，判定按采样时间取生效版本',
  '单条监测数据录入，含必填、数值、单位、重复时间、超量程与历史补录校验',
  '历史记录查询、记录详情与修订留痕（修订保留原值，并同步重算基准快照）',
  '演示预警规则 V1.0：裂缝、倾角、振动、温湿度四条规则，可在预警标准页查看、编辑与试算',
  '规则版本冻结：每次保存生成新版本，旧版本保留，历史记录与事件按当时版本解释',
  '预警事件：黄/橙/红自动生成，同点同规则未关闭只追加证据，升级保留历史',
  '预警中心：按状态筛选，查看证据链、升级历史、通知记录与时间线',
  '站内通知与确认：按等级通知对应角色，支持确认留痕与超时补查升级',
  '事件关闭受权限与时机限制：仅安全管理人员、且已进入恢复待确认时才可关闭',
  '监测趋势曲线：单测点单指标，基准线与三级阈值线按规则版本分段，含事件节点与修订标记',
  'CSV 批量导入：上传文件或粘贴文本，逐行校验并先出预览，错误行不写入，确认后走与手工录入相同的判定链路',
  '演示脚本一键执行（含模拟超时通知场景）',
  '本地数据库持久化、备份恢复、档案字段缺失提示、归档而非删除、操作日志留痕',
]

const notYet = [
  '跨设备业务协同、照片服务端上传：按完整项目后续阶段接入',
  '真实传感器自动采集、NFC 读卡、声光控制：本机未接入（当前传感器读数为预设模拟数据，NFC 为编号校验模拟）',
  '真实外部通知渠道（短信 / 电话 / 推送）：只做本机站内提醒，不声称已送达',
  '后台定时任务与自动刷新：任务生成与状态刷新由人手动触发（共享演示时钟 + 刷新按钮）',
]
</script>

<template>
  <div class="stack">
    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">
      {{ message }}
    </p>

    <DemoChainPanel />
    <ShowcaseControl v-if="backendEnabled" @changed="reloadAllStores" />
    <LegacyMigrationPanel v-if="backendEnabled" />

    <div class="two">
      <SectionCard v-if="backendEnabled" title="演示身份" sub="直接切换演示身份，操作权限由服务端核验" marked>
        <BackendIdentity />
        <p class="duty">当前身份：{{ session.actorLabel }}</p>
      </SectionCard>
      <SectionCard v-else title="演示身份" sub="纯前端基线身份仅用于本地留痕" marked>
        <FormGrid v-model="identityModel" :fields="identityFields" :columns="1" />
        <p class="duty">当前身份：{{ session.actorLabel }}｜职责：{{ ROLES.find((r) => r.key === session.role)?.duty }}</p>
        <template #actions>
          <AppButton size="sm" variant="primary" @click="applyIdentity">应用身份</AppButton>
        </template>
      </SectionCard>

      <SectionCard title="数据模式与重置" sub="清空后可从上方唯一入口重新载入全链演示数据">
        <div class="row wrap">
          <span class="muted">当前模式</span>
          <StatusTag :tone="mode === 'seed' ? 'brand' : 'gray'" :text="mode === 'seed' ? '示例数据模式' : '空白建档模式'" />
        </div>
        <p class="hint">
          示例校区数据在图上与档案中均标注为“示例数据”，与实测建档分开显示。空白模式下所有楼栋、测点与记录都需要自行建档录入。
        </p>
        <div class="row">
          <AppButton size="sm" variant="danger" @click="clearOpen = true">清空并转为空白模式</AppButton>
        </div>
      </SectionCard>
    </div>

    <div class="two">
      <SectionCard title="备份与恢复" sub="数据保存在本机浏览器，清除浏览器数据会丢失内容">
        <div class="row">
          <AppButton size="sm" variant="primary" @click="exportBackup">导出 JSON 备份</AppButton>
          <label class="upload">
            <input type="file" accept="application/json" @change="importBackup" />
            <span class="upload-btn">导入备份文件</span>
          </label>
        </div>
        <p class="hint">
          备份包含档案、监测记录、预警事件、巡检计划、任务、问题、工单与照片附件（数据结构版本号：当前 v{{ SCHEMA_VERSION }}）。
          导出时显示"含照片 N 张，约 X MB"；导入后自动还原附件，并自动把当前数据另存为备份文件；
          导入旧版备份时会立即补迁缺少的规则标识与测点标签。
        </p>
      </SectionCard>

      <SectionCard title="本地存储" sub="浏览器本地数据库">
        <dl class="kv">
          <div class="kv-item"><dt>数据库名</dt><dd class="num">{{ db.name }}</dd></div>
          <div class="kv-item"><dt>数据结构版本</dt><dd class="num">v{{ SCHEMA_VERSION }}</dd></div>
          <div class="kv-item"><dt>当前占用</dt><dd class="num">{{ usage === null ? '浏览器未提供' : formatBytes(usage.usage) }}</dd></div>
          <div class="kv-item">
            <dt>可用配额</dt>
            <dd class="num">{{ usage === null || usage.quota === 0 ? '未提供' : formatBytes(usage.quota) }}</dd>
          </div>
          <div class="kv-item"><dt>程序版本</dt><dd class="num">{{ APP_VERSION }}（{{ APP_STAGE }}）</dd></div>
          <div class="kv-item"><dt>记录总数</dt><dd class="num">{{ records.total }}</dd></div>
          <div class="kv-item"><dt>预警事件</dt><dd class="num">{{ eventCount }}</dd></div>
        </dl>
        <p class="hint">建议演示前导出一次备份并在另一台设备上验证恢复结果，避免现场数据丢失。</p>
      </SectionCard>
    </div>

    <IntegrityPanel />

    <SectionCard title="操作日志" :sub="`共 ${archive.audits.length} 条，展示最近 60 条`">
      <template #actions>
        <select v-model="auditFilter" class="ctl filter-ctl" aria-label="按操作对象筛选日志">
          <option value="">全部对象</option>
          <option v-for="item in auditOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </template>
      <DataTable
        :columns="[
          { key: 'at', label: '时间', width: '150px' },
          { key: 'actor', label: '操作人', width: '190px' },
          { key: 'action', label: '动作', width: '80px' },
          { key: 'object', label: '对象', width: '220px' },
          { key: 'summary', label: '操作内容' },
          { key: 'reason', label: '原因', width: '220px' },
        ]"
        :row-count="auditRows.length"
        empty="暂无操作日志"
      >
        <tr v-for="entry in auditRows" :key="entry.id">
          <td class="num">{{ formatDateTime(entry.at) }}</td>
          <td>
            <div>{{ entry.actor }}</div>
            <div class="code">{{ entry.actorRole }}</div>
          </td>
          <td>{{ entry.action }}</td>
          <td>
            <div>{{ entry.objectLabel }}</div>
            <div class="code">{{ entry.objectType }}</div>
          </td>
          <td>{{ entry.summary }}</td>
          <td class="muted">{{ entry.reason === '' ? '—' : entry.reason }}</td>
        </tr>
      </DataTable>
    </SectionCard>

    <div class="two">
      <SectionCard title="V0.2 冻结能力（历史基线）" sub="V0.2 当时可验证的能力；V1 新增的巡检、问题池、复查、保养台账与管理报表在各自工作台">
        <ul class="list list--ok">
          <li v-for="item in scope" :key="item">{{ item }}</li>
        </ul>
      </SectionCard>
      <SectionCard title="尚未实现（不在 V0.2 范围）" sub="明确标注，避免把计划当成已完成">
        <ul class="list list--no">
          <li v-for="item in notYet" :key="item">{{ item }}</li>
        </ul>
      </SectionCard>
    </div>

    <AppModal :open="clearOpen" title="清空本地数据" sub="清空后转为空白模式，需要从零建档" :width="560" @close="clearOpen = false">
      <p class="notice notice--warn">
        清空会删除全部楼栋、楼层、测点、设备、基准、监测记录与操作日志，只保留一条清空记录。此操作不可撤销，建议先导出备份。
      </p>
      <FormGrid v-model="clearModel" :fields="clearFields" :columns="1" />
      <template #footer>
        <AppButton @click="clearOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmClear">确认清空</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.hint {
  margin: 12px 0;
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.7;
}

.duty {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--text-2);
}

.upload input {
  display: none;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  height: var(--h-control-sm);
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  font-size: 12.5px;
  cursor: pointer;
}

.upload-btn:hover {
  border-color: var(--brand-500);
  color: var(--brand-700);
}

.kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
}

.kv dt {
  font-size: 12px;
  color: var(--text-3);
}

.kv dd {
  margin: 0;
  font-size: 13.5px;
}

.filter-ctl {
  width: 150px;
}

.list {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.85;
  color: var(--text-2);
}

.list--ok li::marker {
  color: var(--st-green);
}

.list--no li::marker {
  color: var(--st-orange);
}

@media (max-width: 1180px) {
  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
