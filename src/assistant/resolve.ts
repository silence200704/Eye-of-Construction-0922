/**
 * 实体消歧：把问句里的线索对着**当前档案**复核，得到唯一对象或候选清单。
 *
 * 三条纪律直接来自方案：
 * 1. 优先按测点编号精确匹配，再按楼栋 / 指标缩小范围；
 * 2. 命中多个时返回候选让用户选，**不替人猜点**；
 * 3. 一个都没命中时说"当前数据集找不到"，不回退到预置假答案。
 *
 * 纯函数：输入是引用数组，不读 store，方便直接用夹具做回归。
 */
import { metricDef } from '@/types/catalog'
import type { DataSource, MetricKey } from '@/types/domain'
import type { QuestionEntities } from './parse'
import { normalizeQuestion } from './parse'
import { sameFloor } from './query/floor'
import type { AskCandidate } from './types'

export interface BuildingRef {
  id: string
  code: string
  name: string
  archived: boolean
}

/** 测点的只读投影：只带消歧与展示需要的字段，避免把整份档案塞进回答层。 */
export interface PointRef {
  id: string
  code: string
  name: string
  zoneId: string
  buildingId: string
  buildingName: string
  /** 所属楼层 ID：3D 深链要按"楼栋 + 楼层 + 测点"逐级定位，只有楼层名定位不了 */
  floorId: string
  floorName: string
  metric: MetricKey
  /** 档案来源：real=实测建档，demo=示例数据。回答里必须能区分，不能混为一谈 */
  dataSource: DataSource
  archived: boolean
}

export type PointResolutionStatus = 'exact' | 'unique' | 'ambiguous' | 'none'

export interface PointResolution {
  status: PointResolutionStatus
  /** exact/unique 时正好一个；ambiguous 时是全部候选 */
  points: PointRef[]
  /** 给人看的口径说明，直接进回答的 `gaps` 或 `conclusion` */
  reason: string
}

/** 名称特征片段的命中门槛：`裂缝测点` 这类 4 字片段才足以认定在说同一个点。 */
export const NAME_MATCH_MIN = 4

/** 候选上限：再多也不适合在半屏里让人挑，界面应引导改用编号提问。 */
export const MAX_CANDIDATES = 8

/** 统一词形：全角转半角、去空白标点、英文小写、去连字符。 */
export function term(text: string): string {
  return normalizeQuestion(text).compact
}

/**
 * 最长公共子串长度。
 * 中文不切词，用子串命中判断"问句里有没有这个测点的特征词"，
 * 比按空格分词可靠，也比模糊编辑距离更可解释（命中就是命中，可以直接写进说明）。
 */
export function lcsLength(a: string, b: string): number {
  if (a === '' || b === '') return 0
  let prev = new Array<number>(b.length + 1).fill(0)
  let best = 0
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] !== b[j - 1]) continue
      cur[j] = prev[j - 1] + 1
      if (cur[j] > best) best = cur[j]
    }
    prev = cur
  }
  return best
}

function nameScore(question: string, point: PointRef): number {
  return Math.max(lcsLength(question, term(point.name)), lcsLength(question, term(point.zoneId)))
}

/** 楼栋引用匹配：`B03` 按编号，`3号教学楼` 按名称；两边都做归一化。 */
export function matchBuildings(refs: string[], buildings: BuildingRef[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = []
  const unknown: string[] = []
  for (const ref of refs) {
    const token = term(ref)
    const hit = buildings.find((row) => {
      const code = term(row.code)
      const name = term(row.name)
      return code === token || name === token || name.includes(token) || token.includes(name)
    })
    if (hit === undefined) {
      if (!unknown.includes(ref)) unknown.push(ref)
      continue
    }
    if (!ids.includes(hit.id)) ids.push(hit.id)
  }
  return { ids, unknown }
}

export interface PointResolutionInput {
  /** 归一化后的问句（compact 形态） */
  question: string
  entities: QuestionEntities
  buildings: BuildingRef[]
  points: PointRef[]
}

/** 消歧主入口。 */
export function resolvePoint(input: PointResolutionInput): PointResolution {
  const { question, entities, buildings, points } = input
  const exact = byPointCode(entities.pointCode, points.filter((row) => !row.archived))
  if (exact !== null) return exact
  const active = points.filter((row) => !row.archived)
  const byBuilding = matchBuildings(entities.buildingRefs, buildings)
  if (byBuilding.ids.length === 0 && byBuilding.unknown.length > 0) {
    return { status: 'none', points: [], reason: `当前校区档案里没有「${buildingToken(byBuilding.unknown[0])}」这栋楼` }
  }
  const scoped = active
    .filter((row) => byBuilding.ids.length === 0 || byBuilding.ids.includes(row.buildingId))
    .filter((row) => entities.floorNumber == null || sameFloor(row, entities.floorNumber))
    .filter((row) => entities.metric === null || row.metric === entities.metric)
  /*
   * 名称特征只保留**得分最高**的那一组。
   * 否则 `一层走廊人工检查点` 会连带把 `一层主馆区人工检查点` 拉进候选 ——
   * 两者只共有"人工检查点"这个通用后缀，而前者与问句的匹配长得多。
   */
  const scored = scoped
    .map((row) => ({ row, score: nameScore(question, row) }))
    .filter((item) => item.score >= NAME_MATCH_MIN)
  const best = scored.reduce((max, item) => Math.max(max, item.score), 0)
  const named = scored.filter((item) => item.score === best).map((item) => item.row)
  /*
   * 一句线索都没有时**不把全部测点当候选**：那样界面会摊出一长串清单，等于让用户替系统筛。
   * 这里直接说明缺什么，由用户补上楼栋、指标或编号。
   */
  if (byBuilding.ids.length === 0 && entities.metric === null && entities.floorNumber == null && named.length === 0) {
    return { status: 'none', points: [], reason: '问句里没有能定位到具体测点、楼栋或指标的线索' }
  }
  const pool = named.length > 0 ? named : scoped
  if (pool.length === 0) {
    return { status: 'none', points: [], reason: emptyReason(entities, byBuilding.ids.length > 0) }
  }
  const scope = scopeText(entities, buildings, byBuilding.ids)
  const how = named.length > 0 ? '并按名称特征' : ''
  if (pool.length === 1) {
    return { status: 'unique', points: [pool[0]], reason: `${scope}${how}匹配到唯一测点` }
  }
  return {
    status: 'ambiguous',
    points: pool.slice(0, MAX_CANDIDATES),
    reason: `${scope}匹配到 ${pool.length} 个测点，需要由你指定是哪一个`,
  }
}

/**
 * 楼栋引用的显示写法。
 *
 * 抽取时为了让"3号教学楼裂缝测点"能定位到楼栋，号后面会多带几个字；回显给用户时要收干净，
 * 否则错误提示会写成"没有「3号教学楼裂」这栋楼"—— 那看着像系统把用户的话读错了。
 */
function buildingToken(raw: string): string {
  const cut = raw.search(/[楼馆舍堂厦]/)
  return cut > 0 ? raw.slice(0, cut + 1) : raw
}

/** 编号精确匹配：命中就是命中，不命中就说编号不在档案里。 */
function byPointCode(code: string | null, points: PointRef[]): PointResolution | null {
  if (code === null) return null
  const hit = points.find((row) => term(row.code) === term(code))
  if (hit === undefined) return { status: 'none', points: [], reason: `编号 ${code} 不在当前测点档案里` }
  return { status: 'exact', points: [hit], reason: `按测点编号 ${hit.code} 精确匹配` }
}

/** 把"用了哪些线索缩小范围"写成一句人话，界面据此解释为什么是这一个点。 */
function scopeText(entities: QuestionEntities, buildings: BuildingRef[], ids: string[]): string {
  const parts: string[] = []
  const names = buildings.filter((row) => ids.includes(row.id)).map((row) => row.name)
  if (names.length > 0) parts.push(`楼栋「${names.join('、')}」`)
  if (entities.floorNumber != null) parts.push(`楼层「${entities.floorNumber}层」`)
  if (entities.metric !== null) parts.push(`指标「${metricDef(entities.metric).name}」`)
  return parts.length === 0 ? '' : `按${parts.join('、')}筛选，`
}

function emptyReason(entities: QuestionEntities, scopedByBuilding: boolean): string {
  if (entities.floorNumber != null) return `指定的 ${entities.floorNumber} 层没有符合条件的在册测点`
  if (entities.metric !== null) {
    const name = metricDef(entities.metric).name
    return scopedByBuilding ? `这栋楼里没有${name}类在册测点` : `当前数据集里没有${name}类在册测点`
  }
  return '这栋楼里没有在册测点'
}

/** 候选清单：编号 + 名称 + 位置指标，供界面直接渲染成按钮。 */
export function toCandidates(points: PointRef[]): AskCandidate[] {
  return points.map((row) => ({
    id: row.id,
    label: `${row.code} ${row.name}`,
    detail: `${row.buildingName} · ${row.floorName} · ${row.zoneId} · ${metricDef(row.metric).name}`,
  }))
}
