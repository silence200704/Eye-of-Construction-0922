/**
 * V0.3 数据迁移：给已有测点补上 NFC 标签字段。
 *
 * 老库（schema v3 及以前）的测点没有 nfc 字段，打卡时会被判成"未登记标签"。
 * 与规则迁移同一做法：按测点编号生成标签编号、版本从 1 起，只在启动与导入备份后各跑一次，
 * 已带标签的点位原样保留（不覆盖用户后来换绑的编号）。
 */
import type { Point } from '@/types/domain'
import { nfcLabelOf } from '@/core/id'

export function migrateLegacyPoints(points: Point[], at: string, by: string): { rows: Point[]; changed: number } {
  const rows: Point[] = []
  let changed = 0
  for (const point of points) {
    if (point.nfc !== undefined && point.nfc !== null && point.nfc.code !== '') continue
    rows.push({
      ...point,
      nfc: {
        code: nfcLabelOf(point.code),
        version: 1,
        boundAt: at,
        boundBy: by,
        remark: '从旧版本数据迁移补建，可在点位档案中换绑',
      },
    })
    changed += 1
  }
  return { rows, changed }
}
