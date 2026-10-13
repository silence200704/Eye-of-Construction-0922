/**
 * 「照片前后有什么变化」的回答模板。
 *
 * 这一版把影像会话接进来，但**结论口径一点没放宽**：
 * 只报来源、时间、关联测点、可观察现象与"判断不了什么"；
 * 不出现毫米数、不说"AI 识别"、不说"实时监控"，也不因为影像差异去生成任何预警。
 *
 * 没有影像时不是一句"未接入"，而是说清缺什么、去哪儿补（影像对比页）。
 */
import { formatDateTime } from '@/core/time'
import { compareStatusLabel } from '@/core/media/compare'
import { frameOriginLabel } from '@/types/media'
import { buildLink } from '../actions'
import type { AssistantSnapshot } from '../selectors'
import { findPoint } from '../selectors'
import type { PointRef } from '../resolve'
import { draft, previewsOf, type AnswerDraft } from './shared'
import { mediaPairPreview } from '../preview/mediaPair'

/** 影像相关回答都要带上的边界说明：少一句就可能被读成"系统在看图下结论"。 */
export const MEDIA_BOUNDARIES: string[] = [
  '影像来源有四类：生成的演示前后照片、公开实拍参考图、人工上传的照片、本地演示视频抽出的关键帧。生成照片的日期是模拟值；公开图非本校照片，显示的是载入时间。',
  '本系统不调用摄像头、不接校园监控，也不调用在线 AI。',
  '预设分析只做像素级差异统计，结论止于"疑似变化 / 未见明显差异 / 不可比对"，**不给宽度（毫米）等物理量**。',
  '影像差异**不会自动生成正式结构预警**；需要数值与判定，请走监测记录与预警规则。',
  '会话影像只存在当前页面里，刷新即失；要留存请走问题与工单的附件入口。',
]

export interface MediaAnswerInput {
  snapshot: AssistantSnapshot
  /** 问句里点到的测点；没点到就退回"当前有影像的测点" */
  point: PointRef | null
  matchNote: string
}

export function answerMediaCompare(input: MediaAnswerInput): AnswerDraft {
  const { snapshot } = input
  const frames = selectFrames(input)
  const notes = [`定位口径：${input.matchNote}`, ...MEDIA_BOUNDARIES]

  if (frames.length === 0) return emptyAnswer(snapshot, notes)

  const point = frames[0].pointId
  const target = findPoint(snapshot, point)
  const label = target === undefined ? '该测点' : `${target.code} ${target.name}`
  const compare = snapshot.media.compare !== null && snapshot.media.compare.pointId === point ? snapshot.media.compare : null
  const preview = mediaPairPreview(frames, compare)

  const facts: NonNullable<AnswerDraft['facts']> = [
    { label: '关联测点', value: target === undefined ? '测点已不在档案里' : `${target.code} ${target.name}`, unit: '' },
    { label: '会话影像', value: `${frames.length} 张（演示素材、公开参考图或本机文件）`, unit: '' },
  ]
  const sourceText = [...new Set(frames.map((row) => frameOriginLabel(row.origin)))].join('、')
  facts.push({ label: '影像来源', value: sourceText, unit: '' })
  const latest = frames[frames.length - 1]
  facts.push({ label: latest.origin === 'demo_public' ? '参考图载入时间' : '最近一张时间', value: formatDateTime(latest.capturedAt), unit: '' })
  const withTimeCode = frames.filter((row) => row.timeCode !== null)
  if (withTimeCode.length > 0) {
    facts.push({ label: '视频关键帧时间码', value: withTimeCode.map((row) => `${row.timeCode?.toFixed(1)} 秒`).join('、'), unit: '' })
  }

  if (compare === null) {
    facts.push({ label: '可观察现象', value: '尚未运行预设分析', unit: '' })
    return draft(
      `${label} 当前有 ${frames.length} 张会话影像（${sourceText}），但还没有做前后对比：请在影像对比页框选同一区域后运行预设分析。`,
      {
        pointId: point,
        facts,
        previews: previewsOf(preview),
        evidence: frames.map((row) => ({
          kind: 'record' as const,
          ref: `${frameOriginLabel(row.origin)}｜${formatDateTime(row.capturedAt)}`,
          id: row.id,
          detail: row.label,
        })),
        gaps: [
          '影像差异结论只在"框选同一区域并运行预设分析"之后才有；现在能说的只有来源与时间。',
          '没有标定就不给毫米数 —— 想知道裂缝宽度，请看该测点的监测记录与阈值判定。',
        ],
        links: mediaLinks(point, target),
        dataNotes: notes,
      },
    )
  }

  facts.push({ label: '可观察现象', value: `${compareStatusLabel(compare.status)}（差异像素 ${(compare.changedRatio * 100).toFixed(1)}%）`, unit: '' })
  facts.push({ label: '比对时间', value: formatDateTime(compare.comparedAt), unit: '' })

  const gaps = [
    '结论只覆盖你框选的那一块区域；区域之外没有比对，换一块可能得到不同结果。',
    '两次拍摄的角度、光照、距离都会影响结果；整体曝光差异过大时系统会直接判"不可比对"。',
  ]
  if (compare.status === 'incomparable') {
    gaps.unshift('本次比对**不可比对**：请用同一测点、同一取景范围、相近光照的两张影像重拍后再试。')
  }
  if (compare.status === 'changed') {
    gaps.unshift('"疑似变化"不等于病害结论：是否处置要由人现场复核，影像本身不作为判定依据。')
  }

  return draft(`${label} 的会话影像对比结果：${compare.summary}`, {
    pointId: point,
    facts,
    previews: previewsOf(preview),
    evidence: [
      { kind: 'record', ref: '预设分析', id: compare.afterId, detail: compare.summary },
      ...frames.slice(-2).map((row) => ({
        kind: 'record' as const,
        ref: `${frameOriginLabel(row.origin)}｜${formatDateTime(row.capturedAt)}`,
        id: row.id,
        detail: row.label,
      })),
    ],
    gaps,
    links: mediaLinks(point, target),
    dataNotes: notes,
  })
}

/** 选影像：问句点名了测点就用它，否则用当前会话里影像最多的那个测点（只报事实，不猜点） */
function selectFrames(input: MediaAnswerInput): AssistantSnapshot['media']['frames'] {
  const all = input.snapshot.media.frames
  if (input.point !== null) return all.filter((row) => row.pointId === input.point?.id).sort(byTime)
  const counts = new Map<string, number>()
  for (const row of all) counts.set(row.pointId, (counts.get(row.pointId) ?? 0) + 1)
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return best === undefined ? [] : all.filter((row) => row.pointId === best[0]).sort(byTime)
}

function byTime(a: { capturedAt: string }, b: { capturedAt: string }): number {
  return a.capturedAt.localeCompare(b.capturedAt)
}

/** 没有任何会话影像：说清缺什么、去哪儿补 */
function emptyAnswer(snapshot: AssistantSnapshot, notes: string[]): AnswerDraft {
  const gaps = [
    '当前页面会话里还没有任何影像，因此无法回答"照片有什么变化"。',
    '请到影像对比页：选好测点，点「一键加入前后照片」载入生成的演示素材；也可人工上传同一位置的照片或从本地视频抽关键帧。框选同一区域后再运行预设分析。',
    '本系统不接校园监控、不调用在线 AI，也不会凭图片编造裂缝宽度。',
  ]
  if (snapshot.media.videoLoaded) gaps.push('演示视频已载入但还没抽关键帧：在影像对比页点「抽 3 个关键帧」即可。')
  return draft('当前会话里没有可对比的影像，先准备影像再问这个问题。', {
    status: 'not_found',
    evidence: [],
    gaps,
    links: [buildLink('media_page'), buildLink('point_trend'), buildLink('monitor')],
    dataNotes: notes,
  })
}

/** 去向：影像对比页（带测点深链）、该测点趋势、监测数据 */
function mediaLinks(pointId: string, point: PointRef | null | undefined): AnswerDraft['links'] {
  const links = [buildLink('media_page', pointId), buildLink('point_trend', pointId)]
  if (point !== null && point !== undefined) links.push(buildLink('point_building', point.buildingId))
  return links
}
