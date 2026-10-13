<script setup lang="ts">
/**
 * 人工上报问题表单。
 *
 * 方案 §1：巡检人员负责到点检查与上报，物业与安全管理人员同样能报 —— 所以这里不限身份。
 * 与"巡检发现"的区别是：人工上报不属于某个任务，需要自己选位置；来源固定记为"人工上报"，
 * 页面不允许把它标成巡检发现（来源不能伪造）。
 */
import { computed, ref } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import { useIssueStore } from '@/stores/inspection/issues'
import { useSessionStore } from '@/stores/session'
import { ANOMALY_TYPES, type PhotoDraftLike } from '@/config/issueOptions'
import PhotoUploader from '@/components/inspection/PhotoUploader.vue'
import AppButton from '@/components/ui/AppButton.vue'

const emit = defineEmits<{ done: [{ issueNo: string; note: string }]; cancel: [] }>()

const archive = useArchiveStore()
const issues = useIssueStore()
const session = useSessionStore()

const buildingId = ref('')
const floorId = ref('')
const zoneId = ref('')
const pointId = ref('')
const anomalyType = ref(ANOMALY_TYPES[0])
const description = ref('')
const photos = ref<PhotoDraftLike[]>([])
const error = ref('')
const busy = ref(false)

const buildings = computed(() => archive.buildings.filter((row) => row.status === 'active'))
const floors = computed(() => (buildingId.value === '' ? [] : archive.floorsOf(buildingId.value)))
const zones = computed(() => archive.floorById(floorId.value)?.zones ?? [])
const points = computed(() =>
  floorId.value === '' ? [] : archive.points.filter((row) => row.status === 'active' && row.floorId === floorId.value),
)

function onBuilding(): void {
  floorId.value = ''
  zoneId.value = ''
  pointId.value = ''
}

function onFloor(): void {
  zoneId.value = ''
  pointId.value = ''
}

function onPoint(): void {
  // 选了具体测点就顺带把位置带进来，省得重复选
  const point = points.value.find((row) => row.id === pointId.value)
  if (point !== undefined) {
    zoneId.value = point.zoneId
  }
}

async function submit(): Promise<void> {
  if (buildingId.value === '') {
    error.value = '请选择楼栋'
    return
  }
  if (floorId.value === '') {
    error.value = '请选择楼层'
    return
  }
  if (zoneId.value === '') {
    error.value = '请选择所在位置（区域）'
    return
  }
  if (description.value.trim().length < 4) {
    error.value = '请写明现场情况（至少 4 个字），否则审核无法判断'
    return
  }
  error.value = ''
  busy.value = true
  try {
    /*
     * 只有一个受控入口：照片草稿随问题上报表一起提交，
     * 问题、附件、时间线、审计日志在同一个事务里落库 —— 不再"先建问题、再逐张传照片、再关联"。
     * 提交失败时页面上什么都不用清理：库里也没有半成品，草稿仍在，改完直接重试。
     */
    const outcome = await issues.reportManualIssue({
      pointId: pointId.value === '' ? null : pointId.value,
      buildingId: buildingId.value,
      floorId: floorId.value,
      zoneId: zoneId.value,
      anomalyType: anomalyType.value,
      description: description.value.trim(),
      photos: [],
      photoDrafts: photos.value,
      detail: `${session.roleLabel}现场上报：${description.value.trim()}`,
    })
    const uploaded = outcome.issue.photos.length
    // 编号与说明分开回给父组件：父组件要用纯编号去列表里定位这一条，不能从拼接串里反解
    emit('done', {
      issueNo: outcome.issue.issueNo,
      note: outcome.duplicated ? `（同一次提交已存在，未重复建单；照片 ${uploaded} 张）` : `（照片 ${uploaded} 张）`,
    })
  } catch (cause) {
    error.value = `提交失败：${(cause as Error).message}（草稿已保留，可重试）`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="manual-form">
    <p class="notice notice--warn">
      来源记为「人工上报」：它不属于某次巡检任务，位置需要自己选。巡检发现的来源不能在这里伪造。
    </p>

    <div class="grid">
      <label class="field">
        <span>楼栋 <b>*</b></span>
        <select v-model="buildingId" class="ctl" @change="onBuilding">
          <option value="">请选择…</option>
          <option v-for="row in buildings" :key="row.id" :value="row.id">{{ row.code }} {{ row.name }}</option>
        </select>
      </label>
      <label class="field">
        <span>楼层 <b>*</b></span>
        <select v-model="floorId" class="ctl" :disabled="buildingId === ''" @change="onFloor">
          <option value="">请选择…</option>
          <option v-for="row in floors" :key="row.id" :value="row.id">{{ row.name }}</option>
        </select>
      </label>
      <label class="field">
        <span>所在位置 <b>*</b></span>
        <select v-model="zoneId" class="ctl" :disabled="floorId === ''">
          <option value="">请选择…</option>
          <option v-for="zone in zones" :key="zone" :value="zone">{{ zone }}</option>
        </select>
      </label>
      <label class="field">
        <span>关联测点</span>
        <select v-model="pointId" class="ctl" :disabled="floorId === ''" @change="onPoint">
          <option value="">不指定（只记到区域）</option>
          <option v-for="row in points" :key="row.id" :value="row.id">{{ row.code }} {{ row.name }}</option>
        </select>
        <em class="field-hint">能定位到具体测点时建议选上，便于与监测数据对照</em>
      </label>
      <label class="field">
        <span>异常类型 <b>*</b></span>
        <select v-model="anomalyType" class="ctl">
          <option v-for="item in ANOMALY_TYPES" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
    </div>

    <label class="field">
      <span>现场情况 <b>*</b></span>
      <textarea v-model="description" class="ctl" rows="3" placeholder="例如：二层西侧走廊墙面出现新裂缝，长约 30cm，位于窗台下" />
    </label>

    <div class="field">
      <span>现场照片</span>
      <PhotoUploader v-model:photos="photos" @error="error = $event" />
    </div>

    <p v-if="error !== ''" class="notice notice--warn">{{ error }}</p>

    <div class="row-between foot">
      <AppButton size="sm" @click="emit('cancel')">取消</AppButton>
      <AppButton size="sm" variant="primary" :disabled="busy" @click="submit">提交问题</AppButton>
    </div>
  </div>
</template>

<style scoped>
.manual-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
}

.field b {
  color: var(--state-red, #c0362c);
}

.foot {
  border-top: 1px solid var(--line);
  padding-top: 8px;
}
</style>
