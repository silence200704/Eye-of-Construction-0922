import { DEMO_EVIDENCE_REGIONS, PUBLIC_CRACK_REFERENCE } from './demoPhotos'

export const DEMO_VIDEOS = [
  {
    key: 'change', title: '固定机位 · 裂缝变化演示',
    path: '/demo-media/videos/crack-change-simulated.mp4',
    poster: '/demo-media/commons-crack-example.jpg',
    source: 'booledozer / CC0 实拍照片派生',
    sourceUrl: PUBLIC_CRACK_REFERENCE.source,
    note: '12 秒合成变化演示：实拍原图 → 模拟中间态 → 模拟变化图；非真实连续拍摄，非本校。',
    comparable: true,
  },
  {
    key: 'inspection', title: '公开实拍 · 砖墙裂缝巡检',
    path: '/demo-media/videos/brick-inspection.mp4',
    poster: '/demo-media/videos/brick-inspection-poster.jpg',
    source: 'Tima Miroshnichenko / Pexels License',
    sourceUrl: 'https://www.pexels.com/video/close-up-video-of-a-bricks-6474187/',
    note: '公开砖墙实拍，非本校。镜头移动、画面没有配准，只展示回放和关键帧，不据此判定裂缝变宽。',
    comparable: false,
  },
] as const

export type DemoVideoKey = typeof DEMO_VIDEOS[number]['key']
export const VIDEO_REGIONS = DEMO_EVIDENCE_REGIONS
export const VIDEO_BOUNDARY = '本地视频预设分析：只抽 3 帧，不识别裂缝、不量毫米、不生成预警；刷新即失。'
