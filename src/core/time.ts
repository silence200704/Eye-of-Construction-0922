/** 时间统一以 ISO 字符串存储（UTC），界面按本地时间展示。 */

export function nowIso(): string {
  return new Date().toISOString()
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** ISO → datetime-local 输入值（本地时间） */
export function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** datetime-local 输入值（本地时间）→ ISO */
export function fromLocalInput(local: string): string {
  const date = new Date(local)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

export function todayInput(): string {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function dayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '00000000'
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

/**
 * 严格校验 YYYY-MM-DD 且**日历上真实存在**。
 *
 * 只判非空不够：`2026-02-31` 会被 Date 自动折算成 3 月 3 日，之后逾期天数、目标日期全都算错。
 * 这里用「构造回去再比一次」挡住格式与日历两类非法值（允许历史日期 —— 演示逾期要用）。
 */
export function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 采样时间不得晚于当前时刻（预留 5 分钟容差，应对现场时钟误差）。 */
export function isFutureBeyond(iso: string, toleranceMinutes = 5): boolean {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return true
  return date.getTime() > Date.now() + toleranceMinutes * 60_000
}

export function isValidDateTime(iso: string): boolean {
  return iso !== '' && !Number.isNaN(new Date(iso).getTime())
}

/** 采样时间比录入时间早出阈值以上即为历史补录；阈值由调用方按方案约定传入。 */
export function isBackfill(sampleIso: string, enteredIso: string, thresholdMinutes: number): boolean {
  const sample = new Date(sampleIso).getTime()
  const entered = new Date(enteredIso).getTime()
  if (!Number.isFinite(sample) || !Number.isFinite(entered)) return false
  return entered - sample > thresholdMinutes * 60_000
}
