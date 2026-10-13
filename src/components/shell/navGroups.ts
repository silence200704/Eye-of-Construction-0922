/** 主导航只列高频工作台；细分功能放到各工作台的上下文标签。原路由不变。 */
export interface NavItem {
  to: string
  label: string
  d: string
}

export interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

export interface NavWorkspace {
  primary: string
  paths: string[]
  tabs: { to: string; label: string }[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'campus', label: '看现场', items: [
      { to: '/dashboard', label: '校园态势', d: 'M4 13h4v7H4zM10 8h4v12h-4zM16 5h4v15h-4z' },
      { to: '/campus', label: '校园地图', d: 'M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6zM9 3v15M15 6v15' },
    ],
  },
  {
    key: 'monitor', label: '查数据', items: [
      { to: '/monitor', label: '监测分析', d: 'M3 17l4-6 4 3 3-5 4 4h3M3 21h18' },
    ],
  },
  {
    key: 'operations', label: '办事务', items: [
      { to: '/alarms', label: '异常处置', d: 'M12 3l9 16H3zM12 9v5M12 17h.01' },
      { to: '/inspection', label: '现场任务', d: 'M9 11l2 2 4-4M5 4h14v16H5zM9 3v3M15 3v3' },
    ],
  },
  {
    key: 'manage', label: '做管理', items: [
      { to: '/reports', label: '管理报表', d: 'M4 20h16M6 17V9M11 17V5M16 17v-6M21 17v-9' },
      { to: '/settings', label: '系统设置', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 15l2 2-3 3-2-2M5 9L3 7l3-3 2 2' },
    ],
  },
]

export const NAV_WORKSPACES: NavWorkspace[] = [
  { primary: '/dashboard', paths: ['/', '/dashboard'], tabs: [
    { to: '/dashboard', label: '传感器驾驶舱' }, { to: '/', label: '校园总览' },
  ] },
  { primary: '/campus', paths: ['/campus', '/archive'], tabs: [
    { to: '/campus', label: '校园地图' }, { to: '/archive', label: '建筑与设备' },
  ] },
  { primary: '/monitor', paths: ['/monitor', '/trend', '/media'], tabs: [
    { to: '/monitor', label: '监测数据' }, { to: '/trend', label: '监测趋势' }, { to: '/media', label: '影像对比' },
  ] },
  { primary: '/alarms', paths: ['/alarms', '/issues', '/standards'], tabs: [
    { to: '/alarms', label: '预警事件' }, { to: '/issues', label: '问题与工单' }, { to: '/standards', label: '预警标准' },
  ] },
  { primary: '/inspection', paths: ['/inspection', '/maintenance'], tabs: [
    { to: '/inspection', label: '点检巡检' }, { to: '/maintenance', label: '设备保养' },
  ] },
  { primary: '/reports', paths: ['/reports'], tabs: [] },
  { primary: '/settings', paths: ['/settings'], tabs: [] },
]

function matches(path: string, base: string): boolean {
  return base === '/' ? path === '/' : path === base || path.startsWith(`${base}/`)
}

export function workspaceOf(path: string): NavWorkspace | undefined {
  return NAV_WORKSPACES.find((space) => space.paths.some((base) => matches(path, base)))
}

export function primaryOf(path: string): string {
  return workspaceOf(path)?.primary ?? '/dashboard'
}

export function groupOf(path: string): string {
  const primary = primaryOf(path)
  return NAV_GROUPS.find((group) => group.items.some((item) => item.to === primary))?.key ?? 'campus'
}
