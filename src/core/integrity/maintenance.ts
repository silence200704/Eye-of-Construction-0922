/**
 * 保养相关的一致性检查（从 integrity/index.ts 拆出：文件超过 450 行的硬指标）。
 *
 * 两类检查：保养计划与任务的引用是否有效；保养任务与它转出的问题是否**双向对应**。
 */
import type { IntegrityInput, IntegrityIssue } from './index'

/**
 * 保养数据的引用校验（V1-D）：计划要指向真实存在的设备/测点/楼栋，
 * 任务要指向真实存在的计划与设备，快照里的位置也要能对上档案 ——
 * 设备或测点被调拨、归档后，历史任务仍应能解释"当时在哪"，指向不存在的位置就是数据坏了。
 */
export function checkMaintenanceLinks(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const deviceIds = new Set(data.devices.map((row) => row.id))
  const pointIds = new Set(data.points.map((row) => row.id))
  const floorIds = new Set(data.floors.map((row) => row.id))
  const buildingIds = new Set(data.buildings.map((row) => row.id))
  const planIds = new Set((data.maintenancePlans ?? []).map((row) => row.id))

  for (const plan of data.maintenancePlans ?? []) {
    const label = `${plan.code} ${plan.name}`
    if (!deviceIds.has(plan.deviceId)) {
      issues.push({ level: 'error', kind: '保养计划设备引用失效', objectId: plan.id, label, message: '计划指向的设备已不存在' })
    }
    if (!buildingIds.has(plan.buildingId)) {
      issues.push({ level: 'error', kind: '保养计划楼栋引用失效', objectId: plan.id, label, message: '计划所属楼栋已不存在' })
    }
    if (plan.pointId !== null && !pointIds.has(plan.pointId)) {
      issues.push({ level: 'error', kind: '保养计划测点引用失效', objectId: plan.id, label, message: '计划指向的测点已不存在' })
    }
    if (plan.checklist.length === 0) {
      issues.push({ level: 'error', kind: '保养计划缺少检查项', objectId: plan.id, label, message: '计划没有检查项，执行时没有依据' })
    }
  }

  for (const task of data.maintenanceTasks ?? []) {
    const label = `${task.taskNo} ${task.snapshot.deviceName}`.trim()
    if (!planIds.has(task.planId)) {
      issues.push({ level: 'error', kind: '保养任务计划引用失效', objectId: task.id, label, message: '任务指向的保养计划已不存在' })
    }
    if (!deviceIds.has(task.deviceId)) {
      issues.push({ level: 'error', kind: '保养任务设备引用失效', objectId: task.id, label, message: '任务指向的设备已不存在' })
    }
    // 快照里的位置：楼栋与楼层要能在档案里对上（区域名允许历史保留，故只校验楼栋与楼层）
    if (!buildingIds.has(task.snapshot.buildingId)) {
      issues.push({ level: 'error', kind: '保养任务快照楼栋失效', objectId: task.id, label, message: '任务快照里的楼栋已不存在' })
    }
    if (!floorIds.has(task.snapshot.floorId)) {
      issues.push({ level: 'error', kind: '保养任务快照楼层失效', objectId: task.id, label, message: '任务快照里的楼层已不存在' })
    }
    if (task.status === 'done' && task.execution === null) {
      issues.push({ level: 'error', kind: '保养任务缺少执行记录', objectId: task.id, label, message: '任务标记已完成为何没有执行记录，两者必须同时存在' })
    }
  }

  checkMaintenanceIssueLinks(data, issues)
}

/**
 * 保养任务与问题之间的双向关联（v7）。
 *
 * 两边的字段必须**互为反向**：任务的 `execution.issueId` 指向的那条问题，其 `maintenanceTaskId`
 * 必须指回这条任务；反之亦然。只补一边会出现"任务详情跳不到问题"或"问题找不到来源任务"，
 * 而这正是一致性检查存在的意义 —— 所以断链要报出来，而不是静默当成没有关联。
 */
export function checkMaintenanceIssueLinks(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const issueById = new Map((data.issues ?? []).map((row) => [row.id, row]))
  const taskById = new Map((data.maintenanceTasks ?? []).map((row) => [row.id, row]))

  for (const task of data.maintenanceTasks ?? []) {
    const label = `${task.taskNo} ${task.snapshot.deviceName}`.trim()
    const linked = task.execution === null || task.execution === undefined ? null : (task.execution.issueId ?? null)
    if (linked === null) continue
    const issue = issueById.get(linked)
    if (issue === undefined) {
      issues.push({
        level: 'error',
        kind: '保养转问题断链',
        objectId: task.id,
        label,
        message: `执行记录关联的问题 ${linked} 已不存在`,
      })
      continue
    }
    if ((issue.maintenanceTaskId ?? null) !== task.id) {
      issues.push({
        level: 'error',
        kind: '保养转问题关联不一致',
        objectId: task.id,
        label,
        message: `执行记录指向问题 ${issue.issueNo || issue.id}，但该问题的来源保养任务不是本条（${issue.maintenanceTaskId ?? '未填写'}）`,
      })
    }
  }

  for (const issue of data.issues ?? []) {
    const taskId = issue.maintenanceTaskId ?? null
    if (taskId === null) {
      // 来源写"保养发现"却没带任务：这种问题在问题池里点不回任务，属于断链
      if (issue.source === 'maintenance') {
        issues.push({
          level: 'error',
          kind: '保养转问题断链',
          objectId: issue.id,
          label: issue.issueNo,
          message: '问题来源为「保养发现」但没有记录来源保养任务',
        })
      }
      continue
    }
    const task = taskById.get(taskId)
    if (task === undefined) {
      issues.push({
        level: 'error',
        kind: '保养转问题断链',
        objectId: issue.id,
        label: issue.issueNo,
        message: `问题记录的来源保养任务 ${taskId} 已不存在`,
      })
      continue
    }
    const back = task.execution === null || task.execution === undefined ? null : (task.execution.issueId ?? null)
    if (back !== issue.id) {
      issues.push({
        level: 'error',
        kind: '保养转问题关联不一致',
        objectId: issue.id,
        label: issue.issueNo,
        message: `问题指向保养任务 ${task.taskNo || task.id}，但该任务的执行记录没有指回本条问题`,
      })
    }
  }
}

