import { describe, expect, it } from 'vitest'
import { mediaPairPreview } from '@/assistant/preview/mediaPair'
import { record, setupHarness } from '../harness'
import { DEMO_COMPARE_REGIONS } from '@/config/media/demoPhotos'
import type { MediaCompareRecord, MediaFrameRef } from '@/types/media'

const frame = (id: string, origin: MediaFrameRef['origin'], at: string): MediaFrameRef => ({
  id, pointId: 'pnt_1', origin, capturedAt: at, label: id, timeCode: null,
})

describe('回答内小图只展示已有证据', () => {
  it('测点趋势沿用有效记录，按采样时间排序，不把 20 秒动画伪装成采样时间', async () => {
    const h = await setupHarness({ records: [
      record({ id: 'later', sampleTime: '2026-09-20T10:00:00.000Z', values: { width: 0.62 } }),
      record({ id: 'bad', sampleTime: '2026-09-20T11:00:00.000Z', values: { width: 0.9 }, quality: 'invalid' }),
      record({ id: 'earlier', sampleTime: '2026-09-19T10:00:00.000Z', values: { width: 0.52 } }),
    ] })
    const result = await h.ask('二层走廊西墙裂缝测点怎么样')
    // 多预览：这段回答只有趋势，没有照片对
    expect(result.previews.map((row) => row.kind)).toEqual(['point_trend'])
    const trend = result.previews[0]
    if (trend.kind !== 'point_trend') return
    expect(trend.samples.flat().map((row) => row.recordId)).toEqual(['earlier', 'later'])
    expect(trend.samples.flat().map((row) => row.value)).toEqual([0.52, 0.62])
    expect(trend.samples.flat().map((row) => row.sampleTime)).toEqual([
      '2026-09-19T10:00:00.000Z', '2026-09-20T10:00:00.000Z',
    ])
  })

  it('没有有效读数时没有趋势图，不画虚构线', async () => {
    const h = await setupHarness({ records: [record({ quality: 'suspect' })] })
    expect((await h.ask('二层走廊西墙裂缝测点怎么样')).previews).toEqual([])
  })

  it('两张生成照片优先成对，公开实拍图不会混入前后组，并带上登记区域', () => {
    const rows = [frame('public', 'demo_public', '2026-09-10'), frame('before', 'demo_generated', '2026-09-11'), frame('after', 'demo_generated', '2026-09-12')]
    const preview = mediaPairPreview(rows, null)
    expect(preview).toMatchObject({ kind: 'media_pair', pointId: 'pnt_1', beforeId: 'before', afterId: 'after', source: 'builtin' })
    // 内置素材必须带上"人工预设的登记区域"，否则框选按钮就没有依据
    expect(preview?.regions).toEqual(DEMO_COMPARE_REGIONS)
    expect(preview?.note).toContain('模拟值')
  })

  it('用户自己的两张影像优先于内置素材，且不附带任何登记区域', () => {
    const rows = [frame('gen1', 'demo_generated', '2026-09-10'), frame('gen2', 'demo_generated', '2026-09-11'), frame('up1', 'upload', '2026-09-12'), frame('up2', 'upload', '2026-09-13')]
    const preview = mediaPairPreview(rows, null)
    expect(preview).toMatchObject({ beforeId: 'up1', afterId: 'up2', source: 'session', regions: null })
  })

  it('已有比对时精确展示那两张；比对帧失效后不偷换成别的图', () => {
    const rows = [frame('a', 'upload', '2026-09-10'), frame('b', 'upload', '2026-09-11'), frame('c', 'upload', '2026-09-12')]
    const compare = { pointId: 'pnt_1', beforeId: 'b', afterId: 'c' } as MediaCompareRecord
    expect(mediaPairPreview(rows, compare)).toMatchObject({ beforeId: 'b', afterId: 'c' })
    expect(mediaPairPreview(rows.slice(0, 2), compare)).toBeNull()
  })

  it('单张上传与单张内置图不自动拼成一对', () => {
    expect(mediaPairPreview([frame('user', 'upload', '2026-09-10'),
      frame('builtin', 'demo_evidence', '2026-09-11')], null)).toBeNull()
  })
})
