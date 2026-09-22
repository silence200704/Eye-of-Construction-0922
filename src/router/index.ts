import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import OverviewView from '@/views/OverviewView.vue'
import CampusView from '@/views/CampusView.vue'
import ArchiveView from '@/views/ArchiveView.vue'
import MonitorView from '@/views/MonitorView.vue'
import StandardsView from '@/views/StandardsView.vue'
import AlarmsView from '@/views/AlarmsView.vue'
import TrendView from '@/views/TrendView.vue'
import SettingsView from '@/views/SettingsView.vue'
import InspectionView from '@/views/operations/InspectionView.vue'
import IssuePoolView from '@/views/operations/IssuePoolView.vue'

/**
 * 采用 hash 路由：纯前端本地演示无需服务端重写规则，
 * 直接打开或刷新任意页面都能正确落到对应视图。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'overview',
    component: OverviewView,
    meta: { title: '校园总览', sub: '全校楼栋、测点与最近录入动态' },
  },
  {
    path: '/campus',
    name: 'campus',
    component: CampusView,
    meta: { title: '校园地图', sub: '从校园图到楼层图逐级定位，查看测点档案与最近读数' },
  },
  {
    path: '/archive',
    name: 'archive',
    component: ArchiveView,
    meta: { title: '建筑与设备', sub: '楼栋、楼层、测点与设备建档，有历史记录后只归档不删除' },
  },
  {
    path: '/monitor',
    name: 'monitor',
    component: MonitorView,
    meta: { title: '监测数据', sub: '单条录入、历史查询与修订留痕' },
  },
  {
    path: '/alarms',
    name: 'alarms',
    component: AlarmsView,
    meta: { title: '预警中心', sub: '规则判定生成的预警事件、证据链、升级历史与通知确认' },
  },
  {
    path: '/trend',
    name: 'trend',
    component: TrendView,
    meta: { title: '监测趋势', sub: '单测点单指标：数据线、基准线、三级阈值线、事件节点与修订标记' },
  },
  {
    path: '/inspection',
    name: 'inspection',
    component: InspectionView,
    meta: { title: '点检巡检', sub: '巡检计划、今日待办与我的任务；到点检查由逐点结果推进' },
  },
  {
    path: '/issues',
    name: 'issues',
    component: IssuePoolView,
    meta: { title: '问题与工单', sub: '三类来源进同一个问题池；审核留痕后转维修工单' },
  },
  {
    path: '/standards',
    name: 'standards',
    component: StandardsView,
    meta: { title: '预警标准', sub: '筑瞳 Demo 演示预警规则 V1.0：分级阈值、持续与恢复条件、试算核对' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { title: '系统设置', sub: '演示身份、数据模式、备份恢复与本地存储' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
