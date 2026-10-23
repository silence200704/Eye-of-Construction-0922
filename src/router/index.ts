import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import OverviewView from '@/views/OverviewView.vue'
import CampusView from '@/views/CampusView.vue'
import ArchiveView from '@/views/ArchiveView.vue'
import MonitorView from '@/views/MonitorView.vue'
import StandardsView from '@/views/StandardsView.vue'
const MediaView = () => import('@/views/media/MediaView.vue')
const KnowledgeView = () => import('@/views/knowledge/KnowledgeView.vue')
import DashboardView from '@/views/dashboard/DashboardView.vue'
import AlarmsView from '@/views/AlarmsView.vue'
import TrendView from '@/views/TrendView.vue'
import SettingsView from '@/views/SettingsView.vue'
import InspectionView from '@/views/operations/InspectionView.vue'
import IssuePoolView from '@/views/operations/IssuePoolView.vue'
import MaintenanceView from '@/views/operations/MaintenanceView.vue'
import ReportsView from '@/views/operations/ReportsView.vue'
import EventReportView from '@/views/operations/EventReportView.vue'

/**
 * 采用 hash 路由：纯前端本地演示无需服务端重写规则，
 * 直接打开或刷新任意页面都能正确落到对应视图。
 */
const routes: RouteRecordRaw[] = [
  { path: '/knowledge', name: 'knowledge', component: KnowledgeView,
    meta: { title: '知识库', sub: '项目知识、FAQ、同义词与本地向量检索依据' } },
  {
    path: '/',
    name: 'overview',
    component: OverviewView,
    meta: { title: '校园总览', sub: '全校楼栋、测点与最近录入动态' },
  },
  {
    // 传感器状态驾驶舱：卡片墙 + 未关闭异常队列，与问筑瞳共用同一套只读选择器
    path: '/dashboard',
    name: 'dashboard',
    component: DashboardView,
    meta: { title: '传感器驾驶舱', sub: '按楼栋/楼层/指标筛选的传感器状态卡片与未关闭异常队列；无心跳不显示在线' },
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
    // 影像对比：工作线 C 的展示页，与问筑瞳的影像问答联动
    path: '/media',
    name: 'media',
    component: MediaView,
    meta: { title: '影像对比', sub: '本机照片与演示视频关键帧的前后对比；预设分析，不给毫米数' },
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
    path: '/maintenance',
    name: 'maintenance',
    component: MaintenanceView,
    meta: { title: '设备保养', sub: '保养计划、周期任务、执行留痕与保养台账；异常只留痕或转问题' },
  },
  {
    path: '/reports',
    name: 'reports',
    component: ReportsView,
    meta: { title: '管理报表', sub: '三项管理指标、明细 CSV 导出与单事件处置报告' },
  },
  {
    // 单事件处置报告：靠报表页的事件列表进入，不单独放进左侧导航；
    // 它在 /reports 之下，导航高亮由 AppShell 的前缀判断兜住
    path: '/reports/event/:id',
    name: 'eventReport',
    component: EventReportView,
    meta: { title: '事件处置报告', sub: '一页说清为何预警、谁处置、如何验收、为何关闭，可打印' },
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
