/**
 * 模块演示场景目录。
 *
 * 每个场景 = 一次"按固定剧本调用既有业务写入口"的载入动作，因此事件、证据链、升级、通知、
 * 工单流转、复查轮次、保养任务全部由规则判定真实生成，**不是预置结果**。
 * 这里只放展示与口径所需的元数据；真正跑数据的实现在 `src/stores/writes/demo/`。
 */
export const DEMO_SCENARIO_KEYS = [
  'campus',
  'records',
  'trend',
  'alarm',
  'alarmVib',
  'envAlarm',
  'inspection',
  'issuePool',
  'workOrders',
  'recheck',
  'maintenance',
  'reports',
  'liveResponse',
  'mediaEvidence',
  'coverage',
] as const

export type DemoScenarioKey = (typeof DEMO_SCENARIO_KEYS)[number]

/** 全链入口的按钮文案（设置页与说明文案共用一份，避免两处不一致）。 */
export const FULL_CHAIN_LABEL = '一键载入全链演示数据'

export interface DemoScenarioIntro {
  /** 生成什么 */
  generates: string
  /** 走哪些业务规则 */
  rules: string
  /** 幂等与隔离口径 */
  idempotent: string
  /** 边界与诚实标注 */
  boundaries: string
}

export interface DemoScenarioMeta {
  key: DemoScenarioKey
  title: string
  /** 载入后自动定位到的页面 */
  path: string
  /** 定位到的对象（写清是什么编号/哪一条） */
  anchor: string
  /** 预期数字：既是展示口径，也是验收口径 */
  expected: string
  intro: DemoScenarioIntro
}

const IDEMPOTENT_COMMON =
  '重复点击按业务键幂等：记录按"测点 + 采样时刻"、任务按"计划@执行时刻"主键、附件按草稿主键；已存在的行只跳过、不改写。'
  + '只写本场景自己键下的行，不清库、不删除、不改写任何手工录入的数据。'

export const DEMO_SCENARIOS: DemoScenarioMeta[] = [
  {
    key: 'coverage', title: '数据全面化补齐', path: '/dashboard',
    anchor: 'B03-F3-CRACK01 待处理红色事件 / B03-F3-CRACK02 历史闭环案例',
    expected: '附加传感器测点 5 个；独立待处理红色事件、完整已关闭案例、已完成巡检与巡检来源问题、已派工待接单、质量与过期样例',
    intro: {
      generates: '补充不同楼栋与楼层的临时测点、传感器数据与状态案例，统一由设置页既有入口生成。',
      rules: '预警、巡检、审核、维修、验收、复查和关闭复用原业务入口；历史案例的时间轴为预设测试值，并明确留痕。',
      idempotent: IDEMPOTENT_COMMON,
      boundaries: '当前待处理与历史已完成案例分属不同测点；不扩展墙体照片对、不修改人工检查点、不证明真实设备上报或真实 NFC 到场。',
    },
  },
  {
    key: 'campus',
    title: '示例校区建档',
    path: '/',
    anchor: '校园地图上的 3 号教学楼（实测建档）',
    expected: '在册楼栋 4 · 楼层 8 · 测点 8（4 传感器 + 4 人工检查点）· 设备 4 · 基准 2',
    intro: {
      generates: '只在建档层为空时重建示例校区；已有建档数据时不动。',
      rules: '建档走仓储的正常写入路径，归档字段与审计日志一并写入。',
      idempotent: '建档层非空即跳过，不会覆盖你手工改过的楼栋/测点/设备档案。',
      boundaries:
        '校区与楼栋档案字段是明确标识的虚构占位资料；只有 3 号教学楼二层的测点位置与录入数据是现场实测。设备健康状态为人工登记，未接入自动心跳。',
    },
  },
  {
    key: 'records',
    title: '监测数据（裂缝主链）',
    path: '/monitor',
    anchor: '记录表里 0.82 mm 那条（红色阶段）',
    expected: '新增 8 条记录；1 个事件、3 条证据、2 次升级（黄 → 橙 → 红）、7 条通知',
    intro: {
      generates: '8 条裂缝记录：0.52 → 0.62 → 0.73 → 0.82 mm，维修后三条复测 0.54 / 0.53 / 0.53，复查 0.53。',
      rules:
        '判定值 = 宽度 − 基准 0.50 mm 的绝对值，按 0.10 / 0.20 / 0.30 mm 分黄橙红；持续异常与速率规则同时生效。',
      idempotent: IDEMPOTENT_COMMON,
      boundaries:
        '采样时间按剧本落在过去，因此每条都标注为历史补录，不伪装成实时预警；倾角不换算整栋倾斜结论。',
    },
  },
  {
    key: 'trend',
    title: '监测趋势（补其他测点）',
    path: '/trend',
    anchor: '趋势图上的 B03-F2-CRACK01，时间窗切到近 30 天',
    expected: '新增 6 条：倾角 0.04 → 0.06 → 0.08（逼近黄阈值未越限）、温湿度 3 条正常；两者均不生成事件',
    intro: {
      generates: '倾角与温湿度各 3 条，与裂缝主链拼成跨两周的多指标趋势。',
      rules:
        '倾角按双轴取较大方向与基准比较；温湿度只做环境辅助，不单独作为结构结论。',
      idempotent: IDEMPOTENT_COMMON,
      boundaries:
        '本场景的补值全部低于各自阈值，所以**不会**生成新事件（恢复态在没有未关闭事件时也不会凭空建单）。'
        + '振动曲线随「振动预警事件」场景写入，不在这里重复写 —— 它的持续异常判定要求末尾几条都是越限记录。',
    },
  },
  {
    key: 'alarm',
    title: '预警事件（工单验收后关闭）',
    path: '/alarms',
    anchor: '预警中心里那个红色事件，展开证据链',
    expected: '事件 1 条（红级）、证据 3 条、升级 2 次、通知 7 条；确认后状态从"待确认"变"处理中"',
    intro: {
      generates: '依赖裂缝主链生成的事件；本场景确认事件，并可模拟"未确认通知超时升级"。',
      rules: '首次越限建单，同点同规则未关闭只追加证据；等级上升才记升级并补发通知。',
      idempotent: '事件按"同测点同规则未关闭"归并，重复载入不会重复建单。',
      boundaries:
        '若该事件已被关闭（例如演示过一遍关闭流程），本场景会如实提示"已关闭"而不伪造新事件；'
        + '要重新演示升级过程，请到系统设置清空本机数据，再用唯一入口载入全链演示数据。超时升级是**演示模拟**，真实系统按黄 30 分钟 / 橙 10 分钟 / 红 5 分钟判定。',
    },
  },
  {
    key: 'alarmVib',
    title: '振动预警事件（现场核查无需维修后关闭）',
    path: '/alarms',
    anchor: '预警中心里的振动事件（第二条关闭路径）',
    expected: '事件 1 条：单条越限转黄 → 连续 3 条越限转橙 → 3 条恢复待确认 → 现场核查结论关闭',
    intro: {
    generates: '振动 7 条：一条低于阈值的基线记录，接 0.052 / 0.058 / 0.061 m/s²（间隔 5 分钟），再接 0.038 / 0.036 / 0.034，整段落在最近两天。',
    rules:
      '振动绝对判定（黄 0.05 / 橙 0.10 / 红 0.20 m/s²），并命中持续异常条件（连续 3 条越限且覆盖 ≥10 分钟）升为橙色。',
    idempotent: IDEMPOTENT_COMMON,
    boundaries:
      '这条链演示的是**第二种关闭依据**（现场核查无需维修），与裂缝链条的"工单验收通过后关闭"互补；'
      + '现场核查结论必须写满 10 个字才被接受，系统不会替人下结论。整段锚在最近两天，'
      + '是为了落在示例校区自带的两条固定日期振动记录之后 —— 持续异常只看按时间排序的末尾几条。',
    },
  },
  {
    key: 'envAlarm',
    title: '温湿度环境提醒（第二类通知）',
    path: '/alarms',
    anchor: '预警提醒里的环境类提醒条目',
    expected: '温湿度 3 条连续越限 → 环境提醒 1 条 + 站内提醒若干；**不产生结构红色预警**',
    intro: {
      generates: '温湿度 3 条：36.2 / 36.8 / 37.1℃、湿度 82 / 84 / 86%RH（间隔 5 分钟），整段落在最近一天。',
      rules:
        '温度高于 35℃ 或湿度高于 80%RH 生成环境提醒；连续 3 条越限升为环境复核任务。'
        + '温湿度只用于辅助判断墙体和设备环境，**不单独作为结构危险结论**。',
      idempotent: IDEMPOTENT_COMMON,
      boundaries:
        '这条链专门给预警提醒补充"另一类"通知，并当面演示"环境异常不会生成结构红色预警"；'
        + '它锚在最近一天，保证落在示例校区自带的两条固定日期温湿度记录之后。',
    },
  },
  {
    key: 'inspection',
    title: '点检巡检（含 NFC 模拟签到）',
    path: '/inspection',
    anchor: '今日任务，展开后高亮已到点待检查的那个测点',
    expected: '巡检计划 1 条（PLAN-今天-001）· 今日任务 1 条（TK-今天-001）· 4 个必查点中 1 个"已到点待检查"、3 个"待到点"',
    intro: {
      generates: '建一条"3 号教学楼二层日常巡检"计划，生成今日任务，并对裂缝测点做一次模拟签到。',
      rules: '任务按"计划 + 执行时刻"业务键幂等生成；到点与检查是两步，到点不等于完成。',
      idempotent: '重复点击提示"新生成 0 条，已存在 1 条"；已到点的点位不会回退。',
      boundaries:
        'NFC 是**输入标签号 + 校验位模拟**，未接入真实读卡硬件；标签编号与测点编号一致（NFC-B03-F2-CRACK01），方便现场核对。',
    },
  },
  {
    key: 'issuePool',
    title: '问题池（六类审核出口全覆盖）',
    path: '/issues',
    anchor: '问题列表，展开"待审核"那条并高亮状态',
    expected: '6 条问题分别停在六类审核出口对应的状态；其中 1 条由预警事件转入',
    intro: {
      generates:
        '六条问题各走一个审核出口：转维修工单、转专业排查、安排复查、退回补充、关联既有对象、无需处理并关闭。',
      rules:
        '出口与目标状态一一对应，不做自由跳转；审核意见 ≥4 字，涉及"无需处理/转排查/退回补充"的出口 ≥10 字；'
        + '"无需处理 + 已当场处理"必须有照片或写满 10 字的免照片理由。',
      idempotent: '人工上报按"来源:地点:异常类型:十分钟时间桶"自动归并，重复提交会提示"已关联现有问题"。',
      boundaries: '问题来源如实标注（传感器预警 / 人工上报 / 巡检发现 / 保养发现），不把手工上报写成传感器发现。',
    },
  },
  {
    key: 'workOrders',
    title: '工单闭环（含验收退回）',
    path: '/issues',
    anchor: '工单面板，展开"处理中"那张并高亮完工照片',
    expected: '工单 5 张：待派工 / 处理中 / 待验收 / 验收退回 / 已验收通过',
    intro: {
      generates: '从问题审核转出的工单，覆盖派工、接单、提交完工（措施 + 材料 + 完工照片）、验收通过、验收退回。',
      rules:
        '派工限学校安全管理人员且必须指定人；接单限维修/物业且接单人须等于被派工人（物业代接必须写原因）；'
        + '验收限学校安全管理人员，退回必须写原因；验收通过后问题进入待复查，**不会自动关闭**。',
      idempotent: '转维修前先判断该问题名下是否已有工单，重复载入不会堆出第二张工单。',
      boundaries:
        '完工与验收照片由**合成图片文件**送入应用的照片处理流程（校验文件头、压缩、入库），'
        + '未经操作系统文件选择框；照片与工单状态、问题状态、时间线、审计日志在同一事务里提交。',
    },
  },
  {
    key: 'recheck',
    title: '复查与观察期（三种结论）',
    path: '/issues',
    anchor: '问题列表，展开"复查逾期"那条',
    expected: '复查轮次 3 条：逾期 1 天 / 继续观察（自动开下一轮）/ 复发转处置',
    intro: {
      generates: '三条待复查问题分别登记复查，并给出三种结论中的一种。',
      rules:
        '登记复查必须齐"事项 / 责任人 / 目标日期"；"继续观察"必须写下一次目标日期并自动开下一轮；'
        + '"复发转处置"把问题送回待审核。',
      idempotent: '同一轮没有结论前不允许重复登记，重复载入不会堆轮次。',
      boundaries:
        '**系统不替人下结论**：逾期只进待办并显示天数，不会自动关闭问题、不会自动升级预警。',
    },
  },
  {
    key: 'maintenance',
    title: '设备保养（台账 / 日历 / 逾期 / 异常转问题）',
    path: '/maintenance',
    anchor: '保养台账，定位到裂缝位移探头并高亮下次保养日期',
    expected: '计划 1 条（MP-今天-001）· 任务 3 条（今日待执行 / 已完成 / 已逾期）· 异常转问题 1 条',
    intro: {
      generates: '建保养计划（裂缝位移探头，周期每日），生成今日任务，另生成昨天（已执行完成）、前天（异常转问题）与大前天（逾期）各一条。',
      rules:
        '任务按"计划 + 执行时刻"主键幂等；执行人须等于计划负责人；有异常项必须写描述，且**不生成任何结构预警事件**。',
      idempotent: '同一计划同一执行时刻只有一条任务，重复点击提示"已存在 N 条"。',
      boundaries:
        '保养逾期单独分区，不与结构预警混成一类；保养发现的异常只留痕或转问题，来源记"保养发现"。',
    },
  },
  {
    key: 'reports',
    title: '管理报表（指标 / 暂无数据 / 导出 / 处置报告）',
    path: '/reports',
    anchor: '报表页事件表，点「处置报告」看单事件一页',
    expected: '三项指标各带定义、分子、分母、时间范围与不纳入条件；分母为 0 时显示"暂无数据"而不是 0%',
    intro: {
      generates: '不写入数据，只把口径与出口演示到位：指标卡、无数据区间、四类 CSV 导出、单事件处置报告。',
      rules: '分母为 0 显示"暂无数据"；样本编号与"去处理"状态按口径不纳入统计。',
      idempotent: '只读操作，不改变任何数据。',
      boundaries:
        '把时间范围切到没有数据的区间即可看到"暂无数据"；CSV 用 Excel 打开与打印对话框需要人工确认，自动化只能核页面文字与文件字节。',
    },
  },
  {
    key: 'liveResponse',
    title: '红色预警现场处置',
    path: '/alarms',
    anchor: '红色待确认事件；点弹窗“查看并处置”后打开事件详情',
    expected: '4 条历史补录 → 黄/橙/红证据 3 条、升级 2 次、通知 7 条；事件停在待确认，问题与工单由现场操作',
    intro: {
      generates: '只写裂缝测点前四条演示记录，按现有规则形成红色事件并弹出站内强提醒。',
      rules: '确认事件、转问题、审核、派工、维修、验收、复查均由演示者随后在原工作台操作。',
      idempotent: '相同采样时刻仅复用本场景记录；遇到人工记录或已处置事件即停止并提示，不覆盖原有数据。',
      boundaries: '读数采样于过去，标记为历史补录；站内提醒仅在本次会话展示，不代表短信或电话送达。疑似结构问题须先转专业排查。',
    },
  },
  {
    key: 'mediaEvidence',
    title: '视觉证据素材（照片与视频）',
    path: '/media',
    anchor: '关联到当前数据集的裂缝测点（有多个时只关联第一个，并在结果里说明）',
    expected: '写出 0 行业务数据；只登记素材就绪与测点锚点；照片与视频在明确分析任务时按需读取',
    intro: {
      generates: '只登记"视觉证据素材已就绪"，**不写任何业务数据、不新建库表**。',
      rules: '素材是随包的公开实拍原图与其"同底图模拟变化"派生图；差异比例在提问时由实际像素计算。',
      idempotent: '重复点击只重写登记（含测点锚点），不产生重复数据；数据集重置或测点被删后自动判为失效。',
      boundaries: '演示链接：基于实拍素材的变化演示，非真实连续拍摄；原图非本校。像素差异不能单独证明裂缝增长，照片不给毫米量值，也不自动生成预警。',
    },
  },
]

/** 页面路径 → 该页面右上角展示的场景。 */
export const PAGE_SCENARIOS: { path: string; key: DemoScenarioKey }[] = [
  { path: '/', key: 'campus' },
  { path: '/campus', key: 'campus' },
  { path: '/monitor', key: 'records' },
  { path: '/trend', key: 'trend' },
  { path: '/alarms', key: 'alarm' },
  { path: '/inspection', key: 'inspection' },
  { path: '/issues', key: 'issuePool' },
  { path: '/maintenance', key: 'maintenance' },
  { path: '/reports', key: 'reports' },
]

export function scenarioMeta(key: DemoScenarioKey): DemoScenarioMeta {
  const found = DEMO_SCENARIOS.find((row) => row.key === key)
  if (found === undefined) throw new Error(`未知的演示场景：${key}`)
  return found
}
