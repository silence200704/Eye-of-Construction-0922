/**
 * 图片文件识别（纯函数，按文件头字节判断）。
 *
 * 存在的理由：`createImageBitmap` 失败时只会抛浏览器自己的英文消息（"The source image could not be decoded."），
 * 用户看到的是"解码失败"，但真正的原因往往是**文件根本不是图片**（改了扩展名的文本、被截断的下载文件）。
 * 按魔数先判一次，提示才能说清是"不是有效图片"还是"图片已损坏"。
 */

/** 文件扩展名不可信，这里只认文件头。 */
export type ImageKind = 'jpeg' | 'png' | ''

export function sniffImageKind(bytes: Uint8Array): ImageKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }
  return ''
}

export function imageKindLabel(kind: ImageKind): string {
  if (kind === 'jpeg') return 'JPEG'
  if (kind === 'png') return 'PNG'
  return '未知格式'
}
