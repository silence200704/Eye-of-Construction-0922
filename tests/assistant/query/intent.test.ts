import { expect, it } from 'vitest'
import { extractEntities, looksLikeWriteCommand, normalizeQuestion, parseIntent } from '@/assistant/parse'
import { directorIntent } from '@/assistant/director/intent'
import { taskQuestions } from '@/assistant/director/questions'

it.each([
  ['放大趋势图', 'point_trend'], ['放大当前照片', 'visual_region'],
  ['为什么这张照片不能比', 'media_reason'], ['全校哪里异常', 'open_events'],
  ['全校现在监测如何', 'campus_overview'], ['读数恢复了吗', 'reading_recovery'],
  ['问题处理完了吗', 'demo_guide'], ['小瞳能帮我做什么', 'capabilities'],
  ['怎么上传照片', 'capabilities'], ['替我关闭事件', 'demo_guide'],
])('%s 分派为 %s', (text, intent) => {
  const q = normalizeQuestion(text)
  expect(parseIntent(q, extractEntities(q))).toBe(intent)
})

it.each(['不要补数据，分析已有视频', '分析已有视频', '怎么准备演示数据', '为什么载入预警数据', '只看现有数据'])('%s 不进准备任务', (question) => {
  expect(directorIntent(question)).toBeNull()
  expect(looksLikeWriteCommand(normalizeQuestion(question))).toBe(false)
})

it('影像页面优先展示绑定当前对象的影像问题', () => {
  const questions = taskQuestions({ code: 'B03-F2-CRACK01', visual: true, authorized: true, focus: 'media' })
  expect(questions.slice(0, 3).join('')).toContain('裂缝照片')
  expect(questions.slice(0, 3).join('')).not.toMatch(/它|这面墙/)
})

it('没有对象不默认推荐B03或无依据指代问题', () => {
  const all = taskQuestions({ visual: true, authorized: true })
  expect(all).toHaveLength(3)
  expect(all.join('')).not.toMatch(/B03|这面墙|这段视频|这个问题/)
})

it('其他测点不推荐B03照片；未准备视频且未授权不推荐分析视频', () => {
  expect(taskQuestions({ code: 'B03-F2-TILT01', visual: false, authorized: false }).join('')).not.toMatch(/照片|视频|CRACK01/)
  expect(taskQuestions({ code: 'B03-F2-CRACK01', visual: true, authorized: false, hasVideo: false }).join('')).not.toMatch(/视频/)
})
