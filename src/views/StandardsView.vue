<script setup lang="ts">
/**
 * 预警标准配置。
 *
 * 本页承载「筑瞳 Demo 演示预警规则 V1.0」：规则编号、适用范围、指标、单位、基准、
 * 阈值、趋势条件、持续条件、恢复条件、责任人、来源、确认人、版本与生效时间。
 * 规则数值用于验证录入、分级、通知与闭环流程，**不是国家建筑安全标准**。
 */
import { computed, ref } from 'vue'
import type { MetricValues } from '@/types/domain'
import type { MonitoringRule, RuleMetric } from '@/types/rules'
import { metricDef } from '@/types/catalog'
import { RULE_SOURCE, RULE_VERSION } from '@/config/ruleSeed'
import { useArchiveStore } from '@/stores/archive'
import { stateAllowedAction, stateLabel, stateTone } from '@/core/rules'
import { assessPoint } from '@/stores/assessment'
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import DescList from '@/components/ui/info/DescList.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import RuleDialog from '@/components/dialogs/RuleDialog.vue'
import ScriptCheckPanel from '@/components/panels/ScriptCheckPanel.vue'

const archive = useArchiveStore()

const selectedId = ref('')
const editOpen = ref(false)
const trialPointId = ref('')
const trialValues = ref<Record<string, unknown>>({})

/** 列表只展示每条规则的最新版本；历史版本在详情里按时间线查看，旧版本不可编辑。 */
const rules = computed(() => archive.latestRules)
const selected = computed<MonitoringRule | undefined>(
  () => archive.ruleById(selectedId.value) ?? rules.value[0],
)
const selectedVersions = computed(() =>
  selected.value === undefined ? [] : archive.ruleVersions(selected.value.ruleId),
)
const metricName = (metric: RuleMetric): string => metricDef(metric === 'environment' ? 'temp_humidity' : metric).name

/** 阈值分级表：直接由规则生成，页面不另写一份数值。 */
const thresholdRows = computed(() => {
  const rule = selected.value
  if (rule === undefined || rule.thresholds === null) return []
  const t = rule.thresholds
  const unit = rule.unit
  return [
    { level: '正常', tone: 'green' as const, condition: `变化量 < ${t.yellow} ${unit}`, action: '继续监测，无需处置' },
    { level: '黄色关注', tone: 'yellow' as const, condition: `≥ ${t.yellow} ${unit}`, action: '生成黄色事件并通知点位责任人与物业值班' },
    { level: '橙色排查', tone: 'orange' as const, condition: `≥ ${t.orange} ${unit}`, action: '事件升级为橙色并安排定向排查' },
    { level: '红色紧急核查', tone: 'red' as const, condition: `≥ ${t.red} ${unit}`, action: '事件升级为红色，立即通知安全管理人员' },
  ]
})

const detailItems = computed(() => {
  const rule = selected.value
  if (rule === undefined) return []
  const scopeBuildings = rule.buildingIds.map((id) => archive.buildingName(id)).join('、') || '不限'
  const scopePoints = rule.pointIds.map((id) => archive.pointById(id)?.code ?? id).join('、') || '按指标匹配全部测点'
  return [
    { label: '规则编号', value: rule.code, mono: true },
    { label: '规则版本', value: rule.version, mono: true },
    { label: '指标', value: metricName(rule.metric) },
    { label: '单位', value: rule.unit, mono: true },
    { label: '规则状态', value: rule.enabled ? '已启用' : '已停用' },
    { label: '基准来源', value: rule.baselineSource === 'point' ? '随测点当前有效基准' : rule.baselineSource === 'fixed' ? '固定基准值' : '不设基准（绝对判定）' },
    { label: '适用建筑', value: scopeBuildings, wide: true },
    { label: '适用测点', value: scopePoints, wide: true },
    {
      label: '变化速率条件',
      value:
        rule.rateThreshold === null
          ? '未配置，当前不判速率（待结构专业人员确认，不填入推测数值）'
          : `达到 ${rule.rateThreshold} ${rule.unit}/h 生成${rule.rateLevel === 'orange' ? '橙色趋势提醒' : '红色提醒'}`,
      wide: true,
    },
    {
      label: '持续条件',
      value: `至少 ${rule.persistence.minRecords} 条有效记录、跨度不少于 ${rule.persistence.minSpanMinutes} 分钟、相邻间隔不超过 ${rule.persistence.maxGapMinutes} 分钟且均越限`,
      wide: true,
    },
    {
      label: '恢复条件',
      value: `连续 ${rule.recovery.minRecords} 条有效记录低于黄色阈值的 ${Math.round(rule.recovery.yellowRatio * 100)}%，标为恢复待确认，不自动关闭问题`,
      wide: true,
    },
    { label: '规则来源', value: rule.source },
    { label: '确认人', value: rule.confirmedBy === '' ? '待确认' : rule.confirmedBy },
    { label: '生效时间', value: formatDateTime(rule.effectiveFrom), mono: true },
    { label: '最后修改', value: `${formatDateTime(rule.updatedAt)}｜${rule.updatedBy}` },
    { label: '规则说明', value: rule.note, wide: true },
  ]
})

/* ---------------- 单条试算 ---------------- */

const trialPoint = computed(() => archive.pointById(trialPointId.value))
const trialFields = computed(() => {
  const point = trialPoint.value
  if (point === undefined) return []
  return metricDef(point.metric).fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: 'number' as const,
    required: true,
    unit: field.unit,
    step: field.step,
    placeholder: field.placeholder,
  }))
})

const trialResult = computed(() => {
  const point = trialPoint.value
  if (point === undefined) return null
  const values: MetricValues = {}
  for (const field of metricDef(point.metric).fields) {
    const raw = String(trialValues.value[field.key] ?? '').trim()
    if (raw !== '') values[field.key] = Number(raw)
  }
  // 与录入弹窗共用同一条判定路径：按采样时间取基准与规则版本
  const outcome = assessPoint({
    pointId: point.id,
    values,
    sampleTime: new Date().toISOString(),
    sampleWindow: point.metric === 'vibration' ? '1 s' : '',
    quality: 'valid',
    deviceId: null,
  })
  if (outcome === null) return { missing: true as const, point }
  return { missing: false as const, point, rule: outcome.rule, baseline: outcome.baseline, assessment: outcome.assessment }
})

function selectTrialPoint(): void {
  if (trialPointId.value !== '') return
  const point = archive.activePoints.find((row) => archive.ruleFor(row.id, new Date().toISOString()) !== undefined)
  trialPointId.value = point?.id ?? ''
}

/* ---------------- 演示数据脚本试算 ---------------- */

function formatThresholds(rule: MonitoringRule): string {
  const t = rule.thresholds
  return t === null ? '环境条件' : `黄 ${t.yellow} / 橙 ${t.orange} / 红 ${t.red} ${rule.unit}`
}

function openEdit(): void {
  if (selected.value !== undefined) editOpen.value = true
}
</script>

<template>
  <div class="stack">
    <p class="notice notice--warn">
      <b>本页规则为「{{ RULE_SOURCE }}」，当前版本 {{ RULE_VERSION }}。</b>
      规则数值用于验证监测数据录入、预警分级、通知派单和维修闭环流程，<b>不是国家建筑安全标准，也不是建筑危险极限</b>。
      建筑监测预警值须结合建筑类型、结构状态、历史数据和设计要求确定，不能所有建筑统一使用一套安全限值。
    </p>

    <SectionCard title="预警规则" :sub="`共 ${rules.length} 条；停用或尚未生效的规则不参与当前数据判断`" marked>
      <template #actions>
        <AppButton size="sm" :disabled="selected === undefined" @click="openEdit">编辑规则</AppButton>
      </template>
      <DataTable
        :columns="[
          { key: 'code', label: '规则编号', width: '160px' },
          { key: 'name', label: '规则名称' },
          { key: 'metric', label: '指标', width: '110px' },
          { key: 'thresholds', label: '分级阈值', width: '230px' },
          { key: 'version', label: '版本', width: '74px' },
          { key: 'status', label: '状态', width: '86px' },
          { key: 'ops', label: '操作', width: '110px' },
        ]"
        :row-count="rules.length"
        empty="尚未配置预警规则"
      >
        <tr
          v-for="rule in rules"
          :key="rule.id"
          class="clickable"
          :class="{ 'row--on': rule.id === selected?.id }"
          @click="selectedId = rule.id"
        >
          <td class="code">{{ rule.code }}</td>
          <td>{{ rule.name }}</td>
          <td>{{ metricName(rule.metric) }}</td>
          <td class="num">
            <template v-if="rule.thresholds !== null">
              黄 {{ rule.thresholds.yellow }} / 橙 {{ rule.thresholds.orange }} / 红 {{ rule.thresholds.red }} {{ rule.unit }}
            </template>
            <template v-else>环境条件（见规则详情）</template>
          </td>
          <td class="num">{{ rule.version }}</td>
          <td>
            <StatusTag :tone="rule.enabled ? 'green' : 'gray'" :text="rule.enabled ? '已启用' : '已停用'" />
          </td>
          <td>
            <AppButton size="sm" variant="ghost" @click.stop="selectedId = rule.id; openEdit()">编辑</AppButton>
          </td>
        </tr>
      </DataTable>
    </SectionCard>

    <div class="two">
      <SectionCard
        title="规则详情"
        :sub="selected === undefined ? '选择上方规则查看' : `${selected.code}｜${selected.name}（${selected.version}）`"
      >
        <EmptyState v-if="selected === undefined" title="尚未选择规则" sub="在上表中选择一条规则" />
        <div v-else class="stack">
          <p class="field-hint">
            下表"命中后预期动作"中，**黄色与橙色以上等级已由系统自动生成或升级预警事件**（见预警中心）；
            接单、排查、维修、验收等处置动作属 V0.3 与 V1.0。
          </p>
          <DataTable
            v-if="thresholdRows.length > 0"
            :columns="[
              { key: 'level', label: '等级', width: '120px' },
              { key: 'condition', label: '触发条件', width: '180px' },
              { key: 'action', label: '命中后预期动作' },
            ]"
            :row-count="thresholdRows.length"
          >
            <tr v-for="row in thresholdRows" :key="row.level">
              <td><StatusTag :tone="row.tone" :text="row.level" /></td>
              <td class="num">{{ row.condition }}</td>
              <td>{{ row.action }}</td>
            </tr>
          </DataTable>
          <DescList :items="detailItems" :columns="2" />

          <div v-if="selectedVersions.length > 1" class="block">
            <div class="block-title">版本历史（{{ selectedVersions.length }} 个版本）</div>
            <p class="field-hint">
              每次保存规则都会生成新版本，旧版本原样保留。判定按采样时间选取当时生效的版本，
              因此调整阈值不会改变历史记录与历史事件的解释。
            </p>
            <ul class="ver-list">
              <li v-for="(row, index) in selectedVersions" :key="row.id">
                <span class="code">{{ row.version }}</span>
                <span>{{ formatDateTime(row.effectiveFrom) }} 起生效</span>
                <span class="muted">{{ formatThresholds(row) }}</span>
                <StatusTag v-if="index === 0" tone="green" text="当前生效" :dot="false" />
                <StatusTag v-else tone="gray" text="历史版本" :dot="false" />
              </li>
            </ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="单条试算" sub="按当前规则实算，不写入数据；用于现场核对阈值边界">
        <div class="stack">
          <label class="trial-field">
            <span>选择测点</span>
            <select v-model="trialPointId" class="ctl" @change="selectTrialPoint">
              <option value="">请选择</option>
              <option v-for="point in archive.activePoints" :key="point.id" :value="point.id">
                {{ point.code }} {{ point.name }}
              </option>
            </select>
          </label>

          <FormGrid v-if="trialFields.length > 0" v-model="trialValues" :fields="trialFields" />

          <div v-if="trialResult !== null && trialResult.missing" class="notice notice--warn">
            该测点没有适用的启用规则，无法试算。
          </div>
          <div v-else-if="trialResult !== null" class="trial-result">
            <div class="row-between">
              <StatusTag :tone="stateTone(trialResult.assessment.state)" :text="stateLabel(trialResult.assessment.state)" />
              <span class="code">{{ trialResult.rule?.code }} · {{ trialResult.rule?.version }}</span>
            </div>
            <dl class="trial-kv">
              <div><dt>判定依据</dt><dd>{{ trialResult.assessment.basis === '' ? '—' : trialResult.assessment.basis }}</dd></div>
              <div><dt>触发值</dt><dd class="num">{{ trialResult.assessment.triggerValue === null ? '—' : `${fmtNumber(trialResult.assessment.triggerValue, 2)} ${trialResult.rule?.unit}` }}</dd></div>
              <div><dt>基准值</dt><dd class="num">{{ trialResult.assessment.baselineValue === null ? '不设基准' : fmtNumber(trialResult.assessment.baselineValue, 2) }}</dd></div>
              <div><dt>生效基准版本</dt><dd class="num">{{ trialResult.baseline === undefined ? '无' : `v${trialResult.baseline.version}` }}</dd></div>
              <div><dt>允许操作</dt><dd>{{ stateAllowedAction(trialResult.assessment.state) }}</dd></div>
              <div><dt>判定结论</dt><dd>{{ trialResult.assessment.reason === '' ? '未越限' : trialResult.assessment.reason }}</dd></div>
            </dl>
            <p v-if="trialResult.assessment.insufficientReason !== ''" class="field-hint">
              {{ trialResult.assessment.insufficientReason }}：数据不足时显示无法判断，不显示“正常”。
            </p>
          </div>
          <p v-else class="field-hint">选择测点并填入读数后即时显示分级结果。</p>
        </div>
      </SectionCard>
    </div>


    <ScriptCheckPanel />

    <RuleDialog :open="editOpen" :rule="selected ?? null" @close="editOpen = false" />
  </div>
</template>

<style scoped>
.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.clickable {
  cursor: pointer;
}

.row--on {
  background: var(--brand-050);
}

.trial-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
}

.trial-result {
  padding: 12px 14px;
  border: 1px solid var(--brand-200);
  border-radius: var(--r-sm);
  background: var(--brand-050);
}

.trial-kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  margin: 10px 0 0;
}

.trial-kv dt {
  font-size: 11.5px;
  color: var(--text-3);
}

.trial-kv dd {
  margin: 0;
  font-size: 13px;
}

.block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.ver-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}

.ver-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 6px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--canvas);
}

.script-block + .script-block {
  margin-top: 18px;
}

.script-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

@media (max-width: 1180px) {
  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
