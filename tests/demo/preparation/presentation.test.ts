import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleAnswer } from '@/assistant/ask'
import { composeVisualEvidence } from '@/assistant/linkage/compose'
import { presentMediaTask } from '@/assistant/director/presentation'
import { buildSnapshot } from '@/assistant/selectors'
import { P_CRACK } from '@/db/seedFactories'
import type { PreparationReceipt } from '@/core/demo/preparation/types'
import { setup, sample, tables, NOW } from './harness'

beforeEach(setup)
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function receipt(): PreparationReceipt {
  return {
    requestId: 'request', demoSessionId: 'session', datasetEpoch: 'epoch',
    capability: 'media', pointId: P_CRACK, at: NOW, status: 'ready',
    created: [], reused: [{ kind: 'frame', id: 'before', label: '原图', source: '测试' }],
    skipped: [], failed: [],
  }
}

async function visualAnswer() {
  await sample({ values: { width: 0.53 } })
  const snapshot = buildSnapshot()
  const point = snapshot.points.find(row => row.id === P_CRACK)!
  const content = composeVisualEvidence({
    snapshot, point, single: null, active: 'crack', matchNote: '按明确编号',
    pair: { kind: 'media_pair', pointId: P_CRACK, beforeId: 'before', afterId: 'after', source: 'session', note: '测试', regions: null },
    results: { crack: null, control: null, custom: null },
  })
  return assembleAnswer('B03-F2-CRACK01的裂缝有什么变化', 'visual_evidence', content, snapshot)
}

describe('分析任务保留实际结论与执行回执', () => {
  it('任务只增加准备回执，不替换分析结论和原证据', async () => {
    const queried = await visualAnswer()
    const before = await tables()
    const presented = presentMediaTask(queried, [receipt()])
    expect(presented.conclusion).toBe(queried.conclusion)
    expect(presented.facts.find(row => row.label === '素材准备')?.value).toContain('实际新增 0 项，复用 1 项')
    expect(presented.facts.find(row => row.label === '任务执行')?.value).toContain('尚无区域差异计算结果')
    expect(presented.facts.some(row => ['展示顺序', '下一步'].includes(row.label))).toBe(false)
    expect(presented.facts).toEqual(expect.arrayContaining(queried.facts))
    expect(presented.previews).toBe(queried.previews)
    expect(presented.evidence).toBe(queried.evidence)
    expect(presented.gaps).toBe(queried.gaps)
    expect(await tables()).toBe(before)
  })
  it('没有历史峰值不编造峰值步骤，重复演示不编造新变化', async () => {
    const queried = await visualAnswer()
    const presented = presentMediaTask(queried, [receipt()])
    expect(presented.conclusion).toBe(queried.conclusion)
    expect(presented.dataNotes.join('')).toContain('不生成虚假的新变化')
    expect(presentMediaTask(queried, [receipt()])).toEqual(presented)
  })
  it('缺少照片对就说明缺项，失败与消歧不冒称演示准备完成', async () => {
    const queried = await visualAnswer()
    const preview = queried.previews.find(row => row.kind === 'visual_evidence')!
    if (preview.kind === 'visual_evidence') preview.pair = null
    expect(presentMediaTask(queried, [receipt()]).facts.find(row => row.label === '任务执行')?.value).toContain('缺少可比照片对')
    for (const status of ['not_found', 'need_choice'] as const) {
      const blocked = { ...queried, status, conclusion: '缺少资料' }
      expect(presentMediaTask(blocked, [receipt()])).toBe(blocked)
    }
  })
})
