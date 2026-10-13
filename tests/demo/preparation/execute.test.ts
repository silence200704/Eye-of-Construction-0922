import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { P_CRACK, P_TILT } from '@/db/seedFactories'
import { db } from '@/db/database'
import { prepareForDemo } from '@/stores/demo/preparation/execute'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { markDatasetReset } from '@/stores/demo/registry'
import { useMediaStore } from '@/stores/media'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useSessionStore } from '@/stores/session'
import { useRecordsStore } from '@/stores/records'
import { setup, authorize, sample, frames, tables, NOW } from './harness'

beforeEach(setup)
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('演示准备授权与边界', () => {
  it('没有入口授权时零写库', async () => {
    const before = await tables()
    const out = await prepareForDemo('sampling', P_CRACK)
    expect(out.status).toBe('blocked')
    expect(await tables()).toBe(before)
  })
  it('结束演示、数据集重置、页面重启都撤销授权', () => {
    authorize()
    const session = usePreparationSession()
    expect(session.active).toBe(true)
    session.end()
    expect(session.active).toBe(false)
    authorize()
    markDatasetReset(NOW)
    expect(session.active).toBe(false)
    authorize()
    setActivePinia(createPinia())
    expect(usePreparationSession().active).toBe(false)
  })
  it('不向未登记测点编造采样或借裂缝图给倾角点', async () => {
    authorize()
    const before = await tables()
    expect((await prepareForDemo('sampling', 'pnt_custom')).status).toBe('blocked')
    expect((await prepareForDemo('media', P_TILT)).status).toBe('blocked')
    expect(await tables()).toBe(before)
  })
  it('另一标签修改数据集代次，即使响应式缓存未更新也拒绝写入', async () => {
    authorize()
    const session = usePreparationSession()
    expect(session.active).toBe(true)
    localStorage.setItem('zhutong-demo/demo-registry', JSON.stringify({ entries: {}, resetAt: 'changed-in-other-tab' }))
    expect(session.isCurrent()).toBe(false)
    expect((await prepareForDemo('sampling', P_CRACK)).status).toBe('blocked')
    expect(await db.records.count()).toBe(0)
  })
  it('全链可选开启会话，部分失败只开放实际成功能力', async () => {
    const chain = await import('@/stores/writes/demo/chain')
    vi.spyOn(chain, 'loadFullChain').mockResolvedValue({
      results: [{ key: 'mediaEvidence', ok: true, message: '素材存在', created: 0, skipped: 0, anchors: [] }, { key: 'inspection', ok: false, message: '缺计划', created: 0, skipped: 0, anchors: [] }],
      created: 0, skipped: 0, message: '部分成功', chainLine: '', chainOk: false, liveOk: false,
    })
    await useDemoScenarioStore().loadChain({ autoPrepare: true })
    expect(usePreparationSession().capabilities).toEqual(['media'])
    expect((await prepareForDemo('sampling', P_CRACK)).status).toBe('blocked')
    await useDemoScenarioStore().loadChain()
    expect(usePreparationSession().active).toBe(false)
  })
  it('排队期间退出，在执行时重验授权，零新增', async () => {
    authorize()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const waiting = useDemoScenarioStore().enqueuePreparation(() => gate)
    const pending = prepareForDemo('sampling', P_CRACK)
    usePreparationSession().end()
    release()
    await waiting
    expect((await pending).status).toBe('blocked')
    expect(await db.records.count()).toBe(0)
  })
})

describe('只补当前测点的采样', () => {
  it('两次并发请求只追加四条，真实回执分新增和复用', async () => {
    authorize()
    const [first, second] = await Promise.all([prepareForDemo('sampling', P_CRACK), prepareForDemo('sampling', P_CRACK)])
    expect(first.status).toBe('ready')
    expect(first.created).toHaveLength(4)
    expect(second.created).toHaveLength(0)
    expect(second.reused).toHaveLength(4)
    expect((await db.records.toArray()).every((row) => row.pointId === P_CRACK)).toBe(true)
    expect(await db.records.count()).toBe(4)
  })
  it.each(['suspect', 'invalid'] as const)('近期最新%s记录不能被演示数据盖过', async (quality) => {
    authorize()
    await sample({ quality })
    const before = await tables()
    expect((await prepareForDemo('sampling', P_CRACK)).status).toBe('blocked')
    expect(await tables()).toBe(before)
  })
  it('近期手填有效值直接复用，过期手填不自动追加', async () => {
    authorize()
    await sample({ source: 'manual', values: { width: 0.59 } })
    const before = await tables()
    expect((await prepareForDemo('sampling', P_CRACK)).reused).toHaveLength(1)
    expect(await tables()).toBe(before)
    vi.setSystemTime(new Date(Date.parse(NOW) + 31 * 60_000))
    expect((await prepareForDemo('sampling', P_CRACK)).status).toBe('blocked')
    expect(await tables()).toBe(before)
  })
  it('未来采样拒绝；过期有效演示采样按窗口追加，重试不重复', async () => {
    authorize()
    await sample({ sampleTime: new Date(Date.parse(NOW) + 60_000).toISOString() })
    expect((await prepareForDemo('sampling', P_CRACK)).status).toBe('blocked')
    await db.records.clear()
    await sample({ sampleTime: new Date(Date.parse(NOW) - 31 * 60_000).toISOString() })
    expect((await prepareForDemo('sampling', P_CRACK)).created).toHaveLength(4)
    expect((await prepareForDemo('sampling', P_CRACK)).created).toHaveLength(0)
  })
  it('过程中退出停止后续写入并报告已提交的一条', async () => {
    authorize()
    const records = useRecordsStore()
    const original = records.addRecord
    vi.spyOn(records, 'addRecord').mockImplementation(async (input) => {
      const row = await original(input)
      usePreparationSession().end()
      return row
    })
    const receipt = await prepareForDemo('sampling', P_CRACK)
    expect(receipt.status).toBe('cancelled')
    expect(receipt.created).toHaveLength(1)
    expect(await db.records.count()).toBe(1)
  })
})

describe('照片与巡检最小准备', () => {
  it('优先现有两张用户照片，单图不被补图替换', async () => {
    authorize()
    frames()
    const media = useMediaStore()
    const spy = vi.spyOn(media, 'loadEvidencePair')
    const receipt = await prepareForDemo('media', P_CRACK)
    expect(receipt.reused).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()
    frames('upload', 1)
    expect((await prepareForDemo('media', P_CRACK)).status).toBe('blocked')
    expect(media.frames).toHaveLength(1)
  })
  it('解码失败回执真实失败，不把素材登记当作读图成功', async () => {
    authorize()
    vi.spyOn(useMediaStore(), 'loadEvidencePair').mockResolvedValue(0)
    const receipt = await prepareForDemo('media', P_CRACK)
    expect(receipt.status).toBe('failed')
    expect(receipt.created).toHaveLength(0)
    expect(receipt.failed.join()).toContain('解码未完成')
  })
  it('生成单点待办，不签到、不改变身份、不生成其它计划任务', async () => {
    authorize()
    const role = useSessionStore().role
    const before = await prepareForDemo('inspection', P_CRACK)
    expect(before.status).toBe('ready')
    expect(before.created.map((row) => row.kind).sort()).toEqual(['plan', 'task'])
    const rows = await db.tasks.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.results[0]?.attempts).toEqual([])
    expect(rows[0]?.results[0]?.status).toBe('pending')
    expect(useSessionStore().role).toBe(role)
    const second = await prepareForDemo('inspection', P_CRACK)
    expect(second.reused.map((row) => row.kind)).toEqual(['task'])
    expect(second.created).toHaveLength(0)
    expect(await db.tasks.count()).toBe(1)
  })
  it('停用计划不自动重启，已办理任务不被重置', async () => {
    authorize()
    await prepareForDemo('inspection', P_CRACK)
    const plans = usePlanStore()
    const tasks = useTaskStore()
    const task = (await db.tasks.get(tasks.tasks[0]!.id))!
    await db.tasks.update(task.id, { results: task.results.map((row) => ({ ...row, status: 'completed', checkedAt: NOW })), status: 'checked' })
    await plans.setEnabled(plans.plans[0]!.id, false)
    const before = await tables()
    const receipt = await prepareForDemo('inspection', P_CRACK)
    expect(receipt.status).toBe('failed')
    expect(await tables()).toBe(before)
  })
})
