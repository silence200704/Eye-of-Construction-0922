import { describe, expect, it } from 'vitest'
import { batchAlertPrompt, eventAlertPrompt, shouldPresentManualAlert } from '@/core/event/alertPrompt'
import { makeEvent } from '../fixtures'

function input(action: 'created' | 'appended' | 'upgraded' | 'recovering' | 'none', level: 'yellow' | 'orange' | 'red' = 'yellow') {
  return {
    event: makeEvent({ id: `evt_${level}`, eventNo: `E20260922-00${level.length}`, level, lastTriggerValue: 0.82, unit: 'mm' }),
    action,
    pointLabel: '3号教学楼 二层西墙裂缝测点',
  }
}

describe('预警触发提醒', () => {
  it('只对新建事件与等级升级生成提醒，追加证据不重复打扰', () => {
    expect(eventAlertPrompt(input('created'))?.title).toContain('黄色关注预警已生成')
    expect(eventAlertPrompt(input('upgraded', 'orange'))?.title).toContain('预警已升级为橙色排查')
    expect(eventAlertPrompt(input('appended'))).toBeNull()
    expect(eventAlertPrompt(input('recovering'))).toBeNull()
  })

  it('红色事件是强提醒，黄色和橙色只进入提醒中心', () => {
    expect(eventAlertPrompt(input('none'))).toBeNull()
    expect(eventAlertPrompt(input('created', 'yellow'))?.strong).toBe(false)
    expect(eventAlertPrompt(input('created', 'orange'))?.strong).toBe(false)
    expect(eventAlertPrompt(input('created', 'red'))?.strong).toBe(true)
  })

  it('批量导入合并同一事件的多次变化，只保留一条最高等级汇总', () => {
    const yellow = input('created', 'yellow')
    yellow.event = makeEvent({ id: 'evt_same', eventNo: 'E20260922-001', level: 'yellow' })
    const red = input('upgraded', 'red')
    red.event = makeEvent({ id: 'evt_same', eventNo: 'E20260922-001', level: 'red' })
    const second = input('created', 'orange')
    second.event = makeEvent({ id: 'evt_second', eventNo: 'E20260922-002', level: 'orange' })
    const prompt = batchAlertPrompt([yellow, red, second])
    expect(prompt?.kind).toBe('batch')
    expect(prompt?.level).toBe('red')
    expect(prompt?.strong).toBe(false)
    expect(prompt?.title).toContain('2 个预警事件')
  })

  it('批次只有追加证据或恢复记录时不生成汇总提醒', () => {
    expect(batchAlertPrompt([input('appended'), input('recovering')])).toBeNull()
  })

  it('当前手工录入或设备上报可以即时弹出，历史补录与 CSV 保持非打断式', () => {
    expect(shouldPresentManualAlert({ source: 'manual', isBackfill: false })).toBe(true)
    expect(shouldPresentManualAlert({ source: 'device', isBackfill: false })).toBe(true)
    expect(shouldPresentManualAlert({ source: 'manual', isBackfill: true })).toBe(false)
    expect(shouldPresentManualAlert({ source: 'device', isBackfill: true })).toBe(false)
    expect(shouldPresentManualAlert({ source: 'csv', isBackfill: false })).toBe(false)
  })
})
