import { describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { useMediaStore } from '@/stores/media'
import { buildSnapshot } from '@/assistant/selectors'
import { answerVideo } from '@/assistant/video/answer'
import { requestedVideoAsset, videoFocus } from '@/assistant/video/focus'
import type { MediaCompareRecord } from '@/types/media'
import type { SessionVideo } from '@/types/media/video'
import { setupHarness, record, NOW } from '../../assistant/harness'

const VIDEO: SessionVideo = {
  id: 'video-a', pointId: 'pnt_1', assetKey: 'change', assetVersion: 1, fileName: 'change.mp4',
  title: '固定机位 · 裂缝变化演示', durationSeconds: 12, width: 960, height: 720,
  loadedAt: NOW, source: 'CC0照片派生', note: '模拟变化，非本校', comparable: true,
}

function prepareVideo() {
  const media = useMediaStore()
  media.videoMeta = { ...VIDEO }
  media.frames = [3, 6, 9].map(timeCode => ({
    id: `frame-${timeCode}`, pointId: VIDEO.pointId, videoId: VIDEO.id, origin: 'video_frame',
    capturedAt: NOW, label: '关键帧', fileName: 'frame.jpg', size: 1, width: 480, height: 360,
    blob: new Blob(['frame']), timeCode,
  }))
  const region: MediaCompareRecord = {
    pointId: VIDEO.pointId, beforeId: 'frame-3', afterId: 'frame-9',
    region: { x: .2, y: .2, w: .2, h: .2 }, status: 'changed', summary: '疑似变化（差异15.5%）',
    changedRatio: .155, comparedAt: NOW,
  }
  media.videoAnalysis = {
    videoId: VIDEO.id, pointId: VIDEO.pointId, frameIds: media.frames.map(row => row.id), reason: '',
    regions: { crack: region, control: { ...region, status: 'stable', summary: '未见明显差异', changedRatio: 0 } },
  }
  return media
}

describe('同一视频按问题重点回答', () => {
  it('公开ask入口六种问题各答所问，同时只读业务表与共享时钟', async () => {
    const h = await setupHarness({ records: [record({ sampleTime: NOW, enteredAt: NOW })] })
    prepareVideo()
    const before = await Promise.all(db.tables.map(table => table.toArray()))
    const cases = [
      ['播放这个演示视频', '回放，请点击下方播放器'],
      ['提取这个视频的三个关键帧', '时间码为 3.0 / 6.0 / 9.0'],
      ['对比这个视频的首末关键帧', '疑似变化（差异15.5%）'],
      ['视频变化和传感器读数一致吗？', '不能确认视频变化与传感器读数真实一致'],
      ['为什么这段视频不能前后比对？', '并非“不能比对”'],
      ['这个视频现在是什么状态？', '已完成预设区域对比'],
    ]
    const answers = []
    for (const [question, expected] of cases) {
      const result = await h.ask(question, { pointId: 'pnt_1' })
      expect(result.conclusion).toContain(expected)
      expect(result.pointId).toBe('pnt_1')
      answers.push(result.conclusion)
    }
    expect(new Set(answers).size).toBe(cases.length)
    expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before)
    expect(h.clock.nowKey).toBe(NOW)
  })

  it('移动机位解释实际不能比对的原因，不复制固定机位的比例', async () => {
    const h = await setupHarness()
    const media = prepareVideo()
    media.videoMeta = { ...VIDEO, assetKey: 'inspection', comparable: false, title: '公开巡检实拍' }
    media.videoAnalysis = { ...media.videoAnalysis!, regions: {}, reason: '镜头移动，画面未配准。' }
    const result = await h.ask('为什么这段视频不能前后比对？', { pointId: 'pnt_1' })
    expect(result.conclusion).toContain('镜头移动')
    expect(result.conclusion).not.toContain('15.5%')
  })

  it('没有分析不沿用旧差异，缺控制区不能编出0%', async () => {
    await setupHarness()
    const media = prepareVideo()
    const snapshot = buildSnapshot()
    const point = snapshot.points[0]
    delete media.videoAnalysis!.regions.control
    expect(answerVideo(buildSnapshot(), point, '对比视频首末帧').conclusion).toContain('完好墙面尚无计算结果')
    media.videoAnalysis = null
    expect(answerVideo(buildSnapshot(), point, '视频差异是多少').conclusion).toContain('尚未完成')
  })

  it('不存在当前视频时不借其他测点素材作答', async () => {
    await setupHarness()
    const media = prepareVideo()
    media.videoMeta = { ...VIDEO, pointId: 'other-point' }
    const snapshot = buildSnapshot()
    expect(answerVideo(snapshot, snapshot.points[0], '视频和读数一致吗').status).toBe('not_found')
  })

  it('素材标题里的“变化”不把播放问题误判成差异比较', () => {
    expect(videoFocus('播放裂缝变化演示视频')).toBe('playback')
    expect(videoFocus('提取裂缝变化视频的三个关键帧')).toBe('keyframes')
  })

  it('对比/抽帧沿用当前同点实拍；明确切换或跨点才另选素材', () => {
    const current = { ...VIDEO, assetKey: 'inspection' }
    expect(requestedVideoAsset('对比该测点的视频首末关键帧', current, 'pnt_1')).toBe('inspection')
    expect(requestedVideoAsset('提取视频关键帧', current, 'pnt_1')).toBe('inspection')
    expect(requestedVideoAsset('播放固定机位演示视频', current, 'pnt_1')).toBe('change')
    expect(requestedVideoAsset('对比该测点的视频首末关键帧', current, 'other-point')).toBe('change')
    expect(requestedVideoAsset('播放公开实拍演示视频', VIDEO, 'pnt_1')).toBe('inspection')
    expect(requestedVideoAsset('分析这段视频', { ...VIDEO, assetKey: '' }, 'pnt_1')).toBe('current')
  })
})
