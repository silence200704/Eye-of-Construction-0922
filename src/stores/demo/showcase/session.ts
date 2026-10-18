import { computed, ref, watch } from 'vue'
import { datasetResetVersion } from '@/stores/demo/registry'
import { clearReceipts, flushReceipts } from '@/core/operations/receipts'
import { defineStore } from 'pinia'
import { db } from '@/db/database'
import { demoActivity, isShowcase, SHOWCASE_DB_NAME, workspaceStorageKey, switchWorkspace } from '@/core/demo/workspace'
import { createRunner, type RunnerState, type RunStep } from '@/core/demo/showcase/runner'
import { mainSteps, type ShowcaseRefs } from './mainChain'
import { prepareShowcase, prepareMedia } from './prepare'
import { runInspection, runMaintenance, runOtherAlarms } from './modules'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useMediaStore } from '@/stores/media'
import { useAlertStore } from '@/stores/alerts'
import { useClockStore } from '@/stores/clock'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { askZhutong } from '@/assistant/ask'
import type { AskResult } from '@/assistant/types'
import { READY_CRACK, CLOSED_CRACK } from '@/stores/writes/demo/coverage/archive'
import { buildEventReport } from '@/core/metrics/eventReport'
import { requireLocalDemo } from '@/api/backend/runtime'

const KEY = workspaceStorageKey('zhutong-demo/showcase-run')
interface Saved { version: number; refs: ShowcaseRefs; state: RunnerState }
function load(): Saved | null {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    return data?.version === 1 && Number.isInteger(data.state?.next) && ['eventId','issueId','orderId'].every(k => typeof data.refs?.[k as keyof ShowcaseRefs] === 'string') ? data : null
  } catch { return null }
}
class ShowcaseController {
  private saved = isShowcase ? load() : null
  refs = ref<ShowcaseRefs>(this.saved?.refs ?? { eventId: '', issueId: '', orderId: '' })
  state = ref<RunnerState>({ next: this.saved?.state.next ?? 0, status: this.saved ? this.saved.state.status === 'completed' ? 'completed' : 'paused' : 'idle', error: '' })
  answer = ref<AskResult | null>(null)
  message = ref('')
  running = computed(() => this.state.value.status === 'running')
  private launching: Promise<void> | null = null
  private cancelled = false
  private runner: ReturnType<typeof createRunner> | null = null
  private labels: Record<string,string> = {
    prepare: '预检、准备历史案例与媒体', trigger: '采样与预警升级', acknowledge: '确认事件', createIssue: '创建问题', review: '审核并生成工单',
    assigned: '派工', repairing: '接单维修', submitted: '提交完工与照片', verified: '验收与照片留痕', recovery: '连续恢复复测',
    register: '登记复查', recheck: '提交复查结论', close: '关闭事件', others: '振动、环境与质量场景', spatial: '实际3D定位',
    compare: '双点同范围比较', simulate: '候选阈值批量试算', media: '视频关键帧实际分析', replay: '真实事件历史回放', cases: '相似办结案例',
    inspection: '逐点巡检与异常上报', maintenance: '周期保养自动执行', report: '完整处置报告',
  }
  private stepIds = ['prepare', ...mainSteps(this.refs.value).map(s => s.id), 'others','spatial','compare','simulate','media','replay','cases','inspection','maintenance','report']
  currentLabel = computed(() => this.state.value.status === 'completed' ? '完整演示已完成' : this.labels[this.stepIds[this.state.value.next] ?? 'prepare'])

  constructor() {
    watch(datasetResetVersion,() => {
    void this.stop()
    localStorage.removeItem(KEY)
    this.refs.value = { eventId: '', issueId: '', orderId: '' }; this.runner = null
    this.state.value = { next: 0, status: 'idle', error: '' }; this.answer.value = null; clearReceipts()
    demoActivity.value = false
  },{ flush: 'sync' })
  }
  async navigate(path: string, query: Record<string,string> = {}): Promise<void> {
    const { router } = await import('@/router')
    await router.push({ path, query })
  }
  async query(question: string, path: string, context = { pointId: 'pnt_b03_f2_crack01', eventId: this.refs.value.eventId }): Promise<void> {
    useClockStore().refresh()
    this.answer.value = await askZhutong(question,{ context })
    if (this.answer.value.status !== 'answered') throw new Error(this.answer.value.conclusion)
    await this.navigate(path,this.answer.value.links[0]?.path === path ? this.answer.value.links[0].query : { point: context.pointId })
  }
  steps(): RunStep[] {
    const main = mainSteps(this.refs.value).map(step => ({ ...step, run: async () => {
      await step.run()
      await this.reload()
      await flushReceipts()
      await this.navigate(step.id === 'trigger' || step.id === 'acknowledge' || step.id === 'close' ? '/alarms' : '/issues',
        step.id === 'trigger' || step.id === 'acknowledge' || step.id === 'close' ? { event: this.refs.value.eventId } : { issue: this.refs.value.issueId, workOrder: this.refs.value.orderId })
    } }))
    return [{ id: 'prepare', run: prepareShowcase }, ...main,
      { id: 'others', run: async () => { await runOtherAlarms(); await this.navigate('/dashboard') } },
      { id: 'spatial', run: () => this.navigate('/campus',{ view: '3d', b: 'bld_b03', f: 'flr_b03_02', point: 'pnt_b03_f2_crack01' }) },
      { id: 'compare', run: () => this.query('比较B03-F3-CRACK01和B03-F3-CRACK02最近24小时的读数','/trend') },
      { id: 'simulate', run: () => this.query('试算黄色阈值改为0.15毫米，最近30天哪些记录会改变等级？','/standards') },
      { id: 'media', run: async () => { await prepareMedia(); await useMediaStore().analyseVideo(); await this.query('分析当前测点的视频','/media') } },
      { id: 'replay', run: () => this.query('回放当前事件的升级过程','/alarms') },
      { id: 'cases', run: () => this.query('以前有类似的裂缝问题吗？','/issues') },
      { id: 'inspection', run: async () => { const id = await runInspection(); await this.navigate('/inspection',{ task: id }) } },
      { id: 'maintenance', run: async () => { const id = await runMaintenance(); await this.navigate('/maintenance',{ task: id }) } },
      { id: 'report', run: async () => {
        const event = await db.events.get(this.refs.value.eventId)
        if (!event) throw new Error('报告关联事件缺失')
        const issues = await db.issues.where('eventId').equals(event.id).toArray()
        const orders = await db.workOrders.where('eventId').equals(event.id).toArray()
        const report = buildEventReport({ event, issues, orders, point: await db.points.get(event.pointId) ?? null,
          device: await db.devices.where('pointId').equals(event.pointId).first() ?? null,
          notifications: await db.notifications.where('eventId').equals(event.id).toArray() })
        if (!report.closed || issues.some(i => i.status !== 'closed') || orders.some(o => o.status !== 'verified')) throw new Error('最终闭环核验未通过')
        await this.navigate(`/reports/event/${event.id}`)
      } },
    ].map(step => ({ ...step, run: async () => {
      this.message.value = this.labels[step.id] ?? step.id
      this.answer.value = null
      await step.run()
      await this.reload()
      await new Promise<void>(resolve => setTimeout(resolve, 1800))
      const alerts = useAlertStore()
      if (alerts.activeStrong) alerts.dismiss(alerts.activeStrong.key)
    } }))
  }
  async reload(): Promise<void> {
    await Promise.all([useArchiveStore().reload(),useRecordsStore().reload(),useEventsStore().reload(),useIssueStore().reload(),useWorkOrderStore().reload()])
    useClockStore().refresh()
  }
  ensureRunner() {
    const epoch = datasetResetVersion.value
    this.runner ??= createRunner({ steps: this.steps(), saved: this.saved || this.state.value.next ? this.state.value : undefined,
      changed: next => { if (epoch !== datasetResetVersion.value) return; this.state.value = next; demoActivity.value = next.status === 'running'; localStorage.setItem(KEY,JSON.stringify({ version: 1, refs: this.refs.value, state: next })) },
    })
    return this.runner
  }
  async locked(work: () => Promise<void>): Promise<void> {
    if (!navigator.locks) throw new Error('此浏览器不支持演示独占锁，请使用Chrome或Edge打开。')
    await navigator.locks.request('zhutong-showcase/run',{ ifAvailable: true },async lock => {
      if (!lock) throw new Error('另一标签正在执行演示，请在该标签暂停后继续。')
      await work()
    })
  }
  start(): Promise<void> {
    requireLocalDemo('完整自动演示')
    if (!isShowcase) { switchWorkspace('showcase',true); return Promise.resolve() }
    if (this.launching) return this.launching
    this.cancelled = false
    this.launching = this.locked(async () => {
      if (this.cancelled) return
      const latest = load()
      if (latest) { Object.assign(this.refs.value,latest.refs); this.state.value = { ...latest.state, status: latest.state.status === 'completed' ? 'completed' : 'paused' }; this.runner = null }
      if (this.state.value.next > 1 && (!this.refs.value.eventId || !await db.events.get(this.refs.value.eventId))) throw new Error('演示对象已失效，请重新演示。')
      usePreparationSession().start(['sampling','media','inspection'])
      await this.ensureRunner().start()
    })
      .catch(cause => { this.message.value = cause instanceof Error ? cause.message : String(cause) })
      .finally(() => { this.launching = null })
    return this.launching
  }
  async pause(): Promise<void> { this.cancelled = true; if (this.runner) await this.runner.pause(); if (this.launching) await this.launching }
  async stop(): Promise<void> { this.cancelled = true; if (this.runner) await this.runner.stop(); if (this.launching) await this.launching; usePreparationSession().end() }
  async reset(restart = false): Promise<void> {
    if (!isShowcase || db.name !== SHOWCASE_DB_NAME) throw new Error('复位仅允许操作独立演示库')
    await this.stop()
    await this.locked(async () => {
      await useArchiveStore().loadSeed()
      localStorage.removeItem(KEY)
      location.replace(`${location.pathname}?workspace=showcase${restart ? '&startDemo=1' : ''}#/settings`)
    })
  }
  async autoStart(): Promise<void> {
    if (!isShowcase || new URLSearchParams(location.search).get('startDemo') !== '1') return
    const url = new URL(location.href); url.searchParams.delete('startDemo'); history.replaceState(null,'',url.href)
    await this.start()
  }
  api() {
    return { state: this.state, refs: this.refs, answer: this.answer, message: this.message, running: this.running,
      currentLabel: this.currentLabel, total: this.stepIds.length, start: this.start.bind(this), pause: this.pause.bind(this),
      stop: this.stop.bind(this), reset: this.reset.bind(this), autoStart: this.autoStart.bind(this), comparisonIds: [READY_CRACK,CLOSED_CRACK] }
  }
}
export const useShowcaseStore = defineStore('showcase', () => new ShowcaseController().api())
