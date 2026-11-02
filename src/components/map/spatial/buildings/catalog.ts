/**
 * 校园 3D 总览的 Blender GLB 目录：只做“楼栋编号 → 模型文件”的映射。
 * 文件不存在或加载失败时，场景仍使用各楼栋原有的程序化外壳，不阻塞 2D/3D。
 */
export interface BuildingModelSpec {
  code: string
  file: string
  /**
   * 只用于进深特别大的模型：按“建筑主体进深”而不是含前台阶的整体包围盒缩放。
   * 图书馆的入口大台阶占掉近 11 个基准单位，若整体压进 footprint，主体会被压扁。
   */
  depthBasis?: number
}

export const BUILDING_MODELS: readonly BuildingModelSpec[] = [
  { code: 'B01', file: 'models/b01-comprehensive.glb' },
  { code: 'B02', file: 'models/b02-lab.glb' },
  { code: 'B03', file: 'models/b03-teaching.glb' },
  { code: 'B04', file: 'models/b04-gym.glb' },
  { code: 'B05', file: 'models/library-longzihu.glb', depthBasis: 16 },
]
