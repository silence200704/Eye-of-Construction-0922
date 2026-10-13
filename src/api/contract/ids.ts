/**
 * V2-1 契约冻结 · 标识与编号。
 *
 * 两类标识的分工（服务端实现必须与这里一致）：
 * - 内部主键 `id`：**不透明**，只用于引用。允许由业务键确定性派生 —— 现有实现里
 *   "事件转出的问题"就是 `iss_` + 业务键派生串，因此同一幂等键重放天然落到同一个 id，
 *   不需要额外查重。客户端不得解析 id 内部结构，只做等值比较与传递。
 * - 业务编号（code / no）：给人看的唯一编号，由服务端分配，作废不复用。
 *
 * 这是已退役的 V2 契约草案，不驱动当前演示业务。当前 `core/id.isoDayKey()`
 * 虽保留历史名称，实际与 `core/time.dayKey()` 一样按本地日期编号，
 * 以免 00:00–08:00 将新单编号归到前一天；已有编号在备份中原样保存。
 */
import { dayKey } from '@/core/time'
import { isoDayKey } from '@/core/id'

const FLOOR_RE = /^B\d{2}-F\d{1,2}$/
const POINT_RE = /^B\d{2}-F\d{1,2}-(CRACK|TILT|VIB|TH|CHECK)\d{2}$/
const DEVICE_RE = /^B\d{2}-F\d{1,2}-(CRACK|TILT|VIB|TH|CHECK)\d{2}-DEV\d+$/
const NFC_RE = /^NFC-B\d{2}-F\d{1,2}-(CRACK|TILT|VIB|TH|CHECK)\d{2}$/
const RULE_RE = /^RULE-[A-Z]+-\d{3}$/

/** 历史契约枚举；当前演示里 local/iso 均按本地日期解释，勿作为新实现依据。 */
export type DayKeyRule = 'local' | 'iso'

export interface NumberRule {
  /** 资源键，与 `resources.ts` 的资源名一致 */
  resource: string
  /** 档案类资源下的子类型（楼栋/楼层/测点/设备/规则），其余资源省略 */
  kind?: string
  /** 编号字段名 */
  field: string
  /** 展示用名称 */
  label: string
  pattern: RegExp
  sample: string
  dayKeyRule: DayKeyRule | null
}

/**
 * 编号规则表（冻结）。`sample` 全部取自现有演示数据，不是编出来的。
 * `dayKeyRule` 为 null 表示该编号不含"日"。
 */
export const NUMBER_RULES: NumberRule[] = [
  { resource: 'archive', kind: 'building', field: 'code', label: '楼栋编号', pattern: /^B\d{2}$/, sample: 'B01', dayKeyRule: null },
  { resource: 'archive', kind: 'floor', field: 'code', label: '楼层编号', pattern: FLOOR_RE, sample: 'B03-F2', dayKeyRule: null },
  { resource: 'archive', kind: 'point', field: 'code', label: '测点编号', pattern: POINT_RE, sample: 'B01-F1-CHECK01', dayKeyRule: null },
  { resource: 'archive', kind: 'device', field: 'code', label: '设备编号', pattern: DEVICE_RE, sample: 'B03-F2-CRACK01-DEV1', dayKeyRule: null },
  { resource: 'archive', kind: 'point', field: 'nfc.code', label: 'NFC 标签编号', pattern: NFC_RE, sample: 'NFC-B03-F2-CRACK01', dayKeyRule: null },
  { resource: 'rule', field: 'code', label: '规则编号', pattern: RULE_RE, sample: 'RULE-CRACK-001', dayKeyRule: null },
  { resource: 'record', field: 'recordNo', label: '记录编号', pattern: /^R\d{8}-\d{3}$/, sample: 'R20260918-001', dayKeyRule: 'local' },
  { resource: 'event', field: 'eventNo', label: '事件编号', pattern: /^E\d{8}-\d{3}$/, sample: 'E20260918-001', dayKeyRule: 'local' },
  { resource: 'issue', field: 'issueNo', label: '问题编号', pattern: /^ISS-\d{8}-\d{3}$/, sample: 'ISS-20260929-002', dayKeyRule: 'iso' },
  { resource: 'workOrder', field: 'orderNo', label: '工单编号', pattern: /^WO-\d{8}-\d{3}$/, sample: 'WO-20260929-002', dayKeyRule: 'iso' },
  { resource: 'task', field: 'taskNo', label: '巡检任务编号', pattern: /^TK-\d{8}-\d{3}$/, sample: 'TK-20260929-001', dayKeyRule: 'iso' },
  { resource: 'plan', field: 'code', label: '巡检计划编号', pattern: /^PLAN-\d{8}-\d{3}$/, sample: 'PLAN-20260920-001', dayKeyRule: 'iso' },
  { resource: 'maintenancePlan', field: 'code', label: '保养计划编号', pattern: /^MP-\d{8}-\d{3}$/, sample: 'MP-20260920-001', dayKeyRule: 'iso' },
  { resource: 'maintenanceTask', field: 'taskNo', label: '保养任务编号', pattern: /^MT-\d{8}-\d{3}$/, sample: 'MT-20260920-001', dayKeyRule: 'iso' },
]

/** 内部主键前缀（现有实现实际使用的小写前缀，服务端不得另起一套）。 */
export const ID_PREFIX = {
  building: 'bld',
  floor: 'flr',
  point: 'pnt',
  device: 'dev',
  baseline: 'bas',
  record: 'rec',
  event: 'evt',
  notification: 'ntf',
  issue: 'iss',
  workOrder: 'wo',
  plan: 'plan',
  maintenancePlan: 'mp',
  attachment: 'att',
  audit: 'log',
  media: 'med',
} as const

export type ResourceIdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX]

/**
 * 主键形态校验：只校验形态，不解释内容。接受两种形态 ——
 * ① 不透明主键 `<prefix>_<不透明串>`；
 * ② **业务键主键** `<prefix>_<业务键>@<执行时刻>`：巡检与保养任务的既有实现就是
 *    `计划ID@执行时刻`（同一计划同一时刻天然唯一，并发点两次也只落一条）。
 *    这是刻意的例外，不是漏改：换成随机主键就必须再查一次重，反而更容易写重。
 */
export function isPrimaryKey(value: string): boolean {
  if (/^[a-z]{2,4}_[A-Za-z0-9_-]{4,76}$/.test(value)) return true
  return /^[a-z]{2,4}_[A-Za-z0-9_-]+@\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)
}

export function numberRuleOf(resource: string, field: string, kind?: string): NumberRule | undefined {
  return NUMBER_RULES.find(
    (row) => row.resource === resource && row.field === field && (kind === undefined || row.kind === kind),
  )
}

/**
 * 按规则校验业务编号；未登记的 (resource, field) 一律视为不通过，避免"忘了登记就放过"。
 * 档案类资源（楼栋/楼层/测点/设备的编号同为 `code`）用 `kind` 指明是哪一种；省略 kind 时任一规则匹配即通过。
 */
export function isBusinessNumber(resource: string, field: string, value: string, kind?: string): boolean {
  if (kind !== undefined) {
    const rule = numberRuleOf(resource, field, kind)
    return rule === undefined ? false : rule.pattern.test(value)
  }
  const rules = NUMBER_RULES.filter((row) => row.resource === resource && row.field === field)
  return rules.length > 0 && rules.some((rule) => rule.pattern.test(value))
}

/**
 * 编号前缀用的日期键。`isoDayKey` 是兼容旧调用的名称，当前与 `dayKey` 同为本地日。
 */
export function numberDayKey(rule: DayKeyRule, at: string): string {
  return rule === 'local' ? dayKey(at) : isoDayKey(at)
}

/**
 * 确定性派生主键：同一业务键必然得到同一个 id。
 * 服务端实现幂等时可直接复用该形态；`iss_` 派生串就是现有实现的做法。
 */
export function deriveId(prefix: ResourceIdPrefix, businessKey: string): string {
  return `${prefix}_${businessKey}`
}

/**
 * 巡检任务/保养任务的业务键（冻结）：`计划ID@执行时刻`。
 * 同一计划同一执行时刻天然唯一，因此"并发点两次只会有一条任务"，不靠应用层查重。
 */
export function taskBusinessKey(planId: string, plannedAt: string): string {
  return `${planId}@${plannedAt}`
}
