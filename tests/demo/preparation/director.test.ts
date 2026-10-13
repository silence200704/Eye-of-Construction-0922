import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { P_CRACK, P_TILT } from '@/db/seedFactories'
import { db } from '@/db/database'
import { directorIntent } from '@/assistant/director/intent'
import { useDirectorStore } from '@/assistant/director/state'
import { useAssistantStore } from '@/assistant/session'
import { runDirector } from '@/assistant/director/task'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { useClockStore } from '@/stores/clock'
import { useMediaStore } from '@/stores/media'
import { useTaskStore } from '@/stores/inspection/tasks'
import { buildLink } from '@/assistant/actions'
import { askZhutong } from '@/assistant/ask'
import { makeEvent } from '../../fixtures'
import { useEventsStore } from '@/stores/events'
import { setup, authorize, tables } from './harness'

beforeEach(setup)
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('助手只执行明确任务', () => {
  it('切换测点后撤下旧测点的处置导览，不拼接不同对象', async () => {
    await db.events.put(makeEvent({ id: 'evt_demo_context', pointId: P_CRACK }))
    await useEventsStore().reload()
    const assistant = useAssistantStore()
    expect(assistant.beginGuide('evt_demo_context')).toBe(true)
    await assistant.rereadGuide()
    await assistant.ask('B03-F2-TILT01怎么样')
    expect(assistant.context.pointId).toBe(P_TILT)
    expect(assistant.guideActive).toBe(false)
    expect(assistant.guidePlan).toBeNull()
  })
  it('执行同测点的巡检任务时撤下历史处置卡，只显示本次真实任务', async () => {
    authorize()
    await db.events.put(makeEvent({ id: 'evt_old_guide', pointId: P_CRACK }))
    await useEventsStore().reload()
    const assistant = useAssistantStore()
    assistant.beginGuide('evt_old_guide')
    await assistant.rereadGuide()
    await assistant.ask('演示 B03-F2-CRACK01 的巡检和模拟NFC')
    expect(assistant.guideActive).toBe(false)
    expect(useDirectorStore().link?.query.task).toBeDefined()
  })
  it.each(['B03-F2-CRACK01怎么样', '为什么是红色', '读数恢复了吗', '照片有什么变化', '帮我验收工单', '全校监测情况'])('普通问题 %s 不执行准备', async (question) => {
    authorize()
    const before = await tables()
    const clock = useClockStore().nowKey
    expect(directorIntent(question)).toBeNull()
    expect(await runDirector({ question, context: {} })).toBeNull()
    expect(await tables()).toBe(before)
    expect(useClockStore().nowKey).toBe(clock)
  })
  it('纯 askZhutong 即使听到演示问法仍然零写库', async () => {
    authorize()
    const before = await tables()
    await askZhutong('带我演示 B03-F2-CRACK01')
    expect(await tables()).toBe(before)
  })
  it('没有授权给唯一设置入口，不造数据', async () => {
    const result = await runDirector({ question: '带我演示 B03-F2-CRACK01', context: {} })
    expect(result?.status).toBe('not_found')
    expect(result?.links[0]?.path).toBe('/settings')
    expect(await db.records.count()).toBe(0)
  })
  it('未给对象先列候选，失效编号不回退到默认裂缝点', async () => {
    authorize()
    const choice = await runDirector({ question: '带我演示', context: {} })
    expect(choice?.status).toBe('need_choice')
    expect(choice?.candidates.length).toBe(4)
    const missing = await runDirector({ question: '带我演示 B03-F2-CRACK99', context: { pointId: P_CRACK } })
    expect(missing?.status).toBe('not_found')
    expect(await db.records.count()).toBe(0)
  })
})

describe('准备、导航和回执沿同一对象', () => {
  it('兼容旧任务定位同一测点，不再识别下一幕', async () => {
    authorize()
    const result = await runDirector({ question: '带我演示 B03-F2-TILT01', context: {} })
    const state = useDirectorStore()
    expect(result?.pointId).toBe(P_TILT)
    expect(state.link?.query).toMatchObject({ b: 'bld_b03', f: 'flr_b03_02', point: P_TILT, view: '3d' })
    expect(state.navigationSeq).toBe(1)
    const blocked = await runDirector({ question: '下一幕', context: { pointId: P_TILT } })
    expect(blocked).toBeNull()
    expect(state.navigationSeq).toBe(1)
    expect(useMediaStore().frames).toHaveLength(0)
  })
  it('巡检一条请求直达真实task，下一步仍由人模拟读卡', async () => {
    authorize()
    await runDirector({ question: '演示 B03-F2-CRACK01 的巡检和模拟NFC', context: {} })
    const task = useTaskStore().tasks[0]!
    const state = useDirectorStore()
    expect(state.link?.query.task).toBe(task.id)
    expect(state.link?.deep).toBe(true)
    expect(task.results[0]?.pointId).toBe(P_CRACK)
    expect(task.results[0]?.attempts).toHaveLength(0)
    expect(buildLink('inspection_page').deep).toBe(false)
  })
  it('缺少照片或解码失败后不进入下一页，对账区分失败与已提交记录', async () => {
    authorize()
    vi.spyOn(useMediaStore(), 'loadEvidencePair').mockResolvedValue(0)
    const result = await runDirector({ question: '演示 B03-F2-CRACK01 的裂缝变化', context: {} })
    expect(result?.status).toBe('not_found')
    expect(useDirectorStore().navigationSeq).toBe(0)
    expect(await db.records.count()).toBe(4)
    const receipt = await runDirector({ question: '演示对账单', context: {} })
    expect(receipt?.facts.find((row) => row.label === '实际新增')?.value).toBe('4')
    expect(receipt?.facts.find((row) => row.label === '失败或拦截')?.value).toBe('1')
  })
  it('回执按主键去重，不把两次请求算成8条采样', async () => {
    authorize()
    await runDirector({ question: '演示 B03-F2-CRACK01 的采样', context: {} })
    await runDirector({ question: '演示 B03-F2-CRACK01 的采样', context: {} })
    const before = await tables()
    const out = await runDirector({ question: '演示对账单', context: {} })
    expect(out?.facts.find((row) => row.label === '实际新增')?.value).toBe('4')
    expect(out?.facts.find((row) => row.label === '实际复用')?.value).toBe('0')
    expect(await tables()).toBe(before)
  })
  it('关闭小瞳不结束授权，结束本次演示后不能再补采样', async () => {
    authorize()
    const assistant = useAssistantStore()
    await assistant.ask('演示 B03-F2-CRACK01 的采样')
    assistant.close()
    expect(usePreparationSession().active).toBe(true)
    await assistant.ask('结束本次演示')
    const before = await tables()
    await assistant.ask('演示 B03-F2-TILT01 的采样')
    expect(assistant.last?.result?.status).toBe('not_found')
    expect(await tables()).toBe(before)
  })
})
