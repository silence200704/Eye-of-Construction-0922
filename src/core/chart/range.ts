export type RangePreset = '24h' | '7' | '30' | '90' | '0' | 'custom'
export interface TimeRange { preset: RangePreset; from: number; toExclusive: number; label: string }
export const RANGE_OPTIONS = [
  { value: '24h', label: '近24小时' }, { value: '7', label: '近7天' },
  { value: '30', label: '近30天' }, { value: '90', label: '近90天' },
  { value: '0', label: '全部' }, { value: 'custom', label: '自定义日期' },
] as const

function localDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择完整起止日期')
  const date = new Date(`${value}T00:00:00`)
  const actual = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (!Number.isFinite(date.getTime()) || actual !== value) throw new Error('日期不合法')
  return date
}

export function resolveRange(input: { preset: RangePreset; now: string; start?: string; end?: string }): TimeRange {
  const anchor = Date.parse(input.now)
  if (!Number.isFinite(anchor)) throw new Error('共享时钟无效')
  if (input.preset === 'custom') {
    const start = localDay(input.start ?? '')
    const end = localDay(input.end ?? '')
    if (start > end) throw new Error('起始日期不能晚于结束日期')
    end.setDate(end.getDate() + 1)
    return { preset: 'custom', from: start.getTime(), toExclusive: end.getTime(), label: `${input.start}至${input.end}（本地日期，含首尾）` }
  }
  const duration = input.preset === '24h' ? 86_400_000 : Number(input.preset) * 86_400_000
  return { preset: input.preset, from: input.preset === '0' ? 0 : anchor - duration,
    toExclusive: anchor + 1, label: RANGE_OPTIONS.find(row => row.value === input.preset)!.label }
}

export function rangeForQuestion(question: string, now: string, previous?: TimeRange): TimeRange {
  const dates = question.match(/\d{4}-\d{2}-\d{2}/g)
  if (dates?.length === 2) return resolveRange({ preset: 'custom', now, start: dates[0], end: dates[1] })
  const days = /(?:最近|近|改看)\s*(7|30|90)\s*天/.exec(question)
  if (days) return resolveRange({ preset: days[1] as RangePreset, now })
  if (/24\s*小时/.test(question)) return resolveRange({ preset: '24h', now })
  if (/全部|所有历史/.test(question)) return resolveRange({ preset: '0', now })
  return previous ?? resolveRange({ preset: '24h', now })
}

export function inRange(time: string, range: TimeRange): boolean {
  const at = Date.parse(time)
  return at >= range.from && at < range.toExclusive
}
