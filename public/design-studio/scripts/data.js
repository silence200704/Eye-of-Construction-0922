export const screens = {
  workbench: { title: '工作台', tab: 'workbench', map: 'Navigation 根页 + Scroll + Grid；底部四入口。' },
  monitoring: { title: '监测与设备', tab: 'monitoring', map: 'Tabs / Select + List；宽窗口采用列表与详情分栏。' },
  point: { title: '测点详情', tab: 'monitoring', map: 'NavDestination 详情页；单位、采样时间与模拟来源保持可见。' },
  alarms: { title: '预警台账', tab: 'monitoring', map: 'List 展示级别和状态，不能仅依靠颜色区分。' },
  alarm: { title: '预警处置', tab: 'monitoring', map: 'NavDestination + 原生表单；服务端核验角色、范围与关闭条件。' },
  statistics: { title: '统计', tab: 'monitoring', map: '周/月切换 + 可读文本；阶段8由服务端聚合替换示例值。' },
  tasks: { title: '现场任务', tab: 'tasks', map: 'Tabs 区分点检、巡检和工单，List 展示任务快照。' },
  task: { title: '到点与检查', tab: 'tasks', map: '分步内容 + Checkbox；模拟读卡与人工签到分别说明。' },
  report: { title: '问题上报', tab: 'tasks', map: 'TextArea + 系统图片选择；照片3张/600KB约束复用服务端。' },
  order: { title: '工单办理', tab: 'tasks', map: 'NavDestination + 办理步骤；完工后等待Web验收，不自行关闭事件。' },
  sync: { title: '同步中心', tab: 'profile', map: 'List 展示本地保存、待同步、服务器确认；阶段9实现持久队列。' },
  profile: { title: '我的', tab: 'profile', map: '身份切换无需账号密码；连接和权限状态分别呈现。' },
}

export const points = [
  { id: '示例-P01', type: 'crack', label: '裂缝', name: '东侧外墙', value: '0.18', unit: 'mm', building: '1号教学楼', state: '黄色关注', tone: 'warning', battery: '82%', connection: '模拟在线' },
  { id: '示例-P02', type: 'tilt', label: '倾角', name: '北侧立柱', value: '0.06', unit: '°', building: '1号教学楼', state: '未触发预警', tone: 'neutral', battery: '76%', connection: '模拟在线' },
  { id: '示例-P03', type: 'vibration', label: '加速度', name: '楼梯平台', value: '—', unit: 'm/s²', building: '2号实验楼', state: '暂无数据', tone: 'muted', battery: '未知', connection: '模拟离线' },
]

export const prototype = {
  screen: 'workbench', viewState: 'normal', window: 'phone', mode: 'prototype',
  filter: 'all', building: 'all', point: points[0], period: 'week',
  taskTab: 'inspection', arrived: false, checks: new Set(),
  drafts: { inspector: {}, repair: {} }, identity: 'inspector', samplePhotos: 0,
  orderStep: 'assigned', result: null,
}

export const iconGroups = {
  monitoring: ['campus', 'monitor', 'crack', 'tilt', 'vibration', 'alarm'],
  field: ['inspection', 'location', 'camera', 'report', 'order', 'check'],
  common: ['sync', 'identity', 'history', 'knowledge'],
}

export function draftFor(screen = prototype.screen) {
  const drafts = prototype.drafts[prototype.identity]
  return drafts[screen] ?? (drafts[screen] = {})
}
