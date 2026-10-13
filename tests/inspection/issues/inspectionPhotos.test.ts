/** 巡检上报的照片原子性：问题、任务关联、附件与日志必须同生共死。 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { attachmentIdOf, type DraftPhotoInput } from '@/db/inspection/attachments'
import { useArchiveStore } from '@/stores/archive'
import { usePlanStore } from '@/stores/inspection/plans'
import { useSessionStore } from '@/stores/session'
import { useTaskStore } from '@/stores/inspection/tasks'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const building = makeBuilding({ id: 'bld_1' })
const floor = makeFloor({ id: 'flr_1', buildingId: building.id, zones: ['二层走廊'] })
const point = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: building.id, floorId: floor.id, zoneId: '二层走廊' })

function photo(id: string): DraftPhotoInput {
  const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2])], { type: 'image/jpeg' })
  return { id, fileName: `${id}.jpg`, blob, thumb: blob, size: blob.size, width: 640, height: 480, capturedAt: AT }
}

async function setup() {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  await db.buildings.put(building)
  await db.floors.put(floor)
  await db.points.put(point)
  const archive = useArchiveStore()
  archive.buildings = [building]
  archive.floors = [floor]
  archive.points = [point]
  const session = useSessionStore()
  session.name = '张工'
  session.role = 'inspector'
  const plans = usePlanStore()
  await plans.savePlan(null, {
    name: '照片巡检', kind: 'patrol', buildingId: building.id, floorIds: [floor.id], pointIds: [point.id],
    cycle: { unit: 'day', interval: 1, atTime: '09:00' }, startDate: '2026-09-01', endDate: null,
    owner: '李老师', executorRole: 'inspector', checklist: [], enabled: true, remark: '',
  })
  const tasks = useTaskStore()
  await tasks.generateFor(new Date('2026-09-20T00:00:00.000Z'))
  return { tasks, taskId: tasks.tasks[0]!.id }
}

function report(tasks: ReturnType<typeof useTaskStore>, taskId: string, photoDrafts: DraftPhotoInput[], reuseIssueId?: string) {
  return tasks.reportInspectionIssue(taskId, point.id, {
    anomalyType: '探头松动', description: '巡检发现固定支架松动', photoDrafts, reuseIssueId,
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('巡检问题的照片同事务提交', () => {
  it('首次上报：问题、任务关联、照片与两条日志一次成立', async () => {
    const { tasks, taskId } = await setup()
    const logsBefore = await db.audits.count()
    const out = await report(tasks, taskId, [photo('p1')])
    expect(out.ok).toBe(true)
    expect(out.issue?.photos).toEqual([attachmentIdOf('p1')])
    expect((await db.tasks.get(taskId))?.results[0]?.abnormalHandling.linkedIssueId).toBe(out.issue?.id)
    expect(await db.attachments.count()).toBe(1)
    expect(await db.audits.count()).toBe(logsBefore + 2)
  })

  it('附件或任务写入失败时，问题、任务关联和照片全部回滚', async () => {
    const { tasks, taskId } = await setup()
    const original = db.attachments.bulkPut.bind(db.attachments)
    ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = () => { throw new Error('模拟附件失败') }
    await expect(report(tasks, taskId, [photo('p1')])).rejects.toThrow('模拟附件失败')
    ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = original
    expect(await db.issues.count()).toBe(0)
    expect(await db.attachments.count()).toBe(0)
    expect((await db.tasks.get(taskId))?.results[0]?.issueIds).toEqual([])

    const taskWrite = db.tasks.put.bind(db.tasks)
    ;(db.tasks as unknown as { put: unknown }).put = () => { throw new Error('模拟任务失败') }
    await expect(report(tasks, taskId, [photo('p1')])).rejects.toThrow('模拟任务失败')
    ;(db.tasks as unknown as { put: unknown }).put = taskWrite
    expect(await db.issues.count()).toBe(0)
    expect(await db.attachments.count()).toBe(0)
  })

  it('同草稿重试不重复；复用原问题补新草稿时任务关联仍完整', async () => {
    const { tasks, taskId } = await setup()
    const first = await report(tasks, taskId, [photo('p1')])
    const same = await report(tasks, taskId, [photo('p1')], first.issue!.id)
    expect(same.duplicated).toBe(true)
    expect(await db.attachments.count()).toBe(1)

    const supplement = await report(tasks, taskId, [photo('p1'), photo('p2')], first.issue!.id)
    expect(supplement.issue?.photos).toEqual([attachmentIdOf('p1'), attachmentIdOf('p2')])
    expect(await db.attachments.count()).toBe(2)
    const row = await db.tasks.get(taskId)
    expect(row?.results[0]?.issueIds).toEqual([first.issue!.id])
    expect((await db.issues.get(first.issue!.id))?.timeline.filter((item) => item.action === '补充照片')).toHaveLength(1)
  })
})
