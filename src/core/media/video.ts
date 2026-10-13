import { compressPhoto } from '@/db/inspection/attachments'

export interface VideoMeta { durationSeconds: number; width: number; height: number; fileName: string }
export interface VideoKeyframe { index: number; timeCode: number; blob: Blob; width: number; height: number }

export function releaseVideo(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

/** 每次等待都清理监听与计时器；坏文件不能让演示永远停在“思考”。 */
function waitFor(video: HTMLVideoElement, event: string, start: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      video.removeEventListener(event, ready)
      video.removeEventListener('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const ready = (): void => finish()
    const failed = (): void => finish(new Error('视频无法解码，请换常见 MP4 / WebM 文件。'))
    const timer = setTimeout(() => finish(new Error('视频读取超时，请重试。')), 12000)
    video.addEventListener(event, ready, { once: true })
    video.addEventListener('error', failed, { once: true })
    try { start() } catch (cause) { finish(cause instanceof Error ? cause : new Error(String(cause))) }
  })
}

export async function loadVideoMeta(url: string, fileName: string): Promise<{ video: HTMLVideoElement; meta: VideoMeta }> {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  try {
    await waitFor(video, 'loadedmetadata', () => { video.src = url })
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) throw new Error('视频时长或画面尺寸无效。')
    return { video, meta: { durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight, fileName } }
  } catch (cause) { releaseVideo(video); throw cause }
}

export async function extractKeyframes(video: HTMLVideoElement, count = 3): Promise<VideoKeyframe[]> {
  const out: VideoKeyframe[] = []
  for (let index = 0; index < count; index += 1) {
    const timeCode = video.duration * (index + 1) / (count + 1)
    await waitFor(video, 'seeked', () => { video.currentTime = timeCode })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器不支持视频抽帧画布。')
    context.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('视频关键帧转换失败。')
    const photo = await compressPhoto(new File([blob], `frame-${index}.jpg`, { type: 'image/jpeg' }))
    out.push({ index, timeCode, blob: photo.blob, width: photo.width, height: photo.height })
  }
  return out
}
