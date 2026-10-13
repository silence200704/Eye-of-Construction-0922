import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { P_CRACK, P_TILT } from '@/db/seedFactories'
import { db } from '@/db/database'
import { runDirector } from '@/assistant/director/task'
import { directorIntent } from '@/assistant/director/intent'
import { taskQuestions } from '@/assistant/director/questions'
import { useDirectorStore } from '@/assistant/director/state'
import { askZhutong } from '@/assistant/ask'
import { useClockStore } from '@/stores/clock'
import { setup, tables } from './harness'

beforeEach(setup)
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('自然任务无需演示口令，问原因、否定和业务决定不触发准备', () => {
  expect(directorIntent('分析 B03-F2-CRACK01 的裂缝照片')).toBe('media')
  expect(directorIntent('分析这段视频')).toBe('video')
  expect(directorIntent('准备 B03-F2-CRACK01 的巡检任务')).toBe('inspection')
  for (const question of ['不要分析裂缝照片', '为什么照片变了', '可以分析视频吗', '能不能分析裂缝照片', '帮我验收工单', '下一幕', '这个问题处理到哪了？']) expect(directorIntent(question)).toBeNull()
})

it('未授权也可定位3D；同一楼层测点，不写业务库或推进时钟', async () => {
  const before = await tables()
  const clock = useClockStore().nowKey
  const result = await runDirector({ question: '在3D中定位 B03-F2-TILT01', context: {} })
  expect(result?.pointId).toBe(P_TILT)
  expect(result?.question).toBe('在3D中定位 B03-F2-TILT01')
  expect(useDirectorStore().link?.query).toMatchObject({ b: 'bld_b03', f: 'flr_b03_02', point: P_TILT, view: '3d' })
  expect(await tables()).toBe(before)
  expect(useClockStore().nowKey).toBe(clock)
})

it('定位没有对象先消歧，失效编号不导航到默认点', async () => {
  expect((await runDirector({ question: '帮我定位传感器', context: {} }))?.status).toBe('need_choice')
  expect((await runDirector({ question: '在3D中定位 B03-F2-CRACK99', context: { pointId: P_CRACK } }))?.status).toBe('not_found')
  expect(useDirectorStore().navigationSeq).toBe(0)
})

it('异常与处置进度回答对应问题，普通提问不补数据', async () => {
  const before = await tables()
  expect((await askZhutong('哪个传感器异常？')).intent).toBe('open_events')
  expect((await askZhutong('B03-F2-TILT01传感器异常吗？')).pointId).toBe(P_TILT)
  expect((await askZhutong('这个传感器异常吗？', { context: { pointId: P_TILT } })).intent).toBe('point_status')
  expect((await askZhutong('这个问题处理到哪了？')).intent).toBe('demo_guide')
  expect(await tables()).toBe(before)
})

it('照片任务未授权只指向唯一设置入口', async () => {
  const result = await runDirector({ question: '分析 B03-F2-CRACK01 的裂缝照片', context: {} })
  expect(result?.status).toBe('not_found')
  expect(result?.links[0].path).toBe('/settings')
  expect(await db.records.count()).toBe(0)
})

it('预设问题围绕任务，非裂缝点不推荐借用裂缝照片', () => {
  const photo = taskQuestions({ authorized: true, visual: true, code: 'B03-F2-CRACK01' })
  expect(photo).toContain('分析 B03-F2-CRACK01 的裂缝照片')
  expect(photo).toContain('分析 B03-F2-CRACK01 的视频首末关键帧')
  expect(photo.join('')).not.toMatch(/下一幕|导演|带我演示/)
  const tilt = taskQuestions({ authorized: true, visual: false, code: 'B03-F2-TILT01' })
  expect(tilt.join('')).not.toMatch(/照片|视频|影像/)
})
