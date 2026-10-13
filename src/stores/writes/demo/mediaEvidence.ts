/**
 * 视觉演示素材场景：**只登记"素材已就绪"，不写任何业务表**。
 *
 * 为什么需要一个场景键：影像素材（公开实拍原图 + 同底图模拟变化）要随"系统设置 → 一键载入全链演示数据"
 * 一起准备，才能保证"提问时素材一定在"。但图片本身是随包静态资源（`public/demo-media/`），
 * 载入时**不读取、不解码**（提问时按需 fetch），所以这里只做两件事：
 * 1. 核对当前数据集里确实有可关联的裂缝测点；
 * 2. 写一条审计与注册表登记（含测点锚点，测点被删/数据集重置后自动判为失效）。
 *
 * 区域坐标与标签在 `src/config/media/demoPhotos.ts`；差异比例一律由实际像素计算。
 */
import type { DemoScenarioResult } from './support'
import { logScenario, makeResult } from './support'
import { useArchiveStore } from '@/stores/archive'
import { DEMO_EVIDENCE_NOTE, DEMO_EVIDENCE_PAIR } from '@/config/media/demoPhotos'

const TITLE = '视觉证据素材（照片与视频）'

export async function loadMediaEvidenceScenario(options: { pointId?: string } = {}): Promise<DemoScenarioResult> {
  const key = 'mediaEvidence' as const
  const archive = useArchiveStore()
  const crackPoints = archive.activePoints.filter((row) => row.metric === 'crack_width' && (options.pointId === undefined || row.id === options.pointId))

  if (crackPoints.length === 0) {
    const message = '当前数据集没有在册的裂缝测点：请先载入示例校区（或先建档），再准备视觉证据素材。'
    await logScenario(key, TITLE, message)
    return makeResult(key, false, message, { created: 0 })
  }

  const target = crackPoints[0]
  const extra = crackPoints.length > 1
    ? `；另有 ${crackPoints.length - 1} 个裂缝测点，未与素材关联（可在影像对比页自行加入照片）`
    : ''
  const message =
    `视觉证据素材已就绪：${DEMO_EVIDENCE_PAIR.map((row) => row.label).join(' + ')}，关联测点 ${target.code}${extra}。`
    + `另有固定机位变化演示视频与公开砖墙巡检实拍已登记，明确分析任务才按需读取。素材说明：${DEMO_EVIDENCE_NOTE}`
  await logScenario(key, TITLE, message)
  return makeResult(key, true, message, {
    created: 0,
    anchors: [target.code],
    anchorRefs: [{ kind: 'point', id: target.id }],
    focus: { path: '/media', query: { point: target.id } },
  })
}
