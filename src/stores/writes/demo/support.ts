/**
 * 演示场景的公共支撑：身份切换、日志、照片草稿与结果结构。
 *
 * 场景写入一律走既有仓储入口（records.addRecord / issues.reviewIssue / workOrders.advanceOrder …），
 * 本文件只提供"怎么切身份、怎么写登记日志、怎么造一张合成照片"这类共用动作，不碰业务规则。
 */
import { useArchiveStore } from '@/stores/archive'
import { useAlertStore } from '@/stores/alerts'
import { useSessionStore } from '@/stores/session'
import { eventAlertPrompt, type AlertPromptEventInput } from '@/core/event/alertPrompt'
import type { AlarmEvent } from '@/types/events'
import { compressPhoto, type DraftPhotoInput } from '@/db/inspection/attachments'
import { nowIso } from '@/core/time'
import type { DemoScenarioKey } from '@/config/demoScenarios'
import type { AnchorRef } from '@/stores/demo/registry'

/**
 * 场景登记日志的 objectId 前缀：`demo:<场景键>`。
 *
 * 审计日志是**追加**的：同一场景载入多次就留多条，不覆盖历史。
 * 界面上的"已就绪 / 失败 / 已失效"不读日志，读 `stores/demo/registry.ts` 那份界面状态缓存。
 */
export const DEMO_LOG_PREFIX = 'demo:'

/**
 * 登记日志的 reason 里带状态标记，界面据此区分"已就绪 / 失败 / 数据已失效"。
 * `reason` 本来就是自由文本，放一个可解析的前缀不需要改库结构。
 */
export const DEMO_STATUS_OK = '状态=成功'
export const DEMO_STATUS_FAILED = '状态=失败'

export interface DemoScenarioResult {
  key: DemoScenarioKey
  ok: boolean
  /** 面向演示者的一句话结果（含"新增 N / 跳过 M"） */
  message: string
  created: number
  skipped: number
  /** 载入后要定位到的对象编号，便于界面提示与截图核对 */
  anchors: string[]
  /**
   * 载入后要跳转到的位置（自动定位）。
   * 只在应用**已经支持**深链的地方给 query（如问题池 `?issue=`、保养台 `?task=`、预警中心 `?event=`），
   * 其余场合只给 path —— 不发明页面上并不存在的参数。
   */
  focus?: { path: string; query: Record<string, string> }
  /**
   * 关键对象引用，用于"已就绪"核验：锚点被手工删掉后界面应改显示"数据已失效"。
   * 只放少量关键对象（事件 / 问题 / 工单 / 任务 / 计划），不是把生成的每一条都记下来。
   */
  anchorRefs?: AnchorRef[]
}

export function makeResult(
  key: DemoScenarioKey,
  ok: boolean,
  message: string,
  extra: {
    created?: number
    skipped?: number
    anchors?: string[]
    focus?: DemoScenarioResult['focus']
    anchorRefs?: AnchorRef[]
  } = {},
): DemoScenarioResult {
  return {
    key,
    ok,
    message,
    created: extra.created ?? 0,
    skipped: extra.skipped ?? 0,
    anchors: extra.anchors ?? [],
    ...(extra.focus === undefined ? {} : { focus: extra.focus }),
    ...(extra.anchorRefs === undefined ? {} : { anchorRefs: extra.anchorRefs }),
  }
}

/**
 * 演示身份。
 * 名字取自示例校区档案里的责任人，避免同一个演示里出现两套人名；
 * 角色决定能不能做这件事，名字只决定留痕写谁。
 */
export const DEMO_ACTORS = {
  safety: { name: '李老师（后勤保障处）', role: 'safety' },
  property: { name: '王老师（物业值班）', role: 'property' },
  inspector: { name: '周老师（巡检班组）', role: 'inspector' },
  repair: { name: '孙老师（物业维修）', role: 'repair' },
} as const

export type DemoActorKey = keyof typeof DEMO_ACTORS

/**
 * 以某个身份执行一段写入，结束后**还原**原来的身份。
 * 还原是刻意的：载入演示数据不该顺手把演示者的身份改成"维修人员"。
 */
export async function withActor<T>(key: DemoActorKey, work: () => Promise<T>): Promise<T> {
  const session = useSessionStore()
  const before = { name: session.name, role: session.role }
  const actor = DEMO_ACTORS[key]
  session.setIdentity(actor.name, actor.role)
  try {
    return await work()
  } finally {
    session.setIdentity(before.name, before.role)
  }
}

/** 写一条场景登记日志：每次载入**追加**一条，不覆盖历史。`key` 也可传 `fullChain` 这类汇总键。 */
export async function logScenario(
  key: string,
  title: string,
  summary: string,
  reason = '演示场景导入；可重复点击，按既有业务键幂等',
): Promise<void> {
  const archive = useArchiveStore()
  await archive.log('import', 'system', `${DEMO_LOG_PREFIX}${key}`, title, summary, `${DEMO_STATUS_OK}；${reason}`)
}

/**
 * 载入失败也要留一条登记。
 * 否则界面会拿着上一次的成功记录继续显示"已就绪"，把失败当成成功。
 */
export async function failScenario(key: string, title: string, message: string): Promise<void> {
  const archive = useArchiveStore()
  await archive.log('import', 'system', `${DEMO_LOG_PREFIX}${key}`, title, message, `${DEMO_STATUS_FAILED}；${message}`)
}

/**
 * 这条记录是不是演示场景自己写的。
 * 用来区分"我上次写的、跳过即可"和"这里已有手工数据、跳过但要提示冲突"。
 */
export function isDemoRecord(note: string): boolean {
  return note.includes('演示场景导入') || note.includes('演示脚本一键导入')
}

/**
 * 造一张**合成**的演示照片。
 *
 * 为什么不是"选一张真实照片"：本机浏览器会话只提供 IAB 后端，文件选择器在该后端不可用
 * （官方 schema 把 filechooser 标为 IAB 不支持）。这里用画布生成真实可解码的 JPEG 字节，
 * 送入应用自己的照片流程（文件头校验 → 压缩 → 落库），差别只在**没经过操作系统文件选择框**，
 * 演示与说明文案里必须照此口径写，不得写成"已真实选择文件"。
 */
export async function makeDemoPhoto(name: string, hue: number): Promise<File | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.fillStyle = `hsl(${hue}, 32%, 62%)`
  ctx.fillRect(0, 0, 320, 240)
  ctx.fillStyle = `hsl(${hue}, 24%, 38%)`
  ctx.fillRect(24, 150, 272, 66)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '20px sans-serif'
  ctx.fillText(name, 24, 60)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (blob === null) return null
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
}

/**
 * 把合成照片压成草稿（附件主键 = `att_` + 草稿标识，天然幂等）。
 * `id` 必须由调用方给定且稳定，否则重试会堆出多张一模一样的照片。
 */
export async function demoDraft(id: string, file: File): Promise<DraftPhotoInput> {
  const compressed = await compressPhoto(file)
  return {
    id,
    fileName: file.name,
    blob: compressed.blob,
    thumb: compressed.thumb,
    size: compressed.blob.size,
    width: compressed.width,
    height: compressed.height,
    capturedAt: nowIso(),
  }
}

/**
 * 把本次载入**新建 / 升级**的事件送进预警提醒（右上角铃铛）。
 *
 * 提醒中心只记录"本浏览器会话里已经向操作者呈现过哪些新建 / 升级事件"，不落库。
 * 既有口径是"历史补录、CSV 与演示脚本只看汇总或页面结果"，所以载入演示数据后它一直是空的；
 * 但 CSV 导入那条路本来就会 `enqueueBatch`，演示导入没有理由例外。
 *
 * 逐条补齐：第一条证据算"已生成"、之后每次升级算"已升级"，等级与触发值都取事件当时那一条 ——
 * 与站内通知同源，不额外编造。
 *
 * 已经在收件箱里的同一条（key 相同）**不重复堆，而是重放**：置回未读未忽略。
 * 否则第二次点「载入演示数据」时红色强提醒弹窗永远不再出现（收件箱只记本会话）。
 */
export function presentLoadedAlerts(events: AlarmEvent[]): { added: number; reopened: number } {
  const alerts = useAlertStore()
  const archive = useArchiveStore()
  let added = 0
  let reopened = 0
  for (const event of events) {
    const first = event.evidences[0]
    if (first === undefined) continue
    const pointLabel = archive.pointLabel(event.pointId)
    const inputs: AlertPromptEventInput[] = [
      {
        event: { ...event, level: first.level, lastTriggerValue: first.triggerValue },
        action: 'created',
        pointLabel,
      },
      ...event.upgrades.map((row) => ({
        event: { ...event, level: row.to, lastTriggerValue: row.triggerValue },
        action: 'upgraded' as const,
        pointLabel,
      })),
    ]
    for (const input of inputs) {
      const prompt = eventAlertPrompt(input)
      if (prompt === null) continue
      if (alerts.items.some((row) => row.key === prompt.key)) {
        alerts.reopen(prompt.key)
        reopened += 1
        continue
      }
      alerts.enqueueEvent(input)
      added += 1
    }
  }
  return { added, reopened }
}

/** 提醒结果的统一文案：新增与重放分开写清，避免"重放"被误读成"又堆了一条"。 */
export function alertNote(result: { added: number; reopened: number }): string {
  if (result.added === 0 && result.reopened === 0) return '预警提醒无变化'
  const parts = [`新增 ${result.added} 条`]
  if (result.reopened > 0) parts.push(`重放 ${result.reopened} 条（原本已读/已忽略）`)
  return `预警提醒${parts.join('、')}`
}

/** 本地日期键偏移：0 = 今天，-1 = 昨天。保养/复查要按天取键，不能直接减毫秒。 */
export function dayKeyOffset(days: number, todayKey: string): string {
  const [year, month, day] = todayKey.split('-').map((part) => Number(part))
  const date = new Date(year, (month ?? 1) - 1, day ?? 1)
  date.setDate(date.getDate() + days)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
