/**
 * 演示场景注册表（前端侧）。
 *
 * 登记分两层，别混：
 * 1) **审计留痕**：每次载入向操作日志**追加**一条（`objectId='demo:<场景键>'`，`reason` 以
 *    `状态=成功/失败` 开头），供审计与人工核对；
 * 2) **界面状态**：`stores/demo/registry.ts` 里那份 localStorage 缓存，记录最近一次结果与关键对象锚点。
 *    界面不读日志 —— 清库 / 重载示例校区 / 导入备份都会整表重建数据集与日志表，只靠日志会把
 *    "载过但数据已经没了"显示成"未载入"。
 *
 * 载入任务是**逻辑串行**的：不做页面级全局锁（普通操作不受影响），
 * 但两个载入任务不会交错 —— 每个场景都会临时切换演示身份，交错就会把留痕身份写乱。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { scenarioMeta, type DemoScenarioKey } from '@/config/demoScenarios'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { failScenario } from '@/stores/writes/demo/support'
import type { DemoScenarioResult } from '@/stores/writes/demo/support'
import { SCENARIO_LOADERS, loadFullChain, type FullChainOutcome } from '@/stores/writes/demo/chain'
import { readRegistry, writeEntry, type AnchorRef, type RegistryEntry } from './registry'
import { datasetResetVersion } from './registry'
import { usePreparationSession } from './preparation/session'

export type ScenarioStatus = 'idle' | 'ready' | 'failed' | 'stale'

export interface ScenarioState {
  status: ScenarioStatus
  /** 成功载入、数据仍整体存在（数据集没被重置、关键对象没被删） */
  ready: boolean
  at: string
  message: string
}

/**
 * 免于"数据已失效"判定的场景。
 * 建档场景自己就是数据源：重载示例校区之后它依然成立，不该被标成失效。
 */
const STALE_EXEMPT: DemoScenarioKey[] = ['campus']

/**
 * 锚点是否都还在（关键对象被手工删除 → 场景数据已失效）。
 *
 * 不做"仓储是否已载入"的守卫：应用启动时 `startApplication()` 会先等全部仓储载入完再渲染页面，
 * 页面上的状态条不可能早于仓储载入出现；加那道守卫反而会把"对象被删了"误判成"已就绪"（有过一次）。
 */
function anchorExists(ref: AnchorRef): boolean {
  switch (ref.kind) {
    case 'event':
      return useEventsStore().byId(ref.id) !== undefined
    case 'issue':
      return useIssueStore().byId(ref.id) !== undefined
    case 'workOrder':
      return useWorkOrderStore().byId(ref.id) !== undefined
    case 'inspectionTask':
      return useTaskStore().byId(ref.id) !== undefined
    case 'maintenanceTask':
      return useMaintenanceTaskStore().byId(ref.id) !== undefined
    case 'maintenancePlan':
      return useMaintenancePlanStore().byId(ref.id) !== undefined
    case 'point':
      return useArchiveStore().pointById(ref.id) !== undefined
  }
}

/** 所有锚点都还在才算"数据没被删过"。 */
function anchorsIntact(refs: AnchorRef[]): boolean {
  return refs.every((ref) => anchorExists(ref))
}

export const useDemoScenarioStore = defineStore('demoScenarios', () => {
  const last = ref<Record<string, RegistryEntry>>({})
  /** 最近一次数据集整体替换的时刻：晚于某场景的载入时刻，即视为该场景数据已失效 */
  const resetAt = ref('')
  const hydrated = ref(false)
  /** 正在载入的场景键（含汇总键 `fullChain`） */
  const running = ref<string[]>([])
  const chainResults = ref<DemoScenarioResult[]>([])
  const chainLine = ref('')

  /**
   * 演示载入任务的串行队列。
   * 只串"载入演示数据"这件事，不锁普通页面操作；后一次排队等前一次结束。
   */
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  function isRunning(key: DemoScenarioKey | 'fullChain'): boolean {
    return running.value.includes(key)
  }

  /** 从界面状态缓存恢复"载过没有 / 成功还是失败 / 之后有没有重置过数据集 / 锚点还在不在"。 */
  async function hydrate(): Promise<void> {
    if (hydrated.value) return
    const registry = readRegistry()
    last.value = { ...registry.entries }
    resetAt.value = registry.resetAt
    hydrated.value = true
  }

  function stateOf(key: DemoScenarioKey): ScenarioState {
    const info = last.value[key]
    if (info === undefined) return { status: 'idle', ready: false, at: '', message: '' }
    if (info.failed) return { status: 'failed', ready: false, at: info.at, message: info.message }
    if (!STALE_EXEMPT.includes(key) && resetAt.value > info.at) {
      return { status: 'stale', ready: false, at: info.at, message: info.message }
    }
    if (!anchorsIntact(info.anchors ?? [])) {
      return {
        status: 'stale',
        ready: false,
        at: info.at,
        message: `${info.message}；上次生成的关键对象已被删除，请重新载入`,
      }
    }
    return { status: 'ready', ready: true, at: info.at, message: info.message }
  }

  /** 载入一个场景。失败也会记入状态，界面不会再把失败当成功。 */
  async function load(key: DemoScenarioKey): Promise<DemoScenarioResult> {
    running.value = [...running.value, key]
    try {
      return await enqueue(async () => {
        try {
          const out = await SCENARIO_LOADERS[key]()
          // 先落本地状态：审计日志要写库，库写不进去时状态也不能丢
          await remember(key, out.message, !out.ok, out.anchorRefs)
          if (!out.ok) await safeFail(key, out.message)
          return out
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause)
          const out: DemoScenarioResult = {
            key,
            ok: false,
            message: `载入失败：${reason}`,
            created: 0,
            skipped: 0,
            anchors: [],
          }
          await remember(key, out.message, true)
          await safeFail(key, out.message)
          return out
        }
      })
    } finally {
      running.value = running.value.filter((row) => row !== key)
    }
  }

  async function loadChain(options: { autoPrepare?: boolean } = {}): Promise<FullChainOutcome> {
    const preparation = usePreparationSession()
    preparation.end('正在从唯一入口重新准备演示。')
    const epoch = readRegistry().resetAt
    const generation = datasetResetVersion.value
    running.value = [...running.value, 'fullChain']
    try {
      return await enqueue(async () => {
        const out = await loadFullChain()
        chainResults.value = out.results
        chainLine.value = out.chainLine
        /*
         * 逐项登记：全链跑完后每个模块页也该显示"已就绪"。
         * 只登记 fullChain 的话，模块页仍会显示"演示场景未载入"。
         */
        for (const row of out.results) {
          await remember(row.key, row.message, !row.ok, row.anchorRefs)
        }
        await remember('fullChain', out.message, !out.liveOk || !out.results.every((row) => row.ok))
        if (options.autoPrepare && epoch === readRegistry().resetAt && generation === datasetResetVersion.value) {
          preparation.start([
            ...(out.liveOk ? ['sampling' as const] : []),
            ...(out.results.some((row) => row.key === 'mediaEvidence' && row.ok) ? ['media' as const] : []),
            ...(out.results.some((row) => row.key === 'inspection' && row.ok) ? ['inspection' as const] : []),
          ])
        }
        return out
      })
    } finally {
      running.value = running.value.filter((row) => row !== 'fullChain')
    }
  }

  /** 审计日志写不进去也不影响界面状态：失败登记以本地缓存为准。 */
  async function safeFail(key: DemoScenarioKey, message: string): Promise<void> {
    try {
      await failScenario(key, scenarioMeta(key).title, message)
    } catch {
      // 库不可写时只丢审计留痕，界面状态已经保存
    }
  }

  async function remember(
    key: string,
    message: string,
    failed: boolean,
    anchorRefs?: AnchorRef[],
  ): Promise<void> {
    const entry: RegistryEntry = {
      at: new Date().toISOString(),
      message,
      failed,
      ...(anchorRefs === undefined ? {} : { anchors: anchorRefs }),
    }
    writeEntry(key, entry)
    last.value = { ...last.value, [key]: entry }
  }

  /** 重新从缓存读一次（数据集被替换后调用，用于把状态刷成"已失效"）。 */
  async function refresh(): Promise<void> {
    hydrated.value = false
    await hydrate()
  }

  return {
    last,
    resetAt,
    hydrated,
    running,
    chainResults,
    chainLine,
    isRunning,
    hydrate,
    stateOf,
    load,
    loadChain,
    /** 内部统一准备队列：调用方必须使用原写入口，不能在队列内再次调用 load/loadChain。 */
    enqueuePreparation: enqueue,
    rememberPreparation: remember,
    refresh,
  }
})
