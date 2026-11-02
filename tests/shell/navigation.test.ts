import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, NAV_WORKSPACES, groupOf, primaryOf, workspaceOf } from '@/components/shell/navGroups'

const routePaths = [
  '/', '/dashboard', '/campus', '/archive', '/monitor', '/trend', '/media',
  '/alarms', '/issues', '/standards', '/inspection', '/maintenance',
  '/reports', '/reports/event/evt_1', '/settings', '/knowledge',
]

describe('常驻主导航与工作台入口', () => {
  it('原工作台入口全部展开到左侧导航，每个入口只出现一次', () => {
    const entries = NAV_GROUPS.flatMap((group) => group.items)
    expect(entries).toHaveLength(15)
    expect(new Set(entries.map((item) => item.to)).size).toBe(15)
    expect(primaryOf('/knowledge')).toBe('/knowledge')
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['看现场', '查数据', '办事务', '做管理'])
    expect(entries.map((item) => item.label)).toEqual([
      '校园总览', '传感器驾驶舱', '校园地图', '建筑与设备',
      '监测数据', '监测趋势', '影像对比',
      '预警中心', '问题与工单', '预警标准', '点检巡检', '设备保养',
      '知识库', '管理报表', '系统设置',
    ])
  })

  it('每条原页面路由都有且只有一个工作台入口', () => {
    const entries = NAV_GROUPS.flatMap((group) => group.items)
    for (const path of routePaths) {
      const space = workspaceOf(path)
      expect(space, path).toBeDefined()
      expect(entries.some((item) => item.to === primaryOf(path))).toBe(true)
      expect(groupOf(path)).toBeTruthy()
      // 事件报告详情靠 /reports 入口进入；其余页面都有直接左侧入口。
      if (!path.startsWith('/reports/event/')) {
        expect(entries.some((item) => item.to === path), path).toBe(true)
      }
    }
    const paths = NAV_WORKSPACES.flatMap((space) => space.paths)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('隐藏的细分页面在所属工作台标签中可达', () => {
    for (const space of NAV_WORKSPACES) {
      if (!space.tabs.length) continue
      expect(new Set(space.tabs.map((tab) => tab.to))).toEqual(new Set(space.paths))
    }
    expect(primaryOf('/trend')).toBe('/monitor')
    expect(primaryOf('/media')).toBe('/monitor')
    expect(primaryOf('/issues')).toBe('/alarms')
    expect(primaryOf('/maintenance')).toBe('/inspection')
    expect(primaryOf('/reports/event/evt_1')).toBe('/reports')
  })
})
