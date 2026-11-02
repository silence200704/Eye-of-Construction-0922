/**
 * 3D 校园场景引擎（命令式，Three 只在这里与 sceneParts 里出现）。
 *
 * 职责：正交相机、受限/自由的旋转缩放、射线拾取、尺寸变化、取景与资源释放。
 * **不做业务判定**：颜色只按传入的事件等级与在册状态取，不读库、不算阈值。
 * 程序化几何（楼板、分区、外墙、贴墙传感器）在 sceneParts.ts。
 * 只在切换到 3D 时才被动态 import（见 SpatialScene.vue），因此 Three 不会进首屏包。
 */
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { CAMPUS_D, CAMPUS_W } from "@/core/spatial/coordinates"
import { CAMPUS_GREENS, CAMPUS_ROADS, type SiteRect } from "@/core/map/campusDecor"
import { disposeLabelCache } from "./sceneText"
import { buildingGroup } from "./sceneShell"
import { BUILDING_MODELS } from "./buildings/catalog"
import { createCameraMotion } from './camera/motion'
import type { PickResult, SceneHandle, SceneUpdate } from "./sceneShared"

export type { PickResult, SceneHandle, SceneScope, SceneUpdate, ViewMode } from "./sceneShared"

/** 与 2D 底图共用的道路/绿地矩形；它们只表达示意布局，不参与拾取或业务计算。 */
function addSiteDetails(environment: THREE.Group): void {
  const roadMat = new THREE.MeshBasicMaterial({ color: 0xd8e1df })
  const greenMat = new THREE.MeshBasicMaterial({ color: 0xb8d2bc })
  const addRect = (rect: SiteRect, material: THREE.Material, y: number): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(rect.w * CAMPUS_W, 0.07, rect.h * CAMPUS_D), material)
    mesh.position.set((rect.x + rect.w / 2 - 0.5) * CAMPUS_W, y, (rect.y + rect.h / 2 - 0.5) * CAMPUS_D)
    mesh.receiveShadow = true
    environment.add(mesh)
  }
  for (const road of CAMPUS_ROADS) addRect(road, roadMat, 0.025)
  for (const green of CAMPUS_GREENS) addRect(green, greenMat, 0.03)
}

/** 天光渐变：比纯色清屏多一层校园晨光感，不引用外部天空盒或图片。 */
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx !== null) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#f8fbfa')
    gradient.addColorStop(0.55, '#e8f1f2')
    gradient.addColorStop(1, '#d7e5e8')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 2, 256)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export function createScene(container: HTMLElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0xeaf2f5, 1)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const sky = skyTexture()
  scene.background = sky
  scene.fog = new THREE.Fog(0xe4eef0, 150, 340)
  const camera = new THREE.OrthographicCamera(-50, 50, 35, -35, 0.1, 800)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4c9d0, 1.5))
  const sun = new THREE.DirectionalLight(0xfff7e9, 2.4)
  sun.position.set(-35, 95, 55)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -100
  sun.shadow.camera.right = 100
  sun.shadow.camera.top = 100
  sun.shadow.camera.bottom = -100
  sun.shadow.normalBias = 0.035
  scene.add(sun)
  // 反向补光把背光面从死黑里拉回来；强度低，只服务于体量与玻璃的层次
  const fill = new THREE.DirectionalLight(0xcfe4ef, 0.55)
  fill.position.set(55, 35, -45)
  scene.add(fill)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  // 允许**自由旋转**（水平整圈 + 近乎俯视到近乎平视）与**自由缩放**：
  // 演示时要能绕着楼看一圈、也能推到单台设备跟前，所以这里不设"安全角度"限制。
  controls.minPolarAngle = 0.02
  controls.maxPolarAngle = Math.PI - 0.02
  controls.minZoom = 0.15
  controls.maxZoom = 8
  controls.zoomSpeed = 1.1
  controls.rotateSpeed = 0.9
  // 演示需要自由拖动：右键/双指平移，左键旋转；水平方向允许完整 360°。
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.panSpeed = 1
  controls.addEventListener('change', () => render())

  const root = new THREE.Group()
  scene.add(root)
  const environment = new THREE.Group()
  scene.add(environment)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CAMPUS_W * 1.5, CAMPUS_D * 1.5),
    new THREE.MeshStandardMaterial({ color: 0xe3ecec, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.05
  ground.receiveShadow = true
  environment.add(ground)
  const grid = new THREE.GridHelper(CAMPUS_W * 1.35, 18, 0xb9ced2, 0xd4e2e4)
  grid.position.y = -0.035
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
  for (const material of gridMaterials) {
    material.transparent = true
    material.opacity = 0.36
  }
  environment.add(grid)
  addSiteDetails(environment)

  const templates = new Map<string, THREE.Object3D>()
  let lastUpdate: SceneUpdate | null = null
  let disposed = false
  let drawerFrame = 0
  const loader = new GLTFLoader()
  for (const spec of BUILDING_MODELS) {
    loader.load(`${import.meta.env.BASE_URL}${spec.file}`, (gltf) => {
      if (disposed) {
        disposeTree(gltf.scene)
        return
      }
      templates.set(spec.code, gltf.scene)
      gltf.scene.userData.depthBasis = spec.depthBasis ?? 0
      if (lastUpdate !== null) update(lastUpdate)
    }, undefined, () => { /* 单栋 GLB 不可用时保留该栋的程序化外壳 */ })
  }

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  /** 正交视口的竖向半高：随范围变化（校园看全场、楼栋框住这一栋） */
  let frustumHalf = 52
  /** 上一次取景对应的条件；只有它变了才重新取景（选中对象不重设相机） */
  let lastFrameKey = ''
  /** 单栋楼用更高的俯角，让区域与测点比外立面更易读。 */
  let focusedBuilding = false
  const motion = createCameraMotion({
    camera,
    controls,
    getHalf: () => frustumHalf,
    setHalf: (value) => { frustumHalf = value; applyFrustum() },
    render,
  })
  controls.addEventListener('start', motion.stop)

  function render(): void {
    renderer.render(scene, camera)
  }

  function applyFrustum(): void {
    const rect = renderer.domElement.getBoundingClientRect()
    const aspect = rect.width / Math.max(1, rect.height)
    camera.left = -frustumHalf * aspect
    camera.right = frustumHalf * aspect
    camera.top = frustumHalf
    camera.bottom = -frustumHalf
    camera.updateProjectionMatrix()
  }

  /**
   * 当前视野里**几何体**的包围盒，取景以它为准。
   *
   * 刻意**不含文字贴片**（Sprite）：标签挂在楼顶上方、还带引杆，把它们算进包围盒
   * 会把整栋楼的几何往下压出画面中央 —— "建模不在界面中间"就是这么来的。
   * 标签按需显示即可，不该参与取景。
   */
  function contentBox(): THREE.Box3 {
    const box = new THREE.Box3()
    root.updateWorldMatrix(false, true)
    root.traverse((child) => {
      if ((child as THREE.Sprite).isSprite === true) return
      const mesh = child as THREE.Mesh
      if (mesh.geometry === undefined) return
      if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox()
      const local = mesh.geometry.boundingBox
      if (local === null) return
      box.union(local.clone().applyMatrix4(mesh.matrixWorld))
    })
    return box
  }

  /**
   * 把相机对准**当前内容的包围盒**：目标点取盒中心，视口按盒尺寸 + 画布宽高比来定。
   *
   * 用公式估尺寸会算错（标签、展开后的层间距都会改变实际范围），所以这里一律量真实包围盒 ——
   * 这就是"建筑总不在视图中央"的根因：目标点必须等于内容中心，不能等于楼栋平面中心。
   */
  function frameContent(animated = false): void {
    const box = contentBox()
    if (box.isEmpty()) return
    const before = motion.capture()
    const center = new THREE.Vector3()
    box.getCenter(center)

    const rect = renderer.domElement.getBoundingClientRect()
    const aspect = Math.max(0.6, rect.width / Math.max(1, rect.height))
    controls.target.copy(center)
    const size = box.getSize(new THREE.Vector3())
    const distance = Math.max(size.x, size.y, size.z) * 1.6 + 12
    camera.position.set(
      center.x + distance * (focusedBuilding ? 0.48 : 0.6),
      center.y + distance * (focusedBuilding ? 1.2 : 0.75),
      center.z + distance * (focusedBuilding ? 0.8 : 0.95),
    )
    camera.lookAt(center)
    camera.updateMatrixWorld()
    // 用相机坐标里的真实投影范围取景；平面斜放或楼层展开时不再出现大片空白。
    const projected = boxCorners(box).map((corner) => corner.applyMatrix4(camera.matrixWorldInverse))
    const halfX = Math.max(...projected.map((corner) => Math.abs(corner.x)))
    const halfY = Math.max(...projected.map((corner) => Math.abs(corner.y)))
    frustumHalf = Math.max(4, halfY, halfX / aspect) * 1.24
    applyFrustum()
    controls.update()
    render()
    if (animated) {
      const after = motion.capture()
      motion.apply(before)
      motion.move(after)
    }
  }

  function resize(width: number, height: number): void {
    motion.stop()
    // updateStyle 必须为真：否则 canvas 的 CSS 尺寸会停在旧值，元素比容器大，
    // 画面被裁掉一截、模型看着就"不在中间"（这正是用户报的那个现象）
    renderer.setSize(width, height, true)
    applyFrustum()
    render()
  }

  /** 选中的楼层从楼体里抽出；只在楼层/范围/视图变化时播放，选测点不重复抽动。 */
  function applyFloorDrawer(root: THREE.Group, animate: boolean): void {
    if (drawerFrame !== 0) cancelAnimationFrame(drawerFrame)
    const levels: { object: THREE.Object3D; target: number }[] = []
    root.traverse((node) => {
      const target = node.userData.drawerTarget
      if (typeof target === 'number') levels.push({ object: node, target })
    })
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!animate || reduced) {
      for (const row of levels) row.object.position.z = row.target
      render()
      return
    }
    for (const row of levels) row.object.position.z = 0
    const started = performance.now()
    const duration = 260
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / duration)
      const eased = t * t * (3 - 2 * t)
      for (const row of levels) row.object.position.z = row.target * eased
      render()
      drawerFrame = t < 1 ? requestAnimationFrame(step) : 0
    }
    drawerFrame = requestAnimationFrame(step)
  }

  function update(input: SceneUpdate): void {
    lastUpdate = input
    for (const child of [...root.children]) {
      root.remove(child)
      disposeTree(child)
    }
    const buildingId = input.scope.kind === 'building' ? input.scope.buildingId : ''
    focusedBuilding = buildingId !== ''
    const target = buildingId === ''
      ? input.model.buildings.filter((row) => !row.archived)
      : input.model.buildings.filter((row) => row.building.id === buildingId)
    for (const building of target) root.add(buildingGroup(building, input, templates))
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      const material = node.material
      const transparent = Array.isArray(material)
        ? material.some((row) => row.transparent)
        : material.transparent
      node.castShadow = !transparent
      node.receiveShadow = !transparent
    })

    // 只在"换了范围/视图/楼层"时重新取景。选中某台设备只是换高亮，
    // 这时候绝不能重设相机 —— 否则用户刚转好、放大好的视角会被一次次弹回去。
    const key = framingKeyOf(input)
    const refreshed = key !== lastFrameKey
    if (refreshed) {
      const animated = lastFrameKey !== ''
      lastFrameKey = key
      frameContent(animated)
    } else {
      render()
    }
    applyFloorDrawer(root, refreshed)
  }

  /** 取景只在这些条件变化时发生（选中对象不算） */
  function framingKeyOf(input: SceneUpdate): string {
    const id = input.scope.kind === 'building' ? input.scope.buildingId : '*'
    return `${input.scope.kind}|${id}|${input.mode}|${input.activeLevelIndex}`
  }

  /**
   * 拾取：命中"设备组里的任一零件"都算点中了那台设备。
   *
   * 设备是底座 + 支架 + 机身 + 面板 + 引杆一组网格，只给机身打标记的话，
   * 点在底座或面板上就没反应 —— 所以命中后沿父链往上找带 `pointId` 的那一层。
   */
  function pick(clientX: number, clientY: number): PickResult | null {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(root.children, true)
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object
      while (node !== null) {
        const data = node.userData as { kind?: string; pointId?: string; buildingId?: string; floorId?: string; zoneKey?: string; zoneLabel?: string }
        if (data.kind === 'marker' && typeof data.pointId === 'string' && data.pointId !== '') {
          return { pointId: data.pointId, buildingId: data.buildingId ?? '', floorId: data.floorId ?? '' }
        }
        if ((data.kind === 'building' || data.kind === 'badge') && typeof data.buildingId === 'string') {
          return { pointId: '', buildingId: data.buildingId, floorId: '' }
        }
        if (data.kind === 'zone' && typeof data.zoneKey === 'string') {
          return {
            pointId: '',
            buildingId: typeof data.buildingId === 'string' ? data.buildingId : '',
            floorId: typeof data.floorId === 'string' ? data.floorId : '',
            zoneKey: data.zoneKey,
            zoneLabel: typeof data.zoneLabel === 'string' ? data.zoneLabel : '',
          }
        }
        node = node.parent
      }
    }
    return null
  }

  function resetView(): void {
    motion.stop()
    frameContent()
  }

  function focusPoint(pointId: string): boolean {
    let target: THREE.Object3D | null = null
    root.traverse((node) => {
      if (target === null && node.userData.kind === 'marker' && node.userData.pointId === pointId && node instanceof THREE.Group) target = node
    })
    if (target === null) return false
    const position = (target as THREE.Object3D).getWorldPosition(new THREE.Vector3())
    const offset = camera.position.clone().sub(controls.target)
    position.y += 0.4
    motion.move({ position: position.clone().add(offset), target: position, half: Math.min(frustumHalf, 9.5) }, 850)
    return true
  }

  function dispose(): void {
    disposed = true
    if (drawerFrame !== 0) cancelAnimationFrame(drawerFrame)
    drawerFrame = 0
    motion.stop()
    controls.removeEventListener('start', motion.stop)
    for (const child of [...root.children]) disposeTree(child)
    root.clear()
    disposeTree(environment)
    environment.clear()
    for (const template of templates.values()) disposeTree(template)
    templates.clear()
    controls.dispose()
    sky.dispose()
    renderer.dispose()
    renderer.domElement.remove()
    disposeLabelCache()
  }

  return { update, resize, pick, resetView, focusPoint, dispose }
}

/** 包围盒八角转到相机坐标，供正交视口精确取景。 */
function boxCorners(box: THREE.Box3): THREE.Vector3[] {
  const corners: THREE.Vector3[] = []
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
    }
  }
  return corners
}

/** 释放一棵子树里的几何与材质（贴图缓存单独在 dispose 时清） */
function disposeTree(node: THREE.Object3D): void {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry !== undefined) mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) for (const row of material) row.dispose()
    else if (material !== undefined) material.dispose()
  })
}

