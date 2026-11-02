/**
 * 3D 场景里的中文文字贴片。
 *
 * Three 没有内置中文字体渲染，用 canvas 画一张贴图再做 Sprite 是最省的做法：
 * 不引入字体文件、不增加网络请求，且与页面同字体家族的观感一致。
 * 只需要在**建档楼层**上生成，未建档层与无测点层不生成标签。
 */
import * as THREE from 'three'

export interface LabelOptions {
  text: string
  /** 世界单位下的可见高度 */
  height: number
  color?: string
  background?: string
  /** 例如图书馆匾额使用宋体；一般数据标签保持页面系统字体 */
  fontFamily?: string
}

const CACHE = new Map<string, THREE.Texture>()

function textureOf(options: LabelOptions): THREE.Texture {
  const family = options.fontFamily ?? 'system-ui, "Microsoft YaHei", sans-serif'
  const key = `${options.text}|${options.color ?? ''}|${options.background ?? ''}|${family}`
  const cached = CACHE.get(key)
  if (cached !== undefined) return cached

  const font = 40
  const pad = 12
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('本机浏览器不支持画布，无法生成 3D 标签')
  ctx.font = `600 ${font}px ${family}`
  const width = Math.ceil(ctx.measureText(options.text).width) + pad * 2
  const height = font + pad * 2
  canvas.width = width
  canvas.height = height

  const paint = canvas.getContext('2d')
  if (paint === null) throw new Error('本机浏览器不支持画布，无法生成 3D 标签')
  paint.clearRect(0, 0, width, height)
  if (options.background !== undefined) {
    paint.fillStyle = options.background
    paint.fillRect(0, 0, width, height)
    paint.strokeStyle = '#b7cbd0'
    paint.lineWidth = 2
    paint.strokeRect(1, 1, width - 2, height - 2)
  }
  paint.font = `600 ${font}px ${family}`
  paint.fillStyle = options.color ?? '#16232a'
  paint.textBaseline = 'middle'
  paint.fillText(options.text, pad, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  CACHE.set(key, texture)
  return texture
}

/** 生成一个按高度等比缩放的文字贴片（贴在楼层上方，始终朝向相机） */
export function labelSprite(options: LabelOptions): THREE.Sprite {
  const texture = textureOf(options)
  const image = texture.image as HTMLCanvasElement
  const aspect = image.width / image.height
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(options.height * aspect, options.height, 1)
  return sprite
}

/** 释放贴图缓存（场景销毁时调用，避免换数据集后累积） */
export function disposeLabelCache(): void {
  for (const texture of CACHE.values()) texture.dispose()
  CACHE.clear()
}
