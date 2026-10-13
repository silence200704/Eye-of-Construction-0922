import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, NAV_WORKSPACES, groupOf, primaryOf, workspaceOf } from '@/components/shell/navGroups'

const routePaths = [
  '/', '/dashboard', '/campus', '/archive', '/monitor', '/trend', '/media',
  '/alarms', '/issues', '/standards', '/inspection', '/maintenance',
  '/reports', '/reports/event/evt_1', '/settings',
]

describe('常驻主导航与工作台入口', () => {
  it('七个主入口各出现一次，分区标题只提供分类', () => {
    const entries = NAV_GROUPS.flatMap((group) => group.items)
    expect(entries).toHaveLength(7)
    expect(new Set(entries.map((item) => item.to)).size).toBe(7)
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['看现场', '查数据', '办事务', '做管理'])
    expect(entries.map((item) => item.label)).toEqual([
      '校园态势', '校园地图', '监测分析', '异常处置', '现场任务', '管理报表', '系统设置',
    ])
  })

  it('每条原页面路由都有且只有一个工作台入口', () => {
    for (const path of routePaths) {
      const space = workspaceOf(path)
      expect(space, path).toBeDefined()
      expect(NAV_GROUPS.flatMap((group) => group.items).some((item) => item.to === primaryOf(path))).toBe(true)
      expect(groupOf(path)).toBeTruthy()
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
