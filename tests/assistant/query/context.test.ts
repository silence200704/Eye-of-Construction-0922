import { expect, it, vi } from 'vitest'
import { makeBuilding, makeEvent, makeFloor, makePoint } from '../../fixtures'
import { setupHarness } from '../harness'
import { buildSnapshot } from '@/assistant/selectors'
import { queryContext, routeContext } from '@/assistant/query/context'
import { useAssistantStore } from '@/assistant/session'
import { askZhutong } from '@/assistant/ask'
import { db } from '@/db/database'
import { useMediaStore } from '@/stores/media'

async function setup() {
  return setupHarness({
    buildings: [makeBuilding({ id: 'b3', code: 'B03', name: '3号教学楼' })],
    floors: [makeFloor({ id: 'f2', buildingId: 'b3', name: '二层', floorNo: 2 }), makeFloor({ id: 'f3', buildingId: 'b3', name: '三层', floorNo: 3 })],
    points: [
      makePoint({ id: 'p2', buildingId: 'b3', floorId: 'f2', code: 'B03-F2-CRACK01' }),
      makePoint({ id: 'p3', buildingId: 'b3', floorId: 'f3', code: 'B03-F3-CRACK01' }),
    ],
    events: [makeEvent({ id: 'e2', pointId: 'p2', eventNo: 'E20260920-002' }), makeEvent({ id: 'e3', pointId: 'p3', eventNo: 'E20260920-003' })],
  })
}

it('楼栋+楼层+指标筛选；缺失楼层不退回另一个测点', async () => {
  const h = await setup()
  expect((await h.ask('3号教学楼二层裂缝怎么样')).pointId).toBe('p2')
  expect((await h.ask('3号教学楼三层裂缝怎么样')).pointId).toBe('p3')
  const missing = await h.ask('3号教学楼五层裂缝怎么样')
  expect(missing.pointId).toBeNull()
  expect(missing.conclusion).toContain('5 层')
})

it('页面与上轮冲突先选择；当前选中/刚才明确指向各自对象', async () => {
  await setup()
  const args = { page: { pointId: 'p2' }, previous: { pointId: 'p3' }, snapshot: buildSnapshot() }
  const result = queryContext({ ...args, question: '它怎么样' })
  expect(result).toMatchObject({ status: 'need_choice' })
  expect(queryContext({ ...args, question: '当前选中的怎么样' })).toEqual(args.page)
  expect(queryContext({ ...args, question: '刚才那个怎么样' })).toEqual(args.previous)
})

it('候选事件ID不能被当成测点，保留原追因问题', async () => {
  await setup()
  const session = useAssistantStore()
  await session.chooseCandidate({ id: 'e3', label: '事件3', detail: '' }, '为什么这条是红色')
  expect(session.last?.question).toBe('为什么这条是红色')
  expect(session.last?.result?.links.some((e) => e.query.event === 'e3')).toBe(true)
  expect(session.context.eventId).toBe('e3')
})

it('页面/上轮冲突选择后继续同一句；后续不会无限消歧', async () => {
  await setup()
  const session = useAssistantStore()
  session.pageContext = { pointId: 'p2' }
  session.context = { pointId: 'p3' }
  await session.ask('它怎么样')
  const candidate = session.last?.result?.candidates.find((c) => c.id === 'p3')
  expect(candidate).toBeDefined()
  await session.chooseCandidate(candidate!, '它怎么样')
  expect(session.last?.result?.pointId).toBe('p3')
})

it('路由对象须存在；未知ID不冒充当前对象', async () => {
  await setup()
  expect(routeContext({ point: 'p2' }, buildSnapshot())).toEqual({ pointId: 'p2' })
  expect(routeContext({ point: 'missing' }, buildSnapshot())).toEqual({})
  expect(routeContext({ event: 'e3' }, buildSnapshot())).toEqual({ eventId: 'e3' })
})

it('明确错编号的视觉问题不借会话唯一测点照片', async () => {
  await setup()
  const media = useMediaStore()
  media.frames = [{ id: 'img1', pointId: 'p2', origin: 'upload', capturedAt: '', label: '', fileName: '', size: 1, width: 2, height: 2, blob: new Blob(), timeCode: null }]
  const r = await askZhutong('B03-F2-CRACK99 的裂缝有什么变化')
  expect(r.status).toBe('not_found')
  expect(r.pointId).toBeNull()
  expect(r.previews).toEqual([])
})

it('普通帮助/趋势/进度查询前后业务表不变', async () => {
  await setup()
  const before = await Promise.all(db.tables.map((t) => t.toArray()))
  for (const q of ['全校哪里异常', '怎么上传照片', 'B03-F2-CRACK01 的趋势如何', 'B03-F2-CRACK01 问题处理完了吗']) await askZhutong(q)
  expect(await Promise.all(db.tables.map((t) => t.toArray()))).toEqual(before)
})

it('旧请求返回不能恢复用户已清除的上下文/回答', async () => {
  const h = await setup()
  const session = useAssistantStore()
  session.context = { pointId: 'p2' }
  let release!: () => void
  const paused = new Promise<void>((resolve) => { release = resolve })
  const original = h.archive.reload.bind(h.archive)
  const spy = vi.spyOn(h.archive, 'reload').mockImplementation(async () => { await paused; return original() })
  // ensureStoresLoaded normally skips already loaded stores: force this read.
  h.archive.loaded = false
  const request = session.ask('它怎么样')
  session.clearTurns()
  session.clearContext()
  release()
  await request
  expect(session.turns).toEqual([])
  expect(session.context).toEqual({})
  spy.mockRestore()
})

it('在途时页面换点会取消旧结果，明确编号的目标导航不会误取消', async () => {
  const h = await setup()
  const session = useAssistantStore()
  session.context = { pointId: 'p2' }
  let release!: () => void
  const paused = new Promise<void>((resolve) => { release = resolve })
  const original = h.archive.reload.bind(h.archive)
  const spy = vi.spyOn(h.archive, 'reload').mockImplementation(async () => { await paused; return original() })
  h.archive.loaded = false
  const request = session.ask('它怎么样')
  session.setPageContext({ pointId: 'p3' })
  release()
  await request
  expect(session.last?.result).toBeNull()
  expect(session.last?.error).toContain('取消')
  spy.mockRestore()
  const newRequest = session.ask('B03-F3-CRACK01 怎么样')
  session.setPageContext({ pointId: 'p3' })
  await newRequest
  expect(session.last?.result?.pointId).toBe('p3')
})
