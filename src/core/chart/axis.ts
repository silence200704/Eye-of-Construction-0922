/**
 * 图表纵轴刻度。
 *
 * 直接按"最小值到最大值四等分"会得到 0.45 / 0.56 / 0.66 / 0.76 / 0.87 这类刻度，
 * 读者无法从坐标轴读出阈值（0.60 / 0.70 / 0.80）在哪一档。
 * 这里取整齐步长，使刻度落在 0.1 的整数倍上，阈值线自然与刻度对齐。
 */

/** 取不小于 raw 的整齐步长：1、2、5 系列（含 1.5 / 3 / 7 的放宽档，避免刻度过密或过疏）。 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  const factor = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10
  return factor * magnitude
}

/** 步长需要的小数位，用于刻度文字不丢精度（0.1 → 1 位，0.05 → 2 位，1 → 0 位）。 */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const text = step.toFixed(10).replace(/0+$/, '')
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/** 在 [min, max] 内按整齐步长给出刻度值；范围退化时返回单刻度。 */
export function niceTicks(min: number, max: number, count = 5): { values: number[]; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { values: Number.isFinite(min) ? [min] : [], step: 0 }
  }
  const step = niceStep((max - min) / Math.max(1, count - 1))
  const values: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
    values.push(Math.round(value * 1e6) / 1e6)
  }
  return { values, step }
}
