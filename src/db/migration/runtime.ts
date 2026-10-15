import { toPlain } from '@/core/plain'
import { blobToDataUrl } from '@/db/backup'
import { useMediaStore } from '@/stores/media'
import { useAssistantStore } from '@/assistant/session'
import { readRegistry } from '@/stores/demo/registry'

export async function captureRuntime(): Promise<Record<string, unknown>> {
  const media = useMediaStore()
  const assistant = useAssistantStore()
  if (media.busy || assistant.busy || assistant.guideLoading) throw new Error('请等待当前影像或助手任务完成后迁移')
  const frames = toPlain(media.frames)
  const meta = toPlain(media.videoMeta)
  const analysis = toPlain(media.videoAnalysis)
  const videoUrl = media.videoUrl
  const result: Record<string, unknown> = {
    assistant: toPlain({ turns: assistant.turns, context: assistant.context, pageContext: assistant.pageContext, contextLabel: assistant.contextLabel }),
    scenario: toPlain(readRegistry()),
    frames: await Promise.all(frames.map(async frame => ({ ...frame, blob: await blobToDataUrl(frame.blob), mimeType: frame.blob.type }))),
    comparisons: toPlain(media.compare ? [media.compare] : []),
  }
  if (meta && videoUrl) {
    const response = await fetch(videoUrl)
    if (!response.ok) throw new Error('当前视频字节无法读取，请重新选择视频后迁移')
    result.video = { meta, analysis, blob: await blobToDataUrl(await response.blob()), origin: meta.assetKey === 'change' ? 'demo_generated' : meta.assetKey ? 'demo_public' : 'upload' }
  }
  return result
}
