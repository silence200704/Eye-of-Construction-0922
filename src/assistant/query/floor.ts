/** 中文楼层线索；不把楼栋编号当楼层。 */
export function floorNumber(text: string): number | null {
  const match = text.match(/(?:第)?([一二三四五六七八九十\d]+)(?:层|楼(?!栋))/)
  if (!match) return null
  const token = match[1]
  if (/^\d+$/.test(token)) return Number(token)
  const digits = '零一二三四五六七八九'
  if (token === '十') return 10
  if (token.includes('十')) {
    const [tens, ones] = token.split('十')
    return (tens === '' ? 1 : digits.indexOf(tens)) * 10 + (ones === '' ? 0 : digits.indexOf(ones))
  }
  return digits.indexOf(token) > 0 ? digits.indexOf(token) : null
}

export function sameFloor(point: { floorName: string; code: string }, requested: number): boolean {
  const actual = floorNumber(point.floorName) ?? Number(point.code.match(/-F(\d+)-/i)?.[1])
  return actual === requested
}
