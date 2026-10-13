/**
 * 回答模板的公共部分：草稿类型、默认值与"来源 / 质量 / 人工登记状态"的口径。
 *
 * 模板只写自己确实知道的内容，缺省由入口统一补（空数组 / null），
 * 这样界面永远拿到同一形状的结果，不用到处判 undefined。
 */
import { DEVICE_HEALTH_OPTIONS, qualityLabel, recordSourceLabel } from '@/types/catalog'
import type { DataSource, MonitorRecord } from '@/types/domain'
import type { DeviceRef } from '../selectors'
import type { PointRef } from '../resolve'
import type { AskCandidate, AskContext, AskEvidence, AskFact, AskLink, AskPendingCommand, AskPreview, AskProvenance, AskStatus, AskTiming } from '../types'

/** 单段预览的便捷写法：多数模板只会给一段。 */
export function previewsOf(preview: AskPreview | null): AskPreview[] {
  return preview === null ? [] : [preview]
}

export interface AnswerDraft {
  context?: AskContext
  followups?: string[]
  status?: AskStatus
  conclusion: string
  /** 本条回答讲的是哪个测点；由模板给出，入口统一装配（见 `AskResult.pointId`） */
  pointId?: string | null
  facts?: AskFact[]
  timing?: AskTiming | null
  provenance?: AskProvenance | null
  evidence?: AskEvidence[]
  /** 消歧候选项；只有 `status: 'need_choice'` 的草稿会带 */
  candidates?: AskCandidate[]
  gaps?: string[]
  links?: AskLink[]
  /** 本回答涉及、但需要人工确认的指令；只有写入类回答会带 */
  pendingCommands?: AskPendingCommand[]
  guide?: { eventId: string | null; canPrepare: boolean }
  /** 回答内的可视化预览；一次回答可以有 0~n 段 */
  previews?: AskPreview[]
  dataNotes?: string[]
}

export function draft(conclusion: string, rest: Omit<Partial<AnswerDraft>, 'conclusion'> = {}): AnswerDraft {
  return { conclusion, ...rest }
}

/**
 * 人工登记 vs 真实心跳的口径说明。
 * 凡回答里出现设备状态，这句话必须一起出现——否则"正常在线"会被读成"设备真的在传数据"。
 */
export const DEVICE_HEALTH_NOTE =
  '设备健康状态是档案里人工登记的字段，不是设备心跳；本机不接入真实设备，回答里不会出现实时在线判断。'

/** 无设备时的统一说明。 */
export const NO_DEVICE_NOTE = '该测点没有绑定设备，读数只能由人工录入或 CSV 导入。'

const HEALTH_LABEL: Record<string, string> = {
  unknown: '未接入（无设备心跳）',
  online: '正常在线（人工登记）',
  offline: '离线 / 待排查（人工登记）',
}

export function dataSourceLabel(value: DataSource): string {
  return value === 'real' ? '实测建档' : '示例数据'
}

function healthLabel(health: DeviceRef['health'] | 'none'): string {
  if (health === 'none') return '无绑定设备'
  return HEALTH_LABEL[health] ?? DEVICE_HEALTH_OPTIONS.find((row) => row.value === health)?.label ?? health
}

/** 来源与质量：质量标记决定这条数据能不能用来下结论，因此和数值一起给。 */
export function provenanceOf(record: MonitorRecord, point: PointRef, device: DeviceRef | null, now: string): AskProvenance {
  return {
    source: record.source,
    sourceLabel: recordSourceLabel(record, now),
    quality: record.quality,
    qualityLabel: qualityLabel(record.quality),
    qualityNote: record.qualityNote,
    pointDataSource: point.dataSource,
    pointDataSourceLabel: dataSourceLabel(point.dataSource),
    deviceHealth: device?.health ?? 'none',
    deviceHealthLabel: healthLabel(device?.health ?? 'none'),
  }
}
