import { LEVEL_COLORS, type PanelOption } from '../echartsSetup'
import type { InsightModel, InsightRow } from '@/core/chart/insights'

export type InsightKind = 'coverage' | 'alerts' | 'orders'

const common = { animationDuration: 450, animationDurationUpdate: 250, tooltip: { trigger: 'item' as const } }

function coverageOption(model: InsightModel): PanelOption {
  return {
    ...common,
    series: [{
      type: 'pie', radius: ['61%', '79%'], center: ['50%', '50%'],
      label: { show: false }, emphasis: { scale: false },
      data: model.rows.filter(row => row.count > 0).map(row => ({
        name: row.label, value: row.count, key: row.key, itemStyle: { color: row.color, borderColor: '#fff', borderWidth: 3 },
      })),
    }],
  }
}

function barAxes(rows: InsightRow[]) {
  return {
    grid: { left: 5, right: 30, top: 35, bottom: 5, containLabel: true },
    xAxis: { type: 'value' as const, minInterval: 1, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'category' as const, inverse: true, data: rows.map(row => row.label), axisLabel: { fontSize: 11, width: 100, overflow: 'truncate' as const } },
  }
}

function alertOption(model: InsightModel): PanelOption {
  return {
    ...common, ...barAxes(model.rows),
    legend: { top: 0, data: ['黄色', '橙色', '红色'], textStyle: { fontSize: 11 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    series: (['yellow', 'orange', 'red'] as const).map((level, index) => ({
      type: 'bar', stack: 'events', name: ['黄色', '橙色', '红色'][index], barMaxWidth: 21,
      itemStyle: { color: LEVEL_COLORS[level] },
      label: { show: true, position: 'inside', color: '#fff', formatter: param => Number(param.value) > 0 ? String(param.value) : '' },
      data: model.rows.map(row => ({ value: row.levels?.[level] ?? 0, key: row.key })),
    })),
  }
}

function orderOption(model: InsightModel): PanelOption {
  return {
    ...common, ...barAxes(model.rows),
    grid: { left: 5, right: 30, top: 5, bottom: 5, containLabel: true },
    series: [{
      type: 'bar', barMaxWidth: 18,
      label: { show: true, position: 'right', color: '#344d57', fontSize: 12 },
      data: model.rows.map(row => ({ value: row.count, key: row.key, name: row.label, itemStyle: { color: row.color, borderRadius: [0, 4, 4, 0] } })),
    }],
  }
}

export function insightOption(kind: InsightKind, model: InsightModel): PanelOption {
  return kind === 'coverage' ? coverageOption(model) : kind === 'alerts' ? alertOption(model) : orderOption(model)
}
