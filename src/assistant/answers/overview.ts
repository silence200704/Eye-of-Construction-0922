/**
 * 「全校现在监测如何」的回答模板。
 *
 * 按方案要求列出：在册绑定设备的测点、最近有有效采样的测点、未关闭黄橙红事件计数，
 * 并把"更新时间"和"来源构成"一起给出来。所有数字都来自当前数据集，
 * 没有写死的演示数字，也不把"没有有效读数"折算成"正常"。
 */
import { formatDateTime } from '@/core/time'
import { buildLink } from '../actions'
import type { AssistantSnapshot } from '../selectors'
import { overviewOf, timingOf } from '../selectors'
import { READING_FRESH_MINUTES } from '../selectors/records'
import { DEVICE_HEALTH_NOTE, draft, type AnswerDraft } from './shared'

export function answerCampusOverview(snapshot: AssistantSnapshot): AnswerDraft {
  const counts = overviewOf(snapshot)
  const level = counts.openByLevel
  const conclusion =
    `${counts.activeBuildings} 栋在册楼栋、${counts.activePoints} 个在册测点` +
    `（传感器 ${counts.sensorPoints} · 人工检查点 ${counts.manualPoints}）；` +
    `未关闭预警 ${counts.openTotal} 条（黄 ${level.yellow}｜橙 ${level.orange}｜红 ${level.red}）。`

  const facts: AnswerDraft['facts'] = [
    { label: '在册楼栋', value: String(counts.activeBuildings), unit: '栋' },
    { label: '在册测点', value: String(counts.activePoints), unit: '个' },
    { label: '其中传感器测点', value: String(counts.sensorPoints), unit: '个' },
    { label: '其中人工检查点', value: String(counts.manualPoints), unit: '个' },
    { label: '有有效读数的传感器测点', value: `${counts.pointsWithValidReading} / ${counts.sensorPoints}`, unit: '个' },
    { label: `近 ${READING_FRESH_MINUTES} 分钟内仍有有效采样的测点`, value: String(counts.pointsFresh), unit: '个' },
    { label: '未关闭预警合计', value: String(counts.openTotal), unit: '条' },
    { label: '未关闭红色', value: String(level.red), unit: '条' },
    { label: '未关闭橙色', value: String(level.orange), unit: '条' },
    { label: '未关闭黄色', value: String(level.yellow), unit: '条' },
    { label: '记录来源构成', value: sourceText(counts.sourceCounts), unit: '' },
  ]
  if (counts.lastSampleTime !== null) {
    facts.push({ label: '最近一次采样时间', value: formatDateTime(counts.lastSampleTime), unit: '' })
  }
  if (counts.lastEnteredAt !== null) {
    facts.push({ label: '最近一次录入时间', value: formatDateTime(counts.lastEnteredAt), unit: '' })
  }

  return draft(conclusion, {
    facts,
    timing: latestTiming(snapshot),
    gaps: overviewGaps(snapshot, counts.sensorPoints, counts.pointsWithValidReading),
    links: overviewLinks(counts.openTotal > 0),
    dataNotes: [
      DEVICE_HEALTH_NOTE,
      '未关闭预警按事件 ID 去重统计：一次升级只改同一条事件，不会重复计数。',
      '“有有效读数”只统计质量标记为有效的记录；存疑与无效记录不参与计数。',
      '"更新时间"只说明数据写入到哪一刻，不代表设备此刻在线。',
      '"最近一次录入时间"取全库最晚的录入时刻，与"最近一次采样时间"可能不是同一条记录（补录时就会这样）。',
    ],
  })
}

function sourceText(rows: Record<string, number>): string {
  return `人工录入 ${rows.manual ?? 0}｜CSV 导入 ${rows.csv ?? 0}｜传感器数据（演示）${rows.device ?? 0}`
}

/** 概况也要给时间口径：用最新一条记录说明"数据更新到哪一刻"，口径与单点回答完全一致。 */
function latestTiming(snapshot: AssistantSnapshot): AnswerDraft['timing'] {
  const newest = snapshot.records.reduce<null | (typeof snapshot.records)[number]>(
    (best, row) => (best === null || row.sampleTime > best.sampleTime ? row : best),
    null,
  )
  return newest === null ? null : timingOf(newest, snapshot.now)
}

function overviewGaps(snapshot: AssistantSnapshot, sensorPoints: number, withReading: number): string[] {
  const gaps: string[] = []
  if (sensorPoints === 0) {
    gaps.push('当前数据集没有任何在册传感器测点（可能是空白模式，或数据尚未载入）。')
  }
  if (snapshot.records.length === 0) {
    gaps.push('本机还没有任何监测记录，读数相关计数只能为空。')
  } else if (withReading < sensorPoints) {
    gaps.push(`有 ${sensorPoints - withReading} 个传感器测点还没有有效读数；这些测点不能用"正常"填充。`)
  }
  if (snapshot.events.length === 0) {
    gaps.push('本机还没有任何预警事件，未关闭计数为 0 指的是"尚未产生"，不是"已处置完毕"。')
  }
  return gaps
}

function overviewLinks(hasOpen: boolean): AnswerDraft['links'] {
  const links = [buildLink('overview'), buildLink('campus_map'), buildLink('monitor'), buildLink('reports')]
  if (hasOpen) links.push(buildLink('alarm_queue'))
  return links
}
