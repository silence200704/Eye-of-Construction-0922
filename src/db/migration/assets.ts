import { blobToDataUrl } from '@/db/backup'
import { DEMO_PHOTOS, DEMO_EVIDENCE_PAIR, PUBLIC_CRACK_REFERENCE } from '@/config/media/demoPhotos'
import { DEMO_VIDEOS } from '@/config/media/demoVideos'
import type { MigrationPackage } from './types'

export async function exportBundledAssets(): Promise<MigrationPackage> {
  const specs = [
    ...DEMO_PHOTOS.map(row => ({ ...row, origin: 'demo_generated', source: '生成演示素材' })),
    ...DEMO_EVIDENCE_PAIR.map(row => ({ ...row, origin: row.key === 'before' ? 'demo_public' : 'demo_evidence', source: PUBLIC_CRACK_REFERENCE.source, author: PUBLIC_CRACK_REFERENCE.author, license: PUBLIC_CRACK_REFERENCE.license })),
    ...DEMO_VIDEOS.map(row => ({ ...row, fileName: row.path.split('/').pop()!, mimeType: 'video/mp4', origin: row.key === 'change' ? 'demo_generated' : 'demo_public' })),
    { path: '/demo-media/videos/brick-inspection-poster.jpg', fileName: 'brick-inspection-poster.jpg', mimeType: 'image/jpeg', origin: 'demo_public', source: DEMO_VIDEOS[1].sourceUrl },
  ]
  const assets = []
  for (const row of specs) {
    const response = await fetch(`${import.meta.env.BASE_URL}${row.path.slice(1)}`)
    if (!response.ok) throw new Error(`随包素材读取失败：${row.fileName}`)
    const blob = new Blob([await response.arrayBuffer()], { type: row.mimeType })
    assets.push({ ...row, id: row.path, blob: await blobToDataUrl(blob) })
  }
  const note = await fetch(`${import.meta.env.BASE_URL}demo-media/videos/来源与处理.md`)
  if (!note.ok) throw new Error('随包素材来源说明读取失败')
  return { format: 'zhutong-migration-v1', schemaVersion: 7, sourceName: 'project-bundled-assets', exportedAt: new Date().toISOString(), counts: {}, data: {}, runtime: { assets, preferences: [{ key: 'bundled-media/source-notes', value: await note.text() }] }, warnings: [] }
}
