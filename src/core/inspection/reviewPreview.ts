/**
 * 审核结果预览（纯函数）。
 *
 * 提交前要让审核人看清"这一步之后会发生什么"：问题变成什么状态、谁接手、下一步做什么、
 * 会不会自动建工单、这一步可不可逆。文案与判定同源 —— 出口与目标状态的对应关系仍以
 * issueMerge 的 REVIEW_FLOW 为准，本文件只把它翻译成给人看的一句话，
 * 避免出现"预览说 A、实际写 B"的分裂。
 */
import type { ReviewAction } from '@/types/inspection'
import { ISSUE_STATUSES } from '@/types/inspection'
import { nextStatusOf } from './issueMerge'

export interface ReviewPreview {
  /** 提交后问题的状态（中文名） */
  statusLabel: string
  /** 谁接手 */
  owner: string
  /** 下一步做什么 */
  nextAction: string
  /** 是否会自动创建维修工单 */
  createsWorkOrder: boolean
  /** 是否不可逆：需要更明确的确认文案 */
  irreversible: boolean
  /** 影响到的其他对象（关联目标），没有则为空串 */
  affects: string
}

/** 出口 → 预览文案。六个出口都在这里，缺一个就会被预览漏掉。 */
const PREVIEW: Record<ReviewAction, Omit<ReviewPreview, 'statusLabel'>> = {
  to_repair: {
    owner: '物业值班 / 维修人员',
    nextAction: '下一步由学校安全管理人员派工；工单未验收通过前不得显示"已维修"',
    createsWorkOrder: true,
    irreversible: false,
    // 建工单这件事由 createsWorkOrder 那一行单独说，这里不重复
    affects: '',
  },
  to_investigate: {
    owner: '专业排查单位 / 学校安全管理人员',
    nextAction: '补充专业检查结论，或据结论转维修决定',
    createsWorkOrder: false,
    irreversible: false,
    affects: '',
  },
  recheck: {
    owner: '原报告人 / 巡检人员',
    nextAction: '按复查事项与目标日期完成复查并回填结论',
    createsWorkOrder: false,
    irreversible: false,
    affects: '问题进入待复查，事件关闭还需要处置依据',
  },
  need_evidence: {
    owner: '原报告人',
    nextAction: '补齐审核意见里写明的材料后重新提交审核',
    createsWorkOrder: false,
    irreversible: false,
    affects: '问题退回待审核，原始报告与照片保留',
  },
  link_object: {
    owner: '学校安全管理人员',
    nextAction: '到关联到的对象里继续跟踪；本条问题不再单独处置',
    createsWorkOrder: false,
    irreversible: true,
    affects: '当前问题保留发现记录并关闭，关联目标会写入"被关联"时间线',
  },
  close_no_fault: {
    owner: '学校安全管理人员',
    nextAction: '无需后续动作；依据与时间线进入可追溯档案',
    createsWorkOrder: false,
    irreversible: true,
    affects: '本条问题关闭；**不代表关联的预警事件自动关闭**',
  },
}

/**
 * 生成预览。`categoryLabel` 是二级分类的中文名（页面上已选），用于把"具体情况"带进下一动作描述；
 * 目标状态取 `nextStatusOf()`，与判定同源。
 */
export function reviewPreview(input: { action: ReviewAction; categoryLabel: string }): ReviewPreview {
  const base = PREVIEW[input.action]
  const status = nextStatusOf(input.action)
  return {
    ...base,
    statusLabel: ISSUE_STATUSES.find((row) => row.key === status)?.name ?? status,
    nextAction: input.categoryLabel === '' ? base.nextAction : `${base.nextAction}（${input.categoryLabel}）`,
  }
}
