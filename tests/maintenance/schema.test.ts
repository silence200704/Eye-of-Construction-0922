/**
 * 数据结构版本与备份版本的对应关系（V1-D 收口 P0-1）。
 *
 * 踩过的坑：数据库已经开到 v5（新增保养表），但 `SCHEMA_VERSION` 还写 4 ——
 * 导出的备份标着 v4，旧版程序会把它当兼容备份导入，然后**静默丢掉保养数据**。
 * 这里锁三件事：当前导出标的是当前版本、旧版本备份能导入、真实 Dexie v4→v6 升级后旧表数据完好。
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { buildBackup, parseBackup, toDataset } from '@/db/backup'
import {
  SCHEMA_V1_STORES,
  SCHEMA_V2_STORES,
  SCHEMA_V3_STORES,
  SCHEMA_V4_STORES,
  SCHEMA_V5_STORES,
  SCHEMA_V6_STORES,
  SCHEMA_V7_STORES,
} from '@/db/database'
import { linkMaintenanceIssues } from '@/db/maintenance/migrate'
import type { InspectionIssue } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'
import { SCHEMA_VERSION } from '@/types/catalog'
import type { Dataset } from '@/db/repo'

const AT = '2026-09-20T09:00:00.000Z'

function emptyDataset(): Dataset {
  return {
    buildings: [], floors: [], points: [], devices: [], baselines: [], records: [], audits: [], rules: [],
    events: [], notifications: [], plans: [], tasks: [], issues: [], workOrders: [], attachments: [],
    maintenancePlans: [], maintenanceTasks: [],
  }
}

describe('备份版本号', () => {
  it('当前导出的备份标的是当前数据结构版本', async () => {
    const pkg = await buildBackup(emptyDataset(), '演示操作员')
    expect(pkg.schemaVersion).toBe(SCHEMA_VERSION)
    expect(pkg.schemaVersion).toBe(7)
  })

  it('旧版（v4）备份能导入，保养两表按空数组恢复', async () => {
    const pkg = await buildBackup(emptyDataset(), '演示操作员')
    const legacy = { ...pkg, schemaVersion: 4, data: { ...pkg.data, maintenancePlans: undefined, maintenanceTasks: undefined } }
    const parsed = parseBackup(JSON.stringify(legacy))
    expect(parsed.ok).toBe(true)
    const data = toDataset(parsed.data!)
    expect(data.maintenancePlans).toEqual([])
    expect(data.maintenanceTasks).toEqual([])
    // 旧备份里本来就有的业务数据照常恢复
    expect(data.buildings).toEqual([])
  })

  it('高于当前版本的备份会被拒绝，不会静默丢掉本程序不认识的表', async () => {
    const pkg = await buildBackup(emptyDataset(), '演示操作员')
    const future = { ...pkg, schemaVersion: SCHEMA_VERSION + 1 }
    const parsed = parseBackup(JSON.stringify(future))
    expect(parsed.ok).toBe(false)
    expect(parsed.errors.join('；')).toContain('高于当前程序支持的')
  })
})

describe('真实 Dexie 升级：v4 → v5 → v6 → v7 旧表数据完好', () => {
  it('v4/v5 库升级到 v7 后，旧表数据原样保留，附件与保养关联索引都可用', async () => {
    const name = 'zhutong-upgrade-probe'

    // 1) 用真实的 v4 定义建库并写入数据（定义取自 database.ts，不是测试里另抄一份）
    const v4 = new Dexie(name)
    v4.version(1).stores(SCHEMA_V1_STORES)
    v4.version(2).stores(SCHEMA_V2_STORES)
    v4.version(3).stores(SCHEMA_V3_STORES)
    v4.version(4).stores(SCHEMA_V4_STORES)
    await v4.open()
    // 代表性旧数据：档案、记录、事件、巡检计划、附件各放一些 —— 只测两张表证明不了"整个历史库不丢数据"
    await v4.table('buildings').add({ id: 'bld_1', code: 'B01', name: '1号综合楼', status: 'active' })
    await v4.table('floors').add({ id: 'flr_1', buildingId: 'bld_1', name: '一层', status: 'active' })
    await v4.table('points').add({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', status: 'active' })
    await v4.table('devices').add({ id: 'dev_1', code: 'DEV-1', pointId: 'pnt_1', status: 'active' })
    await v4.table('records').add({ id: 'rec_1', recordNo: 'R20260920-001', pointId: 'pnt_1', sampleTime: AT })
    await v4.table('events').add({ id: 'evt_1', eventNo: 'E20260920-001', pointId: 'pnt_1', status: 'closed' })
    await v4.table('plans').add({ id: 'plan_1', code: 'PLAN-20260920-001', buildingId: 'bld_1', kind: 'patrol' })
    await v4.table('attachments').add({ id: 'att_1', issueId: 'iss_1', workOrderId: null, kind: 'scene' })
    v4.close()

    // v5 起才有保养表：先用 v5 写入一条"保养转出但还没补关联"的问题与一条已完成任务，
    // 用来验证 v7 升级会按 submissionKey 把两侧的关联补上（旧库只有单边信息）
    const v5 = new Dexie(name)
    v5.version(1).stores(SCHEMA_V1_STORES)
    v5.version(2).stores(SCHEMA_V2_STORES)
    v5.version(3).stores(SCHEMA_V3_STORES)
    v5.version(4).stores(SCHEMA_V4_STORES)
    v5.version(5).stores(SCHEMA_V5_STORES)
    await v5.open()
    await v5.table('maintenanceTasks').add({
      id: 'task_m1',
      taskNo: 'MT-20260920-001',
      planId: 'plan_m1',
      deviceId: 'dev_1',
      plannedAt: AT,
      dueAt: AT,
      status: 'done',
      snapshot: { planCode: 'MP-1', planName: '保养', deviceCode: 'DEV-1', deviceName: '探头', pointId: 'pnt_1', buildingId: 'bld_1', floorId: 'flr_1', zoneId: 'z', owner: '李老师', cycle: { unit: 'month', interval: 1, atTime: '09:00' }, checklist: [] },
      execution: { at: AT, by: '李老师', byRole: '物业值班人员', checklist: [], measures: '紧固', materials: '', photos: [], nextDueDate: '2026-10-20', note: '' },
      timeline: [],
    })
    await v5.table('issues').add({
      id: 'iss_m1',
      issueNo: 'ISS-20260920-001',
      source: 'maintenance',
      submissionKey: 'mt_task_m1',
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      floorId: 'flr_1',
      zoneId: 'z',
      eventId: null,
      taskId: null,
      anomalyType: '保养发现异常',
      description: '螺栓锈蚀',
      photos: [],
      status: 'pending_review',
      reviewAction: null,
      reviewCategory: '',
      reviewedAt: null,
      reviewedBy: '',
      reviewNote: '',
      duplicateOf: null,
      linkedEventId: null,
      linkedFrom: [],
      workOrderIds: [],
      rechecks: [],
      timeline: [],
    })
    v5.close()

    // 2) 按应用的版本链打开（v4 → v5 新增保养表 → v6 附件加保养归属索引）
    const v6 = new Dexie(name)
    v6.version(1).stores(SCHEMA_V1_STORES)
    v6.version(2).stores(SCHEMA_V2_STORES)
    v6.version(3).stores(SCHEMA_V3_STORES)
    v6.version(4).stores(SCHEMA_V4_STORES)
    v6.version(5).stores(SCHEMA_V5_STORES)
    v6.version(6).stores(SCHEMA_V6_STORES)
    // v7：问题表补 maintenanceTaskId 索引，并在升级回调里把保养 ↔ 问题的双向关联补迁回来
    v6.version(7).stores(SCHEMA_V7_STORES).upgrade(async (tx) => {
      const linked = linkMaintenanceIssues(
        (await tx.table('issues').toArray()) as InspectionIssue[],
        (await tx.table('maintenanceTasks').toArray()) as MaintenanceTask[],
      )
      for (const row of linked.issues) {
        if (row.maintenanceTaskId !== undefined) await tx.table('issues').put(row)
      }
      for (const row of linked.tasks) {
        if (row.execution !== null && row.execution !== undefined && row.execution.issueId !== undefined) {
          await tx.table('maintenanceTasks').put(row)
        }
      }
    })
    await v6.open()

    // 旧表数据逐张核对：档案、记录、事件、计划都在
    expect(await v6.table('buildings').count()).toBe(1)
    expect(await v6.table('floors').count()).toBe(1)
    expect(await v6.table('points').count()).toBe(1)
    expect(await v6.table('devices').count()).toBe(1)
    expect((await v6.table('records').get('rec_1'))?.recordNo).toBe('R20260920-001')
    expect((await v6.table('events').get('evt_1'))?.eventNo).toBe('E20260920-001')
    expect((await v6.table('plans').get('plan_1'))?.code).toBe('PLAN-20260920-001')
    // 保养表已建好，且 v5 阶段写入的那条已完成任务升级后还在
    expect(await v6.table('maintenanceTasks').count()).toBe(1)
    expect((await v6.table('maintenanceTasks').get('task_m1'))?.taskNo).toBe('MT-20260920-001')
    // 旧附件行还在，新字段读作 undefined（调用方按 null 处理）
    const attachment = await v6.table('attachments').get('att_1')
    expect(attachment?.issueId).toBe('iss_1')
    expect(attachment?.maintenanceTaskId).toBeUndefined()
    // v6 新增的索引可用：按保养任务查附件
    await v6.table('attachments').put({ id: 'att_2', issueId: null, workOrderId: null, maintenanceTaskId: 'mt_1', kind: 'after' })
    expect(await v6.table('attachments').where('maintenanceTaskId').equals('mt_1').count()).toBe(1)

    // v7 新增索引可用：按来源保养任务查问题
    const issue = await v6.table('issues').get('iss_m1')
    expect(issue?.maintenanceTaskId).toBe('task_m1')
    expect(await v6.table('issues').where('maintenanceTaskId').equals('task_m1').count()).toBe(1)
    // 反向也补齐：任务的执行记录指回那条问题
    const task = await v6.table('maintenanceTasks').get('task_m1')
    expect(task?.execution?.issueId).toBe('iss_m1')

    v6.close()
    await Dexie.delete(name)
  })
})
