/**
 * 图片文件头识别的口径测试。
 *
 * 锁定的行为：按魔数判断，不看扩展名 —— 报"解码失败"时用户分不清是"文件不是图片"还是"图片坏了"。
 */
import { describe, expect, it } from 'vitest'
import { imageKindLabel, sniffImageKind } from '@/core/image'

const jpeg = new Uint8Array(300)
jpeg[0] = 0xff
jpeg[1] = 0xd8
jpeg[2] = 0xff
jpeg.set([0xe0, 0x00, 0x10], 3)

const png = new Uint8Array(64)
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)

describe('图片文件头识别', () => {
  it('认得 JPEG（FF D8 FF）与 PNG（89 50 4E 47 0D 0A 1A 0A）', () => {
    expect(sniffImageKind(jpeg)).toBe('jpeg')
    expect(sniffImageKind(png)).toBe('png')
    expect(imageKindLabel('jpeg')).toBe('JPEG')
    expect(imageKindLabel('png')).toBe('PNG')
  })

  it('改了扩展名的文本文件不算图片', () => {
    const text = new TextEncoder().encode('这不是一张照片，只是把名字改成了 .png')
    expect(sniffImageKind(text)).toBe('')
    expect(imageKindLabel('')).toBe('未知格式')
  })

  it('空文件与不足文件头的短字节按未知处理，不越界读', () => {
    expect(sniffImageKind(new Uint8Array(0))).toBe('')
    expect(sniffImageKind(new Uint8Array([0xff, 0xd8]))).toBe('')
    expect(sniffImageKind(new Uint8Array([0x89, 0x50, 0x4e]))).toBe('')
  })
})
