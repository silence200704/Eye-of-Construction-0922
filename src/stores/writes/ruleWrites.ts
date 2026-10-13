/**
 * 预警规则写入。
 * 调整阈值会写入操作日志并记录版本变化；修改只影响后续数据，
 * 历史记录仍按采样当时生效的规则版本解释，不做覆盖。
 */
import type { MonitoringRule } from '@/types/rules'
import { nowIso } from '@/core/time'
import { putRule } from '@/db/repo'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'
import { validateThresholds } from '@/core/assess/thresholds'

export interface RuleDraft {
  code: string
  name: string
  version: string
  enabled: boolean
  unit: string
  yellow: number | null
  orange: number | null
  red: number | null
  rateThreshold: number | null
  persistenceMinRecords: number
  persistenceMinSpanMinutes: number
  persistenceMaxGapMinutes: number
  recoveryRatio: number
  recoveryMinRecords: number
  tempMin: number | null
  tempMax: number | null
  humidityMax: number | null
  confirmedBy: string
  note: string
}

/** 版本号自增：V1.0 → V1.1；无法解析时保留原值由用户填写。 */
export function nextRuleVersion(current: string): string {
  const parsed = /^V?(\d+)\.(\d+)$/i.exec(current.trim())
  if (parsed === null) return current
  return `V${parsed[1]}.${Number(parsed[2]) + 1}`
}

/**
 * 保存规则。
 * 每次保存生成新的版本行，旧版本行原样保留 —— 这样"历史记录按当时规则版本解释"才成立，
 * 调整阈值不会让过去判定过的记录与事件失去解释。
 */
export async function saveRule(id: string, draft: RuleDraft): Promise<{ version: string; versioned: boolean }> {
  const store = useArchiveStore()
  const session = useSessionStore()
  const existing = store.ruleById(id)
  if (existing === undefined) throw new Error('规则不存在')
  if (draft.yellow !== null && draft.orange !== null && draft.red !== null) {
    const error = validateThresholds({ yellow: draft.yellow, orange: draft.orange, red: draft.red })
    if (error) throw new Error(error)
  }
  const at = nowIso()
  const typed = draft.version.trim()
  const version = typed === '' || typed === existing.version ? nextRuleVersion(existing.version) : typed
  const row: MonitoringRule = {
    ...existing,
    id: `${existing.ruleId}@${version}`,
    ruleId: existing.ruleId,
    code: draft.code.trim(),
    name: draft.name.trim(),
    version,
    effectiveFrom: at,
    enabled: draft.enabled,
    unit: draft.unit.trim(),
    thresholds:
      draft.yellow === null || draft.orange === null || draft.red === null
        ? null
        : { yellow: draft.yellow, orange: draft.orange, red: draft.red },
    rateThreshold: draft.rateThreshold,
    persistence: {
      minRecords: draft.persistenceMinRecords,
      minSpanMinutes: draft.persistenceMinSpanMinutes,
      maxGapMinutes: draft.persistenceMaxGapMinutes,
      level: existing.persistence.level,
    },
    recovery: {
      yellowRatio: draft.recoveryRatio,
      minRecords: draft.recoveryMinRecords,
      minSpanMinutes: existing.recovery.minSpanMinutes,
    },
    environment:
      existing.environment === null
        ? null
        : {
            ...existing.environment,
            tempMin: draft.tempMin ?? existing.environment.tempMin,
            tempMax: draft.tempMax ?? existing.environment.tempMax,
            humidityMax: draft.humidityMax ?? existing.environment.humidityMax,
          },
    confirmedBy: draft.confirmedBy.trim(),
    note: draft.note.trim(),
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: at,
    updatedBy: session.name,
  }
  await putRule(row)
  await store.log(
    'update',
    'system',
    row.id,
    `${row.code} ${row.name}`,
    `修改预警规则 ${row.code}：生成新版本 ${existing.version} → ${version}，旧版本保留`,
    `阈值 ${formatThresholds(existing)} → ${formatThresholds(row)}；新版本自 ${at} 起生效，此前的记录与事件仍按 ${existing.version} 解释`,
  )
  await store.reload()
  return { version, versioned: true }
}

function formatThresholds(rule: MonitoringRule): string {
  const t = rule.thresholds
  return t === null ? '环境条件' : `黄 ${t.yellow} / 橙 ${t.orange} / 红 ${t.red}`
}
