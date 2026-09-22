/**
 * 事件关闭的权限与时机，以及按等级生成的通知。
 * 关闭判断在业务层（planClose）与守卫函数（closeGuard）是同一套口径。
 */
import { describe, expect, it } from 'vitest'
import { closeGuard, notificationsFor, planClose } from '@/core/event/plan'
import { makeEvent } from '../fixtures'

const ACTOR = { name: '演示操作员', role: '学校安全管理人员' }
const NOW = '2026-09-20T09:00:00.000Z'

/* ---------------- 关闭权限与时机（业务层） ---------------- */

describe('事件关闭的权限与时机', () => {
  it('安全管理人员在恢复待确认状态下可以关闭', () => {
    expect(closeGuard('recovering', 'safety').allowed).toBe(true)
  })

  it('物业、巡检、维修角色不能关闭事件', () => {
    for (const role of ['property', 'inspector', 'repair', 'reviewer', 'device']) {
      const guard = closeGuard('recovering', role)
      expect(guard.allowed).toBe(false)
      expect(guard.reason).toContain('仅学校安全管理人员')
    }
  })

  it('待确认与处理中状态不能关闭，必须先进入恢复待确认', () => {
    expect(closeGuard('pending', 'safety').allowed).toBe(false)
    expect(closeGuard('handling', 'safety').allowed).toBe(false)
    expect(closeGuard('pending', 'safety').reason).toContain('恢复待确认')
  })

  it('已关闭的事件不能重复关闭', () => {
    const guard = closeGuard('closed', 'safety')
    expect(guard.allowed).toBe(false)
    expect(guard.reason).toContain('已关闭')
  })

  it('业务层的 planClose 按同一套规则拦截：任何调用方都绕不过去', () => {
    const event = makeEvent({ status: 'recovering' })
    const deniedByRole = planClose({ event, roleKey: 'property', basis: '已复查', actor: ACTOR, at: NOW })
    expect(deniedByRole.ok).toBe(false)
    expect(deniedByRole.next).toBeNull()

    const deniedByStatus = planClose({
      event: makeEvent({ status: 'handling' }),
      roleKey: 'safety',
      basis: '已复查',
      actor: ACTOR,
      at: NOW,
    })
    expect(deniedByStatus.ok).toBe(false)

    const deniedByBasis = planClose({ event, roleKey: 'safety', basis: '   ', actor: ACTOR, at: NOW })
    expect(deniedByBasis.ok).toBe(false)
    expect(deniedByBasis.error).toContain('关闭依据')

    const allowed = planClose({ event, roleKey: 'safety', basis: '连续三次复测低于恢复阈值，现场复查无新增裂缝', actor: ACTOR, at: NOW })
    expect(allowed.ok).toBe(true)
    expect(allowed.next?.status).toBe('closed')
    expect(allowed.next?.closedBy).toBe(ACTOR.name)
    expect(allowed.next?.timeline.at(-1)?.action).toBe('关闭事件')
  })
})

describe('通知按等级生成', () => {
  it('黄色通知点位责任人与物业值班，30 分钟未确认转替补', () => {
    const rows = notificationsFor({ eventId: 'e1', eventNo: 'E1', level: 'yellow', at: NOW })
    expect(rows.map((row) => row.target)).toEqual(['点位责任人', '物业值班人员'])
    expect(rows[0].dueMinutes).toBe(30)
    expect(rows[0].fallback).toBe('替补人员')
  })

  it('橙色通知物业值班与后勤主管，10 分钟未确认升级安全管理人员', () => {
    const rows = notificationsFor({ eventId: 'e1', eventNo: 'E1', level: 'orange', at: NOW })
    expect(rows.map((row) => row.target)).toEqual(['物业值班人员', '后勤主管'])
    expect(rows[0].dueMinutes).toBe(10)
    expect(rows[0].fallback).toBe('学校安全管理人员')
  })

  it('红色同时通知三类对象，5 分钟未确认转应急联系人', () => {
    const rows = notificationsFor({ eventId: 'e1', eventNo: 'E1', level: 'red', at: NOW })
    expect(rows).toHaveLength(3)
    expect(rows[0].dueMinutes).toBe(5)
    expect(rows[0].fallback).toBe('应急联系人')
  })

  it('通知初始状态为已生成，未接入真实渠道不写送达', () => {
    const rows = notificationsFor({ eventId: 'e1', eventNo: 'E1', level: 'red', at: NOW })
    for (const row of rows) {
      expect(row.presentedAt).toBeNull()
      expect(row.acknowledgedAt).toBeNull()
      expect(row.escalatedAt).toBeNull()
      expect(row.channel).toBe('站内提醒')
    }
  })
})
