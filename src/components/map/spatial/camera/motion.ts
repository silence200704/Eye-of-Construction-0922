/** 3D 导览的纯展示运镜；不接触业务状态。 */
import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
  half: number
}

interface MotionContext {
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  getHalf: () => number
  setHalf: (value: number) => void
  render: () => void
}

export function createCameraMotion(context: MotionContext) {
  let frame = 0
  const capture = (): CameraPose => ({
    position: context.camera.position.clone(),
    target: context.controls.target.clone(),
    half: context.getHalf(),
  })
  function stop(): void {
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }
  function apply(pose: CameraPose): void {
    context.camera.position.copy(pose.position)
    context.controls.target.copy(pose.target)
    context.setHalf(pose.half)
    context.camera.lookAt(context.controls.target)
    context.controls.update()
    context.render()
  }
  function move(to: CameraPose, duration = 760): void {
    stop()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || duration <= 0) {
      apply(to)
      return
    }
    const from = capture()
    const started = performance.now()
    const animate = (now: number): void => {
      const t = Math.min(1, (now - started) / duration)
      const eased = t * t * (3 - 2 * t)
      apply({
        position: from.position.clone().lerp(to.position, eased),
        target: from.target.clone().lerp(to.target, eased),
        half: THREE.MathUtils.lerp(from.half, to.half, eased),
      })
      frame = t < 1 ? requestAnimationFrame(animate) : 0
    }
    frame = requestAnimationFrame(animate)
  }
  return { capture, apply, move, stop }
}
