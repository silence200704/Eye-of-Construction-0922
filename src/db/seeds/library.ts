/**
 * 图书馆演示档案：按用户提供的河南牧业经济学院图书馆外观参考补建。
 *
 * 口径：楼栋位置、楼层与室内区域是明确标识的演示占位，不是实测图纸；
 * 图书馆只设一个人工检查点，不虚构传感器或读数。
 */
import type { Building, Floor, Point } from '@/types/domain'
import { B05, F0501, F0502, F0503, F0504, F0505, P_B05_CHECK, building, floor, point } from '../seedFactories'

const LIBRARY_SOURCE = '按河南牧业经济学院图书馆外观参考制作的演示建模；楼栋与楼层字段为占位资料'

export function libraryBuilding(): Building {
  return building({
    id: B05,
    code: 'B05',
    name: '图书馆',
    purpose: '图书馆',
    buildYear: 2018,
    floorCount: 5,
    area: 28000,
    structureType: '框架结构',
    owner: '图书馆办公室',
    backupPerson: '后勤保障处',
    dataSource: 'demo',
    source: LIBRARY_SOURCE,
    x: 0.48,
    y: 0.62,
    w: 0.36,
    h: 0.16,
    rotate: 0,
  })
}

export function libraryFloors(): Floor[] {
  const rows: [string, number, string, string[]][] = [
    [F0501, 1, '一层', ['一层中庭', '一层借阅区', '一层楼梯间', '一层服务台', '一层新书展区', '一层自习区', '一层书库']],
    [F0502, 2, '二层', ['二层走廊', '二层社科书库', '二层楼梯间', '二层自习区', '二层电子阅览', '二层研讨间', '二层备用间']],
    [F0503, 3, '三层', ['三层走廊', '三层自然科学书库', '三层楼梯间', '三层阅览区', '三层期刊区', '三层研讨间', '三层备用间']],
    [F0504, 4, '四层', ['四层走廊', '四层特藏室', '四层楼梯间', '四层阅览区', '四层数字资源区', '四层研讨间', '四层备用间']],
    [F0505, 5, '五层', ['五层走廊', '五层办公区', '五层楼梯间', '五层读者服务区', '五层会议室', '五层设备间', '五层备用间']],
  ]
  return rows.map(([id, floorNo, name, zones]) => floor({
    id,
    buildingId: B05,
    floorNo,
    name,
    zones,
    remark: `演示示意：按图书馆外观参考划分的室内区域，非实测图纸（${LIBRARY_SOURCE}）`,
  }))
}

export function libraryPoint(): Point {
  return point({
    id: P_B05_CHECK,
    code: 'B05-F1-CHECK01',
    name: '一层中庭人工检查点',
    buildingId: B05,
    floorId: F0501,
    zoneId: '一层中庭',
    type: 'manual_check',
    coord: { x: 0.5, y: 0.5 },
    owner: '图书馆办公室',
    backupPerson: '后勤保障处',
    installDate: '2026-10-31',
    dataSource: 'demo',
    remark: '图书馆只做人工巡查，不布设传感器；缺记录不等于正常。',
  })
}
