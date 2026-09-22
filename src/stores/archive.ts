/**
 * 档案状态：楼栋 / 楼层 / 测点 / 设备 / 基准 / 操作日志。
 * 页面共用同一数据源，单次状态变更同时更新记录和日志；刷新后从本地数据库恢复。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AuditAction, AuditLog, AuditObject, Baseline, Building, Device, Floor, Point } from '@/types/domain'
import type { MonitoringRule } from '@/types/rules'
import { hasNumericReadings } from '@/types/catalog'
import { baselineAtTime, migrateLegacyRules, ruleForPoint } from '@/core/rules'
import { nowIso } from '@/core/time'
import { clearDataset, putPoints, putRules, readDataset, replaceRules, writeAudit, writeDataset, type AuditInput, type Dataset } from '@/db/repo'
import { migrateLegacyPoints } from '@/db/inspection/migrate'
import { seedDataset } from '@/db/seed'
import { seedRules } from '@/config/ruleSeed'
import { useSessionStore } from './session'

const MODE_KEY = 'zhutong-demo/data-mode'
export type DataMode = 'seed' | 'blank'

function readDataMode(): DataMode {
  return localStorage.getItem(MODE_KEY) === 'blank' ? 'blank' : 'seed'
}

function writeDataMode(mode: DataMode): void {
  localStorage.setItem(MODE_KEY, mode)
}

export const useArchiveStore = defineStore('archive', () => {
  /** 数据模式是响应式状态：切换示例/空白后侧栏与设置页立即同步。 */
  const dataMode = ref<DataMode>(readDataMode())
  const buildings = ref<Building[]>([])
  const floors = ref<Floor[]>([])
  const points = ref<Point[]>([])
  const devices = ref<Device[]>([])
  const baselines = ref<Baseline[]>([])
  const audits = ref<AuditLog[]>([])
  const rules = ref<MonitoringRule[]>([])
  const loaded = ref(false)
  const busy = ref(false)

  function setMode(mode: DataMode): void {
    dataMode.value = mode
    writeDataMode(mode)
  }

  function applyDataset(data: Dataset): void {
    buildings.value = data.buildings
    floors.value = data.floors
    points.value = data.points
    devices.value = data.devices
    baselines.value = data.baselines
    audits.value = data.audits
    rules.value = data.rules
  }

  async function reload(): Promise<void> {
    applyDataset(await readDataset())
  }

  async function bootstrap(): Promise<void> {
    await reload()
    loaded.value = true
    const empty = buildings.value.length === 0 && points.value.length === 0
    if (empty && dataMode.value === 'seed') {
      await loadSeed()
      return
    }
    // 数据结构升级到 v2 后补入内置演示规则；示例模式下才补，空白模式保持空白
    if (rules.value.length === 0 && dataMode.value === 'seed') {
      await putRules(seedRules())
      await reload()
    }
    await migrateLegacyRulesInPlace()
    migratedRules.value = lastMigrationCount
    await migrateLegacyPointsInPlace()
  }

  /**
   * 旧库的测点没有 NFC 标签字段（v3 及以前），补齐后才能走 V0.3 的到点打卡。
   * 与规则迁移同一做法：启动时与导入备份后各跑一次，已带标签的点位不动。
   */
  async function migrateLegacyPointsInPlace(): Promise<void> {
    const { rows, changed } = migrateLegacyPoints(points.value, nowIso(), '数据结构升级')
    if (changed === 0) return
    await putPoints(rows)
    await reload()
    await log(
      'update',
      'system',
      'points',
      '测点 NFC 标签',
      `为 ${changed} 个测点补建 NFC 标签编号`,
      '旧版本数据没有标签字段，补建后才能走巡检到点打卡；编号与测点编号一致',
    )
  }

  const migratedRules = ref(0)
  let lastMigrationCount = 0

  /**
   * v2 的规则行没有跨版本稳定的 ruleId，升级到 v3 后必须补齐，
   * 否则事件归并标识为空，规则版本与事件去重都失效。
   */
  async function migrateLegacyRulesInPlace(): Promise<void> {
    const { rows, changed } = migrateLegacyRules(rules.value)
    if (changed === 0) {
      lastMigrationCount = 0
      return
    }
    const staleIds = rules.value
      .filter((row) => row.ruleId === undefined || row.ruleId === null || row.ruleId === '' || `${row.ruleId}@${row.version}` !== row.id)
      .map((row) => row.id)
    // 删旧主键与写新主键同事务：分开写会在中间留一个"规则全没了"的窗口
    await replaceRules(staleIds, rows)
    lastMigrationCount = changed
    await log(
      'update',
      'system',
      'rules',
      '预警规则',
      `数据结构升级：为 ${changed} 条旧规则补齐稳定规则标识`,
      'v2 升级到 v3 的迁移，旧规则按编号生成固定标识，事件归并恢复可用',
    )
    await reload()
  }

  /**
   * 数据集整体替换后，其它 store 的内存快照会失效。
   * 由数据管理页在载入示例、清空、恢复备份后统一调用，避免拿着旧事件继续归并。
   */
  async function loadSeed(): Promise<void> {
    busy.value = true
    try {
      await writeDataset(seedDataset())
      setMode('seed')
      await reload()
    } finally {
      busy.value = false
    }
  }

  async function clearAll(reason: string): Promise<void> {
    busy.value = true
    try {
      await clearDataset()
      setMode('blank')
      await log('clear', 'system', 'all', '全部业务数据', '清空本地数据，转为空白模式', reason)
      await reload()
    } finally {
      busy.value = false
    }
  }

  /**
   * 备份恢复：先写入完整数据集，再由调用方补充导入日志。
   * 旧版备份里的规则可能没有 ruleId，导入后立即迁移，不必等下次刷新。
   */
  async function restoreDataset(data: Dataset): Promise<void> {
    await writeDataset(data)
    setMode(data.buildings.length > 0 ? 'seed' : 'blank')
    await reload()
    await migrateLegacyRulesInPlace()
    migratedRules.value = lastMigrationCount
    await migrateLegacyPointsInPlace()
  }

  async function log(
    action: AuditAction,
    objectType: AuditObject,
    objectId: string,
    objectLabel: string,
    summary: string,
    reason = '',
  ): Promise<AuditLog> {
    const session = useSessionStore()
    const input: AuditInput = {
      actor: session.name,
      actorRole: session.roleLabel,
      action,
      objectType,
      objectId,
      objectLabel,
      summary,
      reason,
    }
    const entry = await writeAudit(input)
    audits.value = [entry, ...audits.value].slice(0, 500)
    return entry
  }

  const activeBuildings = computed(() => buildings.value.filter((row) => row.status === 'active'))
  const activePoints = computed(() => points.value.filter((row) => row.status === 'active'))
  const activeDevices = computed(() => devices.value.filter((row) => row.status === 'active'))

  const stats = computed(() => {
    const sensors = activePoints.value.filter((row) => hasNumericReadings(row.metric))
    return {
      buildings: activeBuildings.value.length,
      archivedBuildings: buildings.value.length - activeBuildings.value.length,
      floors: floors.value.filter((row) => row.status === 'active').length,
      points: activePoints.value.length,
      sensorPoints: sensors.length,
      manualPoints: activePoints.value.length - sensors.length,
      devices: activeDevices.value.length,
      baselines: baselines.value.filter((row) => row.current).length,
    }
  })

  function buildingById(id: string): Building | undefined {
    return buildings.value.find((row) => row.id === id)
  }

  function floorById(id: string): Floor | undefined {
    return floors.value.find((row) => row.id === id)
  }

  function pointById(id: string): Point | undefined {
    return points.value.find((row) => row.id === id)
  }

  function deviceById(id: string): Device | undefined {
    return devices.value.find((row) => row.id === id)
  }

  function buildingName(id: string): string {
    return buildingById(id)?.name ?? '未知楼栋'
  }

  function pointLabel(id: string): string {
    const point = pointById(id)
    return point === undefined ? '未知测点' : `${point.code} ${point.name}`
  }

  function floorsOf(buildingId: string, includeArchived = false): Floor[] {
    return floors.value
      .filter((row) => row.buildingId === buildingId && (includeArchived || row.status === 'active'))
      .sort((a, b) => a.floorNo - b.floorNo)
  }

  function pointsOfFloor(floorId: string, includeArchived = false): Point[] {
    return points.value
      .filter((row) => row.floorId === floorId && (includeArchived || row.status === 'active'))
      .sort((a, b) => a.code.localeCompare(b.code))
  }

  function pointsOfBuilding(buildingId: string, includeArchived = false): Point[] {
    return points.value.filter((row) => row.buildingId === buildingId && (includeArchived || row.status === 'active'))
  }

  function devicesOfPoint(pointId: string, includeArchived = false): Device[] {
    return devices.value.filter((row) => row.pointId === pointId && (includeArchived || row.status === 'active'))
  }

  /**
   * 按时间取生效基准：只选 effectiveFrom ≤ 采样时间的版本，取其中生效时间最晚的一版。
   * 因此"下周才生效的新基准"不会参与今天的数据录入与试算。
   */
  function baselineAt(pointId: string, at: string): Baseline | undefined {
    return baselineAtTime(baselines.value, pointId, at)
  }

  /** 当前生效基准 = 此刻按时间取到的版本。 */
  function currentBaseline(pointId: string): Baseline | undefined {
    return baselineAt(pointId, nowIso())
  }

  function ruleById(id: string): MonitoringRule | undefined {
    return rules.value.find((row) => row.id === id)
  }

  /** 按测点与采样时间挑选当时生效的规则版本。 */
  function ruleFor(pointId: string, at: string): MonitoringRule | undefined {
    const point = pointById(pointId)
    return point === undefined ? undefined : ruleForPoint(rules.value, point, at)
  }

  function baselineHistory(pointId: string): Baseline[] {
    return baselines.value
      .filter((row) => row.pointId === pointId)
      .sort((a, b) => b.version - a.version)
  }

  /** 规则的当前版本行：同一 ruleId 取生效时间最晚的一行。 */
  function latestRule(ruleId: string): MonitoringRule | undefined {
    return rules.value
      .filter((row) => row.ruleId === ruleId)
      .reduce<MonitoringRule | undefined>(
        (best, row) => (best === undefined || new Date(row.effectiveFrom) >= new Date(best.effectiveFrom) ? row : best),
        undefined,
      )
  }

  /** 每条规则只保留最新的版本行，供列表页与编辑页使用。 */
  const latestRules = computed(() => {
    const byRule = new Map<string, MonitoringRule>()
    for (const row of rules.value) {
      const best = byRule.get(row.ruleId)
      if (best === undefined || new Date(row.effectiveFrom) >= new Date(best.effectiveFrom)) byRule.set(row.ruleId, row)
    }
    return [...byRule.values()].sort((a, b) => a.code.localeCompare(b.code))
  })

  function ruleVersions(ruleId: string): MonitoringRule[] {
    return rules.value
      .filter((row) => row.ruleId === ruleId)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  }

  const ARCHIVE_ESSENTIALS: { key: keyof Building; label: string }[] = [
    { key: 'purpose', label: '用途' },
    { key: 'buildYear', label: '建设年份' },
    { key: 'floorCount', label: '层数' },
    { key: 'area', label: '面积' },
    { key: 'structureType', label: '结构形式' },
    { key: 'managerUnit', label: '管理单位' },
    { key: 'userUnit', label: '使用单位' },
    { key: 'owner', label: '楼栋负责人' },
    { key: 'backupPerson', label: '替补人员' },
  ]

  /** 档案字段缺失时显示"待补充"并纳入建档待办，不用空值冒充完整档案。 */
  function missingOfBuilding(building: Building): string[] {
    return ARCHIVE_ESSENTIALS.filter((item) => {
      const value = building[item.key]
      return value === null || value === undefined || String(value).trim() === ''
    }).map((item) => item.label)
  }

  return {
    dataMode,
    buildings,
    floors,
    points,
    devices,
    baselines,
    audits,
    rules,
    loaded,
    busy,
    migratedRules,
    activeBuildings,
    activePoints,
    activeDevices,
    stats,
    bootstrap,
    reload,
    loadSeed,
    clearAll,
    restoreDataset,
    log,
    buildingById,
    floorById,
    pointById,
    deviceById,
    buildingName,
    pointLabel,
    floorsOf,
    pointsOfFloor,
    pointsOfBuilding,
    devicesOfPoint,
    currentBaseline,
    baselineAt,
    baselineHistory,
    ruleById,
    ruleFor,
    latestRule,
    latestRules,
    ruleVersions,
    missingOfBuilding,
  }
})
