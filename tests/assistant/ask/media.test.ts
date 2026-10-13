/**
 * 问筑瞳 · 影像问答（工作线 C 联动）。
 *
 * 这一组守的是"能答什么、不能答什么"：
 * 没有影像时说清缺什么并给出去哪儿补；有影像时报来源/时间/测点/现象；
 * **不给毫米数、不说 AI、不自动生成预警**，且问答全程不写库。
 */
import { describe, expect, it } from 'vitest'
import { askZhutong } from '@/assistant/ask'
import { db } from '@/db/database'
import { useMediaStore } from '@/stores/media'
import { frameOriginLabel } from '@/types/media'
import { makePoint } from '../../fixtures'
import { setupHarness } from '../harness'

/** 会话影像：测试里只放一个占位 Blob（比对要真解码，这里只验回答口径） */
function frameBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
}

function addFrames(pointId: string, count: number): void {
  const media = useMediaStore()
  for (let i = 0; i < count; i += 1) {
    media.addUpload({
      pointId,
      capturedAt: `2026-09-2${i + 1}T09:00:00.000Z`,
      label: `西墙裂缝下缘（第 ${i + 1} 次）`,
      fileName: `crack-${i + 1}.jpg`,
      width: 640,
      height: 480,
      blob: frameBlob(),
    })
  }
}

describe('影像问答：没有影像时', () => {
  it('说明缺什么、去哪儿补，而不是一句"未接入"', async () => {
    const h = await setupHarness({ records: [] })
    const result = await h.ask('照片有变化吗')

    expect(result.intent).toBe('media_compare')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('没有可对比的影像')
    const gaps = result.gaps.join('\n')
    expect(gaps).toContain('影像对比页')
    expect(gaps).toContain('不接校园监控')
    expect(gaps).toContain('不会凭图片编造裂缝宽度')
    // 深链：影像页 + 趋势
    expect(result.links.some((row) => row.kind === 'media_page' && row.path === '/media')).toBe(true)
  })

  it('演示视频已载入但还没抽帧时，提示下一步该点哪里', async () => {
    const h = await setupHarness()
    const media = useMediaStore()
    media.videoMeta = { durationSeconds: 8, width: 640, height: 360, fileName: 'demo.mp4' }
    const result = await h.ask('照片有变化吗')
    expect(result.gaps.join('\n')).toContain('还没抽关键帧')
  })
})

describe('影像问答：有影像但还没比对时', () => {
  it('报来源、时间与关联测点，并说明"现象"还需要跑预设分析', async () => {
    const h = await setupHarness({ records: [] })
    addFrames('pnt_1', 2)
    const result = await h.ask('照片有变化吗')

    expect(result.status).toBe('answered')
    expect(result.conclusion).toContain('B01-F2-CRACK01')
    const facts = result.facts.map((row) => `${row.label}=${row.value}`).join('\n')
    expect(facts).toContain('会话影像=2 张')
    expect(facts).toContain('影像来源=人工上传')
    expect(facts).toContain('可观察现象=尚未运行预设分析')
    expect(result.gaps.join('\n')).toContain('框选同一区域')
  })

  it('视频关键帧会带上时间码，来源写清是演示视频', async () => {
    const h = await setupHarness({ records: [] })
    const media = useMediaStore()
    media.addUpload({ pointId: 'pnt_1', capturedAt: '2026-09-20T09:00:00.000Z', label: '上传图', fileName: 'a.jpg', width: 640, height: 480, blob: frameBlob() })
    // 手工放一条关键帧（抽帧要真视频，这里只验回答口径）
    media.frames.push({
      id: 'media_video_1',
      pointId: 'pnt_1',
      origin: 'video_frame',
      capturedAt: '2026-09-21T09:00:03.000Z',
      label: '演示视频｜第 3.0 秒',
      fileName: 'demo.mp4#t=3.0',
      size: 100,
      width: 640,
      height: 360,
      blob: frameBlob(),
      timeCode: 3,
    })

    const result = await h.ask('照片有变化吗')
    const facts = result.facts.map((row) => `${row.label}=${row.value}`).join('\n')
    expect(facts).toContain('人工上传')
    expect(facts).toContain('演示视频关键帧')
    expect(facts).toContain('视频关键帧时间码=3.0 秒')
  })

  it('点名测点时按该测点回答', async () => {
    const h = await setupHarness({
      points: [
        makePoint({ id: 'pnt_1', code: 'B01-F2-CRACK01' }),
        makePoint({ id: 'pnt_2', code: 'B01-F2-TILT01', name: '二层走廊中柱倾角测点', metric: 'tilt_xy', type: 'tilt' }),
      ],
      records: [],
    })
    addFrames('pnt_1', 1)
    const media = useMediaStore()
    media.addUpload({ pointId: 'pnt_2', capturedAt: '2026-09-25T09:00:00.000Z', label: '倾角点影像', fileName: 'tilt.jpg', width: 640, height: 480, blob: frameBlob() })

    const result = await h.ask('B01-F2-TILT01 的照片有变化吗')
    expect(result.conclusion).toContain('B01-F2-TILT01')
    expect(result.conclusion).not.toContain('CRACK01')
  })
})

describe('生成演示照片来源', () => {
  it('来源标签明确是生成素材，不写成现场采集', () => {
    expect(frameOriginLabel('demo_generated')).toBe('生成演示照片')
    expect(frameOriginLabel('demo_generated')).not.toMatch(/现场|采集|在线/)
  })

  it('会话里出现演示照片时，回答明确模拟来源和日期', async () => {
    const h = await setupHarness({ records: [] })
    const media = useMediaStore()
    media.frames.push({
      id: 'media_demo_1',
      pointId: 'pnt_1',
      origin: 'demo_generated',
      capturedAt: '2026-09-27T09:00:00.000Z',
      label: '生成演示照片',
      fileName: 'corridor-crack-before.png',
      size: 120,
      width: 640,
      height: 480,
      blob: frameBlob(),
      timeCode: null,
    })

    const result = await h.ask('照片有变化吗')
    const facts = result.facts.map((row) => `${row.label}=${row.value}`).join('|')
    expect(facts).toContain('生成演示照片')
    const notes = result.dataNotes.join('|')
    expect(notes).toContain('模拟值')
    expect(notes).toContain('不调用摄像头')
    expect(notes).toContain('不调用在线 AI')
  })
})

describe('口径与只读纪律', () => {
  it('任何影像回答都不给毫米数、不说 AI、不暗示自动预警', async () => {
    const h = await setupHarness({ records: [] })
    addFrames('pnt_1', 2)
    const media = useMediaStore()
    media.compare = {
      pointId: 'pnt_1',
      beforeId: media.frames[0].id,
      afterId: media.frames[1].id,
      region: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
      status: 'changed',
      summary: '框选区域内有 12.0% 的像素出现明显差异（阈值 8%），属于**疑似变化**，需要人工复核。',
      changedRatio: 0.12,
      comparedAt: '2026-09-26T09:00:00.000Z',
    }

    const result = await h.ask('照片有变化吗')
    const text = [result.conclusion, ...result.facts.map((row) => `${row.label}=${row.value}`), ...result.gaps, ...result.dataNotes].join('\n')

    expect(result.conclusion).toContain('疑似变化')
    expect(text).not.toMatch(/\d+(\.\d+)?\s*(mm|毫米)/)
    // 只禁"肯定式"的越界说法：边界说明里"不接摄像头、不调用在线 AI"是否定式，允许出现
    expect(text).not.toMatch(/AI ?识别|AI ?分析|人工智能识别|已接入摄像头|实时监控|远程监控已接入/)
    expect(text).toContain('不会自动生成正式结构预警')
    expect(text).toContain('不接校园监控')
  })

  it('影像问答不写库：问完前后本地表一字未动，也没生成任何预警事件', async () => {
    const h = await setupHarness({ records: [] })
    addFrames('pnt_1', 2)
    const before = await db.events.count()
    const auditsBefore = await db.audits.count()

    await h.ask('照片有变化吗')
    await h.ask('B01-F2-CRACK01 的照片有什么变化')

    expect(await db.events.count()).toBe(before)
    expect(await db.audits.count()).toBe(auditsBefore)
    expect(await db.attachments.count()).toBe(0)
  })

  it('影像在会话里、刷新即失：store 不落库，也不进备份', async () => {
    await setupHarness({ records: [] })
    addFrames('pnt_1', 3)
    const media = useMediaStore()
    expect(media.frameCount).toBe(3)
    // 只存内存：数据库里没有任何影像行
    expect(await db.attachments.count()).toBe(0)
    media.clearPoint('pnt_1')
    expect(media.frameCount).toBe(0)
  })

  it('空问题/无关问法仍然不进影像回答', async () => {
    await setupHarness()
    const result = await askZhutong('把服务器重启一下')
    expect(result.intent).toBe('unknown')
  })
})
