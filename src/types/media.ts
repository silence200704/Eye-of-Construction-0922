/**
 * 影像会话的领域类型。
 *
 * 边界（本轮演示素材、人工上传和短视频）：
 * - 影像是**本会话**的：刷新即失，本轮不新增视频表、不做数据库迁移；
 * - 来源必须带标签：人工上传、生成演示照片、公开参考图、演示视频关键帧；
 * - 需要正式留存的照片走**现有问题附件入口**入库，不在影像页直接写库。
 */
import type { Region, PixelMask } from '@/core/media/compare'

/** 演示生成照片与人工上传分开标记，不能伪装成现场真实拍摄。 */
/**
 * `demo_evidence` 是"公开实拍原图 + 同底图模拟变化"这一对**演示证据素材**：
 * 它跟 `demo_public` 不同 —— 公开参考图不能参与前后比对，而这一对是**刻意做出来的对比素材**，
 * 因此允许比对，但必须在界面与回答里标明"基于实拍素材的变化演示，非真实连续拍摄"。
 */
export type FrameOrigin = 'upload' | 'video_frame' | 'demo_generated' | 'demo_public' | 'demo_evidence'

export interface MediaFrame {
  id: string
  /** 关联测点：影像问答靠它把影像和测点连起来 */
  pointId: string
  origin: FrameOrigin
  /** 拍摄时间（用户填写；视频关键帧存会话读取时间，时间码独立展示，不推算真实拍摄日期） */
  capturedAt: string
  /** 人工备注：拍的是什么位置、什么现象 */
  label: string
  fileName: string
  size: number
  width: number
  height: number
  /** 压缩后的图（与问题附件同一套压缩口径） */
  blob: Blob
  /** 视频关键帧的时间码（秒）；照片为 null */
  videoId?: string
  timeCode: number | null
  /** 服务端模式下已保存到数据库的媒体与关键帧 ID；本地演示模式没有 */
  remoteMediaId?: string
  remoteFrameId?: string
  remoteContentUrl?: string
}

/** 只读投影：问答侧只认这些字段，不把 Blob 带进回答层。 */
export interface MediaFrameRef {
  id: string
  pointId: string
  origin: FrameOrigin
  capturedAt: string
  label: string
  videoId?: string
  timeCode: number | null
}

export interface MediaCompareRecord {
  mask?: PixelMask
  pointId: string
  beforeId: string
  afterId: string
  region: Region
  status: 'changed' | 'stable' | 'incomparable'
  summary: string
  changedRatio: number
  comparedAt: string
}

export function frameOriginLabel(origin: FrameOrigin): string {
  if (origin === 'upload') return '人工上传'
  if (origin === 'video_frame') return '演示视频关键帧'
  if (origin === 'demo_public') return '公开实拍参考图（非本校）'
  if (origin === 'demo_evidence') return '演示证据素材（公开实拍派生）'
  return '生成演示照片'
}

/** 会话影像的边界说明：凡是展示影像的地方都要带上。 */
export const MEDIA_SESSION_NOTE =
  '本地演示模式下影像只存在当前页面会话里，刷新或关闭页面即消失；服务端模式下关键帧与比对结果保存到数据库，受身份与授权保护。'

/** 服务端模式的影像说明：由 UI 按运行模式选择。 */
export const MEDIA_SESSION_NOTE_SERVER =
  '影像与关键帧保存在服务端数据库中，受身份与楼栋授权保护；刷新后从受保护内容接口重建预览。'

