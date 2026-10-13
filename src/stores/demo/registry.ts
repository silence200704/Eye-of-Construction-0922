/**
 * 演示场景的**界面状态缓存**（localStorage）。
 *
 * 为什么不放进数据库：`重新载入示例校区` / `清空并转为空白模式` / `导入备份` 都会整表替换数据集，
 * 审计日志表也跟着重建 —— 登记信息若只存库，重置之后就什么都查不到，界面只会显示"未载入"，
 * 看不出"载过、但那份数据已经没了"。
 *
 * 这里**只存界面状态**（载过没有、成功还是失败、之后有没有重置过数据集）；
 * 每次载入的审计留痕仍然照常写进操作日志（`demo:<场景键>`），两件事分开。
 */
import { ref } from 'vue'
import { workspaceStorageKey } from '@/core/demo/workspace'

const KEY = workspaceStorageKey('zhutong-demo/demo-registry')
/** 同页数据集替换信号；localStorage 自身不会触发本页的 storage 事件。 */
export const datasetResetVersion = ref(0)

export interface RegistryEntry {
  /** 载入时刻（ISO） */
  at: string
  /** 那次载入的结果说明 */
  message: string
  failed: boolean
  /**
   * 关键对象引用（事件 / 问题 / 工单 / 任务 / 计划的 id）。
   * 界面据此核验"数据还在不在"：手工删掉锚点后应显示"数据已失效"，而不是继续显示"已就绪"。
   */
  anchors?: AnchorRef[]
}

/** 可核验的关键对象种类。 */
export type AnchorKind =
  | 'event'
  | 'issue'
  | 'workOrder'
  | 'inspectionTask'
  | 'maintenanceTask'
  | 'maintenancePlan'
  /** 测点：视觉证据素材是"关联到某个测点"的，测点被删就该判失效 */
  | 'point'

export interface AnchorRef {
  kind: AnchorKind
  id: string
}

interface Registry {
  entries: Record<string, RegistryEntry>
  /** 最近一次数据集整体替换的时刻：晚于某场景的载入时刻，即视为该场景数据已失效 */
  resetAt: string
}

const EMPTY: Registry = { entries: {}, resetAt: '' }

function read(): Registry {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return { ...EMPTY, entries: {} }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY, entries: {} }
    const candidate = parsed as Partial<Registry>
    return { entries: candidate.entries ?? {}, resetAt: candidate.resetAt ?? '' }
  } catch {
    // 本地缓存损坏时按"从没载过"处理，不影响业务数据
    return { ...EMPTY, entries: {} }
  }
}

function write(next: Registry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 存不进去只影响界面状态提示，不阻断载入
  }
}

export function readRegistry(): Registry {
  return read()
}

export function writeEntry(key: string, entry: RegistryEntry): void {
  const current = read()
  write({ ...current, entries: { ...current.entries, [key]: entry } })
}

export function markDatasetReset(at: string): void {
  const current = read()
  write({ ...current, resetAt: at })
  datasetResetVersion.value += 1
}
