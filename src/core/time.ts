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
