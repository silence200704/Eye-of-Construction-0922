/**
 * 问题相关的展示字典。
 *
 * 单独放一个文件的原因：异常类型列表同时被"巡检上报"（IssueForm）与"人工上报"（ManualIssueForm）使用，
 * 两处各写一份迟早会不一致；照片草稿类型也从这里导出，避免组件间互相 import 造成的循环依赖。
 */
import type { PhotoDraft } from '@/components/inspection/PhotoUploader.vue'

/** 现场异常类型（与方案 §3 的"异常类型"字段对应） */
export const ANOMALY_TYPES: string[] = [
  '探头松动',
  '读数异常',
  '外观破损',
  '渗水受潮',
  '线路老化',
  '遮挡或碰撞',
  '其他',
]

/** 照片草稿（由父组件持有的那份） */
export type PhotoDraftLike = PhotoDraft
