import type { MediaCompareRecord } from '@/types/media'
import { buildLink } from '../actions'
import { draft, type AnswerDraft } from '../answers/shared'
import { answerPointStatus } from '../answers/point'
import { pointTrendPreview } from '../preview/pointTrend'
import type { PointRef } from '../resolve'
import type { AssistantSnapshot } from '../selectors'

export function answerCapabilities(): AnswerDraft {
  return draft('我可以查询传感器读数与趋势、解释预警依据、比对照片和视频关键帧、在3D中定位测点，并核对实际处置进度。', {
    facts: [
      { label: '查询', value: '全校有哪些异常？／B03-F2-CRACK01 的趋势如何？', unit: '' },
      { label: '视觉', value: '选择测点后：分析该测点的裂缝照片／为什么照片有差异？', unit: '' },
      { label: '联动', value: '在3D中定位该测点／这个问题处理完了吗？', unit: '' },
    ],
    links: [buildLink('settings'), buildLink('media_page')],
    gaps: ['临时数据统一从系统设置的一键载入入口准备；照片上传在影像分析页。', '派工、维修、验收、复查与关闭仍由人完成；查看操作方法不会自动准备数据。'],
  })
}

export function answerTrend(input: { snapshot: AssistantSnapshot; point: PointRef; matchNote: string }): AnswerDraft {
  const base = answerPointStatus(input)
  const preview = pointTrendPreview(input.snapshot, input.point)
  return {
    ...base,
    conclusion: preview === null ? `${input.point.code} 暂无可展示的有效趋势。` : `${input.point.code} 的有效读数趋势如下；需要放大查看可打开完整趋势页。`,
    previews: preview === null ? [] : [preview],
    links: [buildLink('point_trend', input.point.id)],
  }
}

export function answerMediaReason(input: { snapshot: AssistantSnapshot; point: PointRef; matchNote: string; previous?: MediaCompareRecord }): AnswerDraft {
  const result = input.previous?.pointId === input.point.id ? input.previous : input.snapshot.media.compare
  const ids = new Set(input.snapshot.media.frames.filter((f) => f.pointId === input.point.id).map((f) => f.id))
  if (result === null || result.pointId !== input.point.id || !ids.has(result.beforeId) || !ids.has(result.afterId)) {
    return draft(`${input.point.code} 尚无有效的区域比对结果，不能解释为“已经发现裂缝变化”。`, {
      pointId: input.point.id, gaps: ['先在这组照片中选区域并运行分析，再问为什么；旧照片失效后需要重新计算。'],
      links: [buildLink('media_page', input.point.id)],
    })
  }
  return draft(`这次照片结论来自所选区域的亮度差异统计：${result.summary}`, {
    pointId: input.point.id,
    facts: [{ label: '差异像素占比', value: (result.changedRatio * 100).toFixed(1), unit: '%' }],
    evidence: [{ kind: 'record', id: result.afterId, ref: '区域比对结果', detail: result.summary }],
    gaps: ['该结果不是红色预警的触发原因；毫米数来自监测记录，照片不换算毫米，也不自动产生预警。'],
    links: [buildLink('media_page', input.point.id)],
  })
}
