/** 影像页随包提供的临时素材；点击后才读取并加入当前会话，不写数据库。 */
export interface DemoPhoto {
  key: 'before' | 'after'
  path: string
  fileName: string
  label: string
  capturedAt: string
  mimeType: 'image/png' | 'image/jpeg'
}

export const DEMO_PHOTOS: DemoPhoto[] = [
  {
    key: 'before',
    path: '/demo-media/corridor-crack-before.png',
    fileName: 'corridor-crack-before.png',
    label: '生成演示图｜走廊墙面前一张（模拟日期）',
    capturedAt: '2026-09-14T09:00:00+08:00',
    mimeType: 'image/png',
  },
  {
    key: 'after',
    path: '/demo-media/corridor-crack-after.png',
    fileName: 'corridor-crack-after.png',
    label: '生成演示图｜走廊墙面后一张（模拟日期）',
    capturedAt: '2026-09-21T09:00:00+08:00',
    mimeType: 'image/png',
  },
]

/** CC0 公开实拍只供查看，不混入同机位的演示前后对比。 */
export const PUBLIC_CRACK_REFERENCE = {
  path: '/demo-media/commons-crack-example.jpg',
  fileName: 'commons-crack-example.jpg',
  label: '公开实拍参考图｜建筑外墙裂缝（非本校；时间为载入时间）',
  mimeType: 'image/jpeg',
  source: 'https://commons.wikimedia.org/wiki/File:A_crack_in_the_facade_of_a_small_building_left_during_construction,_Yonge_and_Bloor,_2018_01_31_-b_(40018872431).jpg',
  author: 'booledozer',
  license: 'CC0 1.0',
}

/** 归一化框选区域（原点左上），与 `core/media/compare.ts` 的 `Region` 同一口径。 */
export interface DemoRegion {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 这组演示素材的**示范框选区域**：演示动线、界面提示与素材回归测试共用这一份口径，
 * 避免三处各写一套数字。两张图只有 `crack` 那一块发生了变化。
 */
export const DEMO_COMPARE_REGIONS: { crack: DemoRegion; control: DemoRegion } = {
  /** 裂缝所在的一条竖向区域：框这里应得到「疑似变化」 */
  crack: { x: 0.54, y: 0.45, w: 0.12, h: 0.38 },
  /** 左侧完好的墙面：框这里应得到「未见明显差异」 */
  control: { x: 0.06, y: 0.15, w: 0.2, h: 0.3 },
}

/**
 * 小瞳视觉证据的**演示素材对**：公开实拍原图 + 一张同底图、同裁切、局部裂缝加宽的模拟变化图。
 *
 * 口径（写进界面与回答，不许省）：
 * - 两张同底图同尺寸同裁切，只有**登记区域内的裂缝**被加宽变深，控制区域未修改；
 * - 这不是真实连续拍摄的两个时刻，是**基于实拍素材的变化演示**；
 * - 原图是公开实拍（非本校），派生图由本工程生成；模拟日期不伪造成真实拍摄时间；
 * - 差异比例一律由**实际像素计算**，不硬编码任何数值。
 *
 * 许可：2026-09-30 已核对 Commons 文件页，CC0 1.0（作者 booledozer，见 PUBLIC_CRACK_REFERENCE.source）。
 * CC0 允许使用、修改与随包分发，无需署名；本工程仍保留来源与作者。
 */
export const DEMO_EVIDENCE_PAIR: DemoPhoto[] = [
  {
    key: 'before',
    path: '/demo-media/commons-crack-example.jpg',
    fileName: 'commons-crack-example.jpg',
    label: '公开实拍原图（非本校，来源日期 2018-01-31）',
    // 仅供排序和演示的展示时间，不能视为来源照片的精确拍摄时间。
    capturedAt: '2018-01-31T12:00:00-05:00',
    mimeType: 'image/jpeg',
  },
  {
    key: 'after',
    path: '/demo-media/commons-crack-evidence-simulated.jpg',
    fileName: 'commons-crack-evidence-simulated.jpg',
    label: '同底图模拟变化（局部裂缝加宽，非真实拍摄）',
    capturedAt: '2026-09-30T09:00:00+08:00',
    mimeType: 'image/jpeg',
  },
]

/** 这一对素材的公共说明：凡是用到它的地方都要一起展示 */
export const DEMO_EVIDENCE_NOTE = '基于实拍素材的变化演示，非真实连续拍摄；修改仅限登记区域内的裂缝。'

/**
 * 登记区域（归一化）：裂缝区是**实际被修改的那一块**，控制区是完好的墙面。
 * 只登记坐标，差异比例由实际图片计算——所以这里没有、也不许出现任何百分比。
 */
export const DEMO_EVIDENCE_REGIONS: { crack: DemoRegion; control: DemoRegion } = {
  /** 裂缝（中段竖直那一段最集中） */
  crack: { x: 0.315, y: 0.32, w: 0.11, h: 0.28 },
  /** 右上角完好砖面：没有裂缝，用来对照"没变的地方不会被说成变了" */
  control: { x: 0.6, y: 0.06, w: 0.2, h: 0.2 },
}
