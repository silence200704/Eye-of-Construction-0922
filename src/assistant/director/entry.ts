import { askZhutong } from '../ask'
import type { AskOptions } from '../ask'
import { directorIntent } from './intent'
import { isShowcase } from '@/core/demo/workspace'

/** 普通提问不加载写入编排；演示任务首次使用才加载准备代码。 */
export async function askWithDirector(question: string, options: AskOptions, readOnly = false) {
  if (isShowcase && !readOnly && /视频|关键帧|为什么不能比较/.test(question) && options.context?.pointId === 'pnt_b03_f2_crack01') {
    const { useMediaStore } = await import('@/stores/media')
    const media = useMediaStore()
    if (!media.videoMeta || !media.videoAnalysis) {
      const { prepareMedia } = await import('@/stores/demo/showcase/prepare')
      await prepareMedia()
      await media.analyseVideo()
    }
  }
  if (isShowcase || readOnly || directorIntent(question) === null) return askZhutong(question, options)
  const { runDirector } = await import('./task')
  return await runDirector({ question, ...options, context: options.context ?? {} }) ?? askZhutong(question, options)
}
