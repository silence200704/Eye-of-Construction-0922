/**
 * 内置演示素材的**素材级契约**：直接读 `public/demo-media/` 里的真实 PNG，
 * 按 `core/media/capture.ts` 的同一口径（长边 480、0.299/0.587/0.114 亮度）取样，
 * 再交给**真正的** `compareFrames` 判定。
 *
 * 为什么要这层测试：这两张图是演示动线第 5 步的素材，必须"框裂缝就疑似变化、
 * 框没变化的地方就没变化"。改成只看素材是否可读、或只看单元逻辑，都挡不住
 * "素材变化太细、8% 阈值下永远判未见明显差异"这类演示事故。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { compareFrames, DEFAULT_COMPARE_OPTIONS, type Region } from '@/core/media/compare'
import { DEMO_COMPARE_REGIONS } from '@/config/media/demoPhotos'
import { lumaFrames, type Bitmap } from './bitmapLuma'

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** 只支持 8 位非隔行 RGB/RGBA —— 够读本项目这两张素材 */
function decodePng(buf: Buffer): Bitmap {
  let pos = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('素材必须是 8 位非隔行 PNG')
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0
      if (channels === 0) throw new Error('素材必须是 RGB / RGBA')
    } else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = new Uint8Array(stride)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) v += paeth(a, b, c)
      cur[i] = v & 0xff
    }
    out.set(cur, y * stride)
    prev = cur
  }
  return { width, height, channels, data: out }
}

const mediaDir = fileURLToPath(new URL('../../public/demo-media/', import.meta.url))
const load = (name: string): Bitmap => decodePng(readFileSync(`${mediaDir}${name}`))

const before = lumaFrames(load('corridor-crack-before.png'))
const after = lumaFrames(load('corridor-crack-after.png'))

function judge(region: Region) {
  return compareFrames({ before: before.data, after: after.data, width: before.width, height: before.height, region })
}

describe('内置演示素材（真实像素）', () => {
  it('两张图尺寸一致，能逐像素比对', () => {
    expect(before.width).toBe(after.width)
    expect(before.height).toBe(after.height)
    expect(before.data.length).toBe(after.data.length)
  })

  it('框选示范裂缝区域得到「疑似变化」，且高出阈值有安全余量', () => {
    const result = judge(DEMO_COMPARE_REGIONS.crack)
    expect(result.status).toBe('changed')
    // 余量断言：只要求"过线"的话，素材稍一变淡就会在演示当天失效
    expect(result.changedRatio).toBeGreaterThan(DEFAULT_COMPARE_OPTIONS.changedRatio * 1.5)
  })

  it('框选未变化的墙面得到「未见明显差异」', () => {
    const result = judge(DEMO_COMPARE_REGIONS.control)
    expect(result.status).toBe('stable')
    expect(result.changedRatio).toBeLessThan(DEFAULT_COMPARE_OPTIONS.changedRatio)
  })

  it('整图直比不足以触发，必须框到裂缝处（守住"框选"这个动作的意义）', () => {
    const whole = judge({ x: 0, y: 0, w: 1, h: 1 })
    expect(whole.status).toBe('stable')
  })
})
