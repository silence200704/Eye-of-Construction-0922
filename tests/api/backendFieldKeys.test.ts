import { beforeEach, describe, expect, it, vi } from 'vitest'

const { command } = vi.hoisted(() => ({ command: vi.fn() }))

vi.mock('@/api/backend/runtime', () => ({
  command,
  read: vi.fn(),
  commandRaw: vi.fn(),
  blobOf: vi.fn(),
}))

import {
  generateInspectionTasksRemote,
  generateMaintenanceRemote,
  saveInspectionPlanRemote,
  saveMaintenancePlanRemote,
} from '@/api/backend/field'

function lastKey(): string {
  const call = command.mock.calls.at(-1)
  return String(call?.[1]?.key ?? '')
}

describe('field remote command keys', () => {
  beforeEach(() => {
    command.mockReset()
    command.mockResolvedValue({
      data: { created: [], skipped: 0, code: 'X' },
      rev: null,
      replayed: false,
      requestId: '',
      datasetEpoch: 1,
    })
  })

  it('uses the caller operation key for generation and does not fix it to a day', async () => {
    await generateInspectionTasksRemote('2026-10-19', 'inspection-operation-a')
    expect(lastKey()).toBe('inspection-operation-a')
    await generateInspectionTasksRemote('2026-10-19', 'inspection-operation-b')
    expect(lastKey()).toBe('inspection-operation-b')
    await generateMaintenanceRemote('2026-10-19', 'maintenance-operation-a')
    expect(lastKey()).toBe('maintenance-operation-a')
  })

  it('includes expectedRev in plan edit keys', async () => {
    await saveInspectionPlanRemote({ name: '同一草稿' }, 'plan-1', 1)
    const first = lastKey()
    await saveInspectionPlanRemote({ name: '同一草稿' }, 'plan-1', 1)
    expect(lastKey()).toBe(first)
    await saveInspectionPlanRemote({ name: '同一草稿' }, 'plan-1', 2)
    expect(lastKey()).not.toBe(first)
    await saveMaintenancePlanRemote({ name: '同一草稿' }, 'plan-1', 1)
    const maintenanceFirst = lastKey()
    await saveMaintenancePlanRemote({ name: '同一草稿' }, 'plan-1', 2)
    expect(lastKey()).not.toBe(maintenanceFirst)
  })
})
