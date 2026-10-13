/**
 * 问句的确定性解析：归一化 → 意图分类 → 实体抽取。
 *
 * 全部是纯函数：不读 store、不读库、不看当前时间，因此同一句话在任何数据集下都解析成同样的结果，
 * 便于单测与回归。实体是否真实存在由 resolve.ts 对着档案复核——解析器不猜。
 */
import type { MetricKey } from '@/types/domain'
import type { AskIntent } from './types'
import { floorNumber } from './query/floor'
import { specificIntent, existingOnly } from './query/specific'
import { featureIntent } from './features/intent'

/** 归一化后的问句：两种形态各有用处，不要互相替代。 */
export interface NormalizedQuestion {
  /** 去空白与标点，**保留原大小写**：识别 B03-F2-CRACK01 这类编号，好原样回显给用户 */
  dashed: string
  /** 再去掉连字符并转小写：用于中文词、楼栋名与名称特征的子串匹配 */
  compact: string
}

/** 视觉问法里要动哪块区域：登记裂缝区 / 完好墙面 / 把变化区域放大。 */
export type VisualAction = 'crack' | 'control' | 'zoom'

/** 抽取到的线索。全部是"问句里提到了什么"，不是"档案里有没有"。 */
export interface QuestionEntities {
  floorNumber?: number | null
  pointCode: string | null
  eventNo: string | null
  /** 楼栋强引用：`B03` 或 `3号教学楼` 这类明确指向某一栋的写法 */
  buildingRefs: string[]
  /** 指标线索：裂缝 / 倾角 / 振动 / 温湿度 / 人工检查 */
  metric: MetricKey | null
  /** 视觉问法要动的区域；不是视觉问法时为 null */
  visualAction: VisualAction | null
}

const FULL_WIDTH = /[\uFF01-\uFF5E]/g
const PUNCT = /[\s，。、；：？！""''〈〉《》【】（）()[\]]/g

/** 全角转半角、去空白与标点；`compact` 额外去连字符并转小写。 */
export function normalizeQuestion(raw: string): NormalizedQuestion {
  const half = raw.replace(FULL_WIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  const dashed = half.replace(PUNCT, '')
  return { dashed, compact: dashed.toLowerCase().replace(/-/g, '') }
}

const METRIC_WORDS: { words: string[]; metric: MetricKey }[] = [
  { words: ['裂缝', '开合'], metric: 'crack_width' },
  { words: ['倾角', '倾斜'], metric: 'tilt_xy' },
  { words: ['振动', '震动', '加速度', '楼板'], metric: 'vibration' },
  { words: ['温湿度', '温度', '湿度'], metric: 'temp_humidity' },
  { words: ['人工检查', '人工巡检'], metric: 'inspection' },
]

const WHY_WORDS = ['为什么', '为何', '原因', '怎么会', '咋回事', '怎么触发', '凭什么']
const UNHANDLED_WORDS = ['待处理', '未处理', '没处理', '还没处理', '待办', '未关闭', '没关闭', '未处置']
const ALARM_WORDS = ['预警', '告警', '报警', '事件']
const CAMPUS_WORDS = ['全校', '校区', '校园', '整体', '总体', '全局', '所有楼栋', '全部楼栋']
/** 概况类词：比 `全校` 弱一档，必须确认问句里没在说某个具体测点才按全校处理 */
const OVERVIEW_WORDS = ['概况', '总览', '汇总', '监测情况', '整体情况', '总体情况']
const POINT_WORDS = ['测点', '点位', '传感器', '设备', '探头', '监测点']
const MEDIA_WORDS = ['照片', '图片', '影像', '摄像头', '视频', '短片', '拍照']
const GUIDE_WORDS = ['带我演示', '带我看处理流程', '演示处理流程', '演示处置流程', '下一步怎么办', '处理到哪', '处置进度', '维修进度', '工单进度', '办理到哪', '还缺什么', '打开完整处置报告']
/**
 * 指代词：`它怎么样` `这条呢` 这类追问。
 * 它们本身定位不到任何对象，只能沿用界面上已明确选定的点位或事件上下文 ——
 * 没有上下文时按"没线索"处理，不猜。
 */
const FOLLOW_UP_WORDS = ['它', '他', '这条', '那条', '该测点', '该点位', '该设备', '这个', '刚才那个', '上面那个']

/**
 * 视觉证据联动的词表（方案 §34/§36）。
 * 刻意都要求"两三个词同时出现"才成立：单独一个"变化"或"墙"太容易在别的问法里误触发。
 */
const RECOVERY_WORDS = ['恢复', '回落', '降下来', '回到正常', '回到安全']
const VISUAL_WORDS = ['变化', '变了', '差异']
const EVIDENCE_WORDS = ['证据']
const WALL_WORDS = ['墙', '墙面', '外墙']
const DATA_WORDS = ['数据', '读数', '数值']
const ZOOM_WORDS = ['放大', '看清楚', '看仔细', '拉近']
const CONTROL_WORDS = ['完好', '没裂', '没有裂缝', '完整墙面', '其他区域', '其他墙面', '别的区域']
const CRACK_REGION_WORDS = ['裂缝区域', '裂缝那块', '裂缝的地方', '裂缝位置', '框裂缝']
const SPATIAL_WORDS = ['3d', '三维', '空间模型', '楼层模型']
const GO_WORDS = ['带我到', '带我去', '带我', '看位置', '在哪', '定位', '看看位置']

/** 业务编号一律大小写不敏感：用户写 b03 或 B03 都是同一个点。 */
const POINT_CODE = /[a-z]{1,4}\d{1,4}(?:-[a-z0-9]+)+/gi
const EVENT_NO = /e\d{8}-\d{3}/gi
const BUILDING_CODE = /(?:^|[^A-Za-z0-9-])b\d{2}(?![0-9])/gi
/** `3号教学楼` `1号综合楼` 这类中文楼栋引用；号后面最多再跟 4 个字，避免把整句吞进来 */
const BUILDING_NAME = /\d{1,2}号[^0-9]{0,4}/g

function has(words: string[], text: string): boolean {
  return words.some((word) => text.includes(word))
}

/** 问句里有没有明确指向某个测点 / 楼栋 / 指标的线索。 */
export function hasPointClue(entities: QuestionEntities): boolean {
  return entities.pointCode !== null || entities.buildingRefs.length > 0 || entities.metric !== null || entities.floorNumber != null
}

function firstMatch(pattern: RegExp, text: string): string | null {
  const found = text.match(pattern)
  return found === null || found.length === 0 ? null : found[0]
}

/** 按词表判定指标；同时命中多个时取词表顺序里的第一个（裂缝 > 倾角 > 振动 > 温湿度 > 人工检查）。 */
function metricOf(text: string): MetricKey | null {
  for (const row of METRIC_WORDS) {
    if (has(row.words, text)) return row.metric
  }
  return null
}

/** 从问句里抽出编号与楼栋引用。 */
export function extractEntities(q: NormalizedQuestion): QuestionEntities {
  const eventNo = firstMatch(EVENT_NO, q.dashed)
  const matchedCode = firstMatch(POINT_CODE, q.dashed)
  const pointCode = matchedCode?.toLowerCase() === eventNo?.toLowerCase() ? null : matchedCode
  const buildingRefs: string[] = []
  if (pointCode !== null) buildingRefs.push(pointCode.split('-')[0])
  for (const match of q.dashed.matchAll(BUILDING_CODE)) {
    const token = match[0].replace(/[^A-Za-z0-9]/g, '')
    if (token !== '' && !buildingRefs.includes(token)) buildingRefs.push(token)
  }
  for (const match of q.compact.matchAll(BUILDING_NAME)) {
    if (!buildingRefs.includes(match[0])) buildingRefs.push(match[0])
  }
  return {
    pointCode,
    floorNumber: floorNumber(q.dashed),
    eventNo,
    buildingRefs,
    metric: metricOf(q.compact),
    visualAction: visualActionOf(q),
  }
}

/** 视觉问法要动哪块区域：先认"放大"，再认"完好墙面"，最后是明确点名的裂缝区域。 */
function visualActionOf(q: NormalizedQuestion): VisualAction | null {
  const text = q.compact
  if (has(ZOOM_WORDS, text) && !/趋势|曲线|走势图/.test(text)) return 'zoom'
  if (has(CONTROL_WORDS, text) && has([...VISUAL_WORDS, '照片', '影像', '对比'], text)) return 'control'
  if (has(CRACK_REGION_WORDS, text)) return 'crack'
  return null
}

/** 读数恢复没有：问的是恢复这件事，不是影像，也不是原因。 */
function wantsRecovery(q: NormalizedQuestion): boolean {
  if (!has(RECOVERY_WORDS, q.compact)) return false
  return !has(MEDIA_WORDS, q.compact) && !has(WHY_WORDS, q.compact)
}

/** 带我到 3D 看位置：要同时出现空间词与"去看"的说法，避免把"3D 是什么"也吞进来。 */
function wantsSpatial(q: NormalizedQuestion): boolean {
  return has(SPATIAL_WORDS, q.compact) && has(GO_WORDS, q.compact)
    || /它在哪|帮我定位|定位(?:这个|该|b\d)/.test(q.compact)
}

/**
 * 视觉证据同屏：问的是"这面墙/这条裂缝有什么变化"或"给我看数据和照片"。
 * 含照片/影像的问法若没提数据，仍然按原来的影像问法走（那套回答更专）。
 */
function wantsVisualEvidence(q: NormalizedQuestion, entities: QuestionEntities): boolean {
  const text = q.compact
  if (entities.visualAction !== null) return true
  if (has(EVIDENCE_WORDS, text) && !has(WHY_WORDS, text)) return true
  if (has(MEDIA_WORDS, text) && has(DATA_WORDS, text)) return true
  if (has(VISUAL_WORDS, text) && (has(WALL_WORDS, text) || entities.metric === 'crack_width')) return true
  return false
}

/**
 * 意图分类。顺序固定，每一步都写清楚为什么排在前面：
 * 影像 → 全校 → 概况类弱词 → 追因 → 未处置队列 → 单测点 → 指代追问。
 */
export function parseIntent(q: NormalizedQuestion, entities: QuestionEntities): AskIntent {
  const feature = featureIntent(q.dashed)
  if (feature !== null) return feature
  const specific = specificIntent(q.compact)
  if (specific !== null) return specific
  if (isPrepareRedDemoCommand(q, entities)) return 'demo_command'
  if (has(GUIDE_WORDS, q.compact)) return 'demo_guide'
  /*
   * 视觉联动四类问法排在影像问法之前：它们里有几条也含"照片/影像"字样，
   * 但问的是"这个测点的数值与图像证据放在一起看"，比单看影像走得更深一层。
   */
  if (wantsRecovery(q)) return 'reading_recovery'
  if (wantsSpatial(q)) return 'spatial_go'
  if (/视频|关键帧|短片/.test(q.compact)) return 'video_compare'
  if (entities.visualAction !== null) return 'visual_region'
  if (wantsVisualEvidence(q, entities)) return 'visual_evidence'
  if (has(MEDIA_WORDS, q.compact)) return 'media_compare'
  if (has(CAMPUS_WORDS, q.compact)) return 'campus_overview'
  // 「监测情况」这类弱词只在确认没在说具体测点时才算全校，否则会被追问问句误吞
  if (!hasPointClue(entities) && !has(POINT_WORDS, q.compact) && has(OVERVIEW_WORDS, q.compact)) {
    return 'campus_overview'
  }
  // 追因优先于其它：`3号教学楼裂缝测点为什么红了` 问的是原因，不是这条测点本身
  if (has(WHY_WORDS, q.compact) || entities.eventNo !== null) return 'event_reason'
  if (!hasPointClue(entities) && /哪个|哪些|列出|所有/.test(q.compact) && /异常/.test(q.compact) && has(POINT_WORDS, q.compact)) return 'open_events'
  if (has(UNHANDLED_WORDS, q.compact) && has(ALARM_WORDS, q.compact)) return 'open_events'
  if (has(POINT_WORDS, q.compact) || hasPointClue(entities)) return 'point_status'
  if (has(FOLLOW_UP_WORDS, q.compact)) return 'point_status'
  return 'unknown'
}

/** 只认明确的演示请求；询问做法、否定句或普通预警查询都不能打开写入入口。 */
export function isPrepareRedDemoCommand(q: NormalizedQuestion, entities: QuestionEntities): boolean {
  const text = q.compact
  if (entities.pointCode !== null || entities.buildingRefs.length > 0) return false
  if (has(['不要', '别', '取消', '怎么', '如何', '为什么', '能否', '可以吗', '另一个', '其他', '其它', '指定'], text)) return false
  return has(['准备', '载入', '生成', '模拟', '一键'], text)
    && has(['红色预警', '红色告警', '红色报警'], text)
    && has(['演示', '现场处置', '演示数据'], text)
}

const WRITE_WORDS = ['准备', '载入', '生成', '造一条', '来一条', '写入', '模拟']
const DEMO_WORDS = ['演示', '红色', '预警', '数据']

/**
 * 是不是"会改本地演示数据"的指令（例如 `准备一次红色预警演示`）。
 *
 * 识别它只为了**说清楚**：这类指令在本步一律不执行，
 * 由答案明确告知需要人工确认，避免用户以为说一句话就把库改了。
 */
export function looksLikeWriteCommand(q: NormalizedQuestion): boolean {
  if (existingOnly(q.compact) || /为什么|如何|怎么|能否|能不能/.test(q.compact)) return false
  return has(WRITE_WORDS, q.compact) && has(DEMO_WORDS, q.compact)
}
