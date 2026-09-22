/**
 * 「筑瞳 Demo 演示预警规则 V1.0」初始化数据。
 *
 * 数值来源：项目组提供的演示预警标准。用于验证监测数据录入、预警分级、通知派单和维修闭环，
 * 不作为建筑安全鉴定结论，也不得在页面上写成国家建筑安全标准或建筑危险极限。
 *
 * 与方案 §13.1 一致：裂缝按相对基准变化量分级，倾角双轴分别比较取较大方向，
 * 振动按 1 秒窗口动态加速度 RMS 绝对判定，温湿度只生成环境提醒。
 */
import type { MonitoringRule } from '@/types/rules'
import { fromLocalInput } from '@/core/time'

export const RULE_VERSION = 'V1.0'
export const RULE_SOURCE = '筑瞳 Demo 演示预警规则 V1.0'

const RULE_SCOPE_BUILDINGS = ['bld_b03']
const RULE_SCOPE_POINTS: Record<string, string[]> = {
  crack_width: ['pnt_b03_f2_crack01'],
  tilt_xy: ['pnt_b03_f2_tilt01'],
  vibration: ['pnt_b03_f2_vib01'],
  environment: ['pnt_b03_f2_th01'],
}

/** 三条结构规则的持续异常条件相同：至少 3 条有效记录、跨度不少于 10 分钟、相邻间隔不超过 5 分钟。 */
const PERSISTENCE = { minRecords: 3, minSpanMinutes: 10, maxGapMinutes: 5, level: 'orange' as const }
/** 恢复条件：连续 3 条低于黄色阈值的 80%，只标为恢复待确认，不自动关闭。 */
/** minSpanMinutes=0：按项目组提供的演示标准只要求连续条数；方案 §13.1 提到的时间覆盖待确认后开启。 */
const RECOVERY = { yellowRatio: 0.8, minRecords: 3, minSpanMinutes: 0 }

function base(metric: MonitoringRule['metric'], code: string, name: string): Omit<MonitoringRule, 'unit' | 'thresholds' | 'baselineSource' | 'note'> {
  /**
   * 生效时间：规则初始化时间，显著早于全部演示数据。
   * 一键演示脚本会回溯十余天写入数据，规则生效日必须早于该窗口，
   * 否则脚本前几条会因"规则尚未生效"而判不出结果。
   */
  const at = fromLocalInput('2026-08-01T00:00')
  const ruleId = `rule_${code.toLowerCase().replace(/-/g, '_')}`
  return {
    id: `${ruleId}@${RULE_VERSION}`,
    ruleId,
    code,
    name,
    buildingIds: RULE_SCOPE_BUILDINGS,
    pointIds: RULE_SCOPE_POINTS[metric] ?? [],
    metric,
    fixedBaseline: null,
    rateThreshold: null,
    rateLevel: 'orange',
    persistence: { ...PERSISTENCE },
    recovery: { ...RECOVERY },
    environment: null,
    version: RULE_VERSION,
    enabled: true,
    source: RULE_SOURCE,
    confirmedBy: '学校安全管理人员',
    effectiveFrom: at,
    createdAt: at,
    createdBy: '演示规则初始化',
    updatedAt: at,
    updatedBy: '演示规则初始化',
  }
}

export function seedRules(): MonitoringRule[] {
  return [
    {
      ...base('crack_width', 'RULE-CRACK-001', '裂缝宽度变化分级规则'),
      unit: 'mm',
      baselineSource: 'point',
      thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
      // 裂缝变化速率达到 0.10 mm/h 生成橙色趋势提醒
      rateThreshold: 0.1,
      rateLevel: 'orange',
      note:
        '判定值 = 当前裂缝宽度 − 当前有效基准宽度，取绝对值。本规则用于验证录入、分级与闭环流程，' +
        '不是建筑安全限值；现场阈值须由结构专业人员按建筑类型、结构状态与设计要求核定。',
    },
    {
      ...base('tilt_xy', 'RULE-TILT-001', '倾角变化分级规则'),
      unit: '°',
      baselineSource: 'point',
      thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
      note:
        'X、Y 轴分别与基准比较，取绝对值较大的方向作为判定依据。本规则只反映测点姿态相对基准的变化，' +
        '不把测点角度换算为整栋建筑的倾斜结论。倾角变化速率阈值：未配置，待结构专业人员确认，' +
        '当前不判速率；演示只展示裂缝变化速率规则。',
    },
    {
      ...base('vibration', 'RULE-VIB-001', '楼板振动分级规则'),
      unit: 'm/s²',
      baselineSource: 'none',
      thresholds: { yellow: 0.05, orange: 0.1, red: 0.2 },
      note:
        '统计窗口 1 秒，以动态加速度有效值 RMS 作为判定指标，绝对判定不设相对基准。' +
        '没有真实原始采样时只展示有效值与峰值，不生成真实振动波形。',
    },
    {
      ...base('environment', 'RULE-ENV-001', '温湿度环境提醒规则'),
      unit: '℃ / %RH',
      baselineSource: 'none',
      thresholds: null,
      environment: { tempMin: 5, tempMax: 35, humidityMax: 80, persistenceRecords: 3 },
      note:
        '温度低于 5℃ 或高于 35℃、相对湿度高于 80% 生成环境提醒；连续 3 条越限生成环境复核任务。' +
        '温湿度异常用于辅助判断墙体和设备环境，不单独作为结构危险结论，也不会生成结构红色预警。',
    },
  ]
}
