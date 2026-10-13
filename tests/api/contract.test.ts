/**
 * V2-1 契约测试。
 *
 * 证明的是**规则本身自洽、且与现有实现不漂移**，不证明服务端已接通：
 * 1. 七类资源样例会逐条校验（主键、编号规则、状态字典、时间、附件归属）；
 * 2. 每个写动作的请求样例必须过 `evaluateWrite()`；
 * 3. 越权、楼栋范围、缺幂等键、旧版本、非法状态迁移、缺必填都会被拒，并给出对应错误码；
 * 4. 契约里的状态迁移表与 `core` 里的真实状态机**逐条比对**（工单 6×6 全量、事件关闭门槛）。
 */
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, errorOf, httpStatusOf, isRetryable } from '@/api/contract/errors'
import { ERROR_CODE_LIST } from '@/api/contract/errors.types'
import { idempotencyKeyOf, idempotencyRuleOf, scopeAllowsBuilding } from '@/api/contract/envelope'
import { evaluateWrite } from '@/api/contract/guard'
import type { WriteRequest } from '@/api/contract/guard'
import { isBusinessNumber, isPrimaryKey, NUMBER_RULES } from '@/api/contract/ids'
import { ACTION_RULES, gapsToEnforce, permissionMatrix, roleAllowed, WRITE_ACTIONS } from '@/api/contract/scope'
import { READ_SAMPLES, sampleIssues, SAMPLE_NOW, WRITE_SAMPLES } from '@/api/contract/samples'
import { RECHECK_OUTCOME_STATUS, statusLabelOf, transitionAllowed, WORK_ORDER_NEXT } from '@/api/contract/states'
import { advance } from '@/core/inspection/workOrderFlow'
import { closeGuard } from '@/core/event/plan'
import { RECHECK_OUTCOMES, WORK_ORDER_STATUSES } from '@/types/inspection'
import type { WorkOrderStatus } from '@/types/inspection'
import { makeWorkOrder } from '../fixtures'

const ALL = { buildingIds: null }

function baseRequest(action: WriteRequest['action'], over: Partial<WriteRequest> = {}): WriteRequest {
  return {
    action,
    actor: { name: '演示操作员', role: 'safety' },
    scope: ALL,
    meta: { idempotencyKey: idempotencyKeyOf(action, ['x']), expectedRev: null, at: SAMPLE_NOW, note: '' },
    target: { exists: true, buildingId: 'bld_1', status: null, rev: null, assignedTo: null, requiredRole: null, machine: null },
    payload: {},
    ...over,
  }
}

describe('接口样例', () => {
  it('七类资源各有一组样例，且逐条通过校验（主键/编号/状态/时间/归属）', () => {
    expect(READ_SAMPLES.map((row) => row.resource).sort()).toEqual(['archive', 'event', 'issue', 'media', 'record', 'task', 'workOrder'])
    for (const sample of READ_SAMPLES) {
      expect(sampleIssues(sample), `${sample.resource}：${sample.label}`).toEqual([])
    }
  })

  it('样例校验器咬得住：编号、状态、归属、时间任一被改坏都能报出来', () => {
    const media = READ_SAMPLES.find((row) => row.resource === 'media')
    const archive = READ_SAMPLES.find((row) => row.resource === 'archive')
    const event = READ_SAMPLES.find((row) => row.resource === 'event')
    expect(media).toBeDefined()
    expect(archive).toBeDefined()
    expect(event).toBeDefined()
    if (media === undefined || archive === undefined || event === undefined) return
    const badNumber = { ...archive, dto: { ...archive.dto, code: 'X-1' } } as typeof archive
    const badStatus = { ...event, dto: { ...event.dto, status: 'archived' } } as typeof event
    const twoOwners = { ...media, dto: { ...media.dto, issueId: null, maintenanceTaskId: 'mt_1' } } as typeof media
    expect(sampleIssues(badNumber)[0]).toContain('业务编号')
    expect(sampleIssues(badStatus).join()).toContain('状态不在字典里')
    expect(sampleIssues(twoOwners).join()).toContain('只有一个归属')
  })

  it('每个写动作都有一条请求样例，且全部通过契约校验', () => {
    const covered = new Set(WRITE_SAMPLES.map((row) => row.action))
    for (const action of WRITE_ACTIONS) expect(covered.has(action), `缺样例：${action}`).toBe(true)
    for (const sample of WRITE_SAMPLES) {
      const outcome = evaluateWrite(sample)
      expect(outcome.ok, `${sample.action}（${sample.label}）：${outcome.ok ? '' : outcome.error.message}`).toBe(true)
    }
  })

  it('编号规则表与校验函数一致：每个样例编号都能被自己的规则接受', () => {
    for (const rule of NUMBER_RULES) {
      expect(isBusinessNumber(rule.resource, rule.field, rule.sample), `${rule.resource}.${rule.field}`).toBe(true)
      expect(isPrimaryKey(`${rule.resource === 'record' ? 'rec' : 'wo'}_abc123`)).toBe(true)
    }
    expect(isBusinessNumber('issue', 'issueNo', 'WO-20260929-002')).toBe(false)
  })
})

describe('越权与范围', () => {
  it('角色不符被拒：物业值班不能派工，安全管理人员不能接单', () => {
    const dispatch = evaluateWrite(baseRequest('work_order_dispatch', { actor: { name: '物业值班人员', role: 'property' }, payload: { assignee: '维修人员' } }))
    const accept = evaluateWrite(baseRequest('work_order_accept', { actor: { name: '演示操作员', role: 'safety' } }))
    expect(dispatch.ok).toBe(false)
    expect(accept.ok).toBe(false)
    if (!dispatch.ok) expect(dispatch.error.code).toBe('ROLE_FORBIDDEN')
    if (!accept.ok) expect(accept.error.code).toBe('ROLE_FORBIDDEN')
  })

  it('楼栋范围不符被拒，并报出允许的楼栋', () => {
    const outcome = evaluateWrite(baseRequest('issue_review', {
      scope: { buildingIds: ['bld_2'] },
      target: { exists: true, buildingId: 'bld_1', status: 'pending_review', rev: 2, assignedTo: null, requiredRole: null, machine: null },
      payload: { action: 'to_repair', category: 'equipment' },
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('SCOPE_FORBIDDEN')
      expect(outcome.error.details.allowedBuildings).toBe('bld_2')
    }
    expect(scopeAllowsBuilding(ALL, 'bld_9')).toBe(true)
  })

  it('身份缺失先于其它校验：连对象存在与否都不该被探测出来', () => {
    const outcome = evaluateWrite(baseRequest('record_write', {
      actor: { name: '', role: '' },
      target: { exists: false, buildingId: null, status: null, rev: null, assignedTo: null, requiredRole: null, machine: null },
      payload: {},
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('AUTH_REQUIRED')
  })

  it('被人代做的例外：物业值班可代接，但必须写明代做原因', () => {
    const target = { exists: true, buildingId: 'bld_1', status: 'assigned', rev: 3, assignedTo: '维修人员', requiredRole: null, machine: 'workOrder' as const }
    const noReason = evaluateWrite(baseRequest('work_order_accept', { actor: { name: '物业值班人员', role: 'property' }, target, payload: { to: 'repairing' } }))
    const withReason = evaluateWrite(baseRequest('work_order_accept', { actor: { name: '物业值班人员', role: 'property' }, target, payload: { to: 'repairing', note: '原维修人外出，代接' } }))
    expect(noReason.ok).toBe(false)
    expect(withReason.ok).toBe(true)
    if (!noReason.ok) expect(noReason.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('幂等、版本与必填', () => {
  it('缺幂等键直接拒：写请求必须能判重放', () => {
    const outcome = evaluateWrite(baseRequest('record_write', {
      meta: { idempotencyKey: '   ', expectedRev: null, at: SAMPLE_NOW, note: '' },
      payload: { pointId: 'pnt_1', sampleTime: SAMPLE_NOW, metric: 'crack_width' },
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.details.field).toBe('idempotencyKey')
  })

  it('旧版本写入被拒，并带出当前版本', () => {
    const stale = evaluateWrite(baseRequest('work_order_verify', {
      target: { exists: true, buildingId: 'bld_1', status: 'submitted', rev: 7, assignedTo: null, requiredRole: null, machine: 'workOrder' },
      meta: { idempotencyKey: idempotencyKeyOf('work_order_verify', ['wo_1']), expectedRev: 5, at: SAMPLE_NOW, note: '' },
      payload: { to: 'verified', note: '验收通过' },
    }))
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.error.code).toBe('VERSION_CONFLICT')
      expect(stale.error.details.currentRev).toBe(7)
      expect(stale.error.retryable).toBe(false)
    }
  })

  it('请求体自带服务端字段（编号、状态、创建痕迹）被拒', () => {
    const outcome = evaluateWrite(baseRequest('record_write', {
      payload: { pointId: 'pnt_1', sampleTime: SAMPLE_NOW, metric: 'crack_width', recordNo: 'R20260920-001' },
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('IMMUTABLE_FIELD')
      expect(outcome.error.details.field).toBe('recordNo')
    }
  })

  it('必填按动作区分：提交待验收要措施，验收退回要原因，继续观察要给下次日期', () => {
    const submit = evaluateWrite(baseRequest('work_order_submit', {
      actor: { name: '维修人员', role: 'repair' },
      target: { exists: true, buildingId: 'bld_1', status: 'repairing', rev: 3, assignedTo: '维修人员', requiredRole: null, machine: 'workOrder' },
      payload: { to: 'submitted' },
    }))
    const returned = evaluateWrite(baseRequest('work_order_verify', {
      target: { exists: true, buildingId: 'bld_1', status: 'submitted', rev: 3, assignedTo: null, requiredRole: null, machine: 'workOrder' },
      payload: { to: 'returned' },
    }))
    const observing = evaluateWrite(baseRequest('issue_recheck_outcome', {
      target: { exists: true, buildingId: 'bld_1', status: 'pending_recheck', rev: 3, assignedTo: null, requiredRole: null, machine: null },
      payload: { outcome: 'observing' },
    }))
    expect(submit.ok).toBe(false)
    expect(returned.ok).toBe(false)
    expect(observing.ok).toBe(false)
    if (!submit.ok) expect(submit.error.details.field).toBe('measures')
    if (!returned.ok) expect(returned.error.details.field).toBe('note')
    if (!observing.ok) expect(observing.error.details.field).toBe('nextDueDate')
  })

  it('附件归属必须唯一：没有归属或两个归属都拒', () => {
    const none = evaluateWrite(baseRequest('attachment_upload', { payload: { draftId: 'd1', ownerId: 'x' } }))
    const two = evaluateWrite(baseRequest('attachment_upload', {
      payload: { draftId: 'd1', ownerType: 'issue', ownerId: 'iss_1', issueId: 'iss_1', workOrderId: 'wo_1' },
    }))
    expect(none.ok).toBe(false)
    expect(two.ok).toBe(false)
  })
})

describe('状态迁移与现有状态机一致（防漂移）', () => {
  it('工单：契约迁移表与 core 的 advance() 逐条一致（6×6 全量）', () => {
    for (const from of WORK_ORDER_STATUSES.map((row) => row.key)) {
      for (const to of WORK_ORDER_STATUSES.map((row) => row.key)) {
        const order = makeWorkOrder({ status: from, assignee: '维修人员', measures: '措施', reviews: [] })
        const outcome = advance({ order, to, at: SAMPLE_NOW, by: '演示操作员', byRole: 'safety', note: '说明' })
        const stateRejected = !outcome.ok && outcome.error.includes('不能直接转为')
        const tableAllows = transitionAllowed('workOrder', from, to)
        expect(tableAllows, `${from} → ${to}`).toBe(!stateRejected)
      }
    }
    expect(WORK_ORDER_NEXT.verified).toEqual([])
  })

  it('事件：只有"恢复待确认"能关闭，且限学校安全管理人员', () => {
    expect(transitionAllowed('event', 'recovering', 'closed')).toBe(true)
    expect(transitionAllowed('event', 'handling', 'closed')).toBe(false)
    expect(closeGuard('recovering', 'safety').allowed).toBe(true)
    expect(closeGuard('recovering', 'repair').allowed).toBe(false)
    expect(closeGuard('closed', 'safety').allowed).toBe(false)
  })

  it('复查三态与状态字典齐全（与 core 的 OUTCOME_STATUS 同键）', () => {
    expect(Object.keys(RECHECK_OUTCOME_STATUS).sort()).toEqual(RECHECK_OUTCOMES.map((row) => row.key).sort())
    expect(statusLabelOf('workOrder', 'submitted')).toBe('待验收')
    expect(statusLabelOf('issue', 'pending_recheck')).toBe('待复查')
    expect(statusLabelOf('event', 'recovering')).toBe('恢复待确认')
  })
})

describe('权限矩阵与错误码', () => {
  it('矩阵覆盖全部写动作，且每行都有依据（拦截位置）与是否已拦标注', () => {
    const rows = permissionMatrix()
    expect(rows).toHaveLength(WRITE_ACTIONS.length)
    for (const row of rows) {
      expect(row.entry.length).toBeGreaterThan(0)
      expect(['store', 'ui-only', 'open']).toContain(row.enforced)
      expect(ACTION_RULES[row.action].label.length).toBeGreaterThan(0)
    }
    // 官方口径：确实还有靠界面隐藏/未拦的动作，V2-2 必须在服务端补 —— 不能悄悄当成已拦
    expect(gapsToEnforce().length).toBeGreaterThan(0)
    expect(gapsToEnforce()).toContain('attachment_upload')
  })

  it('角色白名单与实际拦截点一致：审核/派工/验收限安全管理人员', () => {
    expect(roleAllowed('issue_review', 'safety')).toBe(true)
    expect(roleAllowed('issue_review', 'inspector')).toBe(false)
    expect(roleAllowed('work_order_dispatch', 'safety')).toBe(true)
    expect(roleAllowed('work_order_verify', 'property')).toBe(false)
    expect(roleAllowed('issue_report', 'inspector')).toBe(true)
    expect(roleAllowed('issue_report', 'anything')).toBe(true)
  })

  it('错误码表完整：13 个码都有 HTTP 映射与中文文案，可重试标记只在存储/内部错误上为真', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([...ERROR_CODE_LIST].sort())
    for (const code of ERROR_CODE_LIST) {
      expect(ERROR_CODES[code].message.length).toBeGreaterThan(0)
      expect(ERROR_CODES[code].http).toBeGreaterThanOrEqual(400)
    }
    expect(httpStatusOf('VERSION_CONFLICT')).toBe(409)
    expect(httpStatusOf('SCOPE_FORBIDDEN')).toBe(403)
    expect(isRetryable('STORAGE_UNAVAILABLE')).toBe(true)
    expect(isRetryable('VERSION_CONFLICT')).toBe(false)
    expect(errorOf('STATE_CONFLICT', { from: 'created', to: 'verified' }).details.from).toBe('created')
  })

  it('幂等键派生表覆盖全部写动作；键只由稳定字段拼成', () => {
    for (const action of WRITE_ACTIONS) expect(idempotencyRuleOf(action), `缺幂等规则：${action}`).toBeDefined()
    const key = idempotencyKeyOf('issue_report', ['pnt_1', '设备故障', '周老师', '20260929'])
    expect(key).toBe('issue_report|pnt_1|设备故障|周老师|20260929')
    // 业务值里的竖线不能冒充分隔符
    expect(idempotencyKeyOf('issue_report', ['a|b'])).toBe('issue_report|a/b')
  })
})
