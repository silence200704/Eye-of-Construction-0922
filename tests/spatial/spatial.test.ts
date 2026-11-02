/**
 * 3D 校园的空间投影纯函数测试。
 *
 * 重点守四件事：① 2D 与 3D 用同一套楼层几何；② 世界坐标与局部坐标严格互逆（否则选中会跑偏）；
 * ③ 缺档楼层、无测点层、归档对象如实呈现，不伪造；④ 深链的 ID 与归属要复核。
 */
import { describe, expect, it } from 'vitest'
import { FLOOR_PLAN, floorLayoutOf, mountOnWall, wallFacesOf, zoneCenter } from '@/core/spatial/layout'
import {
  buildingWorld,
  isInsideBuilding,
  levelY,
  localOf,
  MAX_MOUNT_DISTANCE,
  normalizedOf,
  toLocal,
  toWorld,
} from '@/core/spatial/coordinates'
import { buildCampusModel, locatePoint } from '@/core/spatial/project'
import { parseSpatialQuery, resolveSpatialTarget, spatialQueryOf, stageOf } from '@/core/spatial/selection'
import { buildSpatialLink } from '@/assistant/actions'
import { seedBuildings, seedFloors, seedPoints } from '@/db/seedArchive'
import { B01, B02, B03, F0102, F0202, P_CRACK } from '@/db/seedFactories'

const ZONES = ['走廊', '西教室', '楼梯间', '东教室', '值班室', '工具间', '备用间']

describe('楼层区域布局（2D/3D 共用）', () => {
  it('7 个区域 → 走廊 + 上下两排各三间，楼梯间在上排中间', () => {
    const layout = floorLayoutOf(ZONES)
    expect(layout.rooms).toHaveLength(6)
    expect(layout.zones).toHaveLength(7)
    expect(layout.zones[0].kind).toBe('corridor')
    expect(layout.zones[0].label).toBe('走廊')
    expect(layout.rooms.map((row) => row.label)).toEqual(['西教室', '楼梯间', '东教室', '值班室', '工具间', '备用间'])
    const stairs = layout.rooms.filter((row) => row.stairs)
    expect(stairs).toHaveLength(1)
    expect(stairs[0].label).toBe('楼梯间')
    // 上排房间在走廊之上、下排在其下（与 2D 平面图一致）
    const upper = layout.rooms[0]
    const lower = layout.rooms[3]
    expect(upper.box.y + upper.box.h).toBeLessThanOrEqual(layout.corridor.y)
    expect(lower.box.y).toBeGreaterThanOrEqual(layout.corridor.y + layout.corridor.h)
  })

  it('走廊与房间都落在外轮廓内', () => {
    const layout = floorLayoutOf(ZONES)
    const inside = (box: { x: number; y: number; w: number; h: number }): boolean =>
      box.x >= FLOOR_PLAN.left && box.y >= FLOOR_PLAN.top
      && box.x + box.w <= FLOOR_PLAN.right && box.y + box.h <= FLOOR_PLAN.bottom
    expect(inside(layout.outline)).toBe(true)
    expect(layout.zones.every((row) => inside(row.box))).toBe(true)
  })

  it('区域不足 7 个时按占位名补齐，不凭空多出房间', () => {
    const layout = floorLayoutOf(['走廊'])
    expect(layout.rooms).toHaveLength(6)
    expect(layout.rooms[0].label).toBe('房间1')
    expect(layout.zones[0].label).toBe('走廊')
  })

  it('区域中心落在区域框内', () => {
    const [first] = floorLayoutOf(ZONES).rooms
    const center = zoneCenter(first)
    expect(center.x).toBe(first.box.x + first.box.w / 2)
    expect(center.y).toBe(first.box.y + first.box.h / 2)
  })
})

describe('空间坐标换算', () => {
  const rotated = { x: 0.4, y: 0.55, w: 0.2, h: 0.18, rotate: 37 }
  const plain = { x: 0.2, y: 0.3, w: 0.15, h: 0.22, rotate: 0 }

  it('世界坐标与楼栋局部坐标互逆（含旋转楼栋）', () => {
    for (const footprint of [plain, rotated]) {
      const building = buildingWorld(footprint)
      for (const local of [{ x: 0, z: 0 }, { x: 0.5, z: -0.5 }, { x: -0.25, z: 0.4 }]) {
        const world = toWorld(building, local, levelY(1))
        const back = toLocal(building, world)
        expect(back.x).toBeCloseTo(local.x, 10)
        expect(back.z).toBeCloseTo(local.z, 10)
      }
    }
  })

  it('归一化坐标与楼栋局部坐标互逆，且中心点对齐', () => {
    expect(localOf({ x: 0.5, y: 0.5 })).toEqual({ x: 0, z: 0 })
    const back = normalizedOf(localOf({ x: 0.3, y: 0.8 }))
    expect(back.x).toBeCloseTo(0.3, 10)
    expect(back.y).toBeCloseTo(0.8, 10)
  })

  it('层高单调递增，层号边界可判内外', () => {
    expect(levelY(0)).toBeGreaterThan(0)
    expect(levelY(2)).toBeGreaterThan(levelY(1))
    expect(levelY(1) - levelY(0)).toBeCloseTo(levelY(3) - levelY(2), 10)
    expect(isInsideBuilding({ x: 0.5, z: 0.5 })).toBe(true)
    expect(isInsideBuilding({ x: 0.52, z: 0 })).toBe(true)
    expect(isInsideBuilding({ x: 0.6, z: 0 })).toBe(false)
  })
})

describe('墙面与贴墙安装', () => {
  const layout = floorLayoutOf(ZONES)
  const faces = wallFacesOf(layout)

  it('每个区域给出四条边，法线指向区域内部', () => {
    expect(faces).toHaveLength(layout.zones.length * 4)
    const corridorFaces = faces.filter((row) => row.zoneLabel === '走廊')
    expect(corridorFaces).toHaveLength(4)
    // 走廊上边（y=300）的内法线朝下（内容坐标 y 增大方向）
    const top = corridorFaces.find((row) => row.y1 === FLOOR_PLAN.corridorTop && row.y2 === FLOOR_PLAN.corridorTop)
    expect(top?.ny).toBe(1)
    const bottom = corridorFaces.find((row) => row.y1 === FLOOR_PLAN.corridorBottom && row.y2 === FLOOR_PLAN.corridorBottom)
    expect(bottom?.ny).toBe(-1)
  })

  it('给平面上的点找到最近的可挂载墙面，并算出垂足与距离', () => {
    // 走廊正中：离上下两面墙各走廊半宽，取最近的一面
    const mount = mountOnWall(faces, { x: 500, y: 350 })
    expect(mount).not.toBeNull()
    expect(mount?.distance).toBeCloseTo((FLOOR_PLAN.corridorBottom - FLOOR_PLAN.corridorTop) / 2, 6)
    expect(mount?.inside).toBe(true)
    expect(mount?.withinSpan).toBe(true)
    expect([mount?.face.ny]).toEqual([1])
    expect(mount?.y).toBe(FLOOR_PLAN.corridorTop)
  })

  it('点在墙面上时距离为 0，且仍取"靠它所在一侧"的那面墙', () => {
    const inCorridor = mountOnWall(faces, { x: 500, y: FLOOR_PLAN.corridorTop })
    expect(inCorridor?.distance).toBeCloseTo(0, 6)
    expect(inCorridor?.face.ny).toBe(1)
    // 同样贴着走廊上边这堵墙，但站在上排教室里：应取教室那一侧墙面（法线朝下）
    const inRoom = mountOnWall(faces, { x: 200, y: 250 })
    expect(inRoom?.face.zoneLabel).toBe('西教室')
    expect(inRoom?.face.ny).toBe(-1)
    expect(inRoom?.distance).toBeCloseTo(FLOOR_PLAN.corridorTop - 250, 6)
  })

  it('垂足落在墙段之外时如实标注，不假装命中', () => {
    // 平面左上角外侧：最近的墙段在左轮廓，但垂足落在延长线之外
    const mount = mountOnWall(faces, { x: 1000, y: 0 })
    expect(mount).not.toBeNull()
    expect(mount?.withinSpan).toBe(false)
  })

  it('测点贴墙：B03 二层四个传感器都贴在本层墙面上，且高度按指标取', () => {
    const model = buildCampusModel({
      buildings: seedBuildings(),
      floors: seedFloors(),
      points: seedPoints(),
      eventLevelByPoint: {},
    })
    const b03 = model.buildings.find((row) => row.building.id === B03)
    const second = b03?.levels.find((row) => row.floorNo === 2)
    expect(second?.markers).toHaveLength(4)
    for (const marker of second!.markers) {
      expect(marker.mount, `${marker.point.code} 应贴在某面墙上`).not.toBeNull()
      expect(marker.mount!.zoneLabel).toContain('走廊')
      expect(marker.mount!.distance).toBeLessThan(MAX_MOUNT_DISTANCE)
      expect(marker.mountHeight).toBeGreaterThan(0)
    }
    // 温湿度是房间类仪器（装得高），裂缝计靠近构件根部（装得低）
    const crack = second!.markers.find((row) => row.point.type === 'crack')
    const th = second!.markers.find((row) => row.point.type === 'temp_humidity')
    expect(crack!.mountHeight).toBeLessThan(th!.mountHeight)
  })

  it('离所有墙面都很远的测点不硬按到墙上', () => {
    const [b03] = seedBuildings().filter((row) => row.id === B03)
    const [crack] = seedPoints().filter((row) => row.id === P_CRACK)
    const far = { ...crack, id: 'pnt_far', code: 'B03-F2-FAR', coord: { x: 0.02, y: 0.02 } }
    const model = buildCampusModel({ buildings: [b03], floors: seedFloors(), points: [far] })
    const marker = model.buildings[0].levels.flatMap((row) => row.markers)[0]
    expect(marker.mount).toBeNull()
    expect(marker.mountHeight).toBeGreaterThan(0)
  })
})

describe('校园模型投影（示例校区档案）', () => {  const model = buildCampusModel({
    buildings: seedBuildings(),
    floors: seedFloors(),
    points: seedPoints(),
    eventLevelByPoint: { [P_CRACK]: 'red' },
  })

  it('5 栋楼、13 层已建档楼、9 个测点', () => {
    expect(model.buildings).toHaveLength(5)
    expect(model.builtFloorCount).toBe(13)
    expect(model.buildings.reduce((sum, row) => sum + row.pointCount, 0)).toBe(9)
  })

  it('图书馆是第 5 栋，5 层、仅 1 个人工检查点', () => {
    const library = model.buildings.find((row) => row.building.purpose === '图书馆')
    expect(library?.building.code).toBe('B05')
    expect(library?.levels.map((row) => row.floorNo)).toEqual([1, 2, 3, 4, 5])
    expect(library?.missingFloorNos).toEqual([])
    expect(library?.pointCount).toBe(1)
    expect(library?.levels[0].markers[0].point.type).toBe('manual_check')
  })

  it('B01 / B02 的第二个层已补上，没有未建档占位层', () => {
    const b01 = model.buildings.find((row) => row.building.id === B01)
    const b02 = model.buildings.find((row) => row.building.id === B02)
    expect(b01?.levels.map((row) => row.floorNo)).toEqual([1, 2])
    expect(b02?.levels.map((row) => row.floorNo)).toEqual([1, 2])
    expect(b01?.missingFloorNos).toEqual([])
    expect(b02?.missingFloorNos).toEqual([])
    expect(b01?.levels[1].floor?.id).toBe(F0102)
    expect(b02?.levels[1].floor?.id).toBe(F0202)
  })

  it('B03 三层的四个传感器都在二层，一层只有人工检查点', () => {
    const b03 = model.buildings.find((row) => row.building.id === B03)
    expect(b03?.levels.map((row) => row.floorNo)).toEqual([1, 2, 3])
    const [, second, third] = b03!.levels
    expect(second.markers).toHaveLength(4)
    expect(second.markers.every((row) => row.point.dataSource === 'real')).toBe(true)
    expect(b03!.levels[0].markers).toHaveLength(1)
    expect(b03!.levels[0].markers[0].point.type).toBe('manual_check')
    // 三层如实显示无测点，不伪造
    expect(third.markers).toHaveLength(0)
  })

  it('事件等级取已落库事件，未给等级时是 null（不能读成"在线"）', () => {
    expect(model.buildings.find((row) => row.building.id === B03)?.maxEventLevel).toBe('red')
    expect(model.buildings.find((row) => row.building.id === B01)?.maxEventLevel).toBeNull()
    const crack = locatePoint(model, P_CRACK)
    expect(crack?.marker.eventLevel).toBe('red')
    expect(crack?.level.floorNo).toBe(2)
  })

  it('声明层数大于建档层数时补"未建档"占位层，不造假房间与测点', () => {
    const [b01] = seedBuildings().filter((row) => row.id === B01)
    const patched = buildCampusModel({
      buildings: [{ ...b01, floorCount: 4 }],
      floors: seedFloors().filter((row) => row.buildingId === B01),
      points: [],
    })
    const levels = patched.buildings[0].levels
    expect(levels.map((row) => row.floorNo)).toEqual([1, 2, 3, 4])
    expect(patched.buildings[0].missingFloorNos).toEqual([3, 4])
    const missing = levels.filter((row) => row.floor === null)
    expect(missing.every((row) => row.markers.length === 0)).toBe(true)
    expect(missing.every((row) => row.layout.rooms.every((room) => room.label.startsWith('房间')))).toBe(true)
    expect(patched.builtFloorCount).toBe(2)
  })

  it('归档楼栋与测点如实标记', () => {
    const [b03] = seedBuildings().filter((row) => row.id === B03)
    const archived = buildCampusModel({
      buildings: [{ ...b03, status: 'archived' }],
      floors: seedFloors().filter((row) => row.buildingId === B03),
      points: seedPoints().filter((row) => row.buildingId === B03).map((row) => (
        row.id === P_CRACK ? { ...row, status: 'archived' as const } : row
      )),
    })
    expect(archived.buildings[0].archived).toBe(true)
    expect(locatePoint(archived, P_CRACK)?.marker.archived).toBe(true)
  })

  it('测点查不到时返回 null，不退回第一个测点', () => {
    expect(locatePoint(model, 'pnt_not_exist')).toBeNull()
  })
})

describe('校园视图选择解析', () => {
  it('只有 view=3d 才进 3D，其余一律 2D', () => {
    expect(parseSpatialQuery({}).view).toBe('2d')
    expect(parseSpatialQuery({ view: '3D' }).view).toBe('3d')
    expect(parseSpatialQuery({ view: '4d' }).view).toBe('2d')
  })

  it('3D 分两档：不带楼栋是"校园 3D"，带楼栋才进"3D 楼层"', () => {
    expect(stageOf(parseSpatialQuery({}))).toBe('2d')
    expect(stageOf(parseSpatialQuery({ view: '3d' }))).toBe('campus')
    expect(stageOf(parseSpatialQuery({ view: '3d', f: 'flr_b03_02' }))).toBe('campus')
    expect(stageOf(parseSpatialQuery({ view: '3d', b: 'bld_b03' }))).toBe('building')
  })

  it('校园 3D 的链接不写楼栋参数，3D 楼层的链接才带全三个 ID', () => {
    expect(spatialQueryOf({ view: '3d' })).toEqual({ view: '3d' })
    expect(spatialQueryOf({ view: '3d', buildingId: 'bld_b03', floorId: 'flr_b03_02', pointId: 'pnt_b03_f2_crack01' }))
      .toEqual({ view: '3d', b: 'bld_b03', f: 'flr_b03_02', point: 'pnt_b03_f2_crack01' })
  })

  const facts = (id: string): { building?: { code: string; name: string; status: 'active' | 'archived' }; floor?: { name: string; buildingId: string; status: 'active' | 'archived' }; point?: { code: string; buildingId: string; floorId: string; status: 'active' | 'archived' } } => {
    switch (id) {
      case 'bld_b03': return { building: { code: 'B03', name: '3号教学楼', status: 'active' } }
      case 'bld_b02': return { building: { code: 'B02', name: '2号实验楼', status: 'active' } }
      case 'bld_archived': return { building: { code: 'B09', name: '旧楼', status: 'archived' } }
      case 'flr_b03_02': return { floor: { name: '二层', buildingId: 'bld_b03', status: 'active' } }
      case 'flr_b02_02': return { floor: { name: '二层', buildingId: 'bld_b02', status: 'active' } }
      case 'pnt_b03_f2_crack01': return { point: { code: 'B03-F2-CRACK01', buildingId: 'bld_b03', floorId: 'flr_b03_02', status: 'active' } }
      case 'pnt_b03_f1_check01': return { point: { code: 'B03-F1-CHECK01', buildingId: 'bld_b03', floorId: 'flr_b03_01', status: 'active' } }
      case 'pnt_archived': return { point: { code: 'B03-F2-OLD', buildingId: 'bld_b03', floorId: 'flr_b03_02', status: 'archived' } }
      default: return {}
    }
  }

  it('完整且归属正确的深链原样保留', () => {
    const target = resolveSpatialTarget({ view: '3d', b: 'bld_b03', f: 'flr_b03_02', point: 'pnt_b03_f2_crack01' }, facts)
    expect(target).toEqual({ view: '3d', buildingId: 'bld_b03', floorId: 'flr_b03_02', pointId: 'pnt_b03_f2_crack01', reason: '' })
  })

  it('只给测点时补齐它所属的楼栋与楼层', () => {
    const target = resolveSpatialTarget({ view: '3d', point: 'pnt_b03_f2_crack01' }, facts)
    expect(target.buildingId).toBe('bld_b03')
    expect(target.floorId).toBe('flr_b03_02')
    expect(target.reason).toBe('')
  })

  it('找不到的楼栋/楼层/测点分别说明原因，且不保留半截 ID', () => {
    expect(resolveSpatialTarget({ b: 'bld_none' }, facts).buildingId).toBe('')
    const floor = resolveSpatialTarget({ b: 'bld_b03', f: 'flr_none' }, facts)
    expect(floor.floorId).toBe('')
    expect(floor.reason).toContain('找不到这个楼层')
    const point = resolveSpatialTarget({ point: 'pnt_none' }, facts)
    expect(point.pointId).toBe('')
    expect(point.reason).toContain('找不到这个测点')
  })

  it('楼层不属于该楼栋时按楼栋打开并给出原因（错归属不能当命中）', () => {
    const target = resolveSpatialTarget({ b: 'bld_b03', f: 'flr_b02_02' }, facts)
    expect(target.buildingId).toBe('bld_b03')
    expect(target.floorId).toBe('')
    expect(target.reason).toContain('不属于这个楼栋')
  })

  it('测点不属于该楼层时清掉测点并说明原因', () => {
    const target = resolveSpatialTarget({ b: 'bld_b03', f: 'flr_b03_02', point: 'pnt_b03_f1_check01' }, facts)
    expect(target.buildingId).toBe('bld_b03')
    expect(target.floorId).toBe('flr_b03_02')
    expect(target.pointId).toBe('')
    expect(target.reason).toContain('不属于这个楼层')
  })

  it('测点不属于该楼栋时清掉测点并说明原因', () => {
    const target = resolveSpatialTarget({ b: 'bld_b02', point: 'pnt_b03_f2_crack01' }, facts)
    expect(target.pointId).toBe('')
    expect(target.reason).toContain('不属于这个楼栋')
  })

  it('归档楼栋与归档测点都不打开', () => {
    expect(resolveSpatialTarget({ b: 'bld_archived' }, facts).reason).toContain('已归档')
    expect(resolveSpatialTarget({ point: 'pnt_archived' }, facts).reason).toContain('已归档')
  })

  it('拼 query 时不写空参数', () => {
    expect(spatialQueryOf({ view: '3d', buildingId: 'bld_b03', floorId: '', pointId: '' })).toEqual({ view: '3d', b: 'bld_b03' })
    expect(spatialQueryOf({ view: '2d' })).toEqual({})
  })

  it('3D 深链带全楼栋/楼层/测点，缺的 ID 不写空参数', () => {
    const full = buildSpatialLink({ buildingId: 'bld_b03', floorId: 'flr_b03_02', pointId: 'pnt_b03_f2_crack01' })
    expect(full.kind).toBe('spatial_3d')
    expect(full.path).toBe('/campus')
    expect(full.query).toEqual({ view: '3d', b: 'bld_b03', f: 'flr_b03_02', point: 'pnt_b03_f2_crack01' })
    expect(full.deep).toBe(true)
    expect(buildSpatialLink({ buildingId: 'bld_b03', floorId: '', pointId: '' }).query).toEqual({ view: '3d', b: 'bld_b03' })
    expect(buildSpatialLink({ buildingId: '', floorId: '', pointId: '' }).query).toEqual({ view: '3d' })
  })
})
