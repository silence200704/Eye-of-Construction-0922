import { describe, expect, it } from 'vitest'
import { createRunner } from '@/core/demo/showcase/runner'
import { resolveWorkspace, workspaceStorageKey } from '@/core/demo/workspace'
import { ZhutongDatabase } from '@/db/database'
import { makeBuilding } from '../../fixtures'

describe('独立演示与事务边界', () => {
  it('只有明确的演示参数选择独立库，主库偏好键保持兼容', () => {
    expect(resolveWorkspace('')).toBe('main')
    expect(resolveWorkspace('?workspace=showcase')).toBe('showcase')
    expect(resolveWorkspace('?workspace=unknown')).toBe('main')
    expect(workspaceStorageKey('zhutong-demo/session', 'main')).toBe('zhutong-demo/session')
    expect(workspaceStorageKey('zhutong-demo/session', 'showcase')).toBe('zhutong-showcase/session')
  })

  it('提问请求暂停时等待在途提交结束，继续不重复该步骤', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const committed: string[] = []
    const runner = createRunner({ steps: [
      { id: 'first', run: async () => { await gate; committed.push('first') } },
      { id: 'second', run: async () => { committed.push('second') } },
    ] })
    const running = runner.start()
    const pausing = runner.pause()
    expect(committed).toEqual([])
    release()
    await pausing
    await running
    expect(committed).toEqual(['first'])
    expect(runner.state.status).toBe('paused')
    await runner.start()
    expect(committed).toEqual(['first', 'second'])
    expect(runner.state.status).toBe('completed')
  })

  it('失败不越过当前步骤，重试仅继续未成功步骤', async () => {
    let failing = true
    const committed: string[] = []
    const runner = createRunner({ steps: [
      { id: 'first', run: async () => { committed.push('first') } },
      { id: 'second', run: async () => { if (failing) throw new Error('事务失败'); committed.push('second') } },
    ] })
    await runner.start()
    expect(runner.state.status).toBe('failed')
    expect(runner.state.error).toBe('事务失败')
    expect(runner.state.next).toBe(1)
    failing = false
    await runner.start()
    expect(committed).toEqual(['first', 'second'])
  })

  it('并发点击合并为一个运行，恢复的运行始终暂停', async () => {
    let count = 0
    const steps = [{ id: 'first', run: async () => { count += 1 } }]
    const runner = createRunner({ steps })
    await Promise.all([runner.start(), runner.start()])
    expect(count).toBe(1)
    const resumed = createRunner({ steps, saved: { next: 0, status: 'running' } })
    expect(resumed.state.status).toBe('paused')
    expect(count).toBe(1)
  })
})
it('演示已完成后的提问暂停保留完成状态', async () => {
  const runner = createRunner({ steps: [{ id: 'done', run: async () => {} }] })
  await runner.start()
  await runner.pause()
  expect(runner.state.status).toBe('completed')
})
it('演示库复位的真实清表事务不会修改主库中的同编号档案', async () => {
  const main = new ZhutongDatabase('showcase-isolation-main-test')
  const demo = new ZhutongDatabase('showcase-isolation-demo-test')
  const marker = makeBuilding({ id: 'same-id', name: '主库保留档案' })
  try {
    await main.buildings.put(marker)
    await demo.buildings.put({ ...marker, name: '演示档案' })
    await demo.transaction('rw',demo.tables,async () => {
      for (const table of demo.tables) await table.clear()
    })
    expect(await main.buildings.get(marker.id)).toEqual(marker)
    expect(await demo.buildings.count()).toBe(0)
  } finally {
    await main.delete()
    await demo.delete()
  }
})
