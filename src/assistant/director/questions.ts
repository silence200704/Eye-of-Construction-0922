/** 只推荐当前对象可回答的问题，不暗中预选裂缝测点。 */
export function taskQuestions(input: { code?: string; visual: boolean; authorized: boolean; hasVideo?: boolean; event?: boolean; focus?: 'media' | 'video' }): string[] {
  const global = ['全校有哪些异常？', '列出还没处理的预警', '小瞳能帮我做什么？']
  if (!input.code) return global
  const code = input.code
  const questions = [`${code}现在的读数是多少？`, `${code}的趋势如何？`, `在3D中定位 ${code}`]
  if (input.event) questions.unshift('这个问题处理完了吗？', '为什么这条预警是红色？')
  if (input.visual) questions.push(
    input.authorized ? `分析 ${code} 的裂缝照片` : `${code}的照片有什么变化？`,
    `${code}为什么照片有差异？`, `${code}的完好墙面也变了吗？`, `${code}放大照片变化区域`,
  )
  if (input.visual && (input.hasVideo === true || input.authorized)) questions.push(
    `分析 ${code} 的视频首末关键帧`, `播放 ${code} 的固定机位视频`,
    '视频变化和传感器读数一致吗？', '为什么这段视频不能前后比对？',
  )
  if (input.authorized) questions.push(`准备 ${code} 的巡检任务`, '查看操作记录', '停止自动补齐')
  const priority = input.focus === 'media' && input.visual
    ? [input.authorized ? `分析 ${code} 的裂缝照片` : `${code}的裂缝照片有什么变化？`, `${code}为什么照片有差异？`, `${code}放大照片变化区域`]
    : input.focus === 'video' && input.hasVideo ? [`分析 ${code} 的视频首末关键帧`, '为什么这段视频不能前后比对？'] : []
  return [...new Set([...priority, ...questions, ...global])]
}
